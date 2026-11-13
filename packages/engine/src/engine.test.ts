import { describe, expect, it } from 'vitest';
import type { Action, Card, HandConfig, Rank, Seat, Street, Suit } from '@poker/domain';
import {
  applyAction,
  createHand,
  evaluate5,
  evaluate7,
  isHandOver,
  legalActions,
  otherSeat,
  rankLabel,
  replay,
  settleStacks,
  shuffle,
  toCall,
} from './index';

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });

const ROYAL: readonly Card[] = [c(14, 's'), c(13, 's'), c(12, 's'), c(11, 's'), c(10, 's')];
const WHEEL_SF: readonly Card[] = [c(14, 's'), c(5, 's'), c(4, 's'), c(3, 's'), c(2, 's')];
const QUADS: readonly Card[] = [c(9, 's'), c(9, 'h'), c(9, 'd'), c(9, 'c'), c(2, 's')];
const FULL_HOUSE: readonly Card[] = [c(8, 's'), c(8, 'h'), c(8, 'd'), c(13, 'c'), c(13, 'd')];
const FLUSH: readonly Card[] = [c(14, 'h'), c(11, 'h'), c(9, 'h'), c(5, 'h'), c(2, 'h')];
const STRAIGHT: readonly Card[] = [c(9, 's'), c(8, 'h'), c(7, 'd'), c(6, 'c'), c(5, 's')];
const TRIPS: readonly Card[] = [c(7, 's'), c(7, 'h'), c(7, 'd'), c(14, 'c'), c(3, 'd')];
const TWO_PAIR: readonly Card[] = [c(13, 's'), c(13, 'h'), c(4, 'd'), c(4, 'c'), c(9, 's')];
const PAIR: readonly Card[] = [c(14, 's'), c(14, 'h'), c(13, 'd'), c(7, 'c'), c(3, 's')];
const HIGH_CARD: readonly Card[] = [c(14, 's'), c(13, 'h'), c(9, 'd'), c(6, 'c'), c(3, 's')];

const CONFIG: HandConfig = {
  seed: 20261113,
  heroStack: 1000,
  villainStack: 1000,
  smallBlind: 5,
  bigBlind: 10,
};

function play(initial: Action[], config: HandConfig = CONFIG) {
  let state = createHand(config);
  for (const action of initial) state = applyAction(state, action);
  return state;
}

/** 一路过牌/跟注打到摊牌，用于搜索平分底池等确定性局面。 */
function checkDown(config: HandConfig) {
  let state = createHand(config);
  const sequence: readonly { readonly seat: Seat; readonly kind: Action['kind'] }[] = [
    { seat: 'hero', kind: 'call' },
    { seat: 'villain', kind: 'check' },
    { seat: 'villain', kind: 'check' },
    { seat: 'hero', kind: 'check' },
    { seat: 'villain', kind: 'check' },
    { seat: 'hero', kind: 'check' },
    { seat: 'villain', kind: 'check' },
    { seat: 'hero', kind: 'check' },
  ];
  for (const step of sequence) {
    if (isHandOver(state)) break;
    const legal = legalActions(state).find((candidate) => candidate.kind === step.kind);
    if (legal === undefined) break;
    state = applyAction(state, {
      seat: step.seat,
      kind: step.kind,
      amount: legal.min,
      street: state.street,
    });
  }
  return state;
}

const ALL_STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

describe('牌力评估', () => {
  it('识别全部 9 类牌型，且大小顺序严格正确', () => {
    const hands = [
      HIGH_CARD, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, WHEEL_SF,
    ];
    hands.forEach((hand, index) => {
      expect(evaluate5(hand).category).toBe(index);
    });
    for (let i = 1; i < hands.length; i += 1) {
      expect(evaluate5(hands[i]!).code).toBeGreaterThan(evaluate5(hands[i - 1]!).code);
    }
    expect(evaluate5(ROYAL).category).toBe(8);
    expect(evaluate5(ROYAL).code).toBeGreaterThan(evaluate5(WHEEL_SF).code);
    expect(evaluate5(ROYAL).categoryName).toBe('同花顺');
    expect(rankLabel(evaluate5(FULL_HOUSE))).toBe('葫芦');
  });

  it('A-2-3-4-5 轮子顺子的最大牌是 5，且败给 6 高顺子', () => {
    const wheel = evaluate5([c(14, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c'), c(5, 's')]);
    const sixHigh = evaluate5([c(6, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c'), c(5, 's')]);
    expect(wheel.category).toBe(4);
    expect(wheel.kickers[0]).toBe(5);
    expect(sixHigh.code).toBeGreaterThan(wheel.code);
  });

  it('evaluate7 等价于对 21 个 5 张组合取最大值', () => {
    for (const seed of [1, 2, 3, 17, 99, 4096]) {
      const cards = shuffle(seed).slice(0, 7);
      let best = -1;
      for (let skipA = 0; skipA < 7; skipA += 1) {
        for (let skipB = skipA + 1; skipB < 7; skipB += 1) {
          const five = cards.filter((_, index) => index !== skipA && index !== skipB);
          best = Math.max(best, evaluate5(five).code);
        }
      }
      expect(evaluate7(cards).code).toBe(best);
    }
  });

  it('牌型比较能正确区分踢脚', () => {
    const aaK = evaluate5([c(14, 's'), c(14, 'h'), c(13, 'd'), c(7, 'c'), c(3, 's')]);
    const aaQ = evaluate5([c(14, 's'), c(14, 'h'), c(12, 'd'), c(7, 'c'), c(3, 's')]);
    expect(aaK.code).toBeGreaterThan(aaQ.code);
  });
});

describe('确定性洗牌', () => {
  it('同 seed 相同、不同 seed 不同、52 张且无重复', () => {
    const a = shuffle(42);
    const b = shuffle(42);
    const d = shuffle(43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(d);
    expect(a).toHaveLength(52);
    const keys = new Set(a.map((card) => `${card.rank}-${card.suit}`));
    expect(keys.size).toBe(52);
  });
});

describe('HU NLHE 状态机', () => {
  it('createHand：按钮 = 小盲且翻前先行动，盲注与底池正确', () => {
    const state = createHand(CONFIG);
    expect(state.button).toBe('hero');
    expect(state.toAct).toBe('hero');
    expect(state.pot).toBe(15);
    expect(state.currentBet).toBe(10);
    expect(state.players.hero.stack).toBe(995);
    expect(state.players.villain.stack).toBe(990);
    expect(state.actions).toHaveLength(2);
    expect(state.actions.every((a) => a.kind === 'post-blind')).toBe(true);
    expect(state.board).toHaveLength(0);
    expect(toCall(state, 'hero')).toBe(5);
    expect(otherSeat('hero')).toBe('villain');
  });

  it('翻前 hero 跟注、villain 过牌后进入翻牌，且由 villain 先行动', () => {
    const state = play([
      { seat: 'hero', kind: 'call', amount: 5, street: 'preflop' },
      { seat: 'villain', kind: 'check', amount: 0, street: 'preflop' },
    ]);
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);
    expect(state.toAct).toBe('villain');
    expect(state.pot).toBe(20);
  });

  it('全手过牌到摊牌：每一步底池守恒，最终可回放且逐字段一致', () => {
    const actions: Action[] = [
      { seat: 'hero', kind: 'call', amount: 5, street: 'preflop' },
      { seat: 'villain', kind: 'check', amount: 0, street: 'preflop' },
      { seat: 'villain', kind: 'check', amount: 0, street: 'flop' },
      { seat: 'hero', kind: 'check', amount: 0, street: 'flop' },
      { seat: 'villain', kind: 'check', amount: 0, street: 'turn' },
      { seat: 'hero', kind: 'check', amount: 0, street: 'turn' },
      { seat: 'villain', kind: 'check', amount: 0, street: 'river' },
      { seat: 'hero', kind: 'check', amount: 0, street: 'river' },
    ];

    let state = createHand(CONFIG);
    const assertConserved = (): void => {
      expect(
        state.players.hero.stack + state.players.villain.stack + state.pot,
      ).toBe(CONFIG.heroStack + CONFIG.villainStack);
      expect(state.pot).toBe(
        state.players.hero.committed + state.players.villain.committed,
      );
    };
    assertConserved();
    for (const action of actions) {
      state = applyAction(state, action);
      assertConserved();
    }

    expect(isHandOver(state)).toBe(true);
    expect(state.result?.showdown).toBe(true);
    expect(state.board).toHaveLength(5);
    expect(state.toAct).toBeNull();
    expect(replay(CONFIG, state.actions)).toEqual(state);

    const stacks = settleStacks(state);
    expect(stacks.hero - CONFIG.heroStack).toBe(state.result?.heroNet);
    expect(stacks.hero + stacks.villain).toBe(CONFIG.heroStack + CONFIG.villainStack);
  });

  it('弃牌结算：hero 翻前弃牌净亏小盲；hero 全下对手弃牌只赢大盲（超额返还）', () => {
    const folded = play([{ seat: 'hero', kind: 'fold', amount: 0, street: 'preflop' }]);
    expect(folded.result?.winner).toBe('villain');
    expect(folded.result?.heroNet).toBe(-5);
    expect(folded.result?.showdown).toBe(false);
    expect(settleStacks(folded).hero).toBe(995);

    const shoved = play([
      { seat: 'hero', kind: 'allin', amount: 995, street: 'preflop' },
      { seat: 'villain', kind: 'fold', amount: 0, street: 'preflop' },
    ]);
    expect(shoved.result?.winner).toBe('hero');
    expect(shoved.result?.heroNet).toBe(10);
    expect(settleStacks(shoved).hero).toBe(1010);
    expect(settleStacks(shoved).villain).toBe(990);
  });

  it('短 all-in 不重开下注权：对手只能跟或弃，不能加注', () => {
    const shortStack: HandConfig = { ...CONFIG, villainStack: 12 };
    const state = play(
      [
        { seat: 'hero', kind: 'call', amount: 5, street: 'preflop' },
        { seat: 'villain', kind: 'allin', amount: 2, street: 'preflop' },
      ],
      shortStack,
    );
    expect(state.toAct).toBe('hero');
    expect(state.currentBet).toBe(12);
    expect(toCall(state, 'hero')).toBe(2);
    const kinds = legalActions(state).map((legal) => legal.kind);
    expect(kinds).toContain('fold');
    expect(kinds).toContain('call');
    expect(kinds).not.toContain('raise');
    expect(kinds).not.toContain('allin');
    expect(kinds).not.toContain('bet');

    const called = applyAction(state, {
      seat: 'hero', kind: 'call', amount: 2, street: 'preflop',
    });
    expect(isHandOver(called)).toBe(true);
    expect(called.board).toHaveLength(5);
    expect(replay(shortStack, called.actions)).toEqual(called);
  });

  it('legalActions 在 0 筹码 / 全下边界不产生非法金额', () => {
    let state = createHand(CONFIG);
    for (let step = 0; step < 30 && !isHandOver(state); step += 1) {
      for (const legal of legalActions(state)) {
        expect(legal.min).toBeGreaterThanOrEqual(0);
        expect(legal.max).toBeGreaterThanOrEqual(legal.min);
        expect(legal.max).toBeLessThanOrEqual(state.players[state.toAct ?? 'hero'].stack);
      }
      const seat = state.toAct;
      if (seat === null) break;
      const check = legalActions(state).find((legal) => legal.kind === 'check');
      const call = legalActions(state).find((legal) => legal.kind === 'call');
      const chosen = check ?? call;
      if (chosen === undefined) break;
      state = applyAction(state, {
        seat, kind: chosen.kind, amount: chosen.min, street: state.street,
      });
    }
    expect(isHandOver(state)).toBe(true);
  });

  it('非法动作被拒绝', () => {
    const state = createHand(CONFIG);
    expect(() =>
      applyAction(state, { seat: 'villain', kind: 'check', amount: 0, street: 'preflop' }),
    ).toThrow();
    expect(() =>
      applyAction(state, { seat: 'hero', kind: 'bet', amount: 999, street: 'preflop' }),
    ).toThrow();
  });

  it('平分底池：净收益为 0，双方筹码总和守恒，且可回放', () => {
    let split: ReturnType<typeof checkDown> | null = null;
    for (let seed = 1; seed < 300 && split === null; seed += 1) {
      const candidate = checkDown({ ...CONFIG, seed });
      if (candidate.result?.winner === 'split') split = candidate;
    }
    expect(split).not.toBeNull();
    const state = split!;
    expect(ALL_STREETS).toContain(state.street);
    expect(state.result?.heroNet).toBe(0);
    const stacks = settleStacks(state);
    expect(stacks.hero).toBe(CONFIG.heroStack);
    expect(stacks.villain).toBe(CONFIG.villainStack);
    expect(replay(state.config, state.actions)).toEqual(state);
  });

  it('极端短码：盲注即全下时一手牌立刻摊牌，不产生无人可行动的死局', () => {
    const tiny: HandConfig = { ...CONFIG, villainStack: 10 };
    const state = createHand(tiny);
    expect(isHandOver(state)).toBe(true);
    expect(state.board).toHaveLength(5);
    expect(state.toAct).toBeNull();
    expect(legalActions(state)).toHaveLength(0);
    expect(replay(tiny, state.actions)).toEqual(state);

    const tinier: HandConfig = { ...CONFIG, heroStack: 3 };
    const state2 = createHand(tinier);
    expect(isHandOver(state2)).toBe(true);
    expect(settleStacks(state2).hero + settleStacks(state2).villain).toBe(
      tinier.heroStack + tinier.villainStack,
    );
  });

  it('连续全下与加注：多种子下都不会卡死，且底池守恒', () => {
    for (const seed of [3, 19, 71, 233, 1024]) {
      let state = createHand({ ...CONFIG, seed });
      for (let step = 0; step < 60 && !isHandOver(state); step += 1) {
        const legal = legalActions(state);
        expect(legal.length).toBeGreaterThan(0);
        const aggressive = legal.find((candidate) => candidate.kind === 'raise')
          ?? legal.find((candidate) => candidate.kind === 'allin')
          ?? legal.find((candidate) => candidate.kind === 'bet');
        const chosen = aggressive ?? legal.find((candidate) => candidate.kind === 'call')
          ?? legal.find((candidate) => candidate.kind === 'check')
          ?? legal[0]!;
        state = applyAction(state, {
          seat: state.toAct ?? 'hero',
          kind: chosen.kind,
          amount: chosen.kind === 'fold' || chosen.kind === 'check' ? 0 : chosen.max,
          street: state.street,
        });
        expect(
          state.players.hero.stack + state.players.villain.stack + state.pot,
        ).toBe(CONFIG.heroStack + CONFIG.villainStack);
      }
      expect(isHandOver(state)).toBe(true);
    }
  });

  it('非法动作矩阵：错座位、错街次、超额注额全部被拒', () => {
    const state = createHand(CONFIG);
    const bad: readonly Action[] = [
      { seat: 'villain', kind: 'call', amount: 5, street: 'preflop' },
      { seat: 'hero', kind: 'call', amount: 5, street: 'flop' },
      { seat: 'hero', kind: 'fold', amount: 12, street: 'preflop' },
      { seat: 'hero', kind: 'check', amount: 0, street: 'preflop' },
      { seat: 'hero', kind: 'raise', amount: 1, street: 'preflop' },
    ];
    for (const action of bad) {
      expect(() => applyAction(state, action)).toThrow();
    }
  });
});
