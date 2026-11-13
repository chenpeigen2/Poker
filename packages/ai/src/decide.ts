import type {
  Action,
  AiContext,
  GameState,
  Intent,
  IntentKind,
  LegalAction,
  Personality,
  PersonalityParams,
  Seat,
  StrengthBucket,
} from '@poker/domain';
import { STREET_LABELS } from '@poker/domain';
import { createRng, legalActions, mixSeed, toCall } from '@poker/engine';
import { estimateEquity } from './equity';

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const other = (seat: Seat): Seat => (seat === 'hero' ? 'villain' : 'hero');

function strengthBucket(equity: number): StrengthBucket {
  if (equity >= 0.82) return 'nuts';
  if (equity >= 0.62) return 'strong';
  if (equity >= 0.38) return 'medium';
  return 'weak';
}

function chooseAmount(legal: LegalAction, target: number): number {
  switch (legal.kind) {
    case 'fold':
    case 'check':
      return 0;
    case 'call':
      return Math.round(legal.min);
    case 'allin':
      return Math.round(legal.max);
    case 'bet':
    case 'raise':
    case 'post-blind':
      return Math.round(clamp(target, legal.min, legal.max));
  }
}

interface Scored {
  readonly action: Action;
  readonly score: number;
  readonly intent: IntentKind;
}

function isAggressive(kind: Action['kind']): boolean {
  return kind === 'bet' || kind === 'raise' || kind === 'allin';
}

function scoreAction(
  state: GameState,
  action: Action,
  equity: number,
  requiredEquity: number,
  params: PersonalityParams,
  isBluff: boolean,
  tilt: number,
  isCbetSpot: boolean,
): Scored {
  const pot = state.pot;
  const facing = toCall(state, action.seat);
  const opponent = other(action.seat);
  let score = 0;
  let intent: IntentKind = 'defense';

  if (action.kind === 'fold') {
    score = (requiredEquity - equity) * (pot + facing) * 1.6;
    score -= pot * 0.8; // 能免费看牌时绝不弃牌
    if (isCbetSpot) score += params.foldToCbet * pot * 0.7; // 破绽：过度弃牌于 c-bet
    score += tilt * pot * 0.35;
  } else if (isAggressive(action.kind)) {
    const callProb = clamp(
      0.72 - params.aggression * 0.12 - (equity > 0.78 ? 0.1 : 0),
      0.25,
      0.9,
    );
    const equityVsCall = clamp(equity - 0.12, 0, 1);
    const calledPot =
      pot + action.amount + Math.min(action.amount, state.players[opponent].stack);
    score =
      (1 - callProb) * pot + callProb * (equityVsCall * calledPot - action.amount);
    score += params.aggression * pot * 0.28 * equity;
    score -= tilt * pot * 0.25;
    if (equity > 0.75 && action.amount <= state.config.bigBlind * 2) {
      score += params.sizingTell * pot * 0.22; // 破绽：强牌下小注
    }
    intent = isBluff ? 'bluff' : equity > 0.72 ? 'value' : 'probe';
    if (isBluff) {
      score += (1 - equity) * pot * 0.4 + params.bluffFrequency * pot * 0.16;
    }
  } else {
    // check / call
    score = equity * (pot + action.amount) - action.amount;
    score += params.callStation * pot * 0.14;
    intent = equity > 0.72 && facing === 0 ? 'trap' : 'pot-control';
    if (tilt > 0.1) intent = 'tilt';
  }

  return { action, score, intent };
}

const REASONS: Readonly<Record<IntentKind, string>> = {
  value: '这手牌值得收价值',
  bluff: '想试试他会不会盖牌',
  probe: '先小额看看他的反应',
  'pot-control': '把底池控住再说',
  defense: '这局面不值得再投筹码',
  tilt: '连输之后先收一收',
  trap: '先埋一手，等他上钩',
};

/**
 * AI 的唯一决策入口。输出结构化 Intent，动作始终取自 legalActions(state)。
 * 完全确定性：相同 state + personality + ctx 一定返回相同结果。
 */
export function decide(
  state: GameState,
  personality: Personality,
  ctx: AiContext,
): Intent {
  const seat = state.toAct;
  if (seat === null) throw new Error('当前无人需要行动，无法决策');

  const params = personality.params;
  const pot = state.pot;
  const facing = toCall(state, seat);
  const potOdds = facing > 0 ? facing / (pot + facing) : 0;

  const equity = estimateEquity(
    state,
    seat,
    mixSeed(ctx.seed, ctx.handIndex, ctx.decisionIndex, 0x9e3779b9),
  );
  const rollRng = createRng(
    mixSeed(ctx.seed, ctx.handIndex, ctx.decisionIndex, 0x85ebca6b),
  );
  const roll = rollRng();
  const timingRoll = rollRng();

  const tilt = clamp(ctx.recentLosses * params.tilt * 0.05, 0, 0.25);
  const tightness = (1 - params.vpip) * 0.18;
  const isCbetSpot =
    state.street === 'flop' && facing > 0 && state.lastAggressor !== seat;
  const cbetFold = isCbetSpot ? params.foldToCbet * 0.22 : 0;
  const requiredEquity = clamp(
    potOdds + tightness + cbetFold + tilt - params.callStation * 0.15,
    0,
    0.9,
  );

  const bluffChance =
    state.street === 'river' ? params.riverBluff : params.bluffFrequency;
  const isBluff = equity < 0.45 && roll < bluffChance;

  // sizingTell：强牌反而下小注，这是玩家可归纳的反向 tell。
  const sizeMultiplier = equity > 0.75 ? 1 - params.sizingTell * 0.5 : 1;
  const target = clamp(
    pot * (0.35 + params.aggression * 0.55) * sizeMultiplier,
    0,
    pot * 1.6,
  );

  const candidates: Scored[] = [];
  for (const legal of legalActions(state)) {
    const amount = chooseAmount(legal, target);
    const action: Action = {
      seat,
      kind: legal.kind,
      amount,
      street: state.street,
    };
    candidates.push(
      scoreAction(state, action, equity, requiredEquity, params, isBluff, tilt, isCbetSpot),
    );
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.action.amount - b.action.amount ||
      a.action.kind.localeCompare(b.action.kind),
  );
  const best = candidates[0];
  if (best === undefined) throw new Error('无可用合法动作');

  const leakedByFold = best.action.kind === 'fold' && isCbetSpot ? params.foldToCbet * 0.5 : 0;
  const leakedBySizing =
    isAggressive(best.action.kind) && equity > 0.75 && best.action.amount <= state.config.bigBlind * 2
      ? params.sizingTell * 0.32
      : 0;
  const tellLevel = clamp(
    0.12 + Math.abs(equity - 0.5) * 0.3 + leakedByFold + leakedBySizing + (isBluff ? 0.18 : 0),
    0,
    1,
  );

  const timingMs = Math.round(
    params.thinkTimeMs *
      (0.62 +
        timingRoll * 0.7 +
        (equity > 0.75 ? 0.34 : 0) +
        (best.intent === 'bluff' ? -0.12 : 0)),
  );

  return {
    action: best.action,
    strength: strengthBucket(equity),
    intent: best.intent,
    tellLevel,
    equity,
    reason: `${REASONS[best.intent]}（${STREET_LABELS[state.street]}，估算胜率 ${(equity * 100).toFixed(0)}%）`,
    timingMs,
  };
}
