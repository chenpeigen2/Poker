/**
 * 跨包集成测试：用 AI 同时驱动两个座位打完整手牌。
 *
 * 这里刻意不 mock 任何东西，目的就是让 domain / engine / ai 三层的
 * 真实契约在端到端路径上被验证一遍：任何一层的签名或语义不一致都会在此暴露。
 */
import { describe, expect, it } from 'vitest';
import type {
  Action,
  AiContext,
  GameState,
  HandConfig,
  Personality,
  Seat,
} from '@poker/domain';
import {
  applyAction,
  createHand,
  isHandOver,
  legalActions,
  replay,
  settleStacks,
} from '@poker/engine';
import { PERSONALITIES, decide } from '@poker/ai';

const TOTAL_CHIPS = (config: HandConfig): number => config.heroStack + config.villainStack;

function assertLegal(state: GameState, action: Action): void {
  const seat: Seat | null = state.toAct;
  expect(seat).not.toBeNull();
  expect(action.seat).toBe(seat);
  expect(action.street).toBe(state.street);
  const candidates = legalActions(state).filter((legal) => legal.kind === action.kind);
  expect(
    candidates.length,
    `${action.kind} 应在合法动作集合中，实际为 ${legalActions(state).map((l) => l.kind).join(',')}`,
  ).toBeGreaterThan(0);
  const matched = candidates.some(
    (legal) => action.amount >= legal.min && action.amount <= legal.max,
  );
  expect(
    matched,
    `${action.kind} 的 amount=${action.amount} 应落在 ${JSON.stringify(candidates)} 区间内`,
  ).toBe(true);
}

function assertChipsConserved(state: GameState): void {
  const held = state.players.hero.stack + state.players.villain.stack;
  expect(held + state.pot).toBe(TOTAL_CHIPS(state.config));
  expect(state.pot).toBe(
    state.players.hero.committed + state.players.villain.committed,
  );
}

function playHand(
  config: HandConfig,
  heroBot: Personality,
  villainBot: Personality,
): GameState {
  let state = createHand(config);
  assertChipsConserved(state);
  let decisionIndex = 0;

  for (let step = 0; step < 200 && !isHandOver(state); step += 1) {
    const seat = state.toAct;
    if (seat === null) {
      throw new Error('牌局未结束但无人行动');
    }
    const bot: Personality = seat === 'hero' ? heroBot : villainBot;
    const ctx: AiContext = {
      handIndex: 0,
      decisionIndex,
      recentLosses: 0,
      seed: config.seed,
    };
    decisionIndex += 1;
    const intent = decide(state, bot, ctx);
    assertLegal(state, intent.action);
    expect(intent.action.seat).toBe(seat);
    expect(intent.equity).toBeGreaterThanOrEqual(0);
    expect(intent.equity).toBeLessThanOrEqual(1);
    expect(intent.tellLevel).toBeGreaterThanOrEqual(0);
    expect(intent.tellLevel).toBeLessThanOrEqual(1);
    expect(intent.reason.length).toBeGreaterThan(0);

    state = applyAction(state, intent.action);
    assertChipsConserved(state);
  }

  expect(isHandOver(state), '一手牌应在 200 步内结束').toBe(true);
  return state;
}

describe('跨包集成：完整一手牌', () => {
  it('AI 驱动双方时能打完，且每一步底池守恒', () => {
    const config: HandConfig = {
      seed: 20261113,
      heroStack: 1000,
      villainStack: 1000,
      smallBlind: 5,
      bigBlind: 10,
    };
    const state = playHand(config, PERSONALITIES[0]!, PERSONALITIES[1]!);
    expect(state.result).not.toBeNull();
    expect(state.actions.length).toBeGreaterThan(2);
  });

  it('回放逐字段一致，且结算与 heroNet 自洽', () => {
    const config: HandConfig = {
      seed: 777,
      heroStack: 600,
      villainStack: 900,
      smallBlind: 5,
      bigBlind: 10,
    };
    const state = playHand(config, PERSONALITIES[0]!, PERSONALITIES[0]!);

    const rebuilt = replay(config, state.actions);
    expect(rebuilt).toEqual(state);

    const stacks = settleStacks(state);
    expect(stacks.hero - config.heroStack).toBe(state.result?.heroNet);
    expect(stacks.hero + stacks.villain).toBe(TOTAL_CHIPS(config));
  });

  it('多种子 × 多人格组合下均不产生非法动作', () => {
    for (const seed of [1, 2, 3, 17, 9999]) {
      for (let i = 0; i < PERSONALITIES.length; i += 1) {
        const config: HandConfig = {
          seed,
          heroStack: 500,
          villainStack: 500,
          smallBlind: 5,
          bigBlind: 10,
        };
        const state = playHand(
          config,
          PERSONALITIES[i]!,
          PERSONALITIES[(i + 1) % PERSONALITIES.length]!,
        );
        expect(state.result).not.toBeNull();
        const stacks = settleStacks(state);
        expect(stacks.hero + stacks.villain).toBe(TOTAL_CHIPS(config));
      }
    }
  });
});
