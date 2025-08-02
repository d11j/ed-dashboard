import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { ALL_RANKS, COMBAT_RANKS, JOURNAL_DIR } from './constants.js';
import { formatElapsedTime } from './utils.js';

export class JournalProcessor {
    #pilotRanks = {}; // 敵パイロットのランク情報を保持
    #processedFiles = {};
    #activeMissions = {}; // 進行中のミッション情報を保持
    #factionAllegianceMap = {}; // 現在の星系の派閥と所属のマップ

    // 状態管理フラグ
    #wasHardpointsDeployed = false; // ハードポイントの以前の状態
    #isLandingSequence = false;  // 着陸シーケンス中
    #wasLandingGearDown = false; // ランディングギアの以前の状態
    #isInitialTakeoffComplete = false; // セッション開始後の初回離陸が完了したか
    #recordingStartTime = null; // 録画開始時刻
    eventLog = []; // イベントログ

    #broadcastUpdateCallback;
    #broadcastLogCallback;

    constructor(initialState, broadcastUpdateCallback, broadcastLogCallback) {
        this.state = initialState;
        this.#broadcastUpdateCallback = broadcastUpdateCallback;
        this.#broadcastLogCallback = broadcastLogCallback;
    }

    startMonitoring() {
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
                    this.#processStatus(statusData);
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
                this.#processFile(filePath, suppressBroadcast);
            }
        };

        console.log('ジャーナルファイルの初回スキャンと監視を開始します...');

        watcher
            .on('add', (filePath) => processIfNeeded(filePath, true)) // 初回スキャン中はブロードキャストしない
            .on('change', (filePath) => processIfNeeded(filePath, false)) // 変更時はブロードキャストする
            .on('ready', () => {
                console.log('初回スキャン完了。リアルタイム監視中...');
                this.#broadcastUpdateCallback(this.state); // 初回スキャン完了後に一度だけブロードキャスト
            })
            .on('error', (error) => console.error(`ファイル監視エラー: ${error}`));
    }

    /**
     * 録画状態を変更する
     * (server.jsからOBSのイベントに応じて呼び出す)
     */
    setRecordingState(isRecording, startTime = null) {
        if (isRecording) {
            this.#recordingStartTime = startTime;
            this.eventLog = ['[00:00:00] -- 録画開始 --'];
            console.log(`録画開始: ${this.#recordingStartTime}`);
        } else {
            if (this.#recordingStartTime) {
                const elapsedTime = formatElapsedTime(new Date() - this.#recordingStartTime);
                this.eventLog.push(`[${elapsedTime}] -- 録画停止 --`);
                console.log(`録画停止: ${elapsedTime}`);
            }
            this.#recordingStartTime = null;
        }
        this.#broadcastLogCallback(this.eventLog);
    }

    /**
     * 統計情報をリセットする
     */
    resetState(initialState) {
        this.state = initialState;
        this.#broadcastUpdateCallback(this.state);
    }

    /**
     * ファイルを読み込み、ジャーナルエントリを処理する
     * @param {string} filePath 処理するファイルのパス
     * @param {boolean} suppressBroadcast trueの場合、処理後のブロードキャストを抑制する
     */
    async #processFile(filePath, suppressBroadcast = false) {
        const start = this.#processedFiles[filePath] || 0;
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
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
            this.#processJournalLine(line);
        }
        this.#processedFiles[filePath] = end;
        if (!suppressBroadcast) {
            this.#broadcastUpdateCallback(this.state);
        }
    }

    /**
     * Status.jsonをパースし、状態変化に応じてログを記録する
     * @param {object} statusData - Status.jsonから読み込んだJSONオブジェクト
     */
    #processStatus(statusData) {
        if (!statusData) return;

        const now = new Date();
        const flags = statusData.Flags;

        // 現在の状態を取得
        const isHardpointsDeployed = (flags & (1 << 6)) !== 0;
        const isInSupercruise = (flags & (1 << 4)) !== 0;
        const isLandingGearDown = (flags & (1 << 2)) !== 0;

        // 変更点を検出
        const hardpointsChanged = isHardpointsDeployed !== this.#wasHardpointsDeployed;
        const landingGearChanged = isLandingGearDown !== this.#wasLandingGearDown;

        // 着陸シーケンスの開始/中断条件を判定
        const shouldStartLandingSequence = isLandingGearDown && !this.#isLandingSequence && this.#isInitialTakeoffComplete;
        const shouldCancelLandingSequence = !isLandingGearDown && this.#isLandingSequence;

        // 録画中の場合はログを生成
        if (this.#recordingStartTime) {
            const elapsedTime = formatElapsedTime(now - this.#recordingStartTime);

            // ハードポイントの状態変化ログ
            if (hardpointsChanged && !isInSupercruise) {
                const logMessage = isHardpointsDeployed ? '-- 戦闘開始 --' : '-- 戦闘終了 --';
                this.eventLog.push(`[${elapsedTime}] ${logMessage}`);
                this.#broadcastLogCallback(this.eventLog);
            }

            // 着陸シーケンスのログ
            if (landingGearChanged) {
                if (shouldStartLandingSequence) {
                    this.eventLog.push(`[${elapsedTime}] -- 着陸開始 --`);
                    this.#broadcastLogCallback(this.eventLog);
                } else if (shouldCancelLandingSequence) {
                    this.eventLog.push(`[${elapsedTime}] -- 着陸中断 --`);
                    this.#broadcastLogCallback(this.eventLog);
                }
            }
        }

        // 内部状態フラグを更新
        this.#wasHardpointsDeployed = isHardpointsDeployed;
        this.#wasLandingGearDown = isLandingGearDown;

        // 着陸シーケンスの状態を更新
        if (landingGearChanged) {
            if (shouldStartLandingSequence) {
                this.#isLandingSequence = true;
            } else if (shouldCancelLandingSequence) {
                this.#isLandingSequence = false;
            }
        }
    }

    // --- ジャーナル処理ロジック ---
    #processJournalLine(line) {
        try {
            if (line.trim() === '') return;
            const entry = JSON.parse(line);

            if (entry.timestamp) {
                this.state.lastUpdateTimestamp = entry.timestamp;
            }

            // --- ▼▼▼ 状態フラグ管理ロジック ▼▼▼ ---
            if (entry.event === 'LoadGame') {
                if (entry.Docked || entry.StartLanded) {
                    this.#isInitialTakeoffComplete = false;
                    this.#wasLandingGearDown = true;
                } else {
                    this.#isInitialTakeoffComplete = true;
                    this.#wasLandingGearDown = false;
                }
            } else if (entry.event === 'Undocked' || entry.event === 'Liftoff') {
                if (!this.#isInitialTakeoffComplete) {
                    this.#isInitialTakeoffComplete = true;
                }
            }

            // --- 録画中のイベントログ記録 ---
            if (this.#recordingStartTime) {
                const elapsedTime = formatElapsedTime(new Date() - this.#recordingStartTime);
                let logMessage = '';
                let isMinorEvent = false;

                switch (entry.event) {
                    case 'Bounty':
                        isMinorEvent = true;
                        logMessage = `撃破: ${entry.Target_Localised || entry.Target}`;
                        break;
                    case 'FSDJump':
                        logMessage = `ジャンプ: ${entry.StarSystem} へ`;
                        break;
                    case 'DockingGranted':
                        if (!this.#isLandingSequence) {
                            this.#isLandingSequence = true;
                            logMessage = '-- 着陸開始 --';
                        }
                        break;
                    case 'DockingCancelled':
                        if (this.#isLandingSequence) {
                            this.#isLandingSequence = false;
                            logMessage = '-- 着陸キャンセル --';
                        }
                        break;
                    case 'Docked':
                    case 'Touchdown':
                        if (this.#isLandingSequence) this.#isLandingSequence = false;
                        logMessage = entry.event === 'Docked' ? `着艦: ${entry.StationName}` : `着陸: ${entry.Body}`;
                        break;
                    case 'Undocked':
                    case 'Liftoff':
                        logMessage = entry.event === 'Undocked' ? `離艦: ${entry.StationName}` : `離陸: ${entry.Body}`;
                        this.#isLandingSequence = false;
                        this.#wasLandingGearDown = true;
                        break;
                    case 'ShipyardSwap':
                        const newShip = entry.ShipType_Localised || entry.ShipType || 'Unknown';
                        logMessage = `乗り換え: ${newShip.charAt(0).toUpperCase() + newShip.slice(1)}`;
                        break;
                }

                if (logMessage) {
                    const prefix = isMinorEvent ? '* ' : '';
                    this.eventLog.push(`${prefix}[${elapsedTime}] ${logMessage}`);
                    this.#broadcastLogCallback(this.eventLog);
                }
            }

            // --- 統計情報処理 ---
            if (entry.event === 'FSDJump' || entry.event === 'Location') {
                this.#factionAllegianceMap = {}; // 現在の星系の派閥情報に更新
                if (entry.Factions && Array.isArray(entry.Factions)) {
                    entry.Factions.forEach(faction => {
                        if (faction.Name && faction.Allegiance) {
                            this.#factionAllegianceMap[faction.Name] = faction.Allegiance;
                        }
                    });
                }
            } else if (entry.event === 'ShipTargeted' && entry.TargetLocked === true) {
                const pilotName = entry.PilotName_Localised || entry.PilotName;
                if (pilotName && typeof entry.PilotRank !== 'undefined') {
                    this.#pilotRanks[pilotName] = entry.PilotRank;
                }
            } else if (entry.event === 'Bounty') {
                this.state.bounty.count++;
                let reward = 0;
                if (entry.Rewards && Array.isArray(entry.Rewards)) {
                    entry.Rewards.forEach(r => { reward += r.Reward; });
                    this.state.bounty.totalRewards += reward;
                }
                if (entry.Target_Localised) {
                    this.state.bounty.targets[entry.Target_Localised] = (this.state.bounty.targets[entry.Target_Localised] || 0) + 1;
                } else {
                    const shipName = entry.Target.charAt(0).toUpperCase() + entry.Target.slice(1);
                    this.state.bounty.targets[shipName] = (this.state.bounty.targets[shipName] || 0) + 1;
                }
                const pilotName = entry.PilotName_Localised || entry.PilotName;
                let rankName = 'Unknown';
                if (pilotName && typeof this.#pilotRanks[pilotName] !== 'undefined') {
                    const rank = this.#pilotRanks[pilotName];
                    if (typeof rank === 'number') rankName = COMBAT_RANKS[rank] || 'Unknown';
                    else if (typeof rank === 'string') rankName = rank;
                }
                this.state.bounty.ranks[rankName] = (this.state.bounty.ranks[rankName] || 0) + 1;
            } else if (entry.event === 'MaterialCollected') {
                const category = entry.Category;
                const name = entry.Name_Localised || entry.Name;
                const count = entry.Count;
                if (!category || !name) return;
                this.state.materials.total += count;
                this.state.materials.categories[category] = (this.state.materials.categories[category] || 0) + count;
                if (!this.state.materials.details[category]) this.state.materials.details[category] = {};
                this.state.materials.details[category][name] = (this.state.materials.details[category][name] || 0) + count;
            } else if (entry.event === 'FactionKillBond') {
                this.state.bounty.count++;
                this.state.bounty.totalRewards += entry.Reward;
            } else if (entry.event === 'MissionAccepted') {
                const factionName = entry.Faction;
                const allegiance = this.#factionAllegianceMap[factionName];
                if (entry.MissionID && allegiance) {
                    if (allegiance === 'Federation' || allegiance === 'Empire') {
                        this.#activeMissions[entry.MissionID] = allegiance;
                    }
                }
            } else if (entry.event === 'MissionCompleted') {
                const missionID = entry.MissionID;
                const allegiance = this.#activeMissions[missionID];
                this.state.missions.completed++;
                if (allegiance === 'Federation') {
                    this.state.missions.federation++;
                } else if (allegiance === 'Empire') {
                    this.state.missions.empire++;
                } else {
                    this.state.missions.independent++;
                }
                if (allegiance) {
                    delete this.#activeMissions[missionID];
                }
            } else if (entry.event === 'MissionFailed' || entry.event === 'MissionAbandoned') {
                if (this.#activeMissions[entry.MissionID]) {
                    delete this.#activeMissions[entry.MissionID];
                }
            } else if (entry.event === 'Progress') {
                Object.keys(ALL_RANKS).forEach(rankType => {
                    if (this.state.progress[rankType] && typeof entry[rankType] !== 'undefined') {
                        this.state.progress[rankType].progress = entry[rankType];
                    }
                });
            } else if (entry.event === 'Rank' || entry.event === 'Promotion') {
                const ranks = entry;
                Object.keys(ALL_RANKS).forEach(rankType => {
                    if (this.state.progress[rankType] && typeof ranks[rankType] !== 'undefined') {
                        const rankValue = ranks[rankType];
                        const rankList = ALL_RANKS[rankType];
                        this.state.progress[rankType].rank = rankValue;
                        this.state.progress[rankType].name = rankList[rankValue] || 'Unknown';
                        this.state.progress[rankType].nextName = rankList[rankValue + 1] || '';
                        if (entry.event === 'Promotion') {
                            this.state.progress[rankType].progress = 0;
                        }
                    }
                });
            }
        } catch (e) {
            // JSONパースエラーは無視
            console.error(e);
        }
    }
}

export default JournalProcessor;
