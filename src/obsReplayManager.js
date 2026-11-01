import { EventEmitter } from 'events';

/**
 * OBSのリプレイバッファ制御およびキルデスイベント連動を管理するクラス
 */
export class ObsReplayManager extends EventEmitter {
    #obs = null;
    #config = {
        enabled: true,
        delaySeconds: 3,
        multiKillExtend: true
    };
    #isActive = false;
    #isSaving = false;
    #saveTimer = null;
    #countdownTimer = null;
    #pendingReason = null;
    #timerExpiresAt = null;
    #recentClips = [];

    /**
     * @param {object} [initialConfig={}] - 初期設定
     */
    constructor(initialConfig = {}) {
        super();
        this.updateConfig(initialConfig, false);
    }

    /**
     * OBS WebSocketインスタンスを設定し、イベントリスナーを登録する
     * @param {object} obs - obs-websocket-js インスタンス
     */
    setObs(obs) {
        this.#obs = obs;
        if (!this.#obs) {
            return;
        }

        // リプレイバッファの状態変化を監視
        this.#obs.on('ReplayBufferStateChanged', (data) => {
            console.log(`ReplayBufferStateChanged: ${JSON.stringify(data)}`);
            const { outputActive, outputState } = data;
            // 遷移途中の状態（STARTING, STOPPING）は除外し、確定状態のみ更新
            if (['OBS_WEBSOCKET_OUTPUT_STARTING', 'OBS_WEBSOCKET_OUTPUT_STOPPING'].includes(outputState)) {
                return;
            }
            this.#isActive = !!outputActive;
            this.#emitState();
        });

        // リプレイバッファの保存完了を監視
        this.#obs.on('ReplayBufferSaved', (data) => {
            const savedPath = data.savedReplayPath || '';
            const filename = savedPath.split(/[/\\]/).pop() || 'replay.mp4';
            const clipEntry = {
                timestamp: new Date().toISOString(),
                filename,
                path: savedPath,
                reason: this.#pendingReason || 'Manual'
            };
            this.#recentClips.unshift(clipEntry);
            if (this.#recentClips.length > 10) {
                this.#recentClips.pop();
            }
            this.#pendingReason = null;
            this.#emitState();
        });
    }

    /**
     * 設定を更新する
     * @param {object} newConfig - 新しい設定値
     * @param {boolean} [emit=true] - 状態更新イベントを発行するか
     */
    updateConfig(newConfig, emit = true) {
        if (!newConfig || typeof newConfig !== 'object') {
            return;
        }
        if (typeof newConfig.enabled === 'boolean') {
            this.#config.enabled = newConfig.enabled;
        }
        if (typeof newConfig.delaySeconds === 'number' && !isNaN(newConfig.delaySeconds) && newConfig.delaySeconds >= 0) {
            this.#config.delaySeconds = Math.round(newConfig.delaySeconds);
        }
        if (typeof newConfig.multiKillExtend === 'boolean') {
            this.#config.multiKillExtend = newConfig.multiKillExtend;
        }
        if (emit) {
            this.#emitState();
        }
    }

    /**
     * 初期ステータス（起動時など）を設定する
     * @param {boolean} isActive
     */
    setActive(isActive) {
        this.#isActive = !!isActive;
        this.#emitState();
    }

    /**
     * 現在の状態と設定を取得する
     * @returns {object}
     */
    getState() {
        const remainingMs = this.#timerExpiresAt ? Math.max(0, this.#timerExpiresAt - Date.now()) : 0;
        return {
            config: { ...this.#config },
            isActive: this.#isActive,
            isSaving: this.#isSaving,
            remainingSeconds: Math.ceil(remainingMs / 1000),
            pendingReason: this.#pendingReason,
            recentClips: [...this.#recentClips]
        };
    }

    /**
     * キルデスイベント受信時のハンドラ
     * @param {object} param0
     * @param {string} param0.event - 'Bounty' | 'FactionKillBond' | 'PVPKill' | 'Died'
     * @param {object} param0.entry - ジャーナルエントリ
     */
    onCombatKillDeath({ event, entry }) {
        if (!this.#config.enabled) {
            return;
        }
        if (!this.#isActive) {
            console.log(`[OBS Replay] リプレイバッファが非アクティブなため、${event} による保存をスキップします。`);
            return;
        }

        const reason = this.#formatReason(event, entry);

        if (this.#isSaving) {
            if (this.#config.multiKillExtend) {
                console.log(`[OBS Replay] マルチキル検知 (${reason})。タイマーを ${this.#config.delaySeconds} 秒に再設定します。`);
                this.#scheduleSave(this.#config.delaySeconds, `${reason} (Multi)`);
            } else {
                console.log('[OBS Replay] 保存待機中ですが、マルチキル延長が無効のため既存タイマーを維持します。');
            }
        } else {
            console.log(`[OBS Replay] 撃破イベント検知 (${reason})。${this.#config.delaySeconds} 秒後に保存します。`);
            this.#scheduleSave(this.#config.delaySeconds, reason);
        }
    }

    /**
     * 手動で直ちにリプレイを保存する
     */
    async triggerManualSave() {
        if (!this.#isActive) {
            throw new Error('リプレイバッファが開始されていません。');
        }
        this.#clearTimer();
        this.#pendingReason = 'Manual';
        await this.#callSaveReplayBuffer();
    }

    /**
     * リプレイバッファを開始する
     */
    async startReplayBuffer() {
        if (!this.#obs?.identified) {
            throw new Error('OBSに接続されていません。');
        }
        await this.#obs.call('StartReplayBuffer');
    }

    /**
     * リプレイバッファを停止する
     */
    async stopReplayBuffer() {
        if (!this.#obs?.identified) {
            throw new Error('OBSに接続されていません。');
        }
        this.#clearTimer();
        await this.#obs.call('StopReplayBuffer');
    }

    /**
     * リプレイバッファの開始/停止を切り替える
     */
    async toggleReplayBuffer() {
        if (!this.#obs?.identified) {
            throw new Error('OBSに接続されていません。');
        }
        await this.#obs.call('ToggleReplayBuffer');
    }

    /**
     * 指定秒数後に保存を実行するタイマーをセットする
     * @param {number} seconds
     * @param {string} reason
     */
    #scheduleSave(seconds, reason) {
        this.#clearTimer();
        this.#isSaving = true;
        this.#pendingReason = reason;
        this.#timerExpiresAt = Date.now() + seconds * 1000;

        if (seconds <= 0) {
            this.#executeScheduledSave();
            return;
        }

        this.#saveTimer = setTimeout(() => {
            this.#executeScheduledSave();
        }, seconds * 1000);

        // クライアントへカウントダウンを1秒ごとに通知
        this.#countdownTimer = setInterval(() => {
            if (this.#isSaving) {
                this.#emitState();
            }
        }, 1000);

        this.#emitState();
    }

    /**
     * スケジュールされた保存を実行
     */
    async #executeScheduledSave() {
        this.#clearTimer();
        await this.#callSaveReplayBuffer();
    }

    /**
     * OBSへSaveReplayBufferリクエストを送信
     */
    async #callSaveReplayBuffer() {
        if (!this.#obs?.identified) {
            console.error('[OBS Replay] OBSが未接続のため、リプレイバッファの保存に失敗しました。');
            this.#isSaving = false;
            this.#emitState();
            return;
        }
        try {
            console.log(`[OBS Replay] SaveReplayBuffer を発行します (要因: ${this.#pendingReason || 'Unknown'})`);
            await this.#obs.call('SaveReplayBuffer');
        } catch (error) {
            console.error('[OBS Replay] SaveReplayBuffer の呼び出しでエラー:', error);
        } finally {
            this.#isSaving = false;
            this.#timerExpiresAt = null;
            this.#emitState();
        }
    }

    /**
     * タイマーをクリアする
     */
    #clearTimer() {
        if (this.#saveTimer) {
            clearTimeout(this.#saveTimer);
            this.#saveTimer = null;
        }
        if (this.#countdownTimer) {
            clearInterval(this.#countdownTimer);
            this.#countdownTimer = null;
        }
        this.#isSaving = false;
        this.#timerExpiresAt = null;
    }

    /**
     * イベントからわかりやすい理由文字列を作成
     * @param {string} event
     * @param {object} entry
     * @returns {string}
     */
    #formatReason(event, entry) {
        switch (event) {
            case 'Bounty': {
                const target = entry?.Target_Localised || entry?.Target || 'Enemy';
                return `Bounty: ${target.charAt(0).toUpperCase() + target.slice(1)}`;
            }
            case 'FactionKillBond': {
                const victimFaction = entry?.VictimFaction || 'CZ Ship';
                return `CZ Kill: ${victimFaction}`;
            }
            case 'PVPKill': {
                const victim = entry?.Victim || 'CMDR';
                return `PvP Kill: ${victim}`;
            }
            case 'Died': {
                const killer = entry?.KillerName || 'Unknown';
                return `Died: by ${killer}`;
            }
            default:
                return event;
        }
    }

    /**
     * 状態変化イベントをemit
     */
    #emitState() {
        this.emit('stateChange', this.getState());
    }

    /**
     * 終了時のクリーンアップ
     */
    destroy() {
        this.#clearTimer();
        this.removeAllListeners();
    }
}

