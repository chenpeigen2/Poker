import type { Card } from '@poker/domain';
import { makeDeck } from '@poker/domain';

/** mulberry32：给定种子产生完全可复现的 [0,1) 序列。 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把若干整数混合成一个 32 位种子，用于给不同决策派生独立随机流。 */
export function mixSeed(...parts: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    let value = part >>> 0;
    for (let i = 0; i < 4; i += 1) {
      hash ^= value & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      value >>>= 8;
    }
  }
  return hash >>> 0;
}

/** Fisher-Yates 洗牌；相同 seed 一定得到相同牌堆。 */
export function shuffle(seed: number): readonly Card[] {
  const deck: Card[] = [...makeDeck()];
  const rng = createRng(seed);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = deck[i]!;
    const b = deck[j]!;
    deck[i] = b;
    deck[j] = a;
  }
  return deck;
}
