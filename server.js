// Elite: Dangerous Real-time Dashboard - Server
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');
const os = require('os');

// --- 設定 ---
const PORT = 3000;
// Elite:Dangerousのジャーナルディレクトリを指定
const JOURNAL_DIR = path.join(os.homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');

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
    progress: {
        Combat: { rank: 0, name: COMBAT_RANKS[0], progress: 0 },
        Trade: { rank: 0, name: TRADE_RANKS[0], progress: 0 },
        Explore: { rank: 0, name: EXPLORE_RANKS[0], progress: 0 },
        Federation: { rank: 0, name: FED_RANKS[0], progress: 0 },
        Empire: { rank: 0, name: EMP_RANKS[0], progress: 0 },
        CQC: { rank: 0, name: CQC_RANKS[0], progress: 0 },
        Soldier: { rank: 0, name: SOLDIER_RANKS[0], progress: 0 },
        Exobiologist: { rank: 0, name: EXOBIOLOGIST_RANKS[0], progress: 0 }
    }
});

let state = getInitialState(); // 初期化
// 敵パイロットのランク情報を保持
const pilotRanks = {};
const processedFiles = {};

// --- ExpressサーバーとWebSocketサーバーのセットアップ ---
const app = express();
app.use(express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('クライアントが接続しました。');
    ws.send(JSON.stringify({ type: 'full_update', payload: state })); // 接続時に現在の状態を送信
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'reset_stats') {
                console.log('リセット要求を受信しました。統計情報を初期化します。');
                state = getInitialState(); // 状態を初期化
                // processedFiles も初期化する必要があるかもしれないが、
                //「今日の戦果」コンセプトなら不要だろう。
                broadcastUpdate(); // 全クライアントに更新を通知
            }
        } catch (e) {
            console.error('受信メッセージの処理中にエラー:', e);
        }
    });
});

function broadcastUpdate() {
    // TODO: bounty.targetsはTOP5のみをブロードキャストし、それ以下はその他の合計とする
    const payload = JSON.stringify({ type: 'full_update', payload: state });
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

        // 最終更新日時を記録
        if (entry.timestamp) {
            state.lastUpdateTimestamp = entry.timestamp;
        }

        // --- 賞金首イベント処理 ---
        if (entry.event === 'ShipTargeted' && entry.TargetLocked === true) {
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
            console.log(`Ship destroyed: ${pilotName} (${rankName})@${reward} Cr`);
            state.bounty.ranks[rankName] = (state.bounty.ranks[rankName] || 0) + 1;
        }

        // --- マテリアルイベント処理 ---
        else if (entry.event === 'MaterialCollected') {
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
        }

        // --- ランク進行状況イベント処理 ---
        else if (entry.event === 'Progress') {
            // Progressイベント: 各ランクの進行度(%)を更新
            Object.keys(ALL_RANKS).forEach(rankType => {
                if (state.progress[rankType] && typeof entry[rankType] !== 'undefined') {
                    state.progress[rankType].progress = entry[rankType];
                }
            });
        }
        else if (entry.event === 'Rank') {
            // Rankイベント: ランクのレベルと名前を更新
            const ranks = entry; // イベントオブジェクト自体にランク情報が含まれる
            Object.keys(ALL_RANKS).forEach(rankType => {
                // `ranks`オブジェクトにそのランクタイプのキーが存在するかチェック
                if (state.progress[rankType] && typeof ranks[rankType] !== 'undefined') {
                    const rankValue = ranks[rankType];
                    state.progress[rankType].rank = rankValue;
                    state.progress[rankType].name = ALL_RANKS[rankType][rankValue] || 'Unknown';
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
        return; // ファイルが読めなければ処理を中断
    }
    const end = stats.size;

    if (start >= end) return; // 変更なし

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

// --- ファイル監視の開始 ---
async function startMonitoring() {
    console.log(`ジャーナルディレクトリを監視中: ${JOURNAL_DIR}`);

    const watcher = chokidar.watch(JOURNAL_DIR, {
        persistent: true,
        ignoreInitial: false, // 起動時の既存ファイルも処理対象にする
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
        depth: 0 // サブディレクトリは監視しない
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
    startMonitoring(); // 修正した関数を呼び出す
});