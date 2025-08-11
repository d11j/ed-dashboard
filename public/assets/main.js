import { applyCardOrder, setStatusUI, updateLogUI, updateRecordingStatusUI, updateUI } from './uiUpdater.js';
import { connect, sendMessage } from './websocketClient.js';

let isRecording = false;

// --- DOM Element References ---
const resetButton = document.getElementById('reset-button');
const recordButton = document.getElementById('record-button');
const copyLogButton = document.getElementById('copy-log-button');
const logDisplay = document.getElementById('event-log-display');

// --- WebSocket Event Listeners (via document) ---
document.addEventListener('ws:open', () => setStatusUI(true));
document.addEventListener('ws:close', () => setStatusUI(false));

document.addEventListener('ws:full_update', (event) => {
    updateUI(event.detail);
});

document.addEventListener('ws:obs_recording_state', (event) => {
    isRecording = event.detail.isRecording;
    updateRecordingStatusUI(isRecording);
});

document.addEventListener('ws:log_update', (event) => {
    updateLogUI(event.detail);
});

document.addEventListener('ws:layout_apply', (event) => {
    console.log('レイアウト更新を適用:', event.detail);
    applyCardOrder(event.detail);
});


// --- DOM Event Listeners ---
resetButton.addEventListener('click', () => {
    sendMessage('reset_stats');
    console.log('リセット要求を送信しました。');
});

recordButton.addEventListener('click', () => {
    const command = isRecording ? 'stop_obs_recording' : 'start_obs_recording';
    sendMessage(command);
    console.log(`${command} 要求を送信しました。`);
});

copyLogButton.addEventListener('click', () => {
    if (logDisplay.value) {
        const rawLog = logDisplay.value;
        const chapterLog = rawLog
            .split('\n')
            .filter(line => !line.startsWith('*'))
            .map(line => line.replace(/^\[(\d{2}:\d{2}:\d{2})\]\s(?:--\s)?(.+?)(?:\s--)?$/, '$1 - $2'))
            .join('\n');

        navigator.clipboard.writeText(chapterLog)
            .then(() => {
                copyLogButton.textContent = 'Copied！';
                setTimeout(() => { copyLogButton.textContent = 'Copy Log'; }, 2000);
            })
            .catch(err => console.error('コピーに失敗しました:', err));
    }
});

// --- SortableJS Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const columns = {
        'left-column': document.getElementById('left-column'),
        'right-column': document.getElementById('right-column')
    };

    const emitOrder = () => {
        const currentOrder = {};
        for (const id in columns) {
            currentOrder[id] = Array.from(columns[id].querySelectorAll('.card')).map(card => card.dataset.id);
        }
        sendMessage('layout_update', currentOrder);
    };

    const sortableOptions = {
        group: 'shared',
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: emitOrder
    };

    for (const id in columns) {
        if (columns[id]) {
            new Sortable(columns[id], sortableOptions);
        }
    }

    // Start the WebSocket connection
    connect();
});
