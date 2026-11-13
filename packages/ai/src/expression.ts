import type { ExpressionAdapter, GameState, Intent, IntentKind, Personality } from '@poker/domain';

const OPENERS: Readonly<Record<IntentKind, readonly string[]>> = {
  value: ['这把我看好。', '嗯，牌不错。', '该收一点了。'],
  bluff: ['你跟不跟？', '我赌你没东西。', '别看了，盖了吧。'],
  probe: ['先小一点。', '试试水温。', '就这么多。'],
  'pot-control': ['不急。', '先过。', '控一下。'],
  defense: ['这手算了。', '不跟你耗。', '收起来。'],
  tilt: ['……再来。', '缓一手。', '先稳住。'],
  trap: ['随你。', '你先请。', '过。'],
};

const CLOSERS: readonly string[] = ['', '。', '……'];

function hashPick(text: string, options: readonly string[]): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(i)) >>> 0;
  }
  return options[hash % options.length] ?? options[0] ?? '';
}

/** 纯本地模板：把结构化意图翻译成台词。零网络请求。 */
export function expressionFor(intent: Intent, personality: Personality): string {
  const opener = hashPick(
    `${personality.id}-${intent.intent}-${intent.reason}`,
    OPENERS[intent.intent],
  );
  const suffix = hashPick(`${intent.reason}-${intent.equity.toFixed(2)}`, CLOSERS);
  return `${opener}${suffix}`;
}

export const templateAdapter: ExpressionAdapter = {
  id: 'template',
  render(intent: Intent, personality: Personality, _state: GameState): string {
    return expressionFor(intent, personality);
  },
};

/**
 * v1 的 LLM 占位适配器：接口支持异步 render，但**不发起任何网络请求**，
 * 直接降级到模板。这保证「浏览器无 API key」时游戏依然完整可玩。
 * v2 接入真实 LLM 时替换此对象的 render 即可，决策层无需改动。
 */
export const llmPlaceholderAdapter: ExpressionAdapter = {
  id: 'llm-placeholder',
  render(intent: Intent, personality: Personality, _state: GameState): string {
    return expressionFor(intent, personality);
  },
};
