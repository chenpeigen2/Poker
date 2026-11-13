import type { HandRecord, Highlight } from '@poker/domain';

export const BIG_BLIND = 10;

/**
 * 「读出来 → 施压 → 收获」的叙事化反馈。
 * 纯函数，便于单测覆盖两种分支：试探后赢下大底池 / 画像被推翻且付出大代价。
 */
export function buildHighlight(
  record: HandRecord,
  probes: number,
  accuracyBefore: number,
  accuracyAfter: number,
): Highlight | null {
  const net = record.result.heroNet;
  if (probes > 0 && record.result.winner === 'hero' && net >= BIG_BLIND * 4) {
    return {
      handId: record.id,
      title: '读到了，也压住了',
      detail: `你用 ${probes} 次试探买到信息，随后赢下 ${net} 筹码——这就是针对性施压。`,
      net,
    };
  }
  if (accuracyAfter < accuracyBefore && net <= -BIG_BLIND * 4) {
    return {
      handId: record.id,
      title: '这次读错了',
      detail: `画像被推翻，本手付出 ${Math.abs(net)} 筹码。修正假设，再试探一次。`,
      net,
    };
  }
  return null;
}
