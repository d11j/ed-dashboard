// Elite: Dangerous Real-time Dashboard - Server
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');
const os = require('os');
const { OBSWebSocket, EventSubscription } = require('obs-websocket-js'); // OBS WebSocketライブラリ

// --- 設定 ---
const PORT = 3000;
// Elite:Dangerousのジャーナルディレクトリを指定
const JOURNAL_DIR = path.join(os.homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');
const MAX_OBS_RETRIES = 5; // OBSへの最大再接続試行回数

// --- ランク定義 ---
const FED_RANKS = ['None', 'Recruit', 'Cadet', 'Midshipman', 'Petty Officer', 'Chief Petty Officer', 'Warrant Officer', 'Ensign', 'Lieutenant', 'Lieutenant Commander', 'Post Commander', 'Post Captain', 'Rear Admiral', 'Vice Admiral', 'Admiral'];
const EMP_RANKS = ['None', 'Outsider', 'Serf', 'Master', 'Squire', 'Knight', 'Lord', 'Baron', 'Viscount', 'Count', 'Earl', 'Marquis', 'Duke', 'Prince', 'King'];
const COMBAT_RANKS = ['Harmless', 'Mostly Harmless', 'Novice', 'Competent', 'Expert', 'Master', 'Dangerous', 'Deadly', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
const TRADE_RANKS = ['Penniless', 'Mostly Penniless', 'Peddler', 'Dealer', 'Merchant', 'Broker', 'Entrepreneur', 'Tycoon', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
const EXPLORE_RANKS = ['Aimless', 'Mostly Aimless', 'Scout', 'Surveyor', 'Explorer', 'Pathfinder', 'Ranger', 'Pioneer', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
const CQC_RANKS = ['Helpless', 'Mostly Helpless', 'Amateur', 'Semi-Professional', 'Professional', 'Champion', 'Hero', 'Legend', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
const SOLDIER_RANKS = ['Defenceless', 'Mostly Defenceless', 'Rookie', 'Soldier', 'Gunslinger', 'Warrior', 'Gladiator', 'Deadeye', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
const EXOBIOLOGIST_RANKS = ['Directionless', 'Mostly Directionless', 'Compiler', 'Collector', 'Cataloguer', 'Taxonomist', 'Ecologist', 'Geneticist', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];

const ALL_RANKS = {
    Combat: COMBAT_RANKS, Trade: TRADE_RANKS, Explore: EXPLORE_RANKS, Federation: FED_RANKS, Empire: EMP_RANKS,
    CQC: CQC_RANKS, Soldier: SOLDIER_RANKS, Exobiologist: EXOBIOLOGIST_RANKS
};

// --- グローバル状態変数 ---
// 初期状態を関数として定義
const getInitialState = () => ({
    lastUpdateTimestamp: null,
    bounty: {
        count: 0,
        totalRewards: 0,
        targets: {},
        ranks: {}
    },
    materials: {
        total: 0,
        categories: {},
        details: {}
    },
    missions: { // ミッション完了数
        completed: 0,
        federation: 0,
        empire: 0,
        independent: 0
    },
    progress: {
        Combat: { rank: 0, name: COMBAT_RANKS[0], progress: 0, nextName: COMBAT_RANKS[1] },
        Trade: { rank: 0, name: TRADE_RANKS[0], progress: 0, nextName: TRADE_RANKS[1] },
        Explore: { rank: 0, name: EXPLORE_RANKS[0], progress: 0, nextName: EXPLORE_RANKS[1] },
        Federation: { rank: 0, name: FED_RANKS[0], progress: 0, nextName: FED_RANKS[1] },
        Empire: { rank: 0, name: EMP_RANKS[0], progress: 0, nextName: EMP_RANKS[1] },
        CQC: { rank: 0, name: CQC_RANKS[0], progress: 0, nextName: CQC_RANKS[1] },
        Soldier: { rank: 0, name: SOLDIER_RANKS[0], progress: 0, nextName: SOLDIER_RANKS[1] },
        Exobiologist: { rank: 0, name: EXOBIOLOGIST_RANKS[0], progress: 0, nextName: EXOBIOLOGIST_RANKS[1] }
    }
});

let state = getInitialState(); // 初期化
const pilotRanks = {}; // 敵パイロットのランク情報を保持
const processedFiles = {};
const activeMissions = {}; // 進行中のミッション情報を保持
let factionAllegianceMap = {}; // 現在の星系の派閥と所属のマップ

// OBS連携用のグローバル変数
let recordingStartTime = null; // 録画開始時刻
let eventLog = [];             // イベントログの配列

// 状態管理フラグ
let isFighting = false; // 戦闘中かどうか
let wasHardpointsDeployed = false; // ハードポイントの以前の状態
let isLandingSequence = false;  // 着陸シーケンス中
let wasLandingGearDown = false; // ランディングギアの以前の状態
let isInitialTakeoffComplete = false; // セッション開始後の初回離陸が完了したか

// --- ExpressサーバーとWebSocketサーバーのセットアップ ---
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('クライアントが接続しました。');
    ws.send(JSON.stringify({ type: 'full_update', payload: makePayload() }));
    ws.send(JSON.stringify({ type: 'log_update', payload: eventLog })); // 接続時に現在のログを送信

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'reset_stats') {
                console.log('リセット要求を受信しました。統計情報を初期化します。');
                state = getInitialState();
                broadcastUpdate();
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
    const isRecording = data.outputActive;
    const obsStatePayload = { type: 'obs_recording_state', payload: { isRecording } };
    wss.clients.forEach(client => client.send(JSON.stringify(obsStatePayload)));
    console.log(`RecordStateChanged: ${JSON.stringify(data)}`);

    if (isRecording) {
        recordingStartTime = new Date();
        console.log(`録画開始: ${recordingStartTime}`);
        eventLog = ['[00:00:00] -- 録画開始 --'];
        broadcastLogUpdate();
    } else {
        if (recordingStartTime) {
            const elapsedTime = formatElapsedTime(new Date() - recordingStartTime);
            eventLog.push(`[${elapsedTime}] -- 録画停止 --`);
            console.log(`録画停止: ${elapsedTime}`);
            broadcastLogUpdate();
        }
        recordingStartTime = null;
    }
});

// --- ヘルパー関数 ---
/** 経過時間を HH:MM:SS 形式の文字列にフォーマットする */
function formatElapsedTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}
/** イベントログの更新を全クライアントに通知する */
function broadcastLogUpdate() {
    const payload = JSON.stringify({ type: 'log_update', payload: eventLog });
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) client.send(payload);
    });
}
function makePayload() {
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
function broadcastUpdate() {
    const payload = JSON.stringify({ type: 'full_update', payload: makePayload() });
    wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
            client.send(payload);
        }
    });
}

// --- ジャーナル処理ロジック ---
function processJournalLine(line) {
    try {
        if (line.trim() === '') return;
        const entry = JSON.parse(line);

        if (entry.timestamp) {
            state.lastUpdateTimestamp = entry.timestamp;
        }

        // --- ▼▼▼ 状態フラグ管理ロジック ▼▼▼ ---
        if (entry.event === 'LoadGame') {
            if (entry.Docked || entry.StartLanded) {
                isInitialTakeoffComplete = false;
                wasLandingGearDown = true;
            } else {
                isInitialTakeoffComplete = true;
                wasLandingGearDown = false;
            }
        } else if (entry.event === 'Undocked' || entry.event === 'Liftoff') {
            if (!isInitialTakeoffComplete) {
                isInitialTakeoffComplete = true;
            }
        }

        // --- 録画中のイベントログ記録 ---
        if (recordingStartTime) {
            const elapsedTime = formatElapsedTime(new Date() - recordingStartTime);
            let logMessage = '';
            let isMinorEvent = false;

            switch (entry.event) {
                case 'Bounty':
                    if (isFighting) isMinorEvent = true;
                    logMessage = `撃破: ${entry.Target_Localised || entry.Target}`;
                    break;
                case 'FSDJump':
                    logMessage = `ジャンプ: ${entry.StarSystem} へ`;
                    break;
                case 'DockingGranted':
                    if (!isLandingSequence) {
                        isLandingSequence = true;
                        logMessage = '-- 着陸開始 --';
                    }
                    break;
                case 'DockingCancelled':
                    if (isLandingSequence) {
                        isLandingSequence = false;
                        logMessage = '-- 着陸キャンセル --';
                    }
                    break;
                case 'Docked':
                case 'Touchdown':
                    if (isLandingSequence) isLandingSequence = false;
                    logMessage = entry.event === 'Docked' ? `着艦: ${entry.StationName}` : `着陸: ${entry.Body}`;
                    break;
                case 'Undocked':
                case 'Liftoff':
                    logMessage = entry.event === 'Undocked' ? `離艦: ${entry.StationName}` : `離陸: ${entry.Body}`;
                    isLandingSequence = false;
                    wasLandingGearDown = true;
                    break;
            }

            if (logMessage) {
                const prefix = isMinorEvent ? '* ' : '';
                eventLog.push(`${prefix}[${elapsedTime}] ${logMessage}`);
                broadcastLogUpdate();
            }
        }

        // --- 統計情報処理 ---
        if (entry.event === 'FSDJump' || entry.event === 'Location') {
            factionAllegianceMap = {}; // 現在の星系の派閥情報に更新
            if (entry.Factions && Array.isArray(entry.Factions)) {
                entry.Factions.forEach(faction => {
                    if (faction.Name && faction.Allegiance) {
                        factionAllegianceMap[faction.Name] = faction.Allegiance;
                    }
                });
            }
        } else if (entry.event === 'ShipTargeted' && entry.TargetLocked === true) {
            const pilotName = entry.PilotName_Localised || entry.PilotName;
            if (pilotName && typeof entry.PilotRank !== 'undefined') {
                pilotRanks[pilotName] = entry.PilotRank;
            }
        } else if (entry.event === 'Bounty') {
            state.bounty.count++;
            let reward = 0;
            if (entry.Rewards && Array.isArray(entry.Rewards)) {
                entry.Rewards.forEach(r => { reward += r.Reward; });
                state.bounty.totalRewards += reward;
            }
            if (entry.Target_Localised) {
                state.bounty.targets[entry.Target_Localised] = (state.bounty.targets[entry.Target_Localised] || 0) + 1;
            } else {
                const shipName = entry.Target.charAt(0).toUpperCase() + entry.Target.slice(1);
                state.bounty.targets[shipName] = (state.bounty.targets[shipName] || 0) + 1;
            }
            const pilotName = entry.PilotName_Localised || entry.PilotName;
            let rankName = 'Unknown';
            if (pilotName && typeof pilotRanks[pilotName] !== 'undefined') {
                const rank = pilotRanks[pilotName];
                if (typeof rank === 'number') rankName = COMBAT_RANKS[rank] || 'Unknown';
                else if (typeof rank === 'string') rankName = rank;
            }
            state.bounty.ranks[rankName] = (state.bounty.ranks[rankName] || 0) + 1;
        } else if (entry.event === 'MaterialCollected') {
            const category = entry.Category;
            const name = entry.Name_Localised || entry.Name;
            const count = entry.Count;
            if (!category || !name) return;
            state.materials.total += count;
            state.materials.categories[category] = (state.materials.categories[category] || 0) + count;
            if (!state.materials.details[category]) state.materials.details[category] = {};
            state.materials.details[category][name] = (state.materials.details[category][name] || 0) + count;
        } else if (entry.event === 'FactionKillBond') {
            state.bounty.count++;
            state.bounty.totalRewards += entry.Reward;
        } else if (entry.event === 'MissionAccepted') {
            const factionName = entry.Faction;
            const allegiance = factionAllegianceMap[factionName];
            if (entry.MissionID && allegiance) {
                if (allegiance === 'Federation' || allegiance === 'Empire') {
                    activeMissions[entry.MissionID] = allegiance;
                }
            }
        } else if (entry.event === 'MissionCompleted') {
            const missionID = entry.MissionID;
            const allegiance = activeMissions[missionID];
            state.missions.completed++;
            if (allegiance === 'Federation') {
                state.missions.federation++;
            } else if (allegiance === 'Empire') {
                state.missions.empire++;
            } else {
                state.missions.independent++;
            }
            if (allegiance) {
                delete activeMissions[missionID];
            }
        } else if (entry.event === 'MissionFailed' || entry.event === 'MissionAbandoned') {
            if (activeMissions[entry.MissionID]) {
                delete activeMissions[entry.MissionID];
            }
        } else if (entry.event === 'Progress') {
            Object.keys(ALL_RANKS).forEach(rankType => {
                if (state.progress[rankType] && typeof entry[rankType] !== 'undefined') {
                    state.progress[rankType].progress = entry[rankType];
                }
            });
        } else if (entry.event === 'Rank' || entry.event === 'Promotion') {
            const ranks = entry;
            Object.keys(ALL_RANKS).forEach(rankType => {
                if (state.progress[rankType] && typeof ranks[rankType] !== 'undefined') {
                    const rankValue = ranks[rankType];
                    const rankList = ALL_RANKS[rankType];
                    state.progress[rankType].rank = rankValue;
                    state.progress[rankType].name = rankList[rankValue] || 'Unknown';
                    state.progress[rankType].nextName = rankList[rankValue + 1] || '';
                    if (entry.event === 'Promotion') {
                        state.progress[rankType].progress = 0;
                    }
                }
            });
        }
    } catch (e) {
        // JSONパースエラーは無視
    }
}

/**
 * ファイルを読み込み、ジャーナルエントリを処理する
 * @param {string} filePath 処理するファイルのパス
 * @param {boolean} suppressBroadcast trueの場合、処理後のブロードキャストを抑制する
 */
async function processFile(filePath, suppressBroadcast = false) {
    const start = processedFiles[filePath] || 0;
    let stats;
    try {
        stats = fs.statSync(filePath);
    } catch (e) {
        console.error(`ファイル情報の取得に失敗: ${filePath}`, e);
        return;
    }
    const end = stats.size;
    if (start >= end) return;
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8', start });
    const rl = require('readline').createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
        processJournalLine(line);
    }
    processedFiles[filePath] = end;
    if (!suppressBroadcast) {
        broadcastUpdate();
    }
}

/**
 * Status.jsonをパースし、状態変化に応じてログを記録する
 * @param {object} statusData - Status.jsonから読み込んだJSONオブジェクト
 */
function processStatus(statusData) {
    if (!statusData || !recordingStartTime) return; // 録画中でなければ何もしない

    const now = new Date();

    // 1. ハードポイントの状態をチェック (戦闘開始/終了)
    const isHardpointsDeployed = (statusData.Flags & (1 << 6)) !== 0;
    if (isHardpointsDeployed !== wasHardpointsDeployed) {
        isFighting = isHardpointsDeployed;
        const elapsedTime = formatElapsedTime(now - recordingStartTime);
        const logMessage = isHardpointsDeployed ? '-- 戦闘開始 --' : '-- 戦闘終了 --';
        eventLog.push(`[${elapsedTime}] ${logMessage}`);
        broadcastLogUpdate();
        wasHardpointsDeployed = isHardpointsDeployed;
    }

    // 2. ランディングギアの状態をチェック (着陸開始/中断)
    const isLandingGearDown = (statusData.Flags & (1 << 2)) !== 0;
    if (isLandingGearDown !== wasLandingGearDown) {
        const elapsedTime = formatElapsedTime(now - recordingStartTime);
        // ギアが展開され、初回離陸が完了している場合
        if (isLandingGearDown && !isLandingSequence && isInitialTakeoffComplete) {
            isLandingSequence = true;
            eventLog.push(`[${elapsedTime}] -- 着陸開始 --`);
            broadcastLogUpdate();
        } 
        // ギアが格納され、着陸シーケンス中だった場合
        else if (!isLandingGearDown && isLandingSequence) {
            isLandingSequence = false;
            eventLog.push(`[${elapsedTime}] -- 着陸中断 --`);
            broadcastLogUpdate();
        }
        wasLandingGearDown = isLandingGearDown;
    }
}

async function startMonitoring() {
    console.log(`ジャーナルディレクトリを監視中: ${JOURNAL_DIR}`);
    const watcher = chokidar.watch(JOURNAL_DIR, {
        persistent: true,
        ignoreInitial: false, // 起動時の既存ファイルも処理対象にする
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
        depth: 0 // サブディレクトリは監視しない
    });

    const statusPath = path.join(JOURNAL_DIR, 'Status.json');
    const statusWatcher = chokidar.watch(statusPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    });

    statusWatcher.on('change', (filePath) => {
        fs.readFile(filePath, 'utf-8', (err, data) => {
            if (err) return;
            try {
                const statusData = JSON.parse(data);
                processStatus(statusData);
            } catch (e) {
                // パースエラーは無視
            }
        });
    });


    const getTodaysPrefix = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        return `Journal.${year}-${month}-${day}`;
    };
    const processIfNeeded = async (filePath, suppressBroadcast) => {
        const filename = path.basename(filePath);
        // 今日の日付のジャーナルログファイルのみを対象
        if (filename.startsWith(getTodaysPrefix()) && filename.endsWith('.log')) {
            await processFile(filePath, suppressBroadcast);
        }
    };

    console.log("ジャーナルファイルの初回スキャンと監視を開始します...");

    watcher
        .on('add', (filePath) => processIfNeeded(filePath, true)) // 初回スキャン中はブロードキャストしない
        .on('change', (filePath) => processIfNeeded(filePath, false)) // 変更時はブロードキャストする
        .on('ready', () => {
            console.log('初回スキャン完了。リアルタイム監視中...');
            broadcastUpdate(); // 初回スキャン完了後に一度だけブロードキャスト
        })
        .on('error', (error) => console.error(`ファイル監視エラー: ${error}`));
}

// --- サーバー起動 ---
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
    console.log(`ダッシュボードを開く: http://localhost:${PORT}`);
    startMonitoring();
    connectToOBSAtStartup(); // OBSへの接続を開始
});