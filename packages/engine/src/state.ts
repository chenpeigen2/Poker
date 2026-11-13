import type {
  Action,
  Card,
  GameState,
  HandConfig,
  HandRank,
  HandResult,
  LegalAction,
  PlayerState,
  Seat,
  Street,
} from '@poker/domain';
import { evaluate7, rankLabel } from './evaluate';
import { shuffle } from './rng';

export function otherSeat(seat: Seat): Seat {
  return seat === 'hero' ? 'villain' : 'hero';
}

export function toCall(state: GameState, seat: Seat): number {
  return Math.max(0, state.currentBet - state.players[seat].streetCommitted);
}

function nextStreetOf(street: Street): Street {
  switch (street) {
    case 'preflop': return 'flop';
    case 'flop': return 'turn';
    case 'turn': return 'river';
    case 'river':
    case 'showdown': return 'showdown';
  }
}

function completeBoard(state: GameState): readonly Card[] {
  const need = Math.max(0, 5 - state.board.length);
  return [...state.board, ...state.deck.slice(0, need)];
}

function setSeat(
  players: Readonly<Record<Seat, PlayerState>>,
  seat: Seat,
  value: PlayerState,
): Record<Seat, PlayerState> {
  return seat === 'hero'
    ? { hero: value, villain: players.villain }
    : { hero: players.hero, villain: value };
}

// ---------------------------------------------------------------------------
// 创建一手牌
// ---------------------------------------------------------------------------

export function createHand(config: HandConfig): GameState {
  if (config.smallBlind <= 0 || config.bigBlind <= 0) {
    throw new Error('盲注必须为正数');
  }
  if (config.heroStack <= 0 || config.villainStack <= 0) {
    throw new Error('双方筹码必须为正数');
  }

  const deck = shuffle(config.seed);
  const heroHole: readonly Card[] = [deck[0]!, deck[1]!];
  const villainHole: readonly Card[] = [deck[2]!, deck[3]!];
  const remaining = deck.slice(4);

  const sb = Math.min(config.smallBlind, config.heroStack);
  const bb = Math.min(config.bigBlind, config.villainStack);

  const hero: PlayerState = {
    seat: 'hero',
    stack: config.heroStack - sb,
    committed: sb,
    streetCommitted: sb,
    holeCards: heroHole,
    hasFolded: false,
    isAllIn: config.heroStack <= sb,
    hasActedThisStreet: false,
  };
  const villain: PlayerState = {
    seat: 'villain',
    stack: config.villainStack - bb,
    committed: bb,
    streetCommitted: bb,
    holeCards: villainHole,
    hasFolded: false,
    isAllIn: config.villainStack <= bb,
    hasActedThisStreet: false,
  };

  const state: GameState = {
    config,
    street: 'preflop',
    board: [],
    deck: remaining,
    pot: sb + bb,
    players: { hero, villain },
    // 单挑：按钮 = 小盲，翻前先行动。
    toAct: 'hero',
    actions: [
      { seat: 'hero', kind: 'post-blind', amount: sb, street: 'preflop' },
      { seat: 'villain', kind: 'post-blind', amount: bb, street: 'preflop' },
    ],
    currentBet: bb,
    lastAggressor: 'villain',
    minRaiseTo: bb * 2,
    lastRaiseIncrement: bb,
    result: null,
    button: 'hero',
  };

  // 极端短码：盲注就把人打全下了，本手已无人能再行动，直接发完牌面摊牌。
  if (hero.isAllIn || villain.isAllIn) return runOutBoard(state);
  return state;
}

// ---------------------------------------------------------------------------
// 合法动作
// ---------------------------------------------------------------------------

export function legalActions(state: GameState): readonly LegalAction[] {
  if (state.result !== null || state.toAct === null) return [];

  const seat = state.toAct;
  const player = state.players[seat];
  const opponent = state.players[otherSeat(seat)];
  const facing = toCall(state, seat);
  const stack = player.stack;
  const out: LegalAction[] = [];

  // 已经全下（无剩余筹码）时不再有任何可行动作。
  if (stack <= 0) return out;

  if (facing > 0) {
    out.push({ kind: 'fold', min: 0, max: 0 });
    const callAmount = Math.min(facing, stack);
    out.push({ kind: 'call', min: callAmount, max: callAmount });

    // 对手已全下时无人可再跟注，因此不能再加注（短 all-in 不重开下注权）。
    if (!opponent.isAllIn && stack > callAmount) {
      const minIncrement = Math.max(0, state.minRaiseTo - player.streetCommitted);
      if (minIncrement > callAmount && minIncrement <= stack) {
        out.push({ kind: 'raise', min: minIncrement, max: stack });
      }
      out.push({ kind: 'allin', min: stack, max: stack });
    }
  } else {
    out.push({ kind: 'check', min: 0, max: 0 });
    if (stack > 0) {
      const minBet = Math.min(state.config.bigBlind, stack);
      out.push({ kind: 'bet', min: minBet, max: stack });
      out.push({ kind: 'allin', min: stack, max: stack });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 状态转移
// ---------------------------------------------------------------------------

export function applyAction(state: GameState, action: Action): GameState {
  if (state.result !== null) throw new Error('牌局已结束，不能再行动');
  if (state.toAct === null) throw new Error('当前无人需要行动');
  if (action.seat !== state.toAct) {
    throw new Error(`轮到 ${state.toAct} 行动，却收到 ${action.seat} 的动作`);
  }
  if (action.street !== state.street) {
    throw new Error(`动作街次 ${action.street} 与当前 ${state.street} 不符`);
  }

  const legal = legalActions(state).find(
    (candidate) =>
      candidate.kind === action.kind &&
      action.amount >= candidate.min &&
      action.amount <= candidate.max,
  );
  if (legal === undefined) {
    throw new Error(
      `非法动作 ${action.kind}/${action.amount}，合法集合：${JSON.stringify(legalActions(state))}`,
    );
  }

  const player = state.players[action.seat];
  // 牌桌只存在整数筹码：在引擎边界强制量化，防止调用方传入浮点注额破坏守恒。
  const amount = Math.round(Math.min(action.amount, player.stack));
  const updated: PlayerState = {
    ...player,
    stack: player.stack - amount,
    committed: player.committed + amount,
    streetCommitted: player.streetCommitted + amount,
    hasFolded: action.kind === 'fold',
    isAllIn: player.stack - amount === 0,
    hasActedThisStreet: true,
  };

  let next: GameState = {
    ...state,
    players: setSeat(state.players, action.seat, updated),
    pot: state.pot + amount,
    actions: [...state.actions, action],
  };

  if (action.kind === 'bet' || action.kind === 'raise' || action.kind === 'allin') {
    const newTotal = updated.streetCommitted;
    const increment = newTotal - state.currentBet;
    const opponentSeat = otherSeat(action.seat);
    const isFullRaise = state.currentBet === 0 || increment >= state.lastRaiseIncrement;
    const effectiveIncrement = Math.max(
      state.currentBet === 0 ? newTotal : increment,
      state.config.bigBlind,
    );

    if (isFullRaise) {
      next = {
        ...next,
        currentBet: newTotal,
        lastRaiseIncrement: effectiveIncrement,
        minRaiseTo: newTotal + effectiveIncrement,
        lastAggressor: action.seat,
        players: setSeat(next.players, opponentSeat, {
          ...next.players[opponentSeat],
          hasActedThisStreet: false,
        }),
      };
    } else {
      // 短 all-in：加注增量不足，不重开下注权，对手只能跟或弃。
      next = { ...next, currentBet: newTotal, lastAggressor: action.seat };
    }
  }

  return resolve(next, action.seat);
}

/** 判断下注轮是否结束，并决定下一个行动者 / 推进街次 / 结束本手。 */
function resolve(state: GameState, actor: Seat): GameState {
  const opponentSeat = otherSeat(actor);
  const actorPlayer = state.players[actor];
  const opponent = state.players[opponentSeat];

  if (actorPlayer.hasFolded) return finishHand(state, opponentSeat, false);
  if (opponent.hasFolded) return finishHand(state, actor, false);

  const matched = actorPlayer.streetCommitted === opponent.streetCommitted;
  const bothActed = actorPlayer.hasActedThisStreet && opponent.hasActedThisStreet;
  const bothAllIn = actorPlayer.isAllIn && opponent.isAllIn;

  if (bothActed && matched) return advanceStreet(state);
  if (bothAllIn) return runOutBoard(state);

  if (actorPlayer.isAllIn || opponent.isAllIn) {
    // 有人全下但仍存在未跟注的差额：让还有筹码的一方跟或弃，之后直接跑完牌面。
    const responder: Seat = actorPlayer.isAllIn ? opponentSeat : actor;
    const allInPlayer = state.players[otherSeat(responder)];
    const rp = state.players[responder];
    if (rp.stack > 0 && rp.streetCommitted < allInPlayer.streetCommitted) {
      return { ...state, toAct: responder };
    }
    return runOutBoard(state);
  }

  if (!opponent.hasActedThisStreet) return { ...state, toAct: opponentSeat };
  if (!actorPlayer.hasActedThisStreet) return { ...state, toAct: actor };
  return runOutBoard(state);
}

function advanceStreet(state: GameState): GameState {
  if (state.street === 'river' || state.street === 'showdown') return showdown(state);

  const street = nextStreetOf(state.street);
  const need = street === 'flop' ? 3 : 1;
  const board = [...state.board, ...state.deck.slice(0, need)];
  const deck = state.deck.slice(need);
  const reset = (player: PlayerState): PlayerState => ({
    ...player,
    streetCommitted: 0,
    hasActedThisStreet: false,
  });

  const next: GameState = {
    ...state,
    street,
    board,
    deck,
    players: {
      hero: reset(state.players.hero),
      villain: reset(state.players.villain),
    },
    currentBet: 0,
    lastRaiseIncrement: state.config.bigBlind,
    minRaiseTo: state.config.bigBlind,
    lastAggressor: null,
    // 翻后由非按钮位（大盲）先行动。
    toAct: otherSeat(state.button),
  };

  if (next.players.hero.isAllIn || next.players.villain.isAllIn) return runOutBoard(next);
  return next;
}

/** 已无人能再下注：一次性发完剩余公共牌并摊牌。 */
function runOutBoard(state: GameState): GameState {
  const consumed = Math.max(0, 5 - state.board.length);
  return showdown({
    ...state,
    board: completeBoard(state),
    deck: state.deck.slice(consumed),
  });
}

function showdown(state: GameState): GameState {
  const board = completeBoard(state);
  const heroRank = evaluate7([...state.players.hero.holeCards, ...board]);
  const villainRank = evaluate7([...state.players.villain.holeCards, ...board]);
  const winner: Seat | 'split' =
    heroRank.code > villainRank.code
      ? 'hero'
      : villainRank.code < heroRank.code
        ? 'villain'
        : 'split';

  return finishHand(
    {
      ...state,
      board,
      deck: state.deck.slice(Math.max(0, 5 - board.length)),
      street: 'showdown',
      toAct: null,
    },
    winner,
    true,
    heroRank,
    villainRank,
  );
}

function finishHand(
  state: GameState,
  winner: Seat | 'split',
  isShowdown: boolean,
  heroRank?: HandRank,
  villainRank?: HandRank,
): GameState {
  const reason = isShowdown
    ? winner === 'split'
      ? `摊牌双方牌力相同（${rankLabel(heroRank ?? evaluate7([...state.players.hero.holeCards, ...state.board]))}），平分底池`
      : `摊牌：你 ${rankLabel(heroRank!)}, 对手 ${rankLabel(villainRank!)}，${winner === 'hero' ? '你' : '对手'}胜出`
    : winner === 'hero'
      ? '对手弃牌，你收下底池'
      : '你弃牌，对手收下底池';

  const result: HandResult = {
    winner,
    heroNet: computeHeroNet(state, winner),
    showdown: isShowdown,
    reason,
    ...(heroRank === undefined ? {} : { heroRank }),
    ...(villainRank === undefined ? {} : { villainRank }),
  };

  return { ...state, toAct: null, result };
}

function computeHeroNet(state: GameState, winner: Seat | 'split'): number {
  const stacks = settleStacks({ ...state, result: { winner, heroNet: 0, showdown: false, reason: '' } });
  return stacks.hero - state.config.heroStack;
}

// ---------------------------------------------------------------------------
// 结算 / 回放
// ---------------------------------------------------------------------------

/**
 * 本手结算完成后的双方筹码，供现金局下一手续用。
 * 未跟注的超额下注返还给贡献更多的一方；单边池只按较小投入结算。
 */
export function settleStacks(state: GameState): Readonly<Record<Seat, number>> {
  const winner = state.result?.winner ?? 'split';
  const h = state.players.hero.committed;
  const v = state.players.villain.committed;
  // 只有「匹配的部分」进入底池；多投入的部分（未跟注下注）先原样返还。
  const matched = Math.min(h, v);
  const heroShare = winner === 'hero' ? 2 * matched : winner === 'split' ? matched : 0;
  const villainShare = winner === 'villain' ? 2 * matched : winner === 'split' ? matched : 0;
  return {
    hero: state.players.hero.stack + (h - matched) + heroShare,
    villain: state.players.villain.stack + (v - matched) + villainShare,
  };
}

export function isHandOver(state: GameState): boolean {
  return state.result !== null;
}

/** createHand 已收过盲注，因此回放跳过日志中的 post-blind 事件。 */
export function replay(config: HandConfig, actions: readonly Action[]): GameState {
  let state = createHand(config);
  for (const action of actions) {
    if (action.kind === 'post-blind') continue;
    state = applyAction(state, action);
  }
  return state;
}
