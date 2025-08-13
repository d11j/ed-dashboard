import os from 'os';
import path from 'path';

// --- 設定 ---
export const PORT = 3000;
// Elite:Dangerousのジャーナルディレクトリを指定
export const JOURNAL_DIR = path.join(os.homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');
export const MAX_OBS_RETRIES = 5; // OBSへの最大再接続試行回数
export const UI_DEBOUNCE = 100; // UI更新のデバウンス時間（ミリ秒）

// --- ランク定義 ---
export const FED_RANKS = ['None', 'Recruit', 'Cadet', 'Midshipman', 'Petty Officer', 'Chief Petty Officer', 'Warrant Officer', 'Ensign', 'Lieutenant', 'Lieutenant Commander', 'Post Commander', 'Post Captain', 'Rear Admiral', 'Vice Admiral', 'Admiral'];
export const EMP_RANKS = ['None', 'Outsider', 'Serf', 'Master', 'Squire', 'Knight', 'Lord', 'Baron', 'Viscount', 'Count', 'Earl', 'Marquis', 'Duke', 'Prince', 'King'];
export const COMBAT_RANKS = ['Harmless', 'Mostly Harmless', 'Novice', 'Competent', 'Expert', 'Master', 'Dangerous', 'Deadly', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
export const TRADE_RANKS = ['Penniless', 'Mostly Penniless', 'Peddler', 'Dealer', 'Merchant', 'Broker', 'Entrepreneur', 'Tycoon', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
export const EXPLORE_RANKS = ['Aimless', 'Mostly Aimless', 'Scout', 'Surveyor', 'Explorer', 'Pathfinder', 'Ranger', 'Pioneer', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
export const CQC_RANKS = ['Helpless', 'Mostly Helpless', 'Amateur', 'Semi-Professional', 'Professional', 'Champion', 'Hero', 'Legend', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
export const SOLDIER_RANKS = ['Defenceless', 'Mostly Defenceless', 'Rookie', 'Soldier', 'Gunslinger', 'Warrior', 'Gladiator', 'Deadeye', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
export const EXOBIOLOGIST_RANKS = ['Directionless', 'Mostly Directionless', 'Compiler', 'Collector', 'Cataloguer', 'Taxonomist', 'Ecologist', 'Geneticist', 'Elite', 'Elite I', 'Elite II', 'Elite III', 'Elite IV', 'Elite V'];
export const SCAN_VALUES = {
    // Planets
    'Earthlike body': 3000000,
    'Water world(Terraformable)': 3000000,
    'Ammonia world': 1600000,
    'High metal content body(Terraformable)': 2000000,
    'Water world': 1000000,
    'Metalrich body': 500000,
    'High metal content body': 300000,
    'Rocky ice body': 1500000,
};
export const ALL_RANKS = {
    Combat: COMBAT_RANKS, Trade: TRADE_RANKS, Explore: EXPLORE_RANKS, Federation: FED_RANKS, Empire: EMP_RANKS,
    CQC: CQC_RANKS, Soldier: SOLDIER_RANKS, Exobiologist: EXOBIOLOGIST_RANKS
};
