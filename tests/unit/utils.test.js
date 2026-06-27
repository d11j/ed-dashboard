/**
 * @file utils.test.js
 * @description src/utils.js の共通ヘルパー関数に対するユニットテスト。
 *
 * -------------------------------------------------------------
 * 【新規テストケースの追加ガイド】
 * 新しいヘルパー関数を src/utils.js に追加した場合は、以下の構造に倣ってテストを追加してください。
 *
 * describe('関数名', () => {
 *     it('どのような状況で・どう動くべきか（期待する振る舞い）', () => {
 *         // 1. Arrange: 入力パラメータや事前状態の準備
 *         const input = ...;
 *
 *         // 2. Act: テスト対象関数の実行
 *         const result = myFunction(input);
 *
 *         // 3. Assert: 実行結果が想定通りであることの検証
 *         expect(result).toBe(expectedValue);
 *     });
 * });
 * -------------------------------------------------------------
 */

import { describe, expect, it } from 'vitest';
import { formatElapsedTime, getInitialState } from '../../src/utils.js';

describe('utils.js', () => {

    describe('formatElapsedTime', () => {
        it('should format milliseconds to HH:MM:SS format', () => {
            // 1. Arrange & 2. Act & 3. Assert (シンプルなユーティリティのため1行でアサーション)
            expect(formatElapsedTime(0)).toBe('00:00:00');
            expect(formatElapsedTime(1000)).toBe('00:00:01');
            expect(formatElapsedTime(60000)).toBe('00:01:00');
            expect(formatElapsedTime(3600000)).toBe('01:00:00');
            expect(formatElapsedTime(3661000)).toBe('01:01:01');
            expect(formatElapsedTime(86400000)).toBe('24:00:00'); // 24時間表示の確認
        });
    });

    describe('getInitialState', () => {
        it('should return default initial state object with correct structure', () => {
            // 1. Arrange: 特になし (純粋関数のため)

            // 2. Act: 初期状態オブジェクトの生成
            const state = getInitialState();

            // 3. Assert: 期待される各カテゴリの初期プロパティ値が正しくセットされているか検証
            // 戦闘統計の初期値
            expect(state).toHaveProperty('bounty');
            expect(state.bounty.count).toBe(0);
            expect(state.bounty.totalRewards).toBe(0);
            expect(state.bounty.targets).toEqual({});
            expect(state.bounty.bountyHistory).toEqual([]);

            // マテリアル統計の初期値
            expect(state).toHaveProperty('materials');
            expect(state.materials.total).toBe(0);
            expect(state.materials.categories).toEqual({});

            // ミッション統計の初期値
            expect(state).toHaveProperty('missions');
            expect(state.missions.completed).toBe(0);

            // 探査統計の初期値
            expect(state).toHaveProperty('exploration');
            expect(state.exploration.totalScans).toBe(0);
            expect(state.exploration.valuableBodyFound).toEqual({
                elw: false,
                ww: false,
                aw: false,
                terraformable: false
            });

            // 交易統計の初期値
            expect(state).toHaveProperty('trading');
            expect(state.trading.profit).toBe(0);

            // ランク進行状況の初期値 (Combatの初期値代表)
            expect(state).toHaveProperty('progress');
            expect(state.progress.Combat.rank).toBe(0);
            expect(state.progress.Combat.name).toBe('Harmless');

            // 燃料情報の初期値 (デフォルト容量 32t)
            expect(state).toHaveProperty('fuel');
            expect(state.fuel.max).toBe(32);
        });
    });
});

