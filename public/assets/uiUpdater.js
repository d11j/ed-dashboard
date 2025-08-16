let previousState = null;

const statusIndicator = document.getElementById('status-indicator');
const recordButton = document.getElementById('record-button');
const logDisplay = document.getElementById('event-log-display');

/**
 * DOM要素を一時的にハイライトする
 * @param {HTMLElement} element - ハイライトするDOM要素
 * @param {string} [className='highlight-value'] - 適用するCSSクラス名
 */
function highlightElement(element, className = 'highlight-value') {
    element.classList.add(className);
    setTimeout(() => {
        element.classList.remove(className);
    }, 1500);
}

/**
 * 数値をK, M, Gの接頭辞を付けた短い形式にフォーマットする
 * @param {number} num - フォーマットする数値
 * @returns {string} - フォーマット後の文字列
 */
function formatNumber(num) {
    const percisiton = 3;
    if (num === null || typeof num === 'undefined') {
        return '0';
    }
    const absNum = Math.abs(num);
    let sign = num < 0 ? '-' : '';

    if (absNum >= 1e9) {
        return sign + (absNum / 1e9).toFixed(percisiton) + 'G';
    }
    if (absNum >= 1e6) {
        return sign + (absNum / 1e6).toFixed(percisiton) + 'M';
    }
    if (absNum >= 1e3) {
        return sign + (absNum / 1e3).toFixed(percisiton) + 'K';
    }
    return sign + num.toLocaleString();
}

/**
 * 渡された最新の状態オブジェクトに基づき、UI全体を更新する。
 * @param {object} state - 最新の状態オブジェクト
 */
function updateUI(state) {
    if (!state) { return; }

    const oldStateExists = !!previousState;

    // --- Update Last Update Time ---
    const lastUpdateEl = document.getElementById('last-update-time');
    if (state.lastUpdateTimestamp && (!oldStateExists || state.lastUpdateTimestamp !== previousState.lastUpdateTimestamp)) {
        const date = new Date(state.lastUpdateTimestamp);
        lastUpdateEl.textContent = `Last entry: ${date.toLocaleTimeString('en-GB')}`;
    }

    // --- Update Combat Summary ---
    const bountyCountEl = document.getElementById('bounty-count');
    if (oldStateExists && state.bounty.count !== previousState.bounty.count) {
        highlightElement(bountyCountEl.parentElement);
    }
    bountyCountEl.textContent = state.bounty.count.toLocaleString();

    const bountyRewardsEl = document.getElementById('bounty-rewards');
    if (oldStateExists && state.bounty.totalRewards !== previousState.bounty.totalRewards) {
        highlightElement(bountyRewardsEl.parentElement);
    }
    bountyRewardsEl.textContent = formatNumber(state.bounty.totalRewards);

    const bountyPerHourEl = document.getElementById('combat-bounty-per-hour');
    // if (oldStateExists && state.bounty.bountyPerHour !== previousState.bounty.bountyPerHour) {
    //     highlightElement(bountyPerHourEl.parentElement);
    // }
    bountyPerHourEl.textContent = state.bounty.bountyPerHour === null ? 'N/A' : formatNumber(state.bounty.bountyPerHour);

    updateKillsTable('bounty-ranks-table', state.bounty.ranks, oldStateExists ? previousState.bounty.ranks : {});
    updateGenericTable('bounty-targets-table', state.bounty.targets, oldStateExists ? previousState.bounty.targets : {}, ['Target', 'Kills']);

    // --- Update Exploration Summary ---
    const jumpsEl = document.getElementById('exploration-jumps');
    if (oldStateExists && state.exploration.jumpCount !== previousState.exploration.jumpCount) {
        highlightElement(jumpsEl.parentElement);
    }
    jumpsEl.textContent = state.exploration.jumpCount.toLocaleString();

    const distEl = document.getElementById('exploration-distance');
    if (oldStateExists && state.exploration.jumpDistance !== previousState.exploration.jumpDistance) {
        highlightElement(distEl.parentElement);
    }
    distEl.textContent = formatDistance(state.exploration.jumpDistance);

    const scansEl = document.getElementById('exploration-scans');
    if (oldStateExists && state.exploration.totalScans !== previousState.exploration.totalScans) {
        highlightElement(scansEl.parentElement);
    }
    scansEl.textContent = state.exploration.totalScans.toLocaleString();

    const valueEl = document.getElementById('exploration-value');
    if (oldStateExists && state.exploration.estimatedValue !== previousState.exploration.estimatedValue) {
        highlightElement(valueEl.parentElement);
    }
    valueEl.textContent = formatNumber(state.exploration.estimatedValue);

    const highValueEl = document.getElementById('exploration-high-value');
    if (oldStateExists && state.exploration.highValueScans !== previousState.exploration.highValueScans) {
        highlightElement(highValueEl.parentElement);
    }
    highValueEl.textContent = state.exploration.highValueScans.toLocaleString();

    const ftdEl = document.getElementById('exploration-ftd');
    if (oldStateExists && state.exploration.firstToDiscover !== previousState.exploration.firstToDiscover) {
        highlightElement(ftdEl.parentElement);
    }
    ftdEl.textContent = state.exploration.firstToDiscover.toLocaleString();

    // --- Update Materials Summary ---
    const matTotalEl = document.getElementById('mat-total');
    if (oldStateExists && state.materials.total !== previousState.materials.total) {
        highlightElement(matTotalEl.parentElement);
    }
    matTotalEl.textContent = state.materials.total.toLocaleString();
    updateGenericTable('mat-categories-table', state.materials.categories, oldStateExists ? previousState.materials.categories : {}, ['Category', 'Count']);
    updateMaterialsDetailTable('mat-details-table', state.materials.details, oldStateExists ? previousState.materials.details : {});

    // --- Update Mission Summary ---
    updateMissionSummary(state.missions, oldStateExists ? previousState.missions : null);

    // --- Update Trading Summary ---
    const tradingSellCountEl = document.getElementById('trading-sell-count');
    if (oldStateExists && state.trading.sellCount !== previousState.trading.sellCount) {
        highlightElement(tradingSellCountEl.parentElement);
    }
    tradingSellCountEl.textContent = state.trading.sellCount.toLocaleString();

    const tradingUnitsSoldEl = document.getElementById('trading-units-sold');
    if (oldStateExists && state.trading.unitsSold !== previousState.trading.unitsSold) {
        highlightElement(tradingUnitsSoldEl.parentElement);
    }
    tradingUnitsSoldEl.textContent = state.trading.unitsSold.toLocaleString();

    const tradingProfitEl = document.getElementById('trading-profit');
    if (oldStateExists && state.trading.profit !== previousState.trading.profit) {
        highlightElement(tradingProfitEl.parentElement);
    }
    tradingProfitEl.textContent = formatNumber(state.trading.profit);

    // --- Update Trading ROI ---
    const tradingRoiEl = document.getElementById('trading-roi');
    if (oldStateExists && state.trading.roi !== previousState.trading.roi) {
        highlightElement(tradingRoiEl.parentElement);
    }

    if (state.trading.roi) {
        // 値が有限（InfinityやNaNでない）場合は、通常通りパーセンテージで表示
        tradingRoiEl.textContent = `${state.trading.roi.toFixed(2)}%`;
    } else {
        // 値がNaNの場合は、無限大記号を表示
        tradingRoiEl.textContent = '∞ %';
    }

    const profitPerTonEl = document.getElementById('trading-profit-per-ton');
    if (oldStateExists && state.trading.profitPerTon !== previousState.trading.profitPerTon) {
        highlightElement(profitPerTonEl.parentElement);
    }
    profitPerTonEl.textContent = formatNumber(state.trading.profitPerTon);

    const profitPerHourEl = document.getElementById('trading-profit-per-hour');
    // if (oldStateExists && state.trading.profitPerHour !== previousState.trading.profitPerHour) {
    //     highlightElement(profitPerHourEl.parentElement);
    // }
    profitPerHourEl.textContent = state.trading.profitPerHour === null ? 'N/A' : formatNumber(state.trading.profitPerHour);

    // --- Update Rank Progression ---
    updateProgressBars('progress-container', state.progress, oldStateExists ? previousState.progress : null);

    // 現在の状態を次の比較のためにディープコピーして保存
    previousState = JSON.parse(JSON.stringify(state));
}

function updateRecordingStatusUI(isRec) {
    recordButton.classList.toggle('recording', isRec);
    recordButton.textContent = isRec ? 'STOP RECORDING' : 'START RECORDING';
}

function updateLogUI(logEntries) {
    logDisplay.value = logEntries.join('\n');
    logDisplay.scrollTop = logDisplay.scrollHeight;
}

function setStatusUI(isConnected) {
    statusIndicator.textContent = isConnected ? 'Online' : 'Offline';
    statusIndicator.className = `status ${isConnected ? 'connected' : 'disconnected'}`;
}

function updateMissionSummary(newMissions, oldMissions) {
    if (!newMissions) { return; }
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
        if (keyA === 'OTHERS') { return 1; }
        if (keyB === 'OTHERS') { return -1; }
        return valueB - valueA;
    });
    const existingRows = new Map([...tbody.rows].map(row => [row.dataset.key, row]));

    sortedData.forEach(([key, value]) => {
        const row = existingRows.get(key);
        if (row) {
            const valueCell = row.cells[1];
            if (value !== (oldData[key] || 0)) {
                valueCell.textContent = value.toLocaleString();
                highlightElement(valueCell);
            }
            tbody.appendChild(row);
            existingRows.delete(key);
        } else {
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
        if (keyA === 'OTHERS') { return 1; }
        if (keyB === 'OTHERS') { return -1; }
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
        if (catCompare !== 0) { return catCompare; }
        if (a.name === 'OTHERS') { return 1; }
        if (b.name === 'OTHERS') { return -1; }
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
            newRow.insertCell(2).textContent = item.count.toLocaleString();
            highlightElement(newRow, 'highlight-row');
        }
    });
    existingRows.forEach(row => row.remove());
}

/**
 * パイロットの戦闘ランク名に応じたSVGアイコン要素を生成して返す。
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
        <svg width="16" height="16" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
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

/**
 * 光年(ly)で渡された距離を、1,000以上であればkly単位に変換し、
 * 3桁ごとにカンマを付けてフォーマットする関数。
 * @param {number} ly - 距離（光年単位）
 * @returns {string} フォーマットされた距離の文字列
 */
function formatDistance(ly) {
    if (typeof ly !== 'number' || isNaN(ly)) {
        return 'NaN';
    }

    if (ly >= 1000) {
        const klyValue = ly / 1000;
        // toLocaleString()メソッドが3桁区切りのカンマ挿入を自動で行う。
        return klyValue.toLocaleString('en-US') + ' kly';
    } else {
        return ly.toLocaleString('en-US') + ' ly';
    }
}

function updateProgressBars(containerId, newProgressData, oldProgressData) {
    const container = document.getElementById(containerId);
    if (!container) { return; }

    const rankOrder = ['Federation', 'Empire', 'Combat', 'Trade', 'Explore', 'Soldier', 'Exobiologist', 'CQC'];
    rankOrder.forEach(rankType => {
        const data = newProgressData[rankType];
        if (!data) { return; }

        const oldData = oldProgressData ? oldProgressData[rankType] : null;
        let progressItem = document.getElementById(`progress-item-${rankType}`);
        if (!progressItem) {
            progressItem = document.createElement('div');
            progressItem.id = `progress-item-${rankType}`;
            progressItem.className = 'progress-item';
            progressItem.innerHTML = `
                <div class="progress-label">
                    <span class="rank-type">${rankType}</span>
                </div>
                <div class="progress-bar-container">
                    <div class="rank-name-current"></div>
                    <div class="progress-bar"></div>
                    <div class="progress-text"></div>
                    <div class="rank-name-next"></div>
                </div>`;
            container.appendChild(progressItem);
        }

        const progressBar = progressItem.querySelector('.progress-bar');
        const newProgress = data.progress || 0;
        progressBar.style.width = `${newProgress}%`;
        progressItem.querySelector('.progress-text').textContent = `${Math.round(newProgress)}%`;
        progressItem.querySelector('.rank-name-current').textContent = data.name || '';
        progressItem.querySelector('.rank-name-next').textContent = data.nextName || '';

        if (oldData) {
            if (newProgress !== oldData.progress) {
                highlightElement(progressBar.parentElement);
            }
            if (data.name !== oldData.name) {
                highlightElement(progressItem.querySelector('.rank-name-current'));
            }
        }
    });
}

/**
 * 引数で受け取った順序オブジェクトに基づいて、DOMのカードを並び替える
 * @param {object} order - { "left-column": ["id1", "id2"], "right-column": ["id3"] } 形式のオブジェクト
 */
function applyCardOrder(order) {
    const columns = {
        'left-column': document.getElementById('left-column'),
        'right-column': document.getElementById('right-column')
    };
    if (!order || typeof order !== 'object') {
        console.error('無効な順序データです。');
        return;
    }

    for (const columnId in order) {
        const columnElement = columns[columnId];
        if (columnElement && Array.isArray(order[columnId])) {
            order[columnId].forEach(cardId => {
                const cardElement = document.querySelector(`.card[data-id='${cardId}']`);
                if (cardElement) {
                    columnElement.appendChild(cardElement);
                }
            });
        }
    }
}

export { applyCardOrder, setStatusUI, updateLogUI, updateRecordingStatusUI, updateUI };

