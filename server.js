// Elite: Dangerous Real-time Dashboard - Server
import express from 'express';
import http from 'http';
import { EventSubscription, OBSWebSocket } from 'obs-websocket-js';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { MAX_OBS_RETRIES, PORT } from './src/constants.js';
import JournalProcessor from './src/journalProcessor.js';
import { getInitialState } from './src/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- グローバル状態変数 ---


let state = getInitialState(); // 初期化

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

// --- ExpressサーバーとWebSocketサーバーのセットアップ ---
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- JournalProcessorのインスタンス化 ---
const journalProcessor = new JournalProcessor(state, broadcastUpdate, broadcastLogUpdate);
journalProcessor.startMonitoring();

wss.on('connection', (ws) => {
    console.log('クライアントが接続しました。');
    ws.send(JSON.stringify({ type: 'full_update', payload: makePayload(journalProcessor.state) }));
    ws.send(JSON.stringify({ type: 'log_update', payload: journalProcessor.eventLog })); // 接続時に現在のログを送信

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'reset_stats') {
                console.log('リセット要求を受信しました。統計情報を初期化します。');
                journalProcessor.resetState(getInitialState());
            } else if (data.type === 'start_obs_recording') {
                await obs.call('StartRecord');
            } else if (data.type === 'stop_obs_recording') {
                await obs.call('StopRecord');
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
    if(!data.outputPath) {
        return;
    }
    const isRecording = data.outputActive;
    const obsStatePayload = { type: 'obs_recording_state', payload: { isRecording } };
    wss.clients.forEach(client => client.send(JSON.stringify(obsStatePayload)));
    console.log(`RecordStateChanged: ${JSON.stringify(data)}`);

    journalProcessor.setRecordingState(isRecording, new Date());
    console.debug(journalProcessor.eventLog);
});

function makePayload(state) {
    // クライアントに送信する用の状態オブジェクトをディープコピー
    const stateForBroadcast = JSON.parse(JSON.stringify(state));

    // bounty.targetsを処理し、TOP5と「その他」に集約する
    const originalTargets = state.bounty.targets;
    const sortedTargets = Object.entries(originalTargets).sort(([, a], [, b]) => b - a);

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

// --- サーバー起動 ---
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
    console.log(`ダッシュボードを開く: http://localhost:${PORT}`);
    connectToOBSAtStartup(); // OBSへの接続を開始
});