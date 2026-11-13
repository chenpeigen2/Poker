import type { Card, HandRank } from '@poker/domain';

const CATEGORY_NAMES: readonly string[] = [
  '高牌',
  '一对',
  '两对',
  '三条',
  '顺子',
  '同花',
  '葫芦',
  '四条',
  '同花顺',
];

/** 把牌力编码成可直接用 > 比较的整数：category 权重最大，其后依次是 5 个踢脚。 */
function encode(category: number, kickers: readonly number[]): number {
  let code = category * 1e10;
  for (let i = 0; i < 5; i += 1) {
    code += (kickers[i] ?? 0) * Math.pow(10, 8 - 2 * i);
  }
  return code;
}

/**
 * 5 张牌的牌力评估。纯函数，无查表。
 * 类别：0 高牌 / 1 一对 / 2 两对 / 3 三条 / 4 顺子 / 5 同花 / 6 葫芦 / 7 四条 / 8 同花顺。
 */
export function evaluate5(cards: readonly Card[]): HandRank {
  if (cards.length !== 5) {
    throw new Error(`evaluate5 需要恰好 5 张牌，收到 ${cards.length} 张`);
  }

  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const firstSuit = cards[0]?.suit;
  const isFlush = firstSuit !== undefined && cards.every((card) => card.suit === firstSuit);

  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);

  // 按「出现次数降序 → 点数降序」分组，便于统一处理对子/三条/葫芦/四条。
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniqueDesc = [...counts.keys()].sort((a, b) => b - a);

  let straightHigh = 0;
  if (uniqueDesc.length === 5) {
    if (uniqueDesc[0]! - uniqueDesc[4]! === 4) {
      straightHigh = uniqueDesc[0]!;
    } else if (
      uniqueDesc[0] === 14 &&
      uniqueDesc[1] === 5 &&
      uniqueDesc[2] === 4 &&
      uniqueDesc[3] === 3 &&
      uniqueDesc[4] === 2
    ) {
      // A-2-3-4-5 轮子顺子，A 作 1 点，最大牌是 5。
      straightHigh = 5;
    }
  }

  const top = groups[0];
  const second = groups[1];
  const topCount = top?.[1] ?? 0;

  let category = 0;
  let kickers: number[] = [];

  if (straightHigh > 0 && isFlush) {
    category = 8;
    kickers = [straightHigh];
  } else if (topCount === 4) {
    category = 7;
    kickers = [top![0], second![0]];
  } else if (topCount === 3 && second?.[1] === 2) {
    category = 6;
    kickers = [top![0], second[0]];
  } else if (isFlush) {
    category = 5;
    kickers = [...ranks];
  } else if (straightHigh > 0) {
    category = 4;
    kickers = [straightHigh];
  } else if (topCount === 3) {
    category = 3;
    kickers = [top![0], second![0], groups[2]![0]];
  } else if (topCount === 2 && second?.[1] === 2) {
    category = 2;
    kickers = [top![0], second[0], groups[2]![0]];
  } else if (topCount === 2) {
    category = 1;
    kickers = [top![0], second![0], groups[2]![0], groups[3]![0]];
  } else {
    category = 0;
    kickers = [...ranks];
  }

  const padded = [
    kickers[0] ?? 0,
    kickers[1] ?? 0,
    kickers[2] ?? 0,
    kickers[3] ?? 0,
    kickers[4] ?? 0,
  ];

  return {
    category,
    categoryName: CATEGORY_NAMES[category] ?? '未知牌型',
    kickers: padded,
    code: encode(category, padded),
  };
}

/** 7 取 5：枚举 C(7,2)=21 种弃牌组合，取牌力最大者。 */
export function evaluate7(cards: readonly Card[]): HandRank {
  if (cards.length !== 7) {
    throw new Error(`evaluate7 需要恰好 7 张牌，收到 ${cards.length} 张`);
  }
  let best: HandRank | null = null;
  for (let skipA = 0; skipA < 7; skipA += 1) {
    for (let skipB = skipA + 1; skipB < 7; skipB += 1) {
      const five: Card[] = [];
      for (let index = 0; index < 7; index += 1) {
        if (index !== skipA && index !== skipB) five.push(cards[index]!);
      }
      const rank = evaluate5(five);
      if (best === null || rank.code > best.code) best = rank;
    }
  }
  // 循环 21 次，best 必然被赋值。
  return best ?? evaluate5(cards.slice(0, 5));
}

export function rankLabel(rank: HandRank): string {
  return rank.categoryName;
}
