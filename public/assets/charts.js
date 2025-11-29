// Sparkline Charting Utility using Chart.js

const sparklineBaseConfig = {
    type: 'line',
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false }, // Hide legend
        },
        scales: {
            x: { display: false }, // Hide X-axis
            y: { display: false }  // Hide Y-axis
        },
        elements: {
            point: { radius: 0 }, // Hide points
            line: {
                borderWidth: 2,
                borderColor: 'rgba(255, 102, 0, 0.7)', // Orange, semi-transparent
                tension: 0.4
            }
        },
        tooltips: { enabled: false },
        animation: { duration: 0 }
    }
};

/**
 * Sparklineチャートを生成または更新する
 * @param {string} canvasId - チャートを描画するcanvas要素のID
 * @param {number[]} data - チャートに表示するデータ配列
 * @returns {Chart} Chart.jsのインスタンス
 */
function createOrUpdateSparkline(canvasId, data) {
    const ctx = document.getElementById(canvasId).getContext('2d');

    // 既存のチャートインスタンスをチェック
    let chart = Chart.getChart(ctx);

    if (chart) {
        // チャートが既に存在すれば、データのみ更新
        chart.data.labels = data.map((_, i) => i);
        chart.data.datasets[0].data = data;
        chart.update();
    } else {
        // 新しいチャートを作成
        const config = JSON.parse(JSON.stringify(sparklineBaseConfig)); // Deep copy
        config.data = {
            labels: data.map((_, i) => i),
            datasets: [{
                data: data,
                backgroundColor: 'rgba(255, 102, 0, 0.1)', // Optional: add a fill
                fill: true
            }]
        };
        chart = new Chart(ctx, config);
    }
    return chart;
}

// グローバルスコープに公開
window.chartUtils = {
    createOrUpdateSparkline
};
