import { describe, expect, it } from 'vitest';
import type { HandRecord } from '@poker/domain';
import { BIG_BLIND, buildHighlight } from './highlight';

function hand(heroNet: number, winner: 'hero' | 'villain' | 'split'): HandRecord {
  return {
    id: 'hand-test',
    config: {
      seed: 1,
      heroStack: 1000,
      villainStack: 1000,
      smallBlind: 5,
      bigBlind: BIG_BLIND,
    },
    actions: [],
    result: { winner, heroNet, showdown: true, reason: '测试' },
    heroStackAfter: 1000 + heroNet,
    villainStackAfter: 1000 - heroNet,
    createdAt: 'hand-1',
    personalityId: 'laochen',
  };
}

describe('施压高光', () => {
  it('试探后赢下大底池时给出正反馈', () => {
    const result = buildHighlight(hand(120, 'hero'), 2, 0.5, 0.5);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('读到了，也压住了');
    expect(result!.detail).toContain('2 次试探');
    expect(result!.net).toBe(120);
  });

  it('没有试探或赢得太少时不触发', () => {
    expect(buildHighlight(hand(120, 'hero'), 0, 0.5, 0.5)).toBeNull();
    expect(buildHighlight(hand(10, 'hero'), 1, 0.5, 0.5)).toBeNull();
    expect(buildHighlight(hand(120, 'villain'), 2, 0.5, 0.5)).toBeNull();
  });

  it('画像被推翻且付出大代价时给出修正反馈', () => {
    const result = buildHighlight(hand(-150, 'villain'), 1, 0.8, 0.4);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('这次读错了');
    expect(result!.detail).toContain('修正假设');
  });
});
