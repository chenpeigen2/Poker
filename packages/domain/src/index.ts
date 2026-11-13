/**
 * @poker/domain — 全仓唯一的跨包契约（seam）。
 *
 * 规则：
 *  - 零运行时依赖，只允许类型、常量、纯函数。
 *  - 依赖方向：apps/web → @poker/ai → @poker/engine → @poker/domain，禁止反向。
 *  - 任何跨包数据结构必须先在这里定义。修改本文件需通知 Lead。
 *  - 全仓禁止 `any`；未信任输入用 `unknown` + 类型守卫。
 */

// ---------------------------------------------------------------------------
// 牌
// ---------------------------------------------------------------------------

export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export const SUITS: readonly Suit[] = ['c', 'd', 'h', 's'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** 按固定顺序生成 52 张牌；洗牌由 engine 的 seed 派生。 */
export function makeDeck(): readonly Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case 'c': return '♣';
    case 'd': return '♦';
    case 'h': return '♥';
    case 's': return '♠';
  }
}

export function rankLabelText(rank: Rank): string {
  switch (rank) {
    case 14: return 'A';
    case 13: return 'K';
    case 12: return 'Q';
    case 11: return 'J';
    default: return String(rank);
  }
}

export function cardLabel(card: Card): string {
  return `${rankLabelText(card.rank)}${suitSymbol(card.suit)}`;
}

// ---------------------------------------------------------------------------
// 牌局
// ---------------------------------------------------------------------------

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type Seat = 'hero' | 'villain';

export const STREET_LABELS: Readonly<Record<Street, string>> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
};

export const SEAT_LABELS: Readonly<Record<Seat, string>> = {
  hero: '你',
  villain: '对手',
};

export type ActionKind = 'post-blind' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

/**
 * 一次动作。amount 是本次动作的**投入增量**（post-blind 也用它）。
 * probe=true 表示玩家把该动作标记为「试探」，只影响档案系统，不影响规则。
 */
export interface Action {
  readonly seat: Seat;
  readonly kind: ActionKind;
  readonly amount: number;
  readonly street: Street;
  readonly probe?: boolean;
}

export interface LegalAction {
  readonly kind: ActionKind;
  readonly min: number;
  readonly max: number;
}

export interface HandConfig {
  readonly seed: number;
  readonly heroStack: number;
  readonly villainStack: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
}

export interface PlayerState {
  readonly seat: Seat;
  /** 未投入底池的筹码 */
  readonly stack: number;
  /** 本手已投入底池的筹码总额 */
  readonly committed: number;
  /** 本条街已投入的筹码额 */
  readonly streetCommitted: number;
  readonly holeCards: readonly Card[];
  readonly hasFolded: boolean;
  readonly isAllIn: boolean;
  /** 本条街是否已经行动过（用于判断下注权是否关闭） */
  readonly hasActedThisStreet: boolean;
}

/** 牌力：category 0=高牌 … 8=同花顺；code 可直接用 > 比较。 */
export interface HandRank {
  readonly category: number;
  readonly categoryName: string;
  readonly kickers: readonly number[];
  readonly code: number;
}

export interface HandResult {
  readonly winner: Seat | 'split';
  /** hero 本手净收益（正为赢），已含未跟注下注返还 */
  readonly heroNet: number;
  readonly showdown: boolean;
  readonly reason: string;
  readonly heroRank?: HandRank;
  readonly villainRank?: HandRank;
}

/**
 * 一手牌的完整不可变快照。所有字段只读；状态转移由 engine.applyAction 纯函数完成。
 * actions 是追加式事件日志，是回放与档案统计的唯一数据源。
 */
export interface GameState {
  readonly config: HandConfig;
  readonly street: Street;
  readonly board: readonly Card[];
  readonly deck: readonly Card[];
  readonly pot: number;
  readonly players: Readonly<Record<Seat, PlayerState>>;
  readonly toAct: Seat | null;
  readonly actions: readonly Action[];
  /** 本条街最高下注目标（跟注额 = currentBet - streetCommitted） */
  readonly currentBet: number;
  readonly lastAggressor: Seat | null;
  /** 下一次加注需达到的最小「本条街总投入」 */
  readonly minRaiseTo: number;
  /** 上一次完整加注的增量 */
  readonly lastRaiseIncrement: number;
  readonly result: HandResult | null;
  /** 按钮位；单挑中按钮 = 小盲 */
  readonly button: Seat;
}

/** 存档用的一手牌记录，驱动复盘视图与档案统计。 */
export interface HandRecord {
  readonly id: string;
  readonly config: HandConfig;
  readonly actions: readonly Action[];
  readonly result: HandResult;
  readonly heroStackAfter: number;
  readonly villainStackAfter: number;
  readonly createdAt: string;
  readonly personalityId: string;
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface PersonalityParams {
  /** 0..1 入池意愿 */
  readonly vpip: number;
  /** 0..1 侵略性 */
  readonly aggression: number;
  /** 0..1 诈唬倾向 */
  readonly bluffFrequency: number;
  /** 破绽：面对持续下注的过度弃牌率 0..1 */
  readonly foldToCbet: number;
  /** 破绽：河牌诈唬率 0..1（接近 0 即几乎不诈唬） */
  readonly riverBluff: number;
  /** 破绽：小注=强牌的反向 tell 强度 0..1 */
  readonly sizingTell: number;
  /** 连败后缩手程度 0..1 */
  readonly tilt: number;
  /** 0..1 跟注站倾向 */
  readonly callStation: number;
  /** 行动节奏（毫秒），作为可观察的物理 tell */
  readonly thinkTimeMs: number;
}

export interface Personality {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly blurb: string;
  readonly avatarColor: string;
  readonly params: PersonalityParams;
  /** 该对手可被归纳的破绽描述，用于档案卡 */
  readonly knownTells: readonly string[];
}

export type StrengthBucket = 'weak' | 'medium' | 'strong' | 'nuts';
export type IntentKind = 'value' | 'bluff' | 'probe' | 'pot-control' | 'defense' | 'tilt' | 'trap';

/**
 * AI 的唯一输出。结构化意图让「读心面板 / 台词 / 档案」复用同一份数据。
 * 不输出裸动作。
 */
export interface Intent {
  readonly action: Action;
  readonly strength: StrengthBucket;
  readonly intent: IntentKind;
  /** 0..1，本次动作泄漏多少信息 */
  readonly tellLevel: number;
  readonly equity: number;
  /** 用于生成台词/复盘的中文短语，不是给玩家的剧透 */
  readonly reason: string;
  /**
   * 本次决策的思考时长（毫秒）。由人格节奏派生、确定性可复现，
   * 是玩家能直接观察到的 timing tell：强牌与艰难决策会明显变慢。
   */
  readonly timingMs: number;
}

export interface AiContext {
  readonly handIndex: number;
  readonly decisionIndex: number;
  /** 最近连续输掉的买入数，驱动 tilt */
  readonly recentLosses: number;
  readonly seed: number;
}

export interface ExpressionAdapter {
  readonly id: string;
  render(intent: Intent, personality: Personality, state: GameState): string | Promise<string>;
}

// ---------------------------------------------------------------------------
// 档案 / 假设
// ---------------------------------------------------------------------------

export interface DossierStats {
  readonly hands: number;
  readonly vpip: number;
  readonly foldToCbet: number;
  readonly aggression: number;
  readonly riverBluffRate: number;
  readonly avgBetSizing: number;
  readonly showdownWinRate: number;
}

export type HypothesisStatus = 'testing' | 'confirmed' | 'rejected';

/** 一条假设在某个具体观察点上的证据，让「为什么成立/不成立」可追溯。 */
export interface HypothesisSample {
  readonly handId: string;
  readonly hit: boolean;
  readonly note: string;
  readonly street: Street;
}

export interface Hypothesis {
  readonly id: string;
  readonly label: string;
  /** 观察节点：'flop-cbet' | 'turn-small-bet' | 'river-bluff' ... */
  readonly node: string;
  readonly status: HypothesisStatus;
  readonly samples: number;
  readonly hits: number;
  readonly createdAt: string;
  /** 逐手证据链，复盘面板据此展示判定依据 */
  readonly evidence: readonly HypothesisSample[];
}

export interface Dossier {
  readonly personalityId: string;
  readonly handsSeen: number;
  readonly probesUsed: number;
  readonly stats: DossierStats;
  readonly hypotheses: readonly Hypothesis[];
  readonly unlocked: boolean;
  /** 最近一次判定反馈，必须明确含「成立」或「不成立」 */
  readonly lastFeedback: string;
  /** 已判定假设中「成立」的比例，即玩家的读人准确率 */
  readonly readAccuracy: number;
  /** 针对性施压累计净收益（在玩家试探后赢下的大底池） */
  readonly exploitation: number;
}

/** 跨对手的会话战绩，不随人格切换而清空。 */
export interface SessionStats {
  readonly hands: number;
  readonly net: number;
  readonly wins: number;
  readonly losses: number;
  readonly probes: number;
  readonly probeHits: number;
  readonly bestPot: number;
  readonly bigPotsWon: number;
}

/** 「读出来 → 施压 → 收获」的高光时刻，用于叙事化反馈。 */
export interface Highlight {
  readonly handId: string;
  readonly title: string;
  readonly detail: string;
  readonly net: number;
}

export function emptySessionStats(): SessionStats {
  return {
    hands: 0,
    net: 0,
    wins: 0,
    losses: 0,
    probes: 0,
    probeHits: 0,
    bestPot: 0,
    bigPotsWon: 0,
  };
}
