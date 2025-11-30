// Sparkline Charting Utility using Chart.js

const sparklineBaseConfig = {
    type: 'line',
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false }, // Hide legend
            title: {
                display: false, // デフォルトでは非表示
                text: '',
                position: 'top',
                align: 'start',
                color: 'rgba(255, 255, 255, 0.7)',
                font: {
                    family: "'Roboto Mono', monospace",
                    size: 12,
                },
                padding: { top: 0, bottom: 4 }
            }
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
 * @param {object} [options={}] - 追加のChart.jsオプション (例: { max: 100 })
 * @returns {Chart} Chart.jsのインスタンス
 */
function createOrUpdateSparkline(canvasId, data, options = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) { return null; }
    const ctx = canvas.getContext('2d');

    // 既存のチャートインスタンスをチェック
    let chart = Chart.getChart(ctx);

    if (chart) {
        // チャートが既に存在すれば、データのみ更新
        chart.data.labels = data.map((_, i) => i);
        chart.data.datasets[0].data = data;
        if (options.max !== undefined) {
            chart.options.scales.y.max = options.max;
            chart.options.scales.y.min = 0; // 最小値も0に設定
        }

        if (options.title) {
            chart.options.plugins.title.display = true;
            chart.options.plugins.title.text = options.title;
        } else {
            chart.options.plugins.title.display = false;
        }
        chart.update();
    } else {
        // 新しいチャートを作成
        const config = JSON.parse(JSON.stringify(sparklineBaseConfig)); // Deep copy

        if (options.max !== undefined) {
            config.options.scales.y.max = options.max;
            config.options.scales.y.min = 0; // 最小値も0に設定
        }

        if (options.title) {
            config.options.plugins.title.display = true;
            config.options.plugins.title.text = options.title;
        }

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
