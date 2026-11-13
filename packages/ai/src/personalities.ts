import type { Personality } from '@poker/domain';

/**
 * 破掌（tells）必须是「稳定且可归纳」的：每个参数都会直接改变决策分布，
 * 玩家打若干手后能归纳出「他翻牌面对下注总弃牌」「他河牌从不诈唬」这类规律。
 */
export const PERSONALITIES: readonly Personality[] = [
  {
    id: 'laochen',
    name: '老陈',
    title: '紧弱的账房先生',
    blurb: '打了二十年，只信自己看得见的牌。你只要敢压，他多半会把牌盖掉。',
    avatarColor: '#c9a227',
    params: {
      vpip: 0.34,
      aggression: 0.24,
      bluffFrequency: 0.12,
      foldToCbet: 0.84,
      riverBluff: 0.04,
      sizingTell: 0.86,
      tilt: 0.58,
      callStation: 0.12,
      thinkTimeMs: 1500,
    },
    knownTells: [
      '翻牌面对持续下注时过度弃牌',
      '河牌几乎从不诈唬，下注基本都是价值',
      '拿到强牌反而下小注（反向 tell）',
      '连输几手后明显缩手',
      '思考时间偏长',
    ],
  },
  {
    id: 'alang',
    name: '阿浪',
    title: '疯鲨',
    blurb: '他不在乎牌，只在乎你敢不敢跟。频率高得离谱，但频率本身就是破绽。',
    avatarColor: '#d4574a',
    params: {
      vpip: 0.78,
      aggression: 0.88,
      bluffFrequency: 0.62,
      foldToCbet: 0.16,
      riverBluff: 0.58,
      sizingTell: 0.18,
      tilt: 0.16,
      callStation: 0.22,
      thinkTimeMs: 420,
    },
    knownTells: [
      '几乎不弃牌于持续下注，反而频繁反加',
      '河牌诈唬率极高',
      '下注尺寸波动大，与牌力弱相关',
      '出手极快，几乎不思考',
    ],
  },
  {
    id: 'mira',
    name: 'Mira',
    title: '石头',
    blurb: '她不诈唬，也不弃牌。她只是把你的每一次下注都跟到底，等你先眨眼。',
    avatarColor: '#5b8fb9',
    params: {
      vpip: 0.62,
      aggression: 0.2,
      bluffFrequency: 0.06,
      foldToCbet: 0.2,
      riverBluff: 0.03,
      sizingTell: 0.34,
      tilt: 0.1,
      callStation: 0.9,
      thinkTimeMs: 900,
    },
    knownTells: [
      '极高频跟注，几乎不弃牌',
      '几乎从不主动诈唬',
      '节奏极其稳定， timing tell 很弱',
      '只有真正的强牌才会加注',
    ],
  },
  {
    id: 'zhou',
    name: '周先生',
    title: '读局者',
    blurb: '最像人的一个：会平衡、会调整，但连败时仍会露出一点点缝隙。',
    avatarColor: '#7b6bb0',
    params: {
      vpip: 0.55,
      aggression: 0.55,
      bluffFrequency: 0.34,
      foldToCbet: 0.42,
      riverBluff: 0.3,
      sizingTell: 0.42,
      tilt: 0.34,
      callStation: 0.4,
      thinkTimeMs: 1100,
    },
    knownTells: [
      '翻牌弃牌率居中，但会随你的频率调整',
      '河牌偶尔诈唬，比例稳定',
      '连败后侵略性小幅下降',
      '强牌与弱牌的下注尺寸差别不大',
    ],
  },
];

export function getPersonality(id: string): Personality {
  return PERSONALITIES.find((personality) => personality.id === id) ?? PERSONALITIES[0]!;
}
