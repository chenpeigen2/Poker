# 跨包契约（Contract）

> 所有包共享的唯一 seam 是 `@poker/domain` 的 `src/index.ts`（类型 + 常量 + 纯函数）。
> 依赖方向严格单向：`apps/web → @poker/ai → @poker/engine → @poker/domain`。
> **禁止**反向依赖、**禁止**跨包 import 内部文件、`domain` **零运行时依赖**。
> 任何跨包数据结构必须先在 `domain` 定义。改契约要通知 Lead。

## 通用约束

- TypeScript `strict` + `noUncheckedIndexedAccess`，**任何位置不得出现 `any`**（含 `as any`、双重断言）。外部输入用 `unknown` + 守卫。
- 引擎与 AI 的核心逻辑必须是**纯函数**：给定相同输入返回相同输出。禁止 `Math.random()`、`Date.now()`、`crypto.randomUUID()` 出现在 `engine`/`ai` 的 `src` 中（`web` 层生成 UI 层 id 除外）。
- 所有随机性由 `HandConfig.seed` 派生。

## `@poker/engine` 必须导出的 API

```ts
// 牌力
export function evaluate5(cards: readonly Card[]): HandRank
export function evaluate7(cards: readonly Card[]): HandRank
export function rankLabel(rank: HandRank): string

// 确定性洗牌
export function shuffle(seed: number): readonly Card[]

// 状态机（全部纯函数，非法动作抛 Error）
export function createHand(config: HandConfig): GameState
export function legalActions(state: GameState): readonly LegalAction[]
export function applyAction(state: GameState, action: Action): GameState
export function isHandOver(state: GameState): boolean
export function replay(config: HandConfig, actions: readonly Action[]): GameState

// 辅助
export function otherSeat(seat: Seat): Seat
export function toCall(state: GameState, seat: Seat): number
export function settleStacks(state: GameState): Readonly<Record<Seat, number>>
```

语义要点：

- `createHand` 完成洗牌、发底牌、收盲注，返回 `toAct = button`（单挑：按钮=小盲，翻前先行动）。
- `applyAction` 在一条街结束时自动推进 street 并把 board 从 deck 中补齐（翻牌 3 张、转/河各 1 张）。
- 翻后由非按钮位（大盲）先行动。
- `GameState.result` 非 null 即本手结束；`isHandOver` 等价于 `result !== null`。
- `replay` 从 `createHand` 起依次 `applyAction`，结果必须与实时对局**逐字段深度相等**。
- `amount` 是本次动作的**投入增量**；`bet/raise/allin` 的 `amount` 是加到本条街投入上的增量，`streetCommitted` 由引擎累加。
- `settleStacks` 返回本手结算后双方筹码（含未跟注返还），供现金局下一手续用。

## `@poker/ai` 必须导出的 API

```ts
export const PERSONALITIES: readonly Personality[]
export function getPersonality(id: string): Personality
export function decide(state: GameState, personality: Personality, ctx: AiContext): Intent
export function expressionFor(intent: Intent, personality: Personality): string
export const templateAdapter: ExpressionAdapter

// 档案
export function emptyDossier(personalityId: string): Dossier
export function recordHand(dossier: Dossier, hand: HandRecord, personality: Personality): Dossier
export function addHypothesis(dossier: Dossier, label: string, node: string): Dossier
export function verifyHypotheses(dossier: Dossier, hand: HandRecord): Dossier
export const HYPOTHESIS_TEMPLATES: readonly { readonly label: string; readonly node: string }[]
export const UNLOCK_AT: number

// 可利用性（破绽的量化验证）
export function measureExploitability(personality: Personality, trials?: number): number
export function exploitIndex(personality: Personality): number
```

补充语义：

- `HYPOTHESIS_TEMPLATES` 现有 7 个观察节点：`flop-cbet` `river-value` `small-bet-strong` `tilt` `timing` `turn-small-bet` `river-bluff`；新增节点需同步在 `observe()` 中实现。
- `measureExploitability` 用固定 c-bet 剥削策略跑 `trials` 手，返回玩家每手平均净收益，用于验证「破绽可被利用」不是口号。
- `exploitIndex` 是纯参数推导的静态指数，供 UI 展示「这个对手有多好读」。
- `verifyHypotheses` 每次命中观察点会追加一条 `HypothesisSample`，并同步更新 `readAccuracy`。

语义要点：

- `decide` 只读 `GameState`，根据 `state.toAct` 所对应座位决策；返回 `Intent`，其中 `intent.action` 必须是 `legalActions(state)` 中的合法动作。
- `Intent.reason` 是一句可用于生成台词的中文短语（模板层消费），不是给玩家看的剧透。
- `tellLevel` ∈ [0,1]，由「本次动作偏离均衡的程度」决定，供 UI 展示信息泄漏强度。
- AI 的蒙特卡洛使用由 `ctx.seed` + `ctx.handIndex` + `ctx.decisionIndex` 派生的独立 PRNG，保证可复现。
- `recordHand` 累加统计样本并更新 `unlocked`；`verifyHypotheses` 给出 `lastFeedback`（必须含「成立」或「不成立」）。
- `expressionFor` 是同步模板实现；`ExpressionAdapter` 接口预留异步 LLM 实现，v1 不启用。

## `@poker/domain` 已提供的类型

`Card` `Suit` `Rank` `Street` `Seat` `ActionKind` `Action` `LegalAction` `HandConfig` `PlayerState` `GameState` `HandResult` `HandRank` `HandRecord` `StrengthBucket` `IntentKind` `Intent` `Personality` `PersonalityParams` `AiContext` `Dossier` `DossierStats` `Hypothesis` `HypothesisStatus` `HypothesisSample` `ExpressionAdapter` `SessionStats` `Highlight`。

以及纯函数 `makeDeck()` `cardLabel(card)` `rankLabelText(rank)` `suitSymbol(suit)` `emptySessionStats()` 和常量 `SUITS` `RANKS` `STREET_LABELS` `SEAT_LABELS`。

契约扩展（v2）：

- `Intent.timingMs`：由人格节奏与决策难度确定性派生，UI 用它做思考延时，是可观察的 timing tell。
- `Hypothesis.evidence: readonly HypothesisSample[]`：逐手证据链，让「为什么成立/不成立」可追溯。
- `Dossier.readAccuracy` / `Dossier.exploitation`：读人准确率与针对性施压累计收益。
- `SessionStats` / `Highlight`：跨对手会话战绩与叙事化高光事件。

## `apps/web` 结构约定

- `src/main.tsx` 挂载 `<App />`；`src/App.tsx` 持有游戏状态（`useReducer` 或直接 setState 包装）。
- `src/game/useGame.ts`：封装一手牌的循环（人类动作 → AI `decide` → 结算 → 存档 → 下一手），`localStorage` 持久化；**每个对手一份独立 `Dossier`**。
- `src/game/highlight.ts`：`buildHighlight()` 纯函数，生成施压高光。
- `src/audio/sound.ts`：WebAudio 程序化音效（`deal` / `chip` / `flip` / `fold` / `win` / `lose`）。
- `src/table/`：R3F 3D 牌桌（程序化毡布/木纹/牌面/筹码贴图、发牌与推池动画、赢家高亮、相机视差、轮次指示灯、对手姓名牌）。
- `src/panel/`：DOM 面板（动作栏含快捷键与试探开关、状态栏含节奏 tell/引导/高光、对手档案含证据链与可利用性、行为时间轴与会话战绩）。
- `src/replay/`：受控复盘视图；`App` 把 `replay()` 的 `GameState` 回传给 `PokerTable`，实现「同一张 3D 桌子重演历史」。
- `src/styles.css`：深色牌桌配色。
- 3D ↔ DOM 只通过 `GameState` / `HandRecord` / `Dossier` / `SessionStats` 通信，不互相 import 内部组件。
