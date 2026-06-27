/**
 * @file journalProcessor.test.js
 * @description src/journalProcessor.js (ジャーナルログファイル監視・解析クラス) に対するユニットテスト。
 *
 * -------------------------------------------------------------
 * 【新規イベント解析テストの追加ガイド】
 * 新しいゲームログイベント（例: 新しいミッション完了や交易等）を追加し、その解析結果を検証したい場合は、
 * 以下の AAA（Arrange-Act-Assert）パターンに倣ってイベント追記と検証を行ってください。
 *
 * 1. Arrange: テスト対象イベントオブジェクトを定義する
 *    const myNewEvent = {
 *        timestamp: new Date().toISOString(),
 *        event: 'MyNewEventName',
 *        MyDataField: 'MyValue',
 *        ...
 *    };
 *
 * 2. Act: テスト用一時ログファイルにイベントを書き込み、状態更新 (update イベント) を待つ
 *    fs.appendFileSync(logFilePath, JSON.stringify(myNewEvent) + '\n', 'utf-8');
 *    state = await nextUpdate(); // Chokidarの検知と解析完了を待機
 *
 * 3. Assert: state オブジェクトが期待通りに更新されているかを検証する
 *    expect(state.myTargetCategory.myField).toBe(expectedValue);
 * -------------------------------------------------------------
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInitialState } from '../../src/utils.js';

// テスト用の一時ディレクトリを設定
const tempDir = path.join(os.tmpdir(), 'ed-dashboard-test-journals');

// constants.js の JOURNAL_DIR を一時ディレクトリにモック
vi.mock('../../src/constants.js', async () => {
    const actual = await vi.importActual('../../src/constants.js');
    // ホイスト対策として内部でモジュールパスを動的に解決
    const os = await import('os');
    const path = await import('path');
    return {
        ...actual,
        JOURNAL_DIR: path.join(os.tmpdir(), 'ed-dashboard-test-journals'),
        UI_DEBOUNCE: 10 // テスト実行を高速化するためUIデバウンスを10msに短縮
    };
});

// モックの後にモジュールをインポート
import { JournalProcessor } from '../../src/journalProcessor.js';

describe('JournalProcessor', () => {
    let processor;
    let logFilePath;

    beforeEach(() => {
        // --- 1. Arrange: テスト実行用の一時ディレクトリと空のログファイルを作成 ---
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // 接頭辞 Journal.YYYY-MM-DD に適合する一時ログファイル名を作成
        const today = new Date();
        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        const logFilename = `Journal.${year}-${month}-${day}.01.log`;
        logFilePath = path.join(tempDir, logFilename);

        // ファイルを空で新規作成
        fs.writeFileSync(logFilePath, '', 'utf-8');

        // テスト対象インスタンスの生成
        processor = new JournalProcessor(getInitialState());
    });

    afterEach(() => {
        // --- 監視停止とクリーンアップ ---
        if (processor) {
            // テストごとの多重登録を防ぐため、イベントリスナーを全て解除
            processor.removeAllListeners();
        }

        // 作成した一時ディレクトリとログファイルを再帰的削除
        if (fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) {
                console.error('Failed to cleanup temp dir', e);
            }
        }
        vi.restoreAllMocks();
    });

    it('should process journal entries and update state', async () => {
        // --- 1. Arrange: Chokidarによる非同期な状態更新を同期的に待つためのヘルパー ---
        const nextUpdate = () => {
            return new Promise((resolve) => {
                processor.once('update', (state) => {
                    resolve(state);
                });
            });
        };

        // 監視の開始 (初回ロードを実行)
        processor.startMonitoring();

        // 初回ロード完了時 (空ファイル読み込み完了) の最初の update イベントを待機
        let state = await nextUpdate();
        expect(processor.isResumable()).toBe(true);

        // --- 2. Act: イベントログファイルを段階的に追記し、逐次処理結果を待機 ---

        // (1) LoadGame イベントの書き込み
        const loadGameEvent = {
            timestamp: new Date().toISOString(),
            event: 'LoadGame',
            Docked: true,
            Ship: 'ferdelance',
            ShipID: 1,
            FuelCapacity: 32.0
        };
        fs.appendFileSync(logFilePath, JSON.stringify(loadGameEvent) + '\n', 'utf-8');
        state = await nextUpdate(); // 反映後の状態を取得

        // (2) FSDJump イベントの書き込み
        const fsdJumpEvent = {
            timestamp: new Date().toISOString(),
            event: 'FSDJump',
            StarSystem: 'Eranin',
            JumpDist: 12.4,
            Factions: [{ Name: 'Eranin People\'s Party', Allegiance: 'Independent' }]
        };
        fs.appendFileSync(logFilePath, JSON.stringify(fsdJumpEvent) + '\n', 'utf-8');
        state = await nextUpdate();

        // (3) Bounty イベントの書き込み (先に ShipTargeted でパイロットランクを設定)
        const shipTargetedEvent = {
            timestamp: new Date().toISOString(),
            event: 'ShipTargeted',
            TargetLocked: true,
            PilotName: 'NPC_Dangerous',
            PilotRank: 6 // 6 = Dangerous
        };
        fs.appendFileSync(logFilePath, JSON.stringify(shipTargetedEvent) + '\n', 'utf-8');
        state = await nextUpdate();

        const bountyEvent = {
            timestamp: new Date().toISOString(),
            event: 'Bounty',
            Rewards: [{ Faction: 'Eranin People\'s Party', Reward: 80000 }],
            Target: 'sidewinder', // 小文字で送られた場合
            PilotName: 'NPC_Dangerous'
        };
        fs.appendFileSync(logFilePath, JSON.stringify(bountyEvent) + '\n', 'utf-8');
        state = await nextUpdate();

        // --- 3. Assert: 最終的な state オブジェクトが期待通りに集計されているか検証 ---
        // 探査関連の検証
        expect(state.exploration.jumpCount).toBe(1);
        expect(state.exploration.jumpDistance).toBe(12.4);

        // 戦闘関連の検証
        expect(state.bounty.count).toBe(1);
        expect(state.bounty.totalRewards).toBe(80000);
        // 先頭大文字化 (Sidewinder) に整形されていることを検証
        expect(state.bounty.targets['Sidewinder']).toBe(1);
        // パイロットランクが数値から名称 (Dangerous) にデコードされていることを検証
        expect(state.bounty.ranks['Dangerous']).toBe(1);
    }, 15000); // タイムアウトを15秒に設定 (Chokidarのファイル書き込み監視待機のため余裕を持たせる)
});

