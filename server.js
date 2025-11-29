// Elite: Dangerous Real-time Dashboard - Server
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { EventSubscription, OBSWebSocket } from 'obs-websocket-js';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { MAX_OBS_RETRIES, PORT } from './src/constants.js';
import JournalProcessor from './src/journalProcessor.js';
import { getInitialState } from './src/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- DBのセットアップ ---
const defaultData = {
    layout: {
        'left-column': ['rank-progression', 'mission', 'event-log'],
        'right-column': ['combat', 'trading', 'exploration', 'material']
    },
    history: []
};
const adapter = new JSONFile('db.json');
const db = new Low(adapter, defaultData);
await db.read(); // 既存のdb.jsonからデータを読み込む

// db.jsonが空オブジェクト{}などの場合にデフォルト値を適用する
db.data = { ...defaultData, ...db.data };
db.data.history = db.data.history || [];

// --- グローバル状態変数 ---
let initialState = getInitialState(); // デフォルトの初期状態

// DBの履歴から最新のセッションデータのランク情報のみを取得し、初期状態として設定する
if (db.data.history && db.data.history.length > 0) {
    console.log('DBから最新のランク情報を復元します。');
    const lastSession = db.data.history[db.data.history.length - 1];

    // lastSessionにprogressプロパティが存在する場合、それだけを復元する
    if (lastSession && lastSession.progress) {
        initialState.progress = JSON.parse(JSON.stringify(lastSession.progress));
    }
}

/** イベントログの更新を全クライアントに通知する */
function broadcastLogUpdate(eventLog) {
    const payload = JSON.stringify({ type: 'log_update', payload: eventLog });
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(payload);
        }
    });
}

const broadcastUpdate = (state) => {
    const payload = JSON.stringify({ type: 'full_update', payload: makePayload(state) });
    wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
            client.send(payload);
        }
    });
};

/** OBSの録画を停止する */
const stopRecording = async () => {
    // OBSに接続されていない場合は何もしない
    if (!obs.identified) {
        return;
    }
    try {
        const { outputActive } = await obs.call('GetRecordStatus');
        if (outputActive) {
            console.log('セッション終了を検知し、録画を自動停止します。');
            await obs.call('StopRecord');
        }
    } catch (e) {
        // GetRecordStatusが利用できない場合(OBS未接続など)はエラーになるが、無視して良い
        if (e.code !== 'NotConnected') {
            console.error('録画の自動停止中にエラー:', e);
        }
    }
};

// --- ExpressサーバーとWebSocketサーバーのセットアップ ---
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- JournalProcessorのインスタンス化 ---
const journalProcessor = new JournalProcessor(initialState);
journalProcessor.on('update', broadcastUpdate);
journalProcessor.on('logUpdate', broadcastLogUpdate);
journalProcessor.on('sessionEnd', stopRecording);

journalProcessor.startMonitoring();

wss.on('connection', (ws) => {
    ws.id = crypto.randomUUID(); // 各クライアントに一意のIDを割り当て
    console.log(`クライアントが接続しました。 ID: ${ws.id}`);
    ws.send(JSON.stringify({ type: 'full_update', payload: makePayload(journalProcessor.state) }));
    ws.send(JSON.stringify({ type: 'log_update', payload: journalProcessor.eventLog })); // 接続時に現在のログを送信
    ws.send(JSON.stringify({ type: 'layout_apply', payload: db.data.layout })); // 接続時にDBから読み込んだ順序を送信

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'reset_stats') {
                console.log('リセット要求を受信しました。統計情報を初期化します。');
                await persistSessionData(); // 状態をリセットする前に現在のセッションを保存
                journalProcessor.resetState(getInitialState());
            } else if (data.type === 'start_obs_recording') {
                await obs.call('StartRecord');
            } else if (data.type === 'stop_obs_recording') {
                await obs.call('StopRecord');
            } else if (data.type === 'layout_update') {
                db.data.layout = data.payload;
                await db.write(); // DBにレイアウトを保存
            } else if (data.type === 'resume_last_session') {
                console.log('最後のセッションの再開要求を受信しました。');
                if (db.data.history && db.data.history.length > 0) {
                    const lastSession = db.data.history[db.data.history.length - 1];
                    // サーバー側でも復元可能かチェック
                    if (journalProcessor.isResumable()) {
                        journalProcessor.resumeState(lastSession);
                    } else {
                        console.warn('復元不可能なタイミングのため、要求を拒否しました。');
                    }
                } else {
                    console.log('復元可能なセッションデータがありません。');
                }

                // 送信元以外の全クライアントに更新を通知
                wss.clients.forEach(client => {
                    if (client.id !== ws.id && client.readyState === client.OPEN) {
                        client.send(JSON.stringify({ type: 'layout_apply', payload: db.data.layout }));
                    }
                });
            } else if (data.type === 'get_history') {
                // 履歴データの要求に応じて、DBから読み込んだデータを送信
                ws.send(JSON.stringify({ type: 'history_data', payload: db.data.history || [] }));
            }
        } catch (e) {
            console.error('受信メッセージの処理中にエラー:', e);
        }
    });
});

// --- OBS WebSocketクライアントのセットアップ ---
const obs = new OBSWebSocket();
async function connectToOBSAtStartup() {
    for (let i = 0; i < MAX_OBS_RETRIES; i++) {
        try {
            console.log(`OBS WebSocketへの接続を試みます... (試行 ${i + 1}/${MAX_OBS_RETRIES})`);
            // OBS接続部分
            await obs.connect(
                process.env.OBS_WEBSOCKET_URL || 'ws://localhost:4455',
                process.env.OBS_WEBSOCKET_PASSWORD, // 環境変数からパスワードを読み込む
                { eventSubscriptions: EventSubscription.Outputs }
            );
            console.log('OBS WebSocketに接続しました。');
            return; // 接続に成功したので関数を終了
        } catch (error) {
            if (i < MAX_OBS_RETRIES - 1) {
                // 最後でないなら5秒待機
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
    // ループが完了しても接続できなかった場合
    console.error('OBSへの接続に失敗しました。OBS連携機能は無効になります。');
}

obs.on('ConnectionClosed', () => {
    // 接続が切れたことを通知するのみで、再接続は試みない
    console.error('OBS WebSocketとの接続が切れました。');
});

obs.on('RecordStateChanged', (data) => {
    if (!data.outputPath) {
        return;
    }
    const isRecording = data.outputActive;
    const obsStatePayload = { type: 'obs_recording_state', payload: { isRecording } };
    wss.clients.forEach(client => client.send(JSON.stringify(obsStatePayload)));
    console.log(`RecordStateChanged: ${JSON.stringify(data)}`);

    journalProcessor.setRecordingState(isRecording, new Date());
});

function makePayload(state) {
    // クライアントに送信する用の状態オブジェクトをディープコピー
    const stateForBroadcast = JSON.parse(JSON.stringify(state));

    // 復元可能フラグを追加
    stateForBroadcast.isResumable = journalProcessor.isResumable();

    // セッションの経過時間を取得
    const elapsedHours = journalProcessor.getElapsedSessionHours();

    // 時間効率
    stateForBroadcast.trading.profitPerHour = null;
    stateForBroadcast.bounty.bountyPerHour = null;

    if (elapsedHours !== null && elapsedHours > 0) {
        // 時間あたり利益
        stateForBroadcast.trading.profitPerHour = state.trading.profit / elapsedHours;
        // 時間あたり懸賞金額 (Bounty + CombatBond)
        stateForBroadcast.bounty.bountyPerHour = state.bounty.totalRewards / elapsedHours;
    }

    // トンあたりの利益
    stateForBroadcast.trading.profitPerTon = null;
    if (state.trading.unitsSold > 0) {
        stateForBroadcast.trading.profitPerTon = state.trading.profit / state.trading.unitsSold;
    }

    // ROI (投資利益率)
    stateForBroadcast.trading.roi = null;
    if (state.trading.totalBuy > 0) {
        stateForBroadcast.trading.roi = (stateForBroadcast.trading.profit / stateForBroadcast.trading.totalBuy) * 100;
    }

    // bounty.targetsを処理し、TOP5と「その他」に集約する
    const originalTargets = state.bounty.targets;
    const sortedTargets = originalTargets ? Object.entries(originalTargets).sort(([, a], [, b]) => b - a) : [];

    if (sortedTargets.length > 5) {
        const newTargets = {};
        // TOP5を新しいオブジェクトにコピー
        const top5 = sortedTargets.slice(0, 5);
        for (const [name, count] of top5) { newTargets[name] = count; }
        const othersTotal = sortedTargets.slice(5).reduce((sum, [, count]) => sum + count, 0);
        if (othersTotal > 0) { newTargets['OTHERS'] = othersTotal; }
        // ブロードキャスト用のstateを更新
        stateForBroadcast.bounty.targets = newTargets;

    }

    // materials.detailsをカテゴリごとに処理し、TOP5と「その他」に集約する
    const originalMaterialDetails = state.materials.details;
    // カテゴリごとに集約した結果を格納する新しいオブジェクト
    const newMaterialDetails = {};
    for (const category in originalMaterialDetails) {
        const materialsInCategory = originalMaterialDetails[category];
        const sortedMaterials = Object.entries(materialsInCategory).sort(([, a], [, b]) => b - a);
        if (sortedMaterials.length > 5) {
            const newCategoryDetails = {};
            const top5 = sortedMaterials.slice(0, 5);
            for (const [name, count] of top5) { newCategoryDetails[name] = count; }
            const othersTotal = sortedMaterials.slice(5).reduce((sum, [, count]) => sum + count, 0);
            if (othersTotal > 0) { newCategoryDetails['OTHERS'] = othersTotal; }
            newMaterialDetails[category] = newCategoryDetails;
        } else {
            newMaterialDetails[category] = materialsInCategory;
        }
    }
    stateForBroadcast.materials.details = newMaterialDetails;
    return stateForBroadcast;
}

/** 現在のセッションデータをDBに保存する */
async function persistSessionData() {
    // 現在のセッションデータを履歴に追加
    // journalProcessor.stateには、makePayloadで計算される派生データ（時間効率など）が含まれない点に注意
    const finalState = makePayload(journalProcessor.state);
    const sessionData = {
        date: new Date().toISOString(),
        session_duration_hours: journalProcessor.getElapsedSessionHours(),
        ...finalState
    };

    // 循環参照や巨大すぎるデータなどを排除
    delete sessionData.materials.details;
    delete sessionData.bounty.targets;

    if (sessionData.session_duration_hours > 0.01) { // 1分未満のセッションは保存しない
        db.data.history = [...db.data.history, sessionData]; // 配列の末尾にセッションデータを追加
        await db.write();
        console.log('セッションデータを保存しました。');
    } else {
        console.log('セッション時間が短すぎるため、データは保存されませんでした。');
    }
}

// --- サーバーシャットダウン処理 ---
process.on('SIGINT', async () => {
    console.log('サーバーシャットダウン処理を開始します (SIGINT)...');
    await stopRecording();
    await persistSessionData();

    server.close(() => {
        console.log('サーバーを正常にシャットダウンしました。');
        process.exit(0);
    });
});

// --- サーバー起動 ---
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
    console.log(`ダッシュボードを開く: http://localhost:${PORT}`);
    connectToOBSAtStartup(); // OBSへの接続を開始
});
