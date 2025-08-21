import { COMBAT_RANKS, CQC_RANKS, EMP_RANKS, EXOBIOLOGIST_RANKS, EXPLORE_RANKS, FED_RANKS, SOLDIER_RANKS, TRADE_RANKS } from './constants.js';

// --- ヘルパー関数 ---
/** 経過時間を HH:MM:SS 形式の文字列にフォーマットする */
export function formatElapsedTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/** 初期状態 */
export function getInitialState() {
    return ({
        lastUpdateTimestamp: null,
        bounty: {
            count: 0,
            totalRewards: 0,
            targets: {},
            ranks: {}
        },
        materials: {
            total: 0,
            categories: {},
            details: {}
        },
        missions: { // ミッション完了数
            completed: 0,
            federation: 0,
            empire: 0,
            independent: 0
        },
        exploration: {
            totalScans: 0,
            highValueScans: 0, // 高価値スキャン数
            firstToDiscover: 0, // 初発見数
            estimatedValue: 0, // 推定探査収益
            jumpCount: 0, // ジャンプ数
            jumpDistance: 0, // ジャンプ距離
            valuableBodyFound: {
                elw: false,
                ww: false,
                aw: false,
                terraformable: false
            }
        },
        trading: {
            totalBuy: 0,
            totalSell: 0,
            sellCount: 0,
            unitsSold: 0,
            profit: 0,
        },
        progress: {
            Combat: { rank: 0, name: COMBAT_RANKS[0], progress: 0, nextName: COMBAT_RANKS[1] },
            Trade: { rank: 0, name: TRADE_RANKS[0], progress: 0, nextName: TRADE_RANKS[1] },
            Explore: { rank: 0, name: EXPLORE_RANKS[0], progress: 0, nextName: EXPLORE_RANKS[1] },
            Federation: { rank: 0, name: FED_RANKS[0], progress: 0, nextName: FED_RANKS[1] },
            Empire: { rank: 0, name: EMP_RANKS[0], progress: 0, nextName: EMP_RANKS[1] },
            CQC: { rank: 0, name: CQC_RANKS[0], progress: 0, nextName: CQC_RANKS[1] },
            Soldier: { rank: 0, name: SOLDIER_RANKS[0], progress: 0, nextName: SOLDIER_RANKS[1] },
            Exobiologist: { rank: 0, name: EXOBIOLOGIST_RANKS[0], progress: 0, nextName: EXOBIOLOGIST_RANKS[1] }
        }
    });
};
