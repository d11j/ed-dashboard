import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { JOURNAL_DIR } from '../src/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const delayMs = 1000; // 追記する間隔（ミリ秒）
const fixturePath = path.join(__dirname, '../tests/fixtures/journal-test.log');

async function run() {
    console.log('--- Elite:Dangerous ジャーナルシミュレータ ---');
    console.log(`書き込み先ディレクトリ: ${JOURNAL_DIR}`);

    if (!fs.existsSync(JOURNAL_DIR)) {
        throw new Error(`ジャーナルディレクトリが存在しません: ${JOURNAL_DIR}`);
    }

    // fixtureの読み込み
    if (!fs.existsSync(fixturePath)) {
        throw new Error(`テスト用データが見つかりません。 ${fixturePath}`);
    }

    const fileStream = fs.createReadStream(fixturePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const lines = [];
    for await (const line of rl) {
        if (line.trim()) {
            lines.push(line);
        }
    }

    if (lines.length === 0) {
        throw new Error(`テスト用データが空です。 ${fixturePath}`);
    }

    // 今日の日付でシミュレート用ジャーナルファイル名を作成
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');

    // 接頭辞マッチ条件(Journal.YYYY-MM-DD)を満たし、かつシミュレータであることを識別できるファイル名
    const logFilename = `Journal.${year}-${month}-${day}.sim.log`;
    const logFilePath = path.join(JOURNAL_DIR, logFilename);

    console.log(`シミュレーションファイルを作成/初期化します: ${logFilename}`);
    fs.writeFileSync(logFilePath, '', 'utf-8');

    console.log(`開始します。 ${delayMs / 1000} 秒ごとにログを追記します。 (全 ${lines.length} 行)`);
    console.log('Ctrl+C で終了できます。終了後、作成された .sim.log ファイルは必要に応じて削除してください。');

    let index = 0;
    const intervalId = setInterval(() => {
        if (index >= lines.length) {
            console.log('すべてのログを書き込みました。シミュレーションを終了します。');
            clearInterval(intervalId);
            process.exit(0);
        }

        const rawLine = lines[index];
        try {
            const entry = JSON.parse(rawLine);
            // タイムスタンプを現在時刻に更新
            entry.timestamp = new Date().toISOString();
            const logLine = JSON.stringify(entry) + '\n';

            fs.appendFileSync(logFilePath, logLine, 'utf-8');
            console.log(`[${index + 1}/${lines.length}] 追加イベント: ${entry.event}`);
        } catch (e) {
            // JSONでない場合はそのまま追記
            fs.appendFileSync(logFilePath, rawLine + '\n', 'utf-8');
            console.log(`[${index + 1}/${lines.length}] 追加: ${rawLine}`);
        }

        index++;
    }, delayMs);
}

run().catch(console.error);
