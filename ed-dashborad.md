Elite: Dangerous リアルタイムダッシュボード

このアプリケーションは、戦闘とマテリアル収集の統計情報をリアルタイムで表示するウェブベースのウィジェットです。

セットアップ手順
================================================

1. **フォルダの作成:**
   任意の場所に `ed-dashboard` という名前の新しいフォルダを作成すること。

2. **ファイルの作成:**
   作成した `ed-dashboard` フォルダの中に、以下の3つのファイルを作成し、後述するコードをそれぞれコピー＆ペーストすること。
   - `package.json` (プロジェクトの定義ファイル)
   - `server.js` (バックエンドサーバーのコード)
   - `index.html` (フロントエンドUIのコード)

3. **ライブラリのインストール:**
   ターミナル（コマンドプロンプト）を開き、`ed-dashboard` フォルダに移動すること。
   cd path/to/ed-dashboard

   そして、以下のコマンドを実行して、必要なライブラリをインストールすること。
   npm install

4. **ジャーナルディレクトリの指定:**
   `server.js` ファイルを開き、23行目にある `JOURNAL_DIR` の値を、あなたのPCのElite: Dangerousのジャーナルファイルが保存されているディレクトリのパスに書き換えること。
   （通常はデフォルトのままで問題ない）

5. **アプリケーションの起動:**
   ターミナルで以下のコマンドを実行して、サーバーを起動すること。
   node server.js

   ターミナルに「サーバーがポート3000で起動しました。」と表示されれば成功である。

6. **ダッシュボードの表示:**
   ウェブブラウザを開き、アドレスバーに以下のURLを入力すること。
   http://localhost:3000

   ブラウザにダッシュボードが表示され、ゲームをプレイするとリアルタイムで数値が更新される。


ファイルの内容
================================================

---
### 1. package.json
---
(この内容をコピーして `package.json` ファイルを作成)
```
{
  "name": "ed-dashboard",
  "version": "1.0.0",
  "description": "Real-time dashboard for Elite: Dangerous journal stats.",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "chokidar": "^3.5.3",
    "express": "^4.18.2",
    "ws": "^8.13.0"
  }
}
```

---
### 2. server.js
---
(この内容をコピーして `server.js` ファイルを作成)
```
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
// ★★★ Elite:Dangerousのジャーナルディレクトリを指定してください ★★★
const JOURNAL_DIR = path.join(os.homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');

// --- グローバル状態変数 ---
let state = {
    lastUpdateTimestamp: null, // 最終更新タイムスタンプを追加
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
    }
};
const pilotRanks = {}; // パイロット名とランクの対応表
const processedFiles = {}; // { filePath: size }

// --- ExpressサーバーとWebSocketサーバーのセットアップ ---
const app = express();
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('クライアントが接続しました。');
    ws.send(JSON.stringify({ type: 'full_update', payload: state })); // 接続時に現在の状態を送信
});

function broadcastUpdate() {
    const payload = JSON.stringify({ type: 'full_update', payload: state });
    wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
            client.send(payload);
        }
    });
}

// --- ジャーナル処理ロジック ---
// Elite Dangerous Community Wiki等で確認済みの公式なランク順
const COMBAT_RANKS = ['Harmless', 'Mostly Harmless', 'Novice', 'Competent', 'Expert', 'Master', 'Dangerous', 'Deadly', 'Elite'];

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
            if (entry.Rewards && Array.isArray(entry.Rewards)) {
                entry.Rewards.forEach(r => { state.bounty.totalRewards += r.Reward; });
            }
            if (entry.Target_Localised) {
                state.bounty.targets[entry.Target_Localised] = (state.bounty.targets[entry.Target_Localised] || 0) + 1;
            }
            const pilotName = entry.PilotName_Localised || entry.PilotName;
            let rankName = 'Unknown';
            if (pilotName && typeof pilotRanks[pilotName] !== 'undefined') {
                const rank = pilotRanks[pilotName];
                if (typeof rank === 'number') rankName = COMBAT_RANKS[rank] || 'Unknown';
                else if (typeof rank === 'string') rankName = rank;
            }
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
        }

    } catch (e) {
        // JSONパースエラーは無視
    }
}

async function processFile(filePath, isInitialScan = false) {
    const start = processedFiles[filePath] || 0;
    const stats = fs.statSync(filePath);
    const end = stats.size;

    if (start >= end) return; // 変更なし

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8', start });
    const rl = require('readline').createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
        processJournalLine(line);
    }

    processedFiles[filePath] = end;
    if (!isInitialScan) {
        broadcastUpdate();
    }
}

// --- ファイル監視の開始 ---
async function startMonitoring() {
    console.log(`ジャーナルディレクトリを監視中: ${JOURNAL_DIR}`);

    const today = new Date();
    // ★★★ ジャーナルファイルの命名規則(YYYY-MM-DD)に合わせて修正 ★★★
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    const datePrefix = `Journal.${year}-${month}-${day}`;
    
    // 初回スキャン
    const files = fs.readdirSync(JOURNAL_DIR)
        .filter(f => f.startsWith(datePrefix) && f.endsWith('.log'))
        .sort() 
        .map(f => path.join(JOURNAL_DIR, f));

    console.log(`初回スキャン中... (${files.length} ファイル) [${datePrefix}]`);
    for (const file of files) {
        await processFile(file, true);
    }
    console.log('初回スキャン完了。');
    broadcastUpdate();

    const watchPattern = path.join(JOURNAL_DIR, `${datePrefix}*.log`);
    const watcher = chokidar.watch(watchPattern, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    });

    watcher
        .on('add', async (filePath) => {
            console.log(`新規ファイル検出: ${path.basename(filePath)}`);
            await processFile(filePath);
        })
        .on('change', async (filePath) => {
            await processFile(filePath);
        });
}

// --- サーバー起動 ---
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
    console.log(`ダッシュボードを開く: http://localhost:${PORT}`);
    startMonitoring();
});
```

---
### 3. index.html
---
(この内容をコピーして `index.html` ファイルを作成)
```
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ED Dashboard</title>
    <style>
        :root {
            --bg-color: #1a1a1a;
            --card-bg: #2c2c2c;
            --text-color: #e0e0e0;
            --header-color: #ff9900;
            --border-color: #444;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            padding: 10px;
        }
        h1 {
            font-size: 1.8em;
            text-align: center;
            color: var(--header-color);
            margin-bottom: 20px;
            font-family: 'Consolas', 'Monaco', monospace;
        }
        .timestamp {
            text-align: center;
            color: var(--text-color);
            opacity: 0.7;
            margin-top: -15px;
            margin-bottom: 20px;
            font-family: 'Consolas', 'Monaco', monospace;
        }
        .container {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            justify-content: center;
        }
        .card {
            background-color: var(--card-bg);
            border-radius: 8px;
            padding: 20px;
            border: 1px solid var(--border-color);
            width: 45%;
            min-width: 400px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        .summary-grid {
            display: grid;
            gap: 10px;
            margin-bottom: 20px;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        }
        .summary-item {
            font-size: 1.3em;
            background-color: #3a3a3a;
            padding: 10px;
            border-radius: 4px;
        }
        .summary-item .label {
            font-size: 0.9em;
            opacity: 0.8;
        }
        .summary-item .value {
            font-size: 1.5em;
            font-weight: bold;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            text-align: left;
            padding: 8px;
            border-bottom: 1px solid var(--border-color);
        }
        th {
            opacity: 0.8;
        }
        td:last-child {
            text-align: right;
            font-weight: bold;
        }
        .status {
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 0.8em;
        }
        .status.connected {
            background-color: #28a745;
            color: white;
        }
        .status.disconnected {
            background-color: #dc3545;
            color: white;
        }
        .toggle-section {
            margin-bottom: 10px;
        }
        .toggle-checkbox {
            display: none;
        }
        .toggle-label {
            cursor: pointer;
            user-select: none;
            position: relative;
            padding-left: 20px;
            font-weight: bold;
            display: block;
        }
        .toggle-label.h2 {
            font-size: 1.5em;
            color: var(--header-color);
            margin-top: 0;
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 10px;
            margin-bottom: 10px;
        }
        .toggle-label.h3 {
            font-size: 1.17em;
            margin-top: 20px;
        }
        .toggle-label::before {
            content: '▶';
            position: absolute;
            left: 0;
            color: var(--header-color);
            transition: transform 0.2s ease-out;
        }
        .toggle-checkbox:checked + .toggle-label::before {
            transform: rotate(90deg);
        }
        .toggle-content {
            display: none;
            padding-left: 20px;
        }
        .toggle-checkbox:checked ~ .toggle-content {
            display: block;
        }
    </style>
</head>
<body>
    <div id="status-indicator" class="status disconnected">Offline</div>
    <h1>ed.dashboard({realtime: true})</h1>
    <div id="last-update-time" class="timestamp">Last entry: N/A</div>

    <div class="container">
        <!-- Combat Summary Card -->
        <div class="card">
            <div class="toggle-section">
                <input type="checkbox" id="toggle-bounty-summary" class="toggle-checkbox" checked>
                <label for="toggle-bounty-summary" class="toggle-label h2">Combat Summary</label>
                <div class="toggle-content">
                    <div class="summary-grid">
                        <div class="summary-item">
                            <div class="label">Total Kills</div>
                            <div id="bounty-count" class="value">0</div>
                        </div>
                        <div class="summary-item">
                            <div class="label">Total Bounty</div>
                            <div id="bounty-rewards" class="value">0</div>
                        </div>
                    </div>
                    <div class="toggle-section">
                        <input type="checkbox" id="toggle-bounty-ranks" class="toggle-checkbox" checked>
                        <label for="toggle-bounty-ranks" class="toggle-label h3">Kills by Rank</label>
                        <div class="toggle-content">
                            <table id="bounty-ranks-table"></table>
                        </div>
                    </div>
                    <div class="toggle-section">
                        <input type="checkbox" id="toggle-bounty-targets" class="toggle-checkbox" checked>
                        <label for="toggle-bounty-targets" class="toggle-label h3">Kills by Target</label>
                        <div class="toggle-content">
                            <table id="bounty-targets-table"></table>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Materials Collected Card -->
        <div class="card">
            <div class="toggle-section">
                <input type="checkbox" id="toggle-mat-summary" class="toggle-checkbox" checked>
                <label for="toggle-mat-summary" class="toggle-label h2">Materials Collected</label>
                <div class="toggle-content">
                    <div class="summary-grid">
                        <div class="summary-item">
                            <div class="label">Total Collected</div>
                            <div id="mat-total" class="value">0</div>
                        </div>
                    </div>
                    <div class="toggle-section">
                        <input type="checkbox" id="toggle-mat-categories" class="toggle-checkbox" checked>
                        <label for="toggle-mat-categories" class="toggle-label h3">Collected by Category</label>
                        <div class="toggle-content">
                            <table id="mat-categories-table"></table>
                        </div>
                    </div>
                    <div class="toggle-section">
                        <input type="checkbox" id="toggle-mat-details" class="toggle-checkbox" checked>
                        <label for="toggle-mat-details" class="toggle-label h3">Details</label>
                        <div class="toggle-content">
                            <table id="mat-details-table"></table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const statusIndicator = document.getElementById('status-indicator');
        const wsUrl = `ws://${window.location.host}`;
        let socket;

        function connect() {
            socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                console.log('WebSocket connection successful');
                statusIndicator.textContent = 'Online';
                statusIndicator.className = 'status connected';
            };

            socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'full_update') {
                    updateUI(data.payload);
                }
            };

            socket.onclose = () => {
                console.log('WebSocket disconnected. Reconnecting in 5 seconds...');
                statusIndicator.textContent = 'Disconnected';
                statusIndicator.className = 'status disconnected';
                setTimeout(connect, 5000);
            };

            socket.onerror = (error) => {
                console.error('WebSocket Error:', error);
                socket.close();
            };
        }

        function updateUI(state) {
            // --- Update Last Update Time ---
            const lastUpdateEl = document.getElementById('last-update-time');
            if (state.lastUpdateTimestamp) {
                const date = new Date(state.lastUpdateTimestamp);
                const timeString = date.toLocaleTimeString('en-GB'); // HH:MM:SS format
                lastUpdateEl.textContent = `Last entry: ${timeString}`;
            } else {
                lastUpdateEl.textContent = 'Last entry: N/A';
            }

            // --- Update Combat Summary ---
            document.getElementById('bounty-count').textContent = state.bounty.count;
            document.getElementById('bounty-rewards').textContent = state.bounty.totalRewards.toLocaleString();
            
            updateTable('bounty-ranks-table', state.bounty.ranks, ['Rank', 'Kills']);
            updateTable('bounty-targets-table', state.bounty.targets, ['Target', 'Kills']);

            // --- Update Materials Summary ---
            document.getElementById('mat-total').textContent = state.materials.total;
            updateTable('mat-categories-table', state.materials.categories, ['Category', 'Count']);
            
            const matDetailsTable = document.getElementById('mat-details-table');
            matDetailsTable.innerHTML = `<tr><th>Category</th><th>Material</th><th>Count</th></tr>`;
            const flatMaterials = [];
            for(const category in state.materials.details) {
                for(const name in state.materials.details[category]) {
                    flatMaterials.push({category, name, count: state.materials.details[category][name]});
                }
            }
            flatMaterials.sort((a,b) => {
                if (a.category < b.category) return -1;
                if (a.category > b.category) return 1;
                return b.count - a.count;
            });
            flatMaterials.forEach(item => {
                const row = matDetailsTable.insertRow();
                row.insertCell(0).textContent = item.category;
                row.insertCell(1).textContent = item.name;
                const countCell = row.insertCell(2);
                countCell.textContent = item.count;
                countCell.style.textAlign = 'right';
                countCell.style.fontWeight = 'bold';
            });
        }

        function updateTable(tableId, data, headers) {
            const table = document.getElementById(tableId);
            table.innerHTML = `<tr><th>${headers[0]}</th><th>${headers[1]}</th></tr>`;
            
            const sortedData = Object.entries(data).sort(([, a], [, b]) => b - a);
            
            sortedData.forEach(([key, value]) => {
                const row = table.insertRow();
                row.insertCell(0).textContent = key;
                row.insertCell(1).textContent = value.toLocaleString();
            });
        }
        
        connect();
    </script>
</body>
</html>
```