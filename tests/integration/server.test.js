/**
 * @file server.test.js
 * @description server.js (Express HTTP および WebSocket サーバー) に対する結合テスト。
 *
 * -------------------------------------------------------------
 * 【結合テストの特徴・ハックについて】
 * 1. ポート衝突回避:
 *    http.Server.prototype.listen をテストの実行前（server.js ロード前）にフックし、
 *    指定されたポート (3000) を「0（OSによる空きポート自動割り当て）」に置換します。
 *    これにより、既存の開発サーバーが起動したままでも、ポート衝突を起こさずにテストを実行できます。
 *
 * 2. 外部依存の完全モック:
 *    ローカルDB (lowdb)、OBS WebSocket、ファイル監視 (chokidar) をモック化し、
 *    テスト実行中に不要なファイルの書き換えやOBSへの接続リトライが発生しないようにしています。
 *
 * 【新規API・メッセージのテスト追加ガイド】
 * WebSocket経由での新しいイベント要求（例: クライアントからのデータ送信や設定保存）をテストする場合は、
 * 以下のようにクライアント接続を確立した上で AAA パターンで検証します。
 *
 * it('should process my new ws event', async () => {
 *     // 1. Arrange: クライアント接続と送信データの準備
 *     const client = new WebSocket(`ws://localhost:${allocatedPort}`);
 *     const myPayload = { type: 'my_event', payload: { ... } };
 *
 *     // 2. Act: イベントの送信と応答の待機
 *     await new Promise(resolve => client.on('open', resolve));
 *     client.send(JSON.stringify(myPayload));
 *
 *     // 3. Assert: サーバー側の処理結果（DBのモックメソッドが呼ばれたか、等）を検証
 *     expect(mockedDbWrite).toHaveBeenCalled();
 *     client.close();
 * });
 * -------------------------------------------------------------
 */

import http from 'http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

// --- 1. Arrange: 外部モジュール・依存関係のモック設定 (インポート前に行う必要があります) ---

// vi.hoistedを使ってモック関数を定義
const { mockLowRead, mockLowWrite } = vi.hoisted(() => {
    return {
        mockLowRead: vi.fn().mockResolvedValue(undefined),
        mockLowWrite: vi.fn().mockResolvedValue(undefined)
    };
});

// lowdb のモック (テスト環境の db.json を書き換えないようにインメモリで動作させる)
vi.mock('lowdb', () => {
    return {
        Low: class {
            constructor(adapter, defaultData) {
                this.data = defaultData;
            }
            read = mockLowRead;
            write = mockLowWrite;
        }
    };
});
vi.mock('lowdb/node', () => {
    return {
        JSONFile: class { }
    };
});

// OBS WebSocket クライアントのモック (実際のOBSへの接続試行を防止)
vi.mock('obs-websocket-js', () => {
    return {
        OBSWebSocket: class {
            connect = vi.fn().mockResolvedValue(undefined);
            on = vi.fn();
            call = vi.fn().mockResolvedValue({});
            identified = false;
        },
        EventSubscription: {
            Outputs: 'Outputs'
        }
    };
});

// Chokidar のモック (ジャーナルフォルダの監視による意図しないディスクアクセスを防止)
vi.mock('chokidar', () => {
    return {
        default: {
            watch: () => ({
                on: function () { return this; }
            })
        }
    };
});

// server.js 起動時に動く listen をインターセプトし、空きポートを自動割り当て
let capturedServer;
let allocatedPort;
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
    capturedServer = this;
    // ポート 3000 の代わりに自動割り当てポート（0番）を使用
    if (typeof args[0] === 'number') {
        args[0] = 0;
    }
    return originalListen.apply(this, args);
};

// サーバーモジュールを動的にインポートして起動する
// これにより上記の listen フックが機能し、ポート 0 で Express サーバーが起動します
let journalProcessor;
await import('../../server.js').then((mod) => {
    journalProcessor = mod.journalProcessor;
});

describe('Server Integration', () => {
    beforeAll(async () => {
        // サーバーが正常に起動してアドレス（ポート）が確定するのを待機
        await new Promise(resolve => {
            if (capturedServer && capturedServer.listening) {
                allocatedPort = capturedServer.address().port;
                resolve();
            } else if (capturedServer) {
                capturedServer.once('listening', () => {
                    allocatedPort = capturedServer.address().port;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    });

    afterAll(() => {
        // テスト終了時にポートを閉じる (リソースリークの防止)
        if (capturedServer) {
            capturedServer.close();
        }
        vi.restoreAllMocks();
    });

    it('should serve HTML/CSS static files', async () => {
        // 1. Arrange: なし

        // 2. Act: 起動したサーバーに対してルートパスのGET要求を行う
        const response = await fetch(`http://localhost:${allocatedPort}/`);

        // 3. Assert: レスポンスステータスコードと HTML コンテンツの確認
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain('<!DOCTYPE html>');
    });

    it('should establish WebSocket connection and send initial payloads', async () => {
        // 1. Arrange: テスト用 WebSocket クライアントの作成
        const client = new WebSocket(`ws://localhost:${allocatedPort}`);

        // メッセージ受信待機ロジック
        const receiveMessages = () => {
            return new Promise((resolve, reject) => {
                const received = [];
                const timeout = setTimeout(() => {
                    client.close();
                    reject(new Error(`Timeout: Received only ${received.length} messages`));
                }, 3000);

                client.on('message', (data) => {
                    const msg = JSON.parse(data);
                    received.push(msg);

                    // 接続時にサーバーからプッシュ送信されるはずの3つの必須ペイロード
                    // (full_update, log_update, layout_apply) の受信を確認
                    if (received.length >= 3) {
                        clearTimeout(timeout);
                        client.close();
                        resolve(received);
                    }
                });

                client.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });
        };

        // 2. Act: WebSocket接続を確立し、初期メッセージを受信
        const messages = await receiveMessages();

        // 3. Assert: 期待される3種類の更新イベントメッセージがすべて含まれていることを検証
        expect(messages.some(m => m.type === 'full_update')).toBe(true);
        expect(messages.some(m => m.type === 'log_update')).toBe(true);
        expect(messages.some(m => m.type === 'layout_apply')).toBe(true);
    });

    it('should handle layout_update message with collapsed state, write to DB and broadcast to other clients', async () => {
        // 1. Arrange: 2つのWebSocketクライアント接続の準備
        const client1 = new WebSocket(`ws://localhost:${allocatedPort}`);
        const client2 = new WebSocket(`ws://localhost:${allocatedPort}`);

        await Promise.all([
            new Promise((resolve) => client1.on('open', resolve)),
            new Promise((resolve) => client2.on('open', resolve))
        ]);

        // client2が受信するlayout_applyメッセージを監視
        const receiveBroadcast = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Broadcast timeout')), 3000);
            client2.on('message', (data) => {
                const msg = JSON.parse(data);
                if (msg.type === 'layout_apply' && msg.payload.collapsed) {
                    clearTimeout(timeout);
                    resolve(msg.payload);
                }
            });
        });

        // mock lowdb write の呼び出し履歴をリセット
        mockLowWrite.mockClear();

        const layoutPayload = {
            columns: {
                'left-column': ['mission'],
                'right-column': ['combat']
            },
            collapsed: {
                'toggle-progress': true,
                'toggle-mission': false
            }
        };

        const payload = {
            type: 'layout_update',
            payload: layoutPayload
        };

        // 2. Act: client1から layout_update メッセージをサーバーに送信
        client1.send(JSON.stringify(payload));

        const broadcastData = await receiveBroadcast;

        // 3. Assert: DB書き込みが行われ、他のクライアントにcollapsed情報が含まれるlayout_applyが届いたことを検証
        expect(mockLowWrite).toHaveBeenCalled();
        expect(broadcastData).toEqual(layoutPayload);

        client1.close();
        client2.close();
    });

    it('should handle reset_stats message and save session to DB', async () => {
        // 1. Arrange: 時間モックを有効化し（Dateのみモックしてタイマーは動かす）、システム時刻を2時間進めてセッション保存条件(>0.01h)を満たす
        vi.useFakeTimers({ toFake: ['Date'] });

        // セッション開始時刻を設定するため一度リセット状態にする
        const { getInitialState } = await import('../../src/utils.js');
        journalProcessor.resetState(getInitialState());

        const now = new Date();
        vi.setSystemTime(now);
        vi.setSystemTime(new Date(now.getTime() + 2 * 60 * 60 * 1000)); // 2時間進める

        const client = new WebSocket(`ws://localhost:${allocatedPort}`);
        await new Promise((resolve) => client.on('open', resolve));

        mockLowWrite.mockClear();

        const payload = {
            type: 'reset_stats'
        };

        // 2. Act: reset_stats メッセージをサーバーに送信
        client.send(JSON.stringify(payload));

        // セッション永続化とリセット処理の非同期完了を待機
        await new Promise((resolve) => setTimeout(resolve, 200));

        // 3. Assert: 十分なセッション時間があるため、セッション保存 (lowdb.write) が実行されることを検証
        expect(mockLowWrite).toHaveBeenCalled();
        client.close();

        // リアルタイムタイマーを復元
        vi.useRealTimers();
    });

    it('should handle get_history message and return history data', async () => {
        // 1. Arrange: WebSocket接続と受信待機の準備
        const client = new WebSocket(`ws://localhost:${allocatedPort}`);
        await new Promise((resolve) => client.on('open', resolve));

        const getHistoryPayload = {
            type: 'get_history'
        };

        const waitForHistory = () => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    client.close();
                    reject(new Error('Timeout waiting for history_data'));
                }, 3000);

                client.on('message', (data) => {
                    const msg = JSON.parse(data);
                    // get_history に対する返信タイプは history_data
                    if (msg.type === 'history_data') {
                        clearTimeout(timeout);
                        client.close();
                        resolve(msg);
                    }
                });
            });
        };

        // 2. Act: get_history を送信し、レスポンスを待つ
        client.send(JSON.stringify(getHistoryPayload));
        const response = await waitForHistory();

        // 3. Assert: 返ってきたデータ構造が正しいか検証 (モックDBのデフォルト履歴配列)
        expect(response).toHaveProperty('payload');
        expect(Array.isArray(response.payload)).toBe(true);
    });
});

