const statusIndicator = document.getElementById('status-indicator');
const wsUrl = `ws://${window.location.host}`;
let socket;
// 以前のデータ状態を保存する変数
let previousState = null;
// OBSの録画状態を保持
let isRecording = false;

// --- DOM Element References ---
const resetButton = document.getElementById('reset-button');
const recordButton = document.getElementById('record-button');
const copyLogButton = document.getElementById('copy-log-button');
const logDisplay = document.getElementById('event-log-display');

// --- Event Listeners ---
// リセットボタンの処理
resetButton.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'reset_stats' }));
        console.log('リセット要求を送信しました。');
    } else {
        console.error('サーバーに接続されていません。');
    }
});
// 録画ボタンの処理
recordButton.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // 現在の録画状態に応じて、開始または停止の命令を送信
        const command = isRecording ? 'stop_obs_recording' : 'start_obs_recording';
        socket.send(JSON.stringify({ type: command }));
        console.log(`${command} 要求を送信しました。`);
    } else {
        console.error('サーバーに接続されていません。');
    }
});
// ログコピーボタンの処理
copyLogButton.addEventListener('click', () => {
    if (logDisplay.value) {
        // 1. textareaから全てのテキストを取得
        const rawLog = logDisplay.value;

        // 2. 正規表現でチャプター用の行を抽出・加工する
        const chapterLog = rawLog
            .split('\n') // 行ごとに分割
            .filter(line => !line.startsWith('*')) // '*'で始まらない行のみをフィルタリング
            .map(line => {
                // 例: "[00:15:32] -- 戦闘開始 --"  ->  "00:15:32 - 戦闘開始"
                // 例: "[00:28:10] ジャンプ: Sol へ" ->  "00:28:10 - ジャンプ: Sol へ"
                return line.replace(/^\[(\d{2}:\d{2}:\d{2})\]\s(?:--\s)?(.+?)(?:\s--)?$/, '$1 - $2');
            })
            .join('\n'); // 再び改行で結合

        // 3. 加工したテキストをクリップボードにコピー
        navigator.clipboard.writeText(chapterLog)
            .then(() => {
                copyLogButton.textContent = 'コピーしました！';
                setTimeout(() => { copyLogButton.textContent = 'ログをコピー'; }, 2000);
            })
            .catch(err => console.error('コピーに失敗しました:', err));
    }
});

function connect() {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WebSocket connection successful');
        statusIndicator.textContent = 'Online';
        statusIndicator.className = 'status connected';
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        // メッセージタイプに応じて処理を振り分け
        switch (data.type) {
            case 'full_update':
                // 最初のデータ受信時は、previousStateを初期化するだけ
                if (!previousState) {
                    previousState = JSON.parse(JSON.stringify(data.payload));
                }
                updateUI(data.payload);
                // 現在の状態を次の比較のために保存（ディープコピー）
                previousState = JSON.parse(JSON.stringify(data.payload));
                break;
            case 'obs_recording_state':
                isRecording = data.payload.isRecording;
                updateRecordingStatusUI(isRecording);
                break;
            case 'log_update':
                // ログ表示エリアを更新
                logDisplay.value = data.payload.join('\n');
                // テキストエリアを常に最下部にスクロール
                logDisplay.scrollTop = logDisplay.scrollHeight;
                break;
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

/**
 * DOM要素を一時的にハイライトする
 * @param {HTMLElement} element - ハイライトするDOM要素
 * @param {string} [className='highlight-value'] - 適用するCSSクラス名
 */
function highlightElement(element, className = 'highlight-value') {
    element.classList.add(className);
    setTimeout(() => {
        element.classList.remove(className);
    }, 1500); // 1.5秒後にハイライトを解除
}

/** OBSの録画状態に応じてUIを更新する */
function updateRecordingStatusUI(isRec) {
    recordButton.classList.toggle('recording', isRec);
    recordButton.textContent = isRec ? 'STOP RECORDING' : 'START RECORDING';
}

function updateUI(state) {
    // --- Update Last Update Time ---
    const lastUpdateEl = document.getElementById('last-update-time');
    if (state.lastUpdateTimestamp && state.lastUpdateTimestamp !== (previousState && previousState.lastUpdateTimestamp)) {
        const date = new Date(state.lastUpdateTimestamp);
        const timeString = date.toLocaleTimeString('en-GB'); // HH:MM:SS format
        lastUpdateEl.textContent = `Last entry: ${timeString}`;
    }

    // --- Update Combat Summary ---
    const bountyCountEl = document.getElementById('bounty-count');
    if (previousState && state.bounty.count !== previousState.bounty.count) {
        highlightElement(bountyCountEl.parentElement);
    }
    bountyCountEl.textContent = state.bounty.count;

    const bountyRewardsEl = document.getElementById('bounty-rewards');
    if (previousState && state.bounty.totalRewards !== previousState.bounty.totalRewards) {
        highlightElement(bountyRewardsEl.parentElement);
    }
    bountyRewardsEl.textContent = state.bounty.totalRewards.toLocaleString();
    
    updateKillsTable('bounty-ranks-table', state.bounty.ranks, previousState.bounty.ranks);
    updateGenericTable('bounty-targets-table', state.bounty.targets, previousState.bounty.targets, ['Target', 'Kills']);

    // --- Update Materials Summary ---
    const matTotalEl = document.getElementById('mat-total');
    if (previousState && state.materials.total !== previousState.materials.total) {
        highlightElement(matTotalEl.parentElement);
    }
    matTotalEl.textContent = state.materials.total;
    updateGenericTable('mat-categories-table', state.materials.categories, previousState.materials.categories, ['Category', 'Count']);
    updateMaterialsDetailTable('mat-details-table', state.materials.details, previousState.materials.details);

    // --- Update Mission Summary ---
    updateMissionSummary(state.missions, previousState ? previousState.missions : null);

    // --- Update Rank Progression ---
    updateProgressBars('progress-container', state.progress, previousState ? previousState.progress : null);
}

/**
 * ミッション完了数のサマリーUIを更新する
 * @param {object} newMissions - 新しいミッションの状態オブジェクト
 * @param {object} oldMissions - 以前のミッションの状態オブジェクト
 */
function updateMissionSummary(newMissions, oldMissions) {
    if (!newMissions) return;
    const updateElement = (id, newValue, oldValue) => {
        const element = document.getElementById(id);
        if (element) {
            if (oldMissions && newValue !== oldValue) {
                highlightElement(element.parentElement);
            }
            element.textContent = newValue.toLocaleString();
        }
    };
    updateElement('missions-fed', newMissions.federation, oldMissions ? oldMissions.federation : 0);
    updateElement('missions-emp', newMissions.empire, oldMissions ? oldMissions.empire : 0);
    updateElement('missions-ind', newMissions.independent, oldMissions ? oldMissions.independent : 0);
    updateElement('missions-total', newMissions.completed, oldMissions ? oldMissions.completed : 0);
}

function updateGenericTable(tableId, newData, oldData, headers) {
    const table = document.getElementById(tableId);
    if (!table.tHead) {
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headerRow.appendChild(th);
        });
        headerRow.cells[headers.length - 1].style.textAlign = 'right';
    }

    const tbody = table.tBodies[0] || table.createTBody();
    const sortedData = Object.entries(newData).sort(([keyA, valueA], [keyB, valueB]) => {
        if (keyA === 'OTHERS') return 1;
        if (keyB === 'OTHERS') return -1;
        return valueB - valueA;
    });
    const existingRows = new Map([...tbody.rows].map(row => [row.dataset.key, row]));

    sortedData.forEach(([key, value]) => {
        const row = existingRows.get(key);
        if (row) { // 既存の行を更新
            const valueCell = row.cells[1];
            if (value !== (oldData[key] || 0)) {
                valueCell.textContent = value.toLocaleString();
                highlightElement(valueCell);
            }
            tbody.appendChild(row); // 行を末尾に移動してソート順を維持
            existingRows.delete(key);
        } else { // 新しい行を追加
            const newRow = tbody.insertRow();
            newRow.dataset.key = key;
            newRow.insertCell(0).textContent = key;
            newRow.insertCell(1).textContent = value.toLocaleString();
            highlightElement(newRow, 'highlight-row');
        }
    });

    existingRows.forEach(row => row.remove());
}

function updateKillsTable(tableId, newData, oldData) {
    const table = document.getElementById(tableId);
    if (!table.tHead) {
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        ['', 'Rank', 'Kills'].forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            headerRow.appendChild(th);
        });
        headerRow.cells[2].style.textAlign = 'right';
    }

    const tbody = table.tBodies[0] || table.createTBody();
    const sortedData = Object.entries(newData).sort(([keyA, valueA], [keyB, valueB]) => {
        if (keyA === 'OTHERS') return 1;
        if (keyB === 'OTHERS') return -1;
        return valueB - valueA;
    });
    const existingRows = new Map([...tbody.rows].map(row => [row.dataset.key, row]));

    sortedData.forEach(([key, value]) => {
        const row = existingRows.get(key);
        if (row) {
            const valueCell = row.cells[2];
            if (value !== (oldData[key] || 0)) {
                valueCell.textContent = value.toLocaleString();
                highlightElement(valueCell);
            }
            tbody.appendChild(row);
            existingRows.delete(key);
        } else {
            const newRow = tbody.insertRow();
            newRow.dataset.key = key;
            newRow.insertCell(0).appendChild(getRankIcon(key));
            newRow.insertCell(1).textContent = key;
            newRow.insertCell(2).textContent = value.toLocaleString();
            highlightElement(newRow, 'highlight-row');
        }
    });

    existingRows.forEach(row => row.remove());
}

function updateMaterialsDetailTable(tableId, newData, oldData) {
    const table = document.getElementById(tableId);
    if (!table.tHead) {
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        ['Category', 'Material', 'Count'].forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            headerRow.appendChild(th);
        });
        headerRow.cells[2].style.textAlign = 'right';
    }

    const tbody = table.tBodies[0] || table.createTBody();
    const flatNewData = Object.entries(newData).flatMap(([category, names]) =>
        Object.entries(names).map(([name, count]) => ({ category, name, count }))
    );
    flatNewData.sort((a, b) => {
        const catCompare = a.category.localeCompare(b.category);
        if (catCompare !== 0) return catCompare;
        if (a.name === 'OTHERS') return 1;
        if (b.name === 'OTHERS') return -1;
        return b.count - a.count;
    });

    const existingRows = new Map([...tbody.rows].map(row => [row.dataset.key, row]));

    flatNewData.forEach(item => {
        const key = `${item.category}::${item.name}`;
        const row = existingRows.get(key);
        const oldValue = (oldData[item.category] && oldData[item.category][item.name]) || 0;

        if (row) {
            const valueCell = row.cells[2];
            if (item.count !== oldValue) {
                valueCell.textContent = item.count;
                highlightElement(valueCell);
            }
            tbody.appendChild(row);
            existingRows.delete(key);
        } else {
            const newRow = tbody.insertRow();
            newRow.dataset.key = key;
            newRow.insertCell(0).textContent = item.category;
            newRow.insertCell(1).textContent = item.name;
            const countCell = newRow.insertCell(2);
            countCell.textContent = item.count;
            countCell.style.fontWeight = 'bold';
            highlightElement(newRow, 'highlight-row');
        }
    });

    existingRows.forEach(row => row.remove());
}

/**
 * パイロットの戦闘ランク名に応じたSVGアイコン要素を生成して返す。(リファクタリング版)
 * @param {string} rankName - 'Harmless', 'Novice', 'Elite' などの戦闘ランク名。
 * @returns {SVGSVGElement} - 対応するSVGアイコンのDOM要素。
 */
function getRankIcon(rankName) {
    const rankMap = {
        'Harmless': 0, 'Mostly Harmless': 1, 'Novice': 2, 'Competent': 3,
        'Expert': 4, 'Master': 5, 'Dangerous': 6, 'Deadly': 7, 'Elite': 8,
    };
    const rankLevel = rankMap[rankName] || 0;
    const isElite = rankLevel === 8;

    const PART_ID = 'octagon-part';
    const PART_POINTS = '30,5 70,5 62,23 38,23';
    const OUTLINE_POINTS = '30,5 70,5 95,30 95,70 70,95 30,95 5,70 5,30';
    const ELITE_EMBLEM = '<polygon class="fill" points="50,50 25,30 50,75 75,30"/>';

    const style = `
        <style>
            .outline { fill: none; stroke: ${isElite ? '#fff' : '#ff9900'}; stroke-width: ${isElite ? 4 : 3}; opacity: ${isElite ? 1 : 0.6}; }
            .fill { fill: #ff9900; }
            .elite-emblem { fill: none; stroke: #fff; stroke-width: 4; stroke-linecap: round; }
        </style>
    `;
    const extraParts = isElite ? ELITE_EMBLEM : '';

    const rotationParts = Array.from({ length: rankLevel }, (_, i) => 
        `<use href="#${PART_ID}" transform="rotate(${i * 45}, 50, 50)" />`
    ).join('');

    const svgString = `
        <svg width="24" height="24" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <polygon id="${PART_ID}" class="fill" points="${PART_POINTS}" />
            </defs>
            ${style}
            <polygon class="outline" points="${OUTLINE_POINTS}" />
            ${rotationParts}
            ${extraParts}
        </svg>
    `;

    const div = document.createElement('div');
    div.innerHTML = svgString.trim();
    return div.firstChild;
}

function updateProgressBars(containerId, newProgressData, oldProgressData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const rankOrder = ['Federation', 'Empire', 'Combat', 'Trade', 'Explore', 'Soldier', 'Exobiologist', 'CQC'];

    rankOrder.forEach(rankType => {
        const data = newProgressData[rankType];
        if (!data) return;

        const oldData = oldProgressData ? oldProgressData[rankType] : null;
        const elementId = `progress-item-${rankType}`;
        let progressItem = document.getElementById(elementId);

        if (!progressItem) {
            progressItem = document.createElement('div');
            progressItem.id = elementId;
            progressItem.className = 'progress-item';
            progressItem.innerHTML = `
                <div class="progress-label">
                    <span class="rank-type">${rankType}</span>
                    <span class="rank-progress-percent"></span>
                </div>
                <div class="progress-bar-container">
                    <div class="rank-name-current"></div>
                    <div class="progress-bar"></div>
                    <div class="progress-text"></div>
                    <div class="rank-name-next"></div>
                </div>
            `;
            container.appendChild(progressItem);
        }

        const progressBar = progressItem.querySelector('.progress-bar');
        const progressText = progressItem.querySelector('.progress-text');
        const currentRankEl = progressItem.querySelector('.rank-name-current');
        const nextRankEl = progressItem.querySelector('.rank-name-next');

        const newProgress = data.progress || 0;
        progressBar.style.width = `${newProgress}%`;
        
        progressText.textContent = `${Math.round(newProgress)}%`;
        progressItem.querySelector('.rank-progress-percent').textContent = '';

        currentRankEl.textContent = data.name || '';
        nextRankEl.textContent = data.nextName || '';

        if (oldData) {
            if (newProgress !== oldData.progress) highlightElement(progressBar.parentElement);
            if (data.name !== oldData.name) highlightElement(currentRankEl);
        }
    });
}

connect();