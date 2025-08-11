const wsUrl = `ws://${window.location.host}`;
let socket;

/**
 * WebSocketサーバーに接続し、イベントリスナーを設定する。
 * 接続が切断された場合は、5秒後に再接続を試みる。
 */
function connect() {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WebSocket connection successful');
        document.dispatchEvent(new CustomEvent('ws:open'));
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Received message:', data.type);
        // メッセージタイプをイベント名として、ペイロードをdetailに含めてディスパッチ
        document.dispatchEvent(new CustomEvent(`ws:${data.type}`, { detail: data.payload }));
    };

    socket.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting in 5 seconds...');
        document.dispatchEvent(new CustomEvent('ws:close'));
        setTimeout(connect, 5000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
        socket.close();
    };
}

/**
 * WebSocketサーバーにメッセージを送信する。
 * @param {string} type - メッセージの種別。
 * @param {object} [payload=null] - 送信するデータ。
 */
function sendMessage(type, payload = null) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, payload }));
    } else {
        console.error('Cannot send message, WebSocket is not connected.');
    }
}

// モジュールとして関数をエクスポート
export { connect, sendMessage };
