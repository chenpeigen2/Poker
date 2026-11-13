# 架构说明

> 本文描述《读局》当前实现的静态结构与关键不变量。决策理由见 [DECISIONS.md](DECISIONS.md)，
> 跨包签名见 [CONTRACT.md](CONTRACT.md)。

## 1. 分层

```
apps/web  ──→  @poker/ai  ──→  @poker/engine  ──→  @poker/domain
 (R3F/DOM)     (对手)          (规则)              (纯契约)
```

依赖严格单向，禁止反向 import，禁止跨包引用内部文件（`src/xxx`）。
`domain` 零运行时依赖，是**唯一 seam**：任何跨包数据结构必须先在那里定义。

| 包 | 职责 | 关键文件 |
|---|---|---|
| `domain` | 类型、常量、纯函数 | `src/index.ts` |
| `engine` | 牌力评估、洗牌、下注状态机、结算、回放 | `evaluate.ts` `rng.ts` `state.ts` |
| `ai` | 人格、胜率估计、决策、表达、档案、可利用性 | `personalities.ts` `equity.ts` `decide.ts` `dossier.ts` `exploit.ts` |
| `web` | 游戏循环、3D 牌桌、DOM 面板、复盘、音效 | `game/useGame.ts` `table/PokerTable.tsx` `panel/*` `replay/*` |

## 2. 一手牌的数据流

```
createHand(config)                      engine：洗牌 → 发底牌 → 收盲注
   ↓  GameState（不可变快照 + actions 追加日志）
玩家动作 (Action, 可带 probe)
   ↓  applyAction(state, action)        纯函数，校验合法性
   ↓  resolve() → 推进街次 / 发公共牌 / 摊牌
AI 回合 decide(state, personality, ctx)
   ↓  Intent（动作 + 牌力桶 + 意图 + tellLevel + equity + timingMs）
   ↓  expressionFor() → 台词；timingMs → 思考延时（timing tell）
isHandOver(state)
   ↓  settleStacks() → 下一手买入
   ↓  HandRecord → recordHand() / verifyHypotheses() → Dossier
   ↓  SessionStats / Highlight / 复盘历史 → localStorage
```

`apps/web/src/game/useGame.ts` 是唯一的胶水层，把上述链路封装成 `useGame()` hook；
3D 与 DOM 只通过 `GameState` / `HandRecord` / `Dossier` / `SessionStats` 通信，互不 import 内部组件。

## 3. 关键不变量

| 不变量 | 保证方式 | 验证 |
|---|---|---|
| 筹码守恒 | `held(hero.stack + villain.stack) + pot === 总筹码`；引擎边界整数量化 | `engine.test.ts`、集成测试逐步断言 |
| 结算正确 | 只有 `min(h, v)` 进入底池，未跟注超额原样返还；`settleStacks` 与 `heroNet` 自洽 | 平分底池、极端短码、超额下注测试 |
| 完全确定性 | 所有随机性来自 `seed`；`decide` 的蒙特卡洛与节奏各用 `mixSeed` 派生独立流 | 回放逐字段相等、AI 确定性测试 |
| 动作合法性 | `decide` 只在 `legalActions(state)` 内取值；`applyAction` 二次校验 | 多种子 × 多人格集成测试 |
| 零 `any` | TypeScript AST 扫描 `scripts/check-no-any.mjs` | `pnpm check:no-any` |
| 零网络请求 | 表达层默认模板适配器；LLM 仅留接口与禁用桩 | 浏览器烟测零请求 |

## 4. 深接口边界

- **engine 的状态机**是唯一懂得「下注规则」的地方。UI 不判断能不能加注，只渲染 `legalActions(state)`。
- **ai 的 `Intent`** 是唯一懂得「对手为什么这么打」的地方。读心面板、台词、档案三处复用同一份结构化输出。
- **domain 的 `HandRecord.actions`** 是回放、档案统计、复盘三者的共同数据源；`probe` 标记原样保存在动作里。
- **web 的 `useGame`** 不实现任何规则，只做编排、持久化与叙事反馈。

## 5. 「读人」闭环的实现位置

| 环节 | 实现 |
|---|---|
| 提出假设 | `addHypothesis()` + `HYPOTHESIS_TEMPLATES`（7 个观察节点） |
| 主动试探 | `Action.probe`；`ActionBar` 的试探开关；键盘 `P` |
| 开启观察窗口 | `collectEvidence()`：翻牌 c-bet **或**翻牌试探都算；否则最便宜的探测拿不到证据 |
| 观察反应 | `Intent.tellLevel` 信息泄漏条、`timingMs` 节奏条、对手台词、行动时间轴 |
| 判定反馈 | `verifyHypotheses()` → 明确「成立/不成立」+ 逐手证据链 `HypothesisSample[]` |
| 针对性施压 | `Dossier.exploitation` + `buildHighlight()` 叙事化高光 |
| 可利用性验证 | `measureExploitability()` 用固定剥削策略量化不同人格的破绽 |

## 6. 前端结构

```
src/
  main.tsx / App.tsx          布局、键盘、音效触发、复盘联动
  game/useGame.ts             游戏循环（唯一胶水）
  game/highlight.ts           施压高光纯函数（可单测）
  audio/sound.ts              WebAudio 程序化音效，零素材
  table/                      R3F 3D 牌桌
    PokerTable.tsx            相机视差、发牌动画、推池动画、赢家高亮、轮次指示灯
    cardTexture.ts            程序化牌面（点数牌 pip 布局 / 人头牌画框）/ 牌背，带缓存
    textures.ts               毡布纤维、木纹、座位牌、筹码面
  panel/                      DOM 面板（动作、状态、档案、洞察）
  replay/ReplayView.tsx       受控复盘；步进时驱动同一张 3D 牌桌
```

复盘联动：`App` 把 `replay(config, actions.slice(0, step))` 得到的 `GameState` 传给
`PokerTable`，因此复盘不是另一套渲染器，而是**同一张桌子重演历史**。

## 7. 性能

- `three` / R3F / React 拆成独立 chunk（`vite.config.ts` 的 `manualChunks`），便于长期缓存。
- 程序化贴图按 key 缓存，不在每帧重建。
- AI 蒙特卡洛固定 160 次、7 取 5 共 21 组合，单次决策约毫秒级；`Intent.timingMs`
  把计算耗时包装成可观察的「思考」节奏，恰好评测与表现合二为一。
- `GameState` 全字段只读，React 用对象引用变化判断是否需要重渲染。

## 8. 扩展点

| 想加什么 | 改哪里 |
|---|---|
| 新的对手破绽 | `personalities.ts` 加参数 + `dossier.ts` 的 `observe()` 加节点 |
| 新牌局变体 | `engine/state.ts`（状态机）与 `domain`（新增字段需同步契约） |
| 真实 LLM 台词 | 实现 `ExpressionAdapter`（`render` 允许异步），替换 `templateAdapter` |
| 元博弈大师对手 | `decide()` 增加对手模型输入；需要 `HandRecord[]` 作为上下文 |
| 多人 / 联网 | 超出 v1 非目标，需要重做 `GameState.players` 形状与同步协议 |
