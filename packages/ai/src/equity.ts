import type { Card, GameState, Seat } from '@poker/domain';
import { makeDeck } from '@poker/domain';
import { createRng, evaluate7 } from '@poker/engine';

const cardKey = (card: Card): string => `${card.rank}-${card.suit}`;

/**
 * 有界蒙特卡洛胜率估计（默认 160 次）。
 *
 * 未知牌堆 = 整副牌 - 自己的底牌 - 公共牌，因此包含对手真实底牌但不去窥探它。
 * 每次模拟只洗前 2 + need 张，避免整副牌全量洗牌。
 * 随机流由调用方传入的 seed 派生，保证完全可复现。
 */
export function estimateEquity(
  state: GameState,
  seat: Seat,
  seed: number,
  simulations = 160,
): number {
  const hole = state.players[seat].holeCards;
  const board = state.board;
  const known = new Set<string>([...hole, ...board].map(cardKey));
  const unknown: Card[] = makeDeck().filter((card) => !known.has(cardKey(card)));
  const need = Math.max(0, 5 - board.length);
  const drawCount = 2 + need;
  const rng = createRng(seed);

  let score = 0;
  for (let sim = 0; sim < simulations; sim += 1) {
    const pool = [...unknown];
    for (let i = 0; i < drawCount; i += 1) {
      const j = i + Math.floor(rng() * (pool.length - i));
      const a = pool[i]!;
      const b = pool[j]!;
      pool[i] = b;
      pool[j] = a;
    }
    const opponentHole = pool.slice(0, 2);
    const runout = pool.slice(2, drawCount);
    const fullBoard: readonly Card[] = [...board, ...runout];
    const mine = evaluate7([...hole, ...fullBoard]);
    const theirs = evaluate7([...opponentHole, ...fullBoard]);
    if (mine.code > theirs.code) score += 1;
    else if (mine.code === theirs.code) score += 0.5;
  }
  return simulations === 0 ? 0 : score / simulations;
}
