import { describe, expect, it } from 'vitest';
import type {
  Action,
  AiContext,
  GameState,
  HandConfig,
  HandRecord,
  Intent,
  IntentKind,
  Personality,
} from '@poker/domain';
import { applyAction, createHand, isHandOver, legalActions, settleStacks } from '@poker/engine';
import {
  HYPOTHESIS_TEMPLATES,
  addHypothesis,
  decide,
  emptyDossier,
  expressionFor,
  exploitIndex,
  getPersonality,
  measureExploitability,
  PERSONALITIES,
  recordHand,
  templateAdapter,
  verifyHypotheses,
} from './index';

const CONFIG: HandConfig = {
  seed: 4242,
  heroStack: 1000,
  villainStack: 1000,
  smallBlind: 5,
  bigBlind: 10,
};

const ctx = (seed = 7): AiContext => ({
  handIndex: 0,
  decisionIndex: 0,
  recentLosses: 0,
  seed,
});

function flopFacingBet(seed: number): GameState {
  const config: HandConfig = { ...CONFIG, seed };
  let state = createHand(config);
  state = applyAction(state, { seat: 'hero', kind: 'call', amount: 5, street: 'preflop' });
  state = applyAction(state, { seat: 'villain', kind: 'check', amount: 0, street: 'preflop' });
  state = applyAction(state, { seat: 'villain', kind: 'check', amount: 0, street: 'flop' });
  state = applyAction(state, { seat: 'hero', kind: 'bet', amount: 20, street: 'flop' });
  return state;
}

function assertLegal(state: GameState, action: Action): void {
  const seat = state.toAct;
  expect(seat).not.toBeNull();
  expect(action.seat).toBe(seat);
  expect(action.street).toBe(state.street);
  expect(
    legalActions(state).some(
      (legal) =>
        legal.kind === action.kind &&
        action.amount >= legal.min &&
        action.amount <= legal.max,
    ),
    `非法动作 ${action.kind}/${action.amount}`,
  ).toBe(true);
}

describe('decide', () => {
  it('相同输入完全确定性', () => {
    const state = flopFacingBet(11);
    const personality = getPersonality('laochen');
    const first = decide(state, personality, ctx(3));
    const second = decide(state, personality, ctx(3));
    expect(first).toEqual(second);
    expect(first.reason.length).toBeGreaterThan(0);
    expect(first.equity).toBeGreaterThanOrEqual(0);
    expect(first.equity).toBeLessThanOrEqual(1);
    expect(first.tellLevel).toBeGreaterThanOrEqual(0);
    expect(first.tellLevel).toBeLessThanOrEqual(1);
  });

  it('所有种子与人格下动作始终合法，且能打完整手牌', () => {
    for (const seed of [1, 5, 23, 88, 512]) {
      for (const personality of PERSONALITIES) {
        let state = createHand({ ...CONFIG, seed });
        let decisionIndex = 0;
        for (let step = 0; step < 100 && !isHandOver(state); step += 1) {
          const intent = decide(state, personality, { ...ctx(seed), decisionIndex });
          decisionIndex += 1;
          assertLegal(state, intent.action);
          state = applyAction(state, intent.action);
        }
        expect(isHandOver(state)).toBe(true);
        const stacks = settleStacks(state);
        expect(stacks.hero + stacks.villain).toBe(2000);
      }
    }
  });

  it('破绽可归纳：紧弱人格面对 c-bet 的弃牌率显著高于疯鲨', () => {
    const tight = getPersonality('laochen');
    const loose = getPersonality('alang');
    let tightFolds = 0;
    let looseFolds = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      const state = flopFacingBet(seed);
      if (decide(state, tight, ctx(seed)).action.kind === 'fold') tightFolds += 1;
      if (decide(state, loose, ctx(seed)).action.kind === 'fold') looseFolds += 1;
    }
    expect(tightFolds).toBeGreaterThan(looseFolds);
    expect(tightFolds).toBeGreaterThan(0);
  });

  it('河牌诈唬由 riverBluff 参数控制：老陈几乎不诈唬', () => {
    const tight = getPersonality('laochen');
    let bluffs = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const state = flopFacingBet(seed);
      const intent = decide(state, tight, ctx(seed));
      if (intent.intent === 'bluff') bluffs += 1;
    }
    expect(bluffs).toBeLessThanOrEqual(3);
  });
});

describe('人格定义', () => {
  it('参数均在 0..1 且人格之间确有差异', () => {
    expect(PERSONALITIES.length).toBeGreaterThanOrEqual(3);
    for (const personality of PERSONALITIES) {
      for (const [key, value] of Object.entries(personality.params)) {
        if (key === 'thinkTimeMs') continue;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(personality.knownTells.length).toBeGreaterThan(0);
    }
    const signatures = new Set(
      PERSONALITIES.map((p) => JSON.stringify(p.params)),
    );
    expect(signatures.size).toBe(PERSONALITIES.length);
    expect(getPersonality('不存在').id).toBe(PERSONALITIES[0]!.id);
  });
});

describe('表达层', () => {
  it('每种 IntentKind 都产出非空中文台词，且零网络请求', () => {
    const kinds: readonly IntentKind[] = [
      'value', 'bluff', 'probe', 'pot-control', 'defense', 'tilt', 'trap',
    ];
    const personality = getPersonality('alang');
    const state = createHand(CONFIG);
    for (const intentKind of kinds) {
      const intent: Intent = {
        action: { seat: 'villain', kind: 'check', amount: 0, street: 'flop' },
        strength: 'medium',
        intent: intentKind,
        tellLevel: 0.5,
        equity: 0.5,
        reason: '测试',
        timingMs: 900,
      };
      expect(expressionFor(intent, personality).length).toBeGreaterThan(0);
      expect(templateAdapter.render(intent, personality, state)).toBeTruthy();
    }
    expect(templateAdapter.id).toBe('template');
  });
});

describe('档案与假设', () => {
  const makeHand = (index: number): HandRecord => ({
    id: `hand-${index}`,
    config: CONFIG,
    actions: [
      { seat: 'hero', kind: 'post-blind', amount: 5, street: 'preflop' },
      { seat: 'villain', kind: 'post-blind', amount: 10, street: 'preflop' },
      { seat: 'hero', kind: 'call', amount: 5, street: 'preflop' },
      { seat: 'villain', kind: 'check', amount: 0, street: 'preflop' },
      { seat: 'hero', kind: 'bet', amount: 20, street: 'flop', probe: true },
      { seat: 'villain', kind: 'fold', amount: 0, street: 'flop' },
    ],
    result: { winner: 'hero', heroNet: 10, showdown: false, reason: '对手弃牌' },
    heroStackAfter: 1010,
    villainStackAfter: 990,
    createdAt: `hand-${index}`,
    personalityId: 'laochen',
  });

  it('样本累积到阈值才解锁，假设得到明确成立/不成立反馈', () => {
    let dossier = emptyDossier('laochen');
    expect(dossier.unlocked).toBe(false);
    expect(dossier.handsSeen).toBe(0);
    dossier = addHypothesis(
      dossier,
      HYPOTHESIS_TEMPLATES[0]!.label,
      HYPOTHESIS_TEMPLATES[0]!.node,
    );
    expect(dossier.hypotheses).toHaveLength(1);
    expect(dossier.hypotheses[0]!.evidence).toHaveLength(0);

    const personality: Personality = getPersonality('laochen');
    for (let i = 1; i <= 8; i += 1) {
      const hand = makeHand(i);
      dossier = recordHand(dossier, hand, personality);
      dossier = verifyHypotheses(dossier, hand);
      if (i < 8) expect(dossier.unlocked).toBe(false);
    }
    expect(dossier.unlocked).toBe(true);
    expect(dossier.handsSeen).toBe(8);
    expect(dossier.probesUsed).toBe(8);
    expect(dossier.stats.hands).toBe(8);
    expect(dossier.lastFeedback).toMatch(/成立|不成立/);
    expect(dossier.hypotheses[0]!.status).toBe('confirmed');
    expect(dossier.hypotheses[0]!.samples).toBeGreaterThanOrEqual(5);
    expect(dossier.hypotheses[0]!.evidence.length).toBeGreaterThanOrEqual(5);
    expect(dossier.hypotheses[0]!.evidence[0]!.handId).toContain('hand-');
    expect(dossier.readAccuracy).toBeGreaterThan(0);
    expect(dossier.exploitation).toBeGreaterThanOrEqual(0);
  });

  it('破绽可被利用：紧弱对手比跟注站更怕持续下注', () => {
    const tight = getPersonality('laochen');
    const station = getPersonality('mira');
    const tightNet = measureExploitability(tight, 24);
    const stationNet = measureExploitability(station, 24);
    expect(Number.isFinite(tightNet)).toBe(true);
    expect(Number.isFinite(stationNet)).toBe(true);
    expect(tightNet).toBeGreaterThan(stationNet);
    expect(exploitIndex(tight)).toBeGreaterThan(exploitIndex(getPersonality('zhou')));
  });
});
