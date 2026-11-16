import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObsReplayManager } from '../../src/obsReplayManager.js';

describe('ObsReplayManager', () => {
    let manager;
    let mockObs;

    beforeEach(() => {
        vi.useFakeTimers();
        mockObs = {
            identified: true,
            call: vi.fn().mockResolvedValue({}),
            on: vi.fn()
        };
        manager = new ObsReplayManager({
            enabled: true,
            delaySeconds: 3,
            multiKillExtend: true
        });
        manager.setObs(mockObs);
        manager.setActive(true);
    });

    afterEach(() => {
        manager.destroy();
        vi.useRealTimers();
    });

    it('should initialize with default config and active state', () => {
        const state = manager.getState();
        expect(state.config.enabled).toBe(true);
        expect(state.config.delaySeconds).toBe(3);
        expect(state.config.multiKillExtend).toBe(true);
        expect(state.isActive).toBe(true);
        expect(state.isSaving).toBe(false);
    });

    it('should schedule save on combat kill event and trigger after 3 seconds', async () => {
        const stateSpy = vi.fn();
        manager.on('stateChange', stateSpy);

        manager.onCombatKillDeath({
            event: 'Bounty',
            entry: { Target: 'anaconda' }
        });

        expect(manager.getState().isSaving).toBe(true);
        expect(mockObs.call).not.toHaveBeenCalled();

        // 2秒後：まだ呼ばれていない
        vi.advanceTimersByTime(2000);
        expect(mockObs.call).not.toHaveBeenCalled();

        // 1秒後（合計3秒後）：SaveReplayBufferが呼ばれる
        await vi.advanceTimersByTimeAsync(1000);
        expect(mockObs.call).toHaveBeenCalledWith('SaveReplayBuffer');
        expect(manager.getState().isSaving).toBe(false);
    });

    it('should extend timer when multi-kill occurs within delay window', async () => {
        manager.onCombatKillDeath({
            event: 'Bounty',
            entry: { Target: 'sidewinder' }
        });

        // 2秒経過（残り1秒）
        vi.advanceTimersByTime(2000);
        expect(mockObs.call).not.toHaveBeenCalled();

        // 2隻目撃破でタイマー延長
        manager.onCombatKillDeath({
            event: 'FactionKillBond',
            entry: { VictimFaction: 'Pirate Gang' }
        });

        // 最初のタイマー満了タイミング（さらに1秒後、合計3秒時点）ではまだ呼ばれない
        vi.advanceTimersByTime(1000);
        expect(mockObs.call).not.toHaveBeenCalled();

        // 延長された3秒の満了（さらに2秒後、合計5秒時点）で呼ばれる
        await vi.advanceTimersByTimeAsync(2000);
        expect(mockObs.call).toHaveBeenCalledTimes(1);
        expect(mockObs.call).toHaveBeenCalledWith('SaveReplayBuffer');
    });

    it('should not extend timer if multiKillExtend is false', async () => {
        manager.updateConfig({ multiKillExtend: false });

        manager.onCombatKillDeath({
            event: 'Bounty',
            entry: { Target: 'sidewinder' }
        });

        vi.advanceTimersByTime(2000);

        // 2隻目撃破
        manager.onCombatKillDeath({
            event: 'Bounty',
            entry: { Target: 'viper' }
        });

        // 最初の3秒満了時点で保存が実行される
        await vi.advanceTimersByTimeAsync(1000);
        expect(mockObs.call).toHaveBeenCalledTimes(1);
    });

    it('should ignore combat kill event if enabled is false', () => {
        manager.updateConfig({ enabled: false });

        manager.onCombatKillDeath({
            event: 'PVPKill',
            entry: { Victim: 'Ganker' }
        });

        expect(manager.getState().isSaving).toBe(false);
        vi.advanceTimersByTime(5000);
        expect(mockObs.call).not.toHaveBeenCalled();
    });

    it('should ignore combat kill event if replay buffer is inactive', () => {
        manager.setActive(false);

        manager.onCombatKillDeath({
            event: 'Died',
            entry: { KillerName: 'Thargoid Hydra' }
        });

        expect(manager.getState().isSaving).toBe(false);
        vi.advanceTimersByTime(5000);
        expect(mockObs.call).not.toHaveBeenCalled();
    });

    it('should trigger manual save immediately', async () => {
        await manager.triggerManualSave();
        expect(mockObs.call).toHaveBeenCalledWith('SaveReplayBuffer');
    });

    it('should record recent clips when ReplayBufferSaved event is received', () => {
        // OBSイベントハンドラを取り出す
        const savedHandler = mockObs.on.mock.calls.find(call => call[0] === 'ReplayBufferSaved')[1];
        expect(savedHandler).toBeDefined();

        savedHandler({ savedReplayPath: 'C:\\Videos\\Replay_2026-11-01.mp4' });

        const state = manager.getState();
        expect(state.recentClips.length).toBe(1);
        expect(state.recentClips[0].filename).toBe('Replay_2026-11-01.mp4');
    });
});

