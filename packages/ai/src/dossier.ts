import type {
  Action,
  Dossier,
  DossierStats,
  HandRecord,
  Hypothesis,
  HypothesisSample,
  HypothesisStatus,
  Personality,
  Street,
} from '@poker/domain';

export const HYPOTHESIS_TEMPLATES: readonly { readonly label: string; readonly node: string }[] = [
  { label: '他翻牌面对持续下注时过度弃牌', node: 'flop-cbet' },
  { label: '他河牌下注基本都是价值下注', node: 'river-value' },
  { label: '他下小注时其实拿着强牌', node: 'small-bet-strong' },
  { label: '他连输之后会明显缩手', node: 'tilt' },
  { label: '他思考越久牌越弱', node: 'timing' },
  { label: '他转牌下小注时牌力偏弱', node: 'turn-small-bet' },
  { label: '他河牌大额下注常常是诈唬', node: 'river-bluff' },
];

export const UNLOCK_AT = 8;
const VERDICT_SAMPLES = 5;

function isAggressive(kind: Action['kind']): boolean {
  return kind === 'bet' || kind === 'raise' || kind === 'allin';
}

interface Evidence {
  readonly vpip: number;
  readonly cbetOpportunity: boolean;
  readonly cbetFold: boolean;
  readonly cbetFoldRate: number;
  readonly aggressionRate: number;
  readonly riverBluffRate: number;
  readonly avgBetSizing: number;
  readonly showdown: boolean;
  readonly showdownWin: number;
  readonly probes: number;
  readonly riverBet: boolean;
  readonly riverBetWon: boolean;
  readonly smallBet: boolean;
  readonly smallBetWon: boolean;
  readonly tiltOpportunity: boolean;
  readonly tiltFold: boolean;
  readonly timingSample: boolean;
  readonly turnSmallBet: boolean;
  readonly riverBigBet: boolean;
  readonly heroNet: number;
  readonly bigBlind: number;
}

function collectEvidence(hand: HandRecord): Evidence {
  const villain = hand.actions.filter(
    (action) => action.seat === 'villain' && action.kind !== 'post-blind',
  );
  const hero = hand.actions.filter(
    (action) => action.seat === 'hero' && action.kind !== 'post-blind',
  );
  const villainWon = hand.result.winner === 'villain';
  const aggressive = villain.filter((action) => isAggressive(action.kind));
  const sized = aggressive.filter((action) => action.kind !== 'allin');
  const riverActions = villain.filter((action) => action.street === 'river');
  const riverAggressive = riverActions.filter((action) => isAggressive(action.kind));
  const bigBlind = hand.config.bigBlind;
  const heroFlopBet = hero.some(
    (action) => action.street === 'flop' && isAggressive(action.kind),
  );
  // 主动试探（含 check-call 这类廉价探测）同样开启一个可观察窗口，
  // 否则最便宜的试探方式永远拿不到证据，核心循环会退化成死路。
  const heroFlopProbe = hero.some(
    (action) => action.street === 'flop' && action.probe === true,
  );
  const villainFlopFold = villain.some(
    (action) => action.street === 'flop' && action.kind === 'fold',
  );
  const preflopVoluntary = villain.some(
    (action) =>
      action.street === 'preflop' &&
      (action.kind === 'call' || isAggressive(action.kind)),
  );

  return {
    vpip: preflopVoluntary ? 1 : 0,
    cbetOpportunity: heroFlopBet || heroFlopProbe,
    cbetFold: villainFlopFold,
    cbetFoldRate: heroFlopBet || heroFlopProbe ? (villainFlopFold ? 1 : 0) : 0.5,
    aggressionRate: villain.length === 0 ? 0 : aggressive.length / villain.length,
    riverBluffRate:
      riverActions.length === 0 ? 0 : riverAggressive.length / riverActions.length,
    avgBetSizing:
      sized.length === 0
        ? 0
        : sized.reduce((sum, action) => sum + action.amount, 0) / sized.length,
    showdown: hand.result.showdown,
    showdownWin: villainWon ? 1 : 0,
    probes: hand.actions.filter((action) => action.probe === true).length,
    riverBet: riverAggressive.length > 0,
    riverBetWon: villainWon,
    smallBet: sized.some((action) => action.amount <= bigBlind * 2),
    smallBetWon: villainWon,
    tiltOpportunity: hand.result.winner === 'hero',
    tiltFold: villain.some(
      (action) => action.street === 'preflop' && action.kind === 'fold',
    ),
    timingSample: hand.actions.some((action) => action.probe === true),
    turnSmallBet: sized.some(
      (action) => action.street === 'turn' && action.amount <= bigBlind * 2,
    ),
    riverBigBet: sized.some(
      (action) => action.street === 'river' && action.amount >= bigBlind * 6,
    ),
    heroNet: hand.result.heroNet,
    bigBlind,
  };
}

/** 某个假设节点在本手牌里是否产生了可观察样本，以及是否命中。 */
function observe(
  node: string,
  e: Evidence,
): { observed: boolean; hit: boolean; note: string; street: Street } {
  switch (node) {
    case 'flop-cbet':
      return {
        observed: e.cbetOpportunity,
        hit: e.cbetFold,
        note: e.cbetFold ? '翻牌施压后他弃牌' : '翻牌施压后他没有弃牌',
        street: 'flop',
      };
    case 'river-value':
      return {
        observed: e.riverBet,
        hit: e.riverBetWon,
        note: e.riverBetWon ? '河牌下注且摊牌获胜' : '河牌下注但未获胜',
        street: 'river',
      };
    case 'small-bet-strong':
      return {
        observed: e.smallBet,
        hit: e.smallBetWon,
        note: e.smallBetWon ? '小注之后他赢了摊牌' : '小注之后他没有赢',
        street: 'flop',
      };
    case 'tilt':
      return {
        observed: e.tiltOpportunity,
        hit: e.tiltFold,
        note: e.tiltFold ? '输掉上一手后他翻前就弃牌' : '输掉上一手后他照常入池',
        street: 'preflop',
      };
    case 'timing':
      return {
        observed: e.timingSample,
        hit: true,
        note: '本手用试探记录了节奏样本',
        street: 'flop',
      };
    case 'turn-small-bet':
      return {
        observed: e.turnSmallBet,
        hit: !e.smallBetWon,
        note: e.smallBetWon ? '转牌小注后他赢下摊牌' : '转牌小注后他没有赢',
        street: 'turn',
      };
    case 'river-bluff':
      return {
        observed: e.riverBigBet,
        hit: !e.riverBetWon,
        note: e.riverBetWon ? '河牌大注后他赢了摊牌' : '河牌大注后他没有赢',
        street: 'river',
      };
    default:
      return { observed: false, hit: false, note: '未知观察节点', street: 'preflop' };
  }
}

function runningRate(previous: number, previousHands: number, value: number): number {
  return (previous * previousHands + value) / (previousHands + 1);
}

export function emptyDossier(personalityId: string): Dossier {
  const stats: DossierStats = {
    hands: 0,
    vpip: 0,
    foldToCbet: 0,
    aggression: 0,
    riverBluffRate: 0,
    avgBetSizing: 0,
    showdownWinRate: 0,
  };
  return {
    personalityId,
    handsSeen: 0,
    probesUsed: 0,
    stats,
    hypotheses: [],
    unlocked: false,
    lastFeedback: '尚未开始观察。',
    readAccuracy: 0,
    exploitation: 0,
  };
}

export function addHypothesis(dossier: Dossier, label: string, node: string): Dossier {
  const hypothesis: Hypothesis = {
    id: `h-${dossier.hypotheses.length + 1}`,
    label,
    node,
    status: 'testing',
    samples: 0,
    hits: 0,
    createdAt: `hand-${dossier.handsSeen + 1}`,
    evidence: [],
  };
  return { ...dossier, hypotheses: [...dossier.hypotheses, hypothesis] };
}

/** 累加一手牌的统计样本；样本达阈值才解锁档案卡。 */
export function recordHand(
  dossier: Dossier,
  hand: HandRecord,
  _personality: Personality,
): Dossier {
  const evidence = collectEvidence(hand);
  const previous = dossier.handsSeen;
  const hands = previous + 1;
  const stats: DossierStats = {
    hands,
    vpip: runningRate(dossier.stats.vpip, previous, evidence.vpip),
    foldToCbet: runningRate(dossier.stats.foldToCbet, previous, evidence.cbetFoldRate),
    aggression: runningRate(dossier.stats.aggression, previous, evidence.aggressionRate),
    riverBluffRate: runningRate(dossier.stats.riverBluffRate, previous, evidence.riverBluffRate),
    avgBetSizing: runningRate(dossier.stats.avgBetSizing, previous, evidence.avgBetSizing),
    showdownWinRate: evidence.showdown
      ? runningRate(dossier.stats.showdownWinRate, previous, evidence.showdownWin)
      : dossier.stats.showdownWinRate,
  };

  // 针对性施压收益：本手试探过、并且赢下了一个像样的底池。
  const exploited =
    evidence.probes > 0 &&
    evidence.heroNet >= evidence.bigBlind * 3 &&
    hand.result.winner === 'hero'
      ? evidence.heroNet
      : 0;

  return {
    ...dossier,
    handsSeen: hands,
    probesUsed: dossier.probesUsed + evidence.probes,
    stats,
    unlocked: hands >= UNLOCK_AT,
    exploitation: dossier.exploitation + exploited,
  };
}

/** 用本手的行为验证假设，给出明确「成立 / 不成立」的判定反馈，并留下证据链。 */
export function verifyHypotheses(dossier: Dossier, hand: HandRecord): Dossier {
  const evidence = collectEvidence(hand);

  const hypotheses = dossier.hypotheses.map((hypothesis): Hypothesis => {
    if (hypothesis.status !== 'testing') return hypothesis;
    const observation = observe(hypothesis.node, evidence);
    if (!observation.observed) return hypothesis;

    const sample: HypothesisSample = {
      handId: hand.id,
      hit: observation.hit,
      note: observation.note,
      street: observation.street,
    };
    const samples = hypothesis.samples + 1;
    const hits = hypothesis.hits + (observation.hit ? 1 : 0);
    let status: HypothesisStatus = hypothesis.status;
    if (samples >= VERDICT_SAMPLES) {
      status = hits / samples >= 0.6 ? 'confirmed' : 'rejected';
    }
    return {
      ...hypothesis,
      samples,
      hits,
      status,
      evidence: [...hypothesis.evidence, sample].slice(-12),
    };
  });

  const judged = hypotheses.filter(
    (item) => item.status === 'confirmed' || item.status === 'rejected',
  );
  const readAccuracy =
    judged.length === 0
      ? 0
      : judged.filter((item) => item.status === 'confirmed').length / judged.length;

  if (hypotheses.length === 0) {
    return {
      ...dossier,
      hypotheses,
      readAccuracy,
      lastFeedback: '本手已记录，尚未登记假设，暂无判定。',
    };
  }

  const focus = hypotheses.reduce((best, current) =>
    current.samples > best.samples ? current : best,
  );
  const verdict =
    focus.status === 'confirmed'
      ? '成立'
      : focus.status === 'rejected'
        ? '不成立'
        : '尚未成立';
  const lastFeedback =
    focus.samples === 0
      ? `本手判定：假设「${focus.label}」尚未成立——本手没有可验证的观察点。试着主动下注，或把动作标记为「试探」来制造证据。`
      : `本手判定：假设「${focus.label}」${verdict}（命中 ${focus.hits}/${focus.samples} 个样本）`;

  return { ...dossier, hypotheses, readAccuracy, lastFeedback };
}
