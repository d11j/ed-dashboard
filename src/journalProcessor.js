import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { ALL_RANKS, COMBAT_RANKS, JOURNAL_DIR, SCAN_VALUES } from './constants.js';
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
    #isInGame = false; // ゲームのメインモードかどうか
    #isLoading = false; // LoadGame～Locationの間trueになるフラグ
    #isInitialLoaded = false; // 初回ロードが完了したかどうか
    #sessionStartTimer = null;
    eventLog = []; // イベントログ

    #broadcastUpdateCallback;
    #broadcastLogCallback;
    #eventHandlers;

    constructor(initialState, broadcastUpdateCallback, broadcastLogCallback) {
        this.state = initialState;
        this.#broadcastUpdateCallback = broadcastUpdateCallback;
        this.#broadcastLogCallback = broadcastLogCallback;

        // --- イベントハンドラマップ ---
        this.#eventHandlers = {
            'LoadGame': this.#handleLoadGame,
            'Shutdown': this.#handleSessionEnd,
            'Music': this.#handleMusic,
            'Undocked': this.#handleTakeoff,
            'Liftoff': this.#handleTakeoff,
            'Bounty': this.#handleBounty,
            'FSDJump': this.#handleLocationChange,
            'Location': this.#handleLocationChange,
            'DockingGranted': this.#handleDockingGranted,
            'DockingCancelled': this.#handleDockingCancelled,
            'Docked': this.#handleDockingComplete,
            'Touchdown': this.#handleDockingComplete,
            'ShipTargeted': this.#handleShipTargeted,
            'MaterialCollected': this.#handleMaterialCollected,
            'FactionKillBond': this.#handleFactionKillBond,
            'MissionAccepted': this.#handleMissionAccepted,
            'MissionCompleted': this.#handleMissionCompleted,
            'MissionFailed': this.#handleMissionAbandonedOrFailed,
            'MissionAbandoned': this.#handleMissionAbandonedOrFailed,
            'Scan': this.#handleScan,
            'Progress': this.#handleProgress,
            'Rank': this.#handleRank,
            'Promotion': this.#handleRank
        };
    }

    /**
     * ジャーナルディレクトリを監視し、ファイルの追加や変更を検知して処理を行う
     * 監視開始時に既存のジャーナルファイルも処理する
     */
    startMonitoring() {
        console.log(`ジャーナルディレクトリを監視中: ${JOURNAL_DIR}`);
        const watcher = chokidar.watch(JOURNAL_DIR, {
            persistent: true,
            ignoreInitial: false, // 起動時の既存ファイルも処理対象にする
            awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
            depth: 0 // サブディレクトリは監視しない
        });

        // 初期読み込み完了のPromise
        const initialProcessingPromises = [];

        const getTodaysPrefix = () => {
            if(process.env.DEBUG_PFX) {
                return process.env.DEBUG_PFX;
            }
            const today = new Date();
            const year = today.getFullYear();
            const month = (today.getMonth() + 1).toString().padStart(2, '0');
            const day = today.getDate().toString().padStart(2, '0');
            return `Journal.${year}-${month}-${day}`;
        };

        console.log('ジャーナルファイルの初回スキャンと監視を開始します...');

        watcher
            .on('add', (filePath) => {
                const filename = path.basename(filePath);
                if (filename.startsWith(getTodaysPrefix()) && filename.endsWith('.log')) {
                    if (!this.#isInitialLoaded) {
                        // 初回スキャン中: Promise配列に追加し、ブロードキャストは抑制
                        initialProcessingPromises.push(this.#processFile(filePath, true));
                    } else {
                        // 運用中の新規ファイル追加: 即時処理し、ブロードキャストする
                        this.#processFile(filePath, false);
                    }
                }
            })
            .on('change', (filePath) => {
                const filename = path.basename(filePath);
                if (filename.startsWith(getTodaysPrefix()) && filename.endsWith('.log')) {
                    this.#processFile(filePath, false);
                }
            })
            .on('ready', async () => {
                console.log('初回スキャン完了。リアルタイム監視中...');

                // ★ すべての初回ファイル処理が完了するのを待つ
                await Promise.all(initialProcessingPromises);
                this.#isInitialLoaded = true;
                console.log('すべてのジャーナル履歴の読み込みが完了しました。');

                // --- Status.jsonの監視をここで開始 ---
                const statusPath = path.join(JOURNAL_DIR, 'Status.json');
                const statusWatcher = chokidar.watch(statusPath, {
                    persistent: true,
                    ignoreInitial: true,
                    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
                });

                statusWatcher.on('change', (filePath) => {
                    if (!this.#isInGame) { return; }
                    fs.readFile(filePath, 'utf-8', (err, data) => {
                        if (err) { return; }
                        try {
                            const statusData = JSON.parse(data);
                            this.#processStatus(statusData);
                        } catch (e) { /* パースエラーは無視 */ }
                    });
                });
                this.#broadcastUpdateCallback(this.state); // 初回スキャン完了後に一度だけブロードキャスト
            })
            .on('error', (error) => console.error(`ファイル監視エラー: ${error}`));
    }

    /**
     * 録画状態を変更する (server.jsからOBSのイベントに応じて呼び出す)
     * @param {boolean} isRecording - 録画中であるか
     * @param {Date | null} startTime - 録画開始時刻
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
     * @param {object} initialState - 初期状態オブジェクト
     */
    resetState(initialState) {
        this.state = initialState;
        this.#broadcastUpdateCallback(this.state);
    }

    /**
     * ファイルを読み込み、ジャーナルエントリを処理する
     * @param {string} filePath - 処理するファイルのパス
     * @param {boolean} suppressBroadcast - trueの場合、処理後のブロードキャストを抑制する
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
        if (start >= end) {
            return;
        }
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
        if (!statusData) {
            return;
        }

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

    /**
     * ジャーナル行をパースし、イベントハンドラマップを介して適切な処理メソッドに振り分ける
     * @param {string} line - ジャーナルファイルから読み込んだ単一の行
     */
    #processJournalLine(line) {
        try {
            if (line.trim() === '') {
                return;
            }
            const entry = JSON.parse(line);

            if (entry.timestamp) {
                this.state.lastUpdateTimestamp = entry.timestamp;
            }

            // イベントハンドラを呼び出す
            const handler = this.#eventHandlers[entry.event];
            if (handler) {
                handler.call(this, entry);
            }
            this.#logEvent(entry);
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * 録画中に特定のイベントが発生した場合、タイムスタンプ付きのログを生成する
     * @param {object} entry - ジャーナルエントリ
     * @param {boolean} [isMinorEvent=false] - 重要度が低いイベント（ログ上では `*` を付ける）か
     */
    #logEvent(entry, isMinorEvent = false) {
        if (!this.#recordingStartTime) {
            return;
        }

        const elapsedTime = formatElapsedTime(new Date() - this.#recordingStartTime);
        let logMessage = '';

        switch (entry.event) {
            case 'Bounty':
                isMinorEvent = true;
                logMessage = `撃破: ${entry.Target_Localised || entry.Target}`;
                break;
            case 'FSDJump':
                logMessage = `ジャンプ: ${entry.StarSystem} へ`;
                break;
            case 'DockingGranted':
                logMessage = '-- 着陸開始 --';
                break;
            case 'DockingCancelled':
                logMessage = '-- 着陸キャンセル --';
                break;
            case 'Docked':
                logMessage = `着艦: ${entry.StationName}`;
                break;
            case 'Touchdown':
                logMessage = `着陸: ${entry.Body}`;
                break;
            case 'Undocked':
                logMessage = `離艦: ${entry.StationName}`;
                break;
            case 'Liftoff':
                logMessage = `離陸: ${entry.Body}`;
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

    // --- イベント別ハンドラメソッド ---

    /**
     * LoadGameイベントを処理し、ゲーム開始時の状態（着艦中か否か）をセットする
     * @param {object} entry - LoadGameイベントのジャーナルエントリ
     */
    #handleLoadGame(entry) {
        if (entry.Docked || entry.StartLanded) {
            this.#isInitialTakeoffComplete = false;
            this.#wasLandingGearDown = true;
        } else {
            this.#isInitialTakeoffComplete = true;
            this.#wasLandingGearDown = false;
        }
        this.#isLoading = true;
    }

    /** セッション終了時に呼び出され、監視を無効化する */
    #handleSessionEnd() {
        // 既に無効化されている場合は何もしない
        if (!this.#isInGame) {
            return;
        }
        console.log('セッションが終了しました。Status.jsonの監視を無効化します。');

        if (this.#sessionStartTimer) {
            clearTimeout(this.#sessionStartTimer);
            this.#sessionStartTimer = null;
        }

        this.#isInGame = false;
        this.#isLoading = false;
    }

    /** メインメニューに戻った際にセッションを終了とみなす */
    #handleMusic(entry) {
        if (entry.MusicTrack === 'MainMenu') {
            this.#handleSessionEnd();
        }
    }

    /**
     * UndockedまたはLiftoffイベントを処理し、離陸/離艦状態を管理する
     * @param {object} _entry - Undocked/Liftoffイベントのジャーナルエントリ
     */
    #handleTakeoff(_entry) {
        if (!this.#isInitialTakeoffComplete) {
            this.#isInitialTakeoffComplete = true;
        }
        this.#isLandingSequence = false;
        this.#wasLandingGearDown = true;
    }

    /**
     * FSDJumpまたはLocationイベントを処理し、星系の派閥情報を更新する
     * @param {object} entry - FSDJump/Locationイベントのジャーナルエントリ
     */
    #handleLocationChange(entry) {
        this.#factionAllegianceMap = {};
        if (entry.Factions && Array.isArray(entry.Factions)) {
            entry.Factions.forEach(faction => {
                if (faction.Name && faction.Allegiance) {
                    this.#factionAllegianceMap[faction.Name] = faction.Allegiance;
                }
            });
        }

        // ロード後の最初のLocationイベントを検知
        if (this.#isLoading) {
            this.#isLoading = false; // ロード完了
            // 既にタイマーがセットされていたら何もしない
            if (!this.#sessionStartTimer) {
                // 短い遅延を設けて、ゲームの状態が完全に安定するのを待つ
                this.#sessionStartTimer = setTimeout(() => {
                    console.log('Status.jsonの監視を有効化します。');
                    this.#isInGame = true;
                    this.#sessionStartTimer = null; // タイマーIDをクリア
                }, 1500);
            }
        }
    }

    /**
     * DockingGrantedイベントを処理し、着陸シーケンスの開始を記録する
     * @param {object} _entry - DockingGrantedイベントのジャーナルエントリ
     */
    #handleDockingGranted(_entry) {
        if (!this.#isLandingSequence) {
            this.#isLandingSequence = true;
        }
    }

    /**
     * DockingCancelledイベントを処理し、着陸シーケンスの中断を記録する
     * @param {object} _entry - DockingCancelledイベントのジャーナルエントリ
     */
    #handleDockingCancelled(_entry) {
        if (this.#isLandingSequence) {
            this.#isLandingSequence = false;
        }
    }

    /**
     * DockedまたはTouchdownイベントを処理し、着陸/着艦の完了を記録する
     * @param {object} _entry - Docked/Touchdownイベントのジャーナルエントリ
     */
    #handleDockingComplete(_entry) {
        if (this.#isLandingSequence) {
            this.#isLandingSequence = false;
        }
    }

    /**
     * ShipTargetedイベントを処理し、ターゲットのパイロットランクを一時的に保持する
     * @param {object} entry - ShipTargetedイベントのジャーナルエントリ
     */
    #handleShipTargeted(entry) {
        if (entry.TargetLocked === true) {
            const pilotName = entry.PilotName_Localised || entry.PilotName;
            if (pilotName && typeof entry.PilotRank !== 'undefined') {
                this.#pilotRanks[pilotName] = entry.PilotRank;
            }
        }
    }

    /**
     * Bountyイベントを処理し、賞金首の撃破情報を集計する
     * @param {object} entry - Bountyイベントのジャーナルエントリ
     */
    #handleBounty(entry) {
        this.state.bounty.count++;
        let reward = 0;
        if (entry.Rewards && Array.isArray(entry.Rewards)) {
            entry.Rewards.forEach(r => { reward += r.Reward; });
            this.state.bounty.totalRewards += reward;
        }
        const targetName = entry.Target_Localised || (entry.Target.charAt(0).toUpperCase() + entry.Target.slice(1));
        this.state.bounty.targets[targetName] = (this.state.bounty.targets[targetName] || 0) + 1;

        const pilotName = entry.PilotName_Localised || entry.PilotName;
        let rankName = 'Unknown';
        if (pilotName && typeof this.#pilotRanks[pilotName] !== 'undefined') {
            const rank = this.#pilotRanks[pilotName];
            rankName = (typeof rank === 'number') ? COMBAT_RANKS[rank] || 'Unknown' : rank;
        }
        this.state.bounty.ranks[rankName] = (this.state.bounty.ranks[rankName] || 0) + 1;
    }

    /**
     * MaterialCollectedイベントを処理し、収集したマテリアル情報を集計する
     * @param {object} entry - MaterialCollectedイベントのジャーナルエントリ
     */
    #handleMaterialCollected(entry) {
        const { Category: category, Name_Localised, Name: name, Count: count } = entry;
        if (!category || !name) {
            return;
        }
        this.state.materials.total += count;
        this.state.materials.categories[category] = (this.state.materials.categories[category] || 0) + count;
        if (!this.state.materials.details[category]) {
            this.state.materials.details[category] = {};
        }
        this.state.materials.details[category][Name_Localised || name] = (this.state.materials.details[category][Name_Localised || name] || 0) + count;
    }

    /**
     * FactionKillBondイベントを処理し、CZでの撃破報酬を集計する
     * @param {object} entry - FactionKillBondイベントのジャーナルエントリ
     */
    #handleFactionKillBond(entry) {
        this.state.bounty.count++;
        this.state.bounty.totalRewards += entry.Reward;
    }

    /**
     * MissionAcceptedイベントを処理し、連邦/帝国ミッションを追跡対象に追加する
     * @param {object} entry - MissionAcceptedイベントのジャーナルエントリ
     */
    #handleMissionAccepted(entry) {
        const allegiance = this.#factionAllegianceMap[entry.Faction];
        if (entry.MissionID && allegiance) {
            if (allegiance === 'Federation' || allegiance === 'Empire') {
                this.#activeMissions[entry.MissionID] = allegiance;
            }
        }
    }

    /**
     * MissionCompletedイベントを処理し、ミッション完了数を集計する
     * @param {object} entry - MissionCompletedイベントのジャーナルエントリ
     */
    #handleMissionCompleted(entry) {
        const { MissionID } = entry;
        const allegiance = this.#activeMissions[MissionID];
        this.state.missions.completed++;
        if (allegiance === 'Federation') {
            this.state.missions.federation++;
        } else if (allegiance === 'Empire') {
            this.state.missions.empire++;
        } else {
            this.state.missions.independent++;
        }
        if (allegiance) {
            delete this.#activeMissions[MissionID];
        }
    }

    /**
     * MissionAbandoned/MissionFailedイベントを処理し、追跡対象からミッションを削除する
     * @param {object} entry - MissionAbandoned/MissionFailedイベントのジャーナルエントリ
     */
    #handleMissionAbandonedOrFailed(entry) {
        if (this.#activeMissions[entry.MissionID]) {
            delete this.#activeMissions[entry.MissionID];
        }
    }

    /**
     * Scanイベントを処理し、探査情報を集計する
     * @param {object} entry - Scanイベントのジャーナルエントリ
     */
    #handleScan(entry) {
        if(entry.ScanType !== 'Detailed') {
            return;
        }

        // スキャン総数を更新
        this.state.exploration.totalScans++;

        // 初発見数を更新
        const isFirstDiscovery = !this.state.exploration.firstToDiscover;
        this.state.exploration.firstToDiscover += isFirstDiscovery ? 0 : 1;

        if(isFirstDiscovery) {
            // 初発見のイベントログを出力
            const elapsedTime = formatElapsedTime(new Date() - this.#recordingStartTime);
            this.eventLog.push(`[${elapsedTime}] 初発見: ${entry.BodyName}`);
            this.#broadcastLogCallback(this.eventLog);
        }

        // テラフォーム可能かどうかをチェック
        const isTerraformable = entry.TerraformState === 'Terraformable';

        // スキャンの価値算出
        if (entry.PlanetClass) {
            const planetClass = entry.PlanetClass + (isTerraformable ? '(Terraformable)' : '');
            const value = SCAN_VALUES[planetClass] || 0;
            this.state.exploration.estimatedValue += value;

            // 高価値スキャンのカウント
            if (value > 0) {
                this.state.exploration.highValueScans++;
            }
        }
    }

    /**
     * Progressイベントを処理し、各ランクの進行度(%)を更新する
     * @param {object} entry - Progressイベントのジャーナルエントリ
     */
    #handleProgress(entry) {
        Object.keys(ALL_RANKS).forEach(rankType => {
            if (this.state.progress[rankType] && typeof entry[rankType] !== 'undefined') {
                this.state.progress[rankType].progress = entry[rankType];
            }
        });
    }

    /**
     * Rank/Promotionイベントを処理し、各ランクの階級情報を更新する
     * @param {object} entry - Rank/Promotionイベントのジャーナルエントリ
     */
    #handleRank(entry) {
        Object.keys(ALL_RANKS).forEach(rankType => {
            if (this.state.progress[rankType] && typeof entry[rankType] !== 'undefined') {
                const rankValue = entry[rankType];
                const rankList = ALL_RANKS[rankType];
                const progressState = this.state.progress[rankType];

                progressState.rank = rankValue;
                progressState.name = rankList[rankValue] || 'Unknown';
                progressState.nextName = rankList[rankValue + 1] || '';

                if (entry.event === 'Promotion') {
                    progressState.progress = 0;
                }
            }
        });
    }
}

export default JournalProcessor;
