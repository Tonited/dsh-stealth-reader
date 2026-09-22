# DSH Web 界面「会话消息流」渲染考古报告

> 目标：弄清 DeepSeek Harness（DSH）Web GUI 里会话消息流**究竟是怎么渲染的**，以便第三方客户端插件能在右侧主区合成与真实会话视觉一致的内容。
>
> 全程只读代码（`grep` / `sed` / `read` / `dd` / `ls`），**未修改任何 DSH 文件、未运行 dsh、未启动服务器**。唯一写入的文件是本报告。
>
> 所有结论都带 `路径:行号` 证据。确实无法确定的项，明确标注「无法确定」并说明原因。

---

## 路径缩写对照

| 缩写 | 含义 |
|---|---|
| `$DSH` | `/home/ashley/.local/opt/node-v24.9.0-linux-x64/lib/node_modules/@deepseek-ai/dsh` |
| `PKG` | `$DSH/node_modules/@deepseek-ai` |
| `CHAT` | `PKG/dsh-client-ui-chat/lib/client.js`（`wc -l` = 8368，即 8369 行） |
| `CONV` | `PKG/dsh-client-ui-conversation/lib/client.js`（`wc -l` = 16863，即 16864 行） |
| `TOOL` | `PKG/dsh-client-ui-tool/lib/client.js`（`wc -l` = 2393，即 2394 行） |
| `APPR` | `PKG/dsh-client-ui-approval/lib/client.js`（`wc -l` = 292，即 293 行） |
| `LAYOUT` | `PKG/dsh-client-ui-layout/lib/client.js`（`wc -l` = 576，即 577 行，全文可读） |
| `RENDERER` | `PKG/dsh-client-ui-renderer/lib/client.js`（slot 渲染器） |
| `RUNNER` | `PKG/dsh-cordis-client-runner/lib/client.js`（`CLIENT_SLOT_API` 目录，2201 行起） |
| `THEME` | `PKG/dsh-client-ui-theme/lib/client.js`（全部 CSS 变量的定义真源） |
| `SESSION` | `PKG/dsh-session/lib/types/types.d.ts`（事件形状真源） |
| `LLM` | `PKG/dsh-llm/lib/types/`（消息 / 内容块 / 流块真源） |
| `CTRL` | `PKG/dsh-api-session-controller/lib/types/client/`（eventSource 真源） |
| `SHELL` | `PKG/dsh-web-frontend/dist/assets/index-BKQ_L1z6.js`（555 KB，**UI primitives 内联在这里**） |
| `SHELLCSS` | `PKG/dsh-web-frontend/dist/assets/index-DPX2bQLo.css`（51 KB） |

### 一个必须知道的前置架构事实

- 各 `dsh-client-ui-*/lib/client.js` **不是**打包在一起的 SPA chunk，而是运行期由 `window.__ModuleLoader__.load({id, factory})` 注册的独立 sidecar bundle（每个文件首行即此调用，见 `CHAT:1-8`）。
- `@deepseek-ai/dsh-client-ui-primitives`（`DisclosureRow`、`StateDot`、`TerminalBlock`、`ReadBlock`、`DiffBlock`、`MarkdownText`、全部 `Icon*` 组件）**在本安装里没有独立目录**，其实现被内联进 `SHELL`，通过模块注册表暴露：
  - `SHELL:508249` → `const Zg = Object.freeze(Object.defineProperty({__proto__:null, ..., DisclosureRow:Yp, StateDot:O6, ..., MarkdownText:w8, ...}))`
  - `SHELL:553323` → `"@deepseek-ai/dsh-client-ui-primitives": Zg`
- 因此「复用 DSH 的组件」在第三方插件里**是可行的**（`require("@deepseek-ai/dsh-client-ui-primitives")` 由 module loader 解析），但**该包没有 `.d.ts`**，只有内联在 `RUNNER:1840` 之类位置的声明注册表，类型只能靠猜。

### 样式载体的统一形态（先说结论，第 4 节给全部证据）

所有 CSS Module 都被构建成 **JS 字符串常量**，在**模块 factory 首次求值时**（不是挂载时）`document.createElement("style")` 注入 `document.head`：

```js
// CHAT:1506-1515
const tagId$11 = "@deepseek-ai/dsh-client-ui-chat/ChatView.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$11) + "]") === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-chat";
    tag.dataset.pluginCss = tagId$11;
    tag.textContent = css$11;
    document.head.appendChild(tag);
}
```

**没有** `adoptedStyleSheets` / `CSSStyleSheet` / `insertRule` / `cssText` / styled-components / Shadow DOM。

---

## 1. 消息流 DOM 结构

### 1.1 结论

**容器层级（自上而下）**

```
#root                                     ← dsh-web-frontend/dist/index.html:15  <div id="root"></div>
└ div[data-slot="root"] style="display:contents"          RENDERER:889-892
  └ div.pI_x6G_frame  style="grid-template-columns: <sidebar>px minmax(0,1fr) <rightbar>px"   LAYOUT:277-285
    ├ div.pI_x6G_sidebarCol                                             LAYOUT:292-295
    ├ div.pI_x6G_centerCol            ← ★「右侧主区」的根容器（第 6 问）  LAYOUT:107-112 / 296
    │ └ div[data-slot="main"] style="display:contents"                  RENDERER（renderSlot("main")）
    │   └ div[data-slot="main.conversation"] style="display:contents"
    │     └ div.wSkVaW_root[data-phase="active"]                        CONV:14948-14950
    │       ├ header.wSkVaW_header                                      CONV:15074  (min-height:76px)
    │       └ div.wSkVaW_body                                           CONV:14951-14953
    │         └ div.wSkVaW_scrollBody[data-conversation-scroll]         CONV:14954-14955
    │           ├ div[data-slot="conversation.session"] style="display:contents"
    │           │ └ div.wSkVaW_viewArea                                 CONV:15134-15135
    │           │   └ div[data-slot="conversation.view"] style="display:contents"   ← 渲染唯一的 active view
    │           │     └ div.EvIC1a_root                                 CHAT:2497-2498  ← ChatView 根
    │           │       ├ div.EvIC1a_scroll        ← ★真正的滚动容器     CHAT:2499-2501
    │           │       │   ├ div.eGxaPq_slot  (TurnNavigator 侧轨)      CHAT:2503 / 1626
    │           │       │   └ div.EvIC1a_column[data-chat-flow]          CHAT:2510-2513
    │           │       │       ├ div.EvIC1a_flowItem ...  ← 每行一个     CHAT:1602-1613
    │           │       │       ├ div.EvIC1a_flowItem ...
    │           │       │       ├ div.EvIC1a_turnStatus[role=status]     CHAT:2537-2540
    │           │       │       ├ div.EvIC1a_flowItem(pending steering)
    │           │       │       └ div.EvIC1a_flowItem(pending submission)
    │           │       └ div.EvIC1a_toBottomSlot > button.EvIC1a_toBottom   CHAT:2550-2566
    │           └ div.wSkVaW_composerSeat[data-composer-seat]           CONV:14942-14945  ← 输入卡片
    ├ div.pI_x6G_rightbarCol[data-rightbar-col]                         LAYOUT:122-127
    ├ div.pI_x6G_overlayLayer[data-shell-overlay]                       LAYOUT:301-305  ← ★官方 overlay 层
    └ div.pI_x6G_handle[data-side=sidebar|rightbar]                     LAYOUT:191-202
```

**关于 slot 包装元素**：`renderSlot(key, owner, opts)` 一律被 `boundRenderSlot` 包成 `<div data-slot={slotKey} style={{display:"contents"}}>`，即**对布局零影响的纯寻址锚点**：

```js
// RENDERER:284-293
return (0, react_jsx_runtime.jsx)(SlotOutlet, { slotKey: key, ownerProps: owner, opts });
// RENDERER:765-776
const ANCHOR_STYLE = { display: "contents" };
function SlotOutlet({ slotKey, ownerProps, opts }) {
    ...
    return (0, react_jsx_runtime.jsx)("div", {
        "data-slot": slotKey,
        style: ANCHOR_STYLE,
        children: renderOutletContent(host, slotKey, ownerProps, opts, useScopeBinding())
    });
}
```

### 1.2 分组：turn / step / chat node

分组是**数据层**的，不是 DOM 层：DOM 只有一维的 `.EvIC1a_column[data-chat-flow] > .EvIC1a_flowItem` 列表。

- **Chat node** = 一个 `.EvIC1a_flowItem`，带 4 个 `data-*`：

```js
// CHAT:1602-1614
return (0, react_jsx_runtime.jsx)("div", {
    ref: wrapperRef,
    className: ChatView_module_css_default.flowItem,
    "data-chat-anchor-key": routedNode.key,
    "data-chat-flow-key": routedNode.key,
    "data-chat-flow-kind": routedNode.kind,
    "data-chat-turn": turn,
    "data-turn-process-member": processMember || void 0,
    "data-turn-process-hidden": processHidden || void 0,
    "data-turn-process-answer": compactAnswer || void 0,
    children: renderSlot("conversation.chat.node", routedOwner, {
        entryKey: routedNode.kind, hookContext: turnData,
        fallback: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {...})
    })
});
```

- **turn 分组**：引擎在数据层建位置树。`TurnLocation { turn, start, end, status, steps, data }`，`StepLocation { turn, step, start, end, status, data }`：

```
// CONV/lib/types/client/contract/conversation.d.ts:66-84
export interface StepLocation {
    readonly turn: number; readonly step: number;
    readonly start: SessionEvent<'step/start'> | undefined;
    readonly end: SessionEvent<'step/end'> | undefined;
    readonly status: 'open' | 'closed' | 'unknown';
    readonly data: ConversationLocationDataStore<ConversationStepDataMap>;
}
export interface TurnLocation {
    readonly turn: number;
    readonly start: SessionEvent<'turn/start'> | undefined;
    readonly end: SessionEvent<'turn/end'> | undefined;
    readonly status: 'open' | 'closed' | 'unknown';
    readonly steps: readonly StepLocation[];
    readonly data: ConversationLocationDataStore<ConversationTurnDataMap>;
}
```

- `.EvIC1a_flowItem` 上的 `data-chat-turn` 就是 turn 分组在 DOM 上的唯一投影（`CHAT:1609`）。侧轨 TurnNavigator 靠查询它做跳转：`CHAT:1954-1961` `const row = element.closest("[data-chat-turn]")`、`for (const row of list.querySelectorAll("[data-chat-turn]"))`。

- **step 不产生任何 DOM**。`ChatNodeKind` 里没有 `step` 类型（见 1.3）。`step/start` / `step/end` 只用于给 assistant 节点做 timing 与 key：

```
// CHAT:4497-4500
timing: { stepStartTime: context.start?.event.time ?? null, firstTokenTime: state.firstTokenTime ?? null, completedTime: event.time }
```

### 1.3 `conversation.chat.node` 的 key 枚举（ChatNodeKind）

**权威列表**（`RUNNER` 的 slot 目录里 owner 的 keyDomain 字段，`RUNNER:2383` 一行给全）：

```
// RUNNER:2383
keyDomain: "fixed by the owner's key table { [Kind in ChatNodeKind]: { node: ChatNode<Kind> } },
            already taken: assistant-step, command, command-input, compaction, context, manual-compaction,
            model-retry, steering, system-prompt, tool-call, turn-error, turn-max-tokens, turn-process,
            turn-tail, unknown, user, workflow-run"
```

即 **17 个 key**，各自渲染器与注册处：

| key | 渲染组件 | 注册处 |
|---|---|---|
| `user` | `UserMessageNodeView` | `CHAT:3690-3694` |
| `steering` | `UserMessageNodeView`（同一个） | `CHAT:3695-3699` |
| `context` | `ContextMessageNodeView` | `CHAT:3700-3704` |
| `system-prompt` | `SystemPromptNodeView` | `CHAT:3705-3709` |
| `assistant-step` | `AssistantNodeView` | `CHAT:3710-3714` |
| `command` | `CommandNodeView`（子槽 `conversation.chat.commandview`） | `CHAT:3715-3724` |
| `manual-compaction` | `ManualCompactionNodeView` | `CHAT:3725-3728` |
| `compaction` | `CompactionNodeView` | `CHAT:3729-3733` |
| `model-retry` | `RetryNodeView` | `CHAT:3734-3738` |
| `turn-error` | `TurnErrorNodeView` | `CHAT:3739-3743` |
| `turn-max-tokens` | `TurnMaxTokensNodeView` | `CHAT:3744-3748` |
| `turn-process` | `TurnProcessNodeView` | `CHAT:3749-3753` |
| `turn-tail` | `TurnTailNodeView`（子槽 `conversation.chat.turnTail`） | `CHAT:3754-3769` |
| `unknown` | `UnknownNodeView` | `CHAT:3769-3773` |
| `command-input` | `GoalCommandInputView`（`client-ui-goal`） | `PKG/dsh-client-ui-goal/lib/client.js:527-529` |
| `tool-call` | `ToolCallTree`（`client-ui-tool`） | `TOOL:2368-2374` |
| `workflow-run` | `WorkflowRunPanel`（`client-ui-workflow-run`） | `PKG/dsh-client-ui-workflow-run/lib/client.js` |

slot 注册形态（`CHAT:3688-3694`）：

```js
ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
    name: "conversation.chat.node",
    key: "user",
    locale: NS
}, UserMessageNodeView));
```

**注册这个 slot 等价于「替换该 kind 的整行渲染器」**，代码库自己标了风险等级：

```
// RUNNER:2395
replaceRisk: "shadows-shipped-ui"
```

**注意**：`conversation.chat.node` 的 key 是**固定表**（`{ [Kind in ChatNodeKind]: {...} }`），第三方**不能新造 kind** —— 只能复用现有 17 个 key 之一（= 替换）。想新增「看起来像新行」的内容，只能往**已有的** kind 里塞（例如 `unknown`、`turn-tail`、或自己注册 `tool-call` 的 toolview），或者绕开这个消息流、用 `conversation.input.dock` / `shell.overlay` 之类的旁挂槽。

---

## 2. 各类内容的视觉呈现

### 通用度量（先记住这几条）

- 正文基准字号 = `var(--dsh-content-font-size, 14px)`，行高 = `calc(24px + var(--dsh-content-font-delta, 0px))`；用户设置字号范围 **12–17px**（`THEME/lib/index.js:25-28`）。
- 次级字号 = `var(--dsh-content-font-size-secondary, 13px)`。
- 所有图标尺寸、行高写成 `calc(Npx + var(--dsh-content-font-delta, 0px))`，随字号整体缩放。
- 会话内容列宽 = `var(--dsh-chat-content-width)` = `var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width,0px) * .64), 920px))`（`CONV:14652` 定义，`CONV:14815-14821` 用 ResizeObserver 写 `--dsh-conversation-column-width`）。
- **没有左侧竖线**用于普通消息行。唯一的 `border-left` 在工具**子调用**容器上（见 2.4）。

### 2.1 用户消息

| 项 | 值 | 证据 |
|---|---|---|
| 行容器 | `div.Sixlwa_userRow`，`flex-direction:column; align-items:flex-end; gap:6px` | `CHAT:155`（CSS 常量），`CHAT:1239-1242`（JSX） |
| 内层 | `div.Sixlwa_userStack`，`max-width:min(calc(var(--dsh-chat-content-width,748px) * .702), 82%)` | `CHAT:155` |
| 气泡 | `div.Sixlwa_bubble` | `CHAT:1259-1261` |
| 背景 | `var(--dsw-specific-bubble)`，light = `--dsw-static-deepseek-50`，dark = 中性蓝灰 850（`#2c2c2e`） | `THEME:1053`（别名定义） |
| 字号 / 行高 | `14px` / `calc(22px + δ)` | `CHAT:155` |
| 颜色 | `var(--dsw-alias-label-primary)` | 同上 |
| 圆角 / 内边距 | `border-radius:22px; padding:10px 16px` | 同上 |
| 空白处理 | `white-space:pre-wrap; word-break:break-word` | 同上 |
| 对齐 | 右对齐（`align-items:flex-end`） | 同上 |
| 行首元素 | **无图标、无头像、无前缀字符** | `CHAT:1239-1291` 全段 JSX |
| 附件 | `div.Sixlwa_attachmentRow > span.Sixlwa_fileCard`（240×64，`border-radius:16px`） | `CHAT:155`, `CHAT:1246-1258` |
| 引用摘要 | `div.Sixlwa_referenceSummary`（13px，`--dsw-alias-label-tertiary`） | `CHAT:155`, `CHAT:1283-1287` |
| 悬停操作行 | `div.xzv4MW_actions`，高 `calc(28px + δ)`，`@media (hover:hover)` 下默认 `opacity:0` | `CHAT:1004` |

典型文案格式：**用户原始文本逐字**（`projectUserText(text, referenceLabels, skillNames)`，`CHAT:1263`）。每条 turn 的**第一个**用户气泡前会插入一条时间戳 `span.xzv4MW_timeStart`（`--dsw-alias-label-tertiary`，`padding-right:12px`，`CHAT:1004`）。

`steering` kind 复用**完全相同**的 `UserMessageNodeView`（`CHAT:3695-3699`），仅多一个 `data-pending-steering` 属性。

### 2.2 assistant 文本消息

| 项 | 值 | 证据 |
|---|---|---|
| 根 | `div.hWmORq_root[data-streaming?]` | `CHAT:3021-3024` |
| 内容体 | `div.hWmORq_body`，`flex-direction:column; gap:16px` | `CHAT:2934` |
| 字号 / 行高 | `var(--dsh-content-font-size,14px)` / `calc(24px + δ)` | `CHAT:2934` |
| 颜色 | `var(--dsw-alias-label-primary)` | 同上 |
| 行首元素 | **无**（markdown 直接铺开，无图标/头像） | `CHAT:2967-3044` |
| 段落间距 | `gap:16px`（段落之间） | `CHAT:2934` |
| 内容渲染 | primitive `MarkdownText`（`labels` + `fileMentions` + `pathImages`） | `CHAT:2985-2991` |
| 中断标记 | `span.hWmORq_stopped`，文案 `t("message.stopped")` = `"已停止"`/`"Stopped"`，`font-size:11px;line-height:18px;border-radius:6px;padding:0 6px` | `CHAT:3029-3031`, `CHAT:2934`, `CHAT:2686` |
| 操作行 | `div.xzv4MW_actions`（复制/重试/反馈），`margin-top:16px; margin-left:-6px` | `CHAT:2934` |

Markdown 字号 token（`THEME:1059`）：

| token | 值 |
|---|---|
| `--dsw-font-markdown-h1` | `700 calc(21px + δ)/calc(30px + δ)` |
| `--dsw-font-markdown-h2` | `700 calc(19px + δ)/calc(28px + δ)` |
| `--dsw-font-markdown-h3` | `700 calc(18px + δ)/calc(26px + δ)` |
| `--dsw-font-markdown-h4` | `600 14px/calc(24px + δ)` |
| `--dsw-font-markdown-base` | `400 14px/calc(24px + δ)` |
| `--dsw-font-markdown-base-strong` | `600 14px/calc(24px + δ)` |
| `--dsw-font-markdown-table` | `400 13px/calc(22px + δ₂)` |
| `--dsw-font-markdown-code` | `400 12px/19px var(--ds-font-family-code)` |
| `--dsw-font-markdown-code-block` | `400 11px/19px var(--ds-font-family-code)` |

### 2.3 思考 / 推理（reasoning）

| 项 | 值 | 证据 |
|---|---|---|
| 根 | `div.lcKema_root[data-variant="think"][data-state="running"|"ok"][data-expanded?]` | `CHAT:2892-2895` |
| 折叠高度 | `calc(24px + δ)`（`contain:size layout`） | `CHAT:2848` |
| 行首元素 | **SVG 图标** `IconThinkOutline14 size={14}` 放在 16px leading 盒里（不是字符） | `CHAT:2899-2908` |
| 标题 | `t("message.think")` = **`"思考"` / `"Think"`** | `CHAT:2907`, `CHAT:2675` / `CHAT:2781` |
| 标题样式 | `font-size:13px; line-height:24px; color:var(--dsw-alias-label-secondary); font-weight:400` | `_title_luwio_79`（`SHELLCSS`）+ `CHAT:2848` |
| 分隔圆点 | `span.lcKema_separator` = `2×2px; border-radius:1px; background:var(--dsw-alias-label-caption); margin:0 8px` | `CHAT:2848`, `CHAT:2911` |
| 摘要 | 单行省略（`text-overflow:ellipsis`），`13px/calc(20px + δ₂)`，`var(--dsw-alias-label-tertiary)` | `CHAT:2848`, `CHAT:2912-2917` |
| 摘要文本 | **流式中取「最后一行」，结束后取「第一行」，并 `replaceAll("**","")`** | `CHAT:2890-2892` |
| 展开正文 | `div.lcKema_thinkBody`，`padding:4px 0 4px calc(22px + δ)`（**左缩进 22px**），13px/20px，`white-space:pre-wrap`，同 tertiary 色 | `CHAT:2848`, `CHAT:2926-2928` |
| 斜体 | **不是斜体**（`lcKema_*` 全表无 `font-style:italic`） | `CHAT:2848` |
| 进行中 | 行内扫光动画 + 视觉隐藏 `t("row.running")` | `CHAT:2848`, `CHAT:2896-2898` |

**「Thought for 5s」这种带时长的文案不存在**。全仓 `"Thought for"` 只有一处，且无时长：`CHAT:2790` `"message.turnProcess.thoughtForAWhile": "Thought for a while"` / `CHAT:2684` `"已思考"`，那属于 **turn-process 头部**（见 2.7），不是 reasoning 行。

### 2.4 工具调用（tool/call）

**DOM 四层**：

```js
// ① 行容器（CHAT:1602-1613，同上）
div.EvIC1a_flowItem[data-chat-flow-kind="tool-call"][data-chat-turn]
  ↓ renderSlot 包装
  div[data-slot="conversation.chat.node"][style="display:contents"]

// ② 调用树（TOOL:1475-1486）
div.ztWv_q_callRow[data-chat-anchor-key="call:<callId>"][data-chat-call-id="<callId>"]
  ↓ renderSlot("tool.call.toolview", {entryKey: toolName}, {fallback: GenericToolCard})

// ③ ToolRow 根（TOOL:1254-1258）
div.o3BgMG_root[data-variant][data-tool="<wire 名>"][data-state="running|ok|error|stopped"]
  ├ span.o3BgMG_visuallyHidden  ← 仅 running/error/stopped 时存在（"Running"/"Failed"/"Stopped"）
  ↓ DisclosureRow（SHELL:326242，minified 名 Yp）
  div._root_luwio_9
    ├ div._row_luwio_16.o3BgMG_row[data-disclosure-row][data-expandable][role=button][tabindex=0][aria-expanded]
    │   ├ span._leading_luwio_29.o3BgMG_leading     ← 16×16 盒，内置 14×14 SVG
    │   ├ span._title_luwio_79.o3BgMG_title         ← 工具显示名
    │   ├ span.o3BgMG_sep[aria-hidden]              ← 2×2 圆点
    │   ├ (button.o3BgMG_fileLink | span.o3BgMG_summary)   ← 摘要（可点击路径 vs 纯文本）
    │   └ span.o3BgMG_summarySuffix                 ← 可选尾注
    └ div.o3BgMG_bodyWrap   ← 仅在 open 时渲染（展开体：terminal/diff/read/search/web/ioCard）
```

Hover 时 leading 图标与 chevron 互切（`SHELLCSS`）：

```css
._row_luwio_16:hover ._iconIdle_luwio_57 { opacity: 0 }
._row_luwio_16:hover ._chevronHover_luwio_63 { opacity: 1 }
```

**工具名怎么显示**：显示的是**本地化显示名**，不是 wire 名。

```js
// TOOL:796-804
const VARIANT_TITLE_KEYS = {
    search: "tool.title.search", read: "tool.title.read", bash: "tool.title.bash",
    write: "tool.title.write", edit: "tool.title.edit", code: "tool.title.code",
    others: "tool.title.generic"
};
// TOOL:814-831
const TOOL_VARIANTS = {
    bash: "bash", pwsh: "bash", read: "read", read_image: "read", web_fetch: "read",
    web_search: "search", grep: "search", glob: "search",
    write: "write", edit: "edit", run_code: "code",
    cordis_package_inspect: "read", cordis_runtime_inspect: "read",
    cordis_run: "others", cordis_stop: "others", cordis_undefine: "others"
};
// TOOL:833-841
const TOOL_TITLE_KEYS = {
    cordis_package_inspect: "tool.title.inspect", cordis_runtime_inspect: "tool.title.inspect",
    cordis_run: "tool.title.runCordis", cordis_stop: "tool.title.stopCordis",
    cordis_undefine: "tool.title.removeCordis", pwsh: "tool.title.pwsh", read_image: "tool.title.readImage"
};
```

locale 默认值（`CONV:13730-13746` zh / `CONV:13892-13908` en）：

| key | zh | en |
|---|---|---|
| `tool.title.search` | 搜索 | Search |
| `tool.title.read` | 读取 | Read |
| `tool.title.bash` | **Bash** | **Bash** |
| `tool.title.write` | 写入 | Write |
| `tool.title.edit` | 编辑 | Edit |
| `tool.title.code` | 代码 | Code |
| `tool.title.generic` | 工具调用 | Tool call |
| `tool.title.grep` | Grep | Grep |
| `tool.title.glob` | Glob | Glob |
| `tool.title.webSearch` / `webFetch` | 网页搜索 / 网页获取 | Search / Fetch |
| `tool.title.readImage` | 读取图片 | Read image |
| `tool.title.pwsh` | Pwsh | Pwsh |

**未知工具的显示规则**（`TOOL:957-958`）：title 用 `tool.title.generic`（"工具调用"），wire 名被拼进 **summary**：

```js
const summary = variant === "others" && toolName !== "" && toolTitleKey === void 0 ? `${toolName} · ${base}` : base;
```

**参数怎么显示**：

- **折叠态 = 单行摘要**（无字符上限，只靠 CSS `text-overflow:ellipsis`）。
- 取值优先级（`TOOL:882-911`）：

```js
const SUMMARY_KEYS = {
    bash:   ["description", "command"],
    read:   ["path", "file_path", "url"],
    search: ["query", "pattern", "url"],
    write:  ["path", "file_path"],
    edit:   ["path", "file_path"],
    code:   ["description"],
    others: []
};
function deriveSummary(variant, argsRaw) {
    const parsed = parseArgs(argsRaw);
    if (typeof parsed !== "object" || parsed === null) return firstLine(argsRaw);   // 非法 JSON → 原文首行
    const args = parsed;
    if (variant === "search" && Array.isArray(args.queries)) {                      // web_search 多 query
        const queries = args.queries.filter((q) => typeof q === "string" && q !== "");
        if (queries.length > 0) return queries.map(firstLine).join(", ");
    }
    const picked = pickString(args, SUMMARY_KEYS[variant]);
    if (picked !== void 0) return firstLine(picked);
    for (const v of Object.values(args)) if (typeof v === "string" && v !== "") return firstLine(v);
    return firstLine(argsRaw);
}
```

- **路径显示：相对化 + `~` 缩写，不做字符截断**（`TOOL:956`）：

```js
const base = argsRaw === "" ? block.callId
           : abbreviateHomePath(relativizeToCwd(deriveSummary(variant, argsRaw), cwd), home);
```

  - `relativizeToCwd`（`TOOL:56-61`）：路径以 workspace 根开头则剥掉根 + 一个分隔符。
  - `abbreviateHomePath`（`TOOL:41-49`）：POSIX home 前缀 → `~`；Windows 路径不处理。
  - 不在 cwd 下的绝对路径**原样显示**。
  - 样例：`D:\work\a.ts`（cwd=`D:\work`）→ `a.ts`；`/home/dev/x` → `~/x`；`/etc/hosts` → `/etc/hosts`。
- **可点击路径**：`variant ∈ {read, write, edit}` 且摘要取自 `path`/`file_path` 时，摘要渲染成 `button.o3BgMG_fileLink` 而不是 span（`TOOL:912-926`, `TOOL:1279-1288`）：

```js
const FILE_PATH_KEYS = ["path", "file_path"];
const FILE_PATH_VARIANTS = new Set(["read", "write", "edit"]);
```

  CSS：`text-decoration:underline dotted; text-decoration-color:var(--dsw-alias-label-tertiary); text-underline-offset:3px; color:var(--dsw-alias-label-secondary)`。

- **展开态 = 参数 JSON**（`TOOL:933-942`）：`run_code` 只显示 `code` 字段，`code` variant 走 `CodeBlock`；其余 `JSON.stringify(parsed, null, 2)`（2 空格缩进）放进 `bodyScroll`（`max-height:260px`）或 `ioCard`。

- **bash 展开后的提示符列**（`SHELL:468528`，`TerminalBlock`）：

```js
F.map((V, ie) => d.jsxs("div", { className: i1.promptLine, children: [
    ie === 0 && d.jsx(O6, { state: Q.state, className: i1.runState }),
    d.jsx("span", { className: i1.cwd, children: ie > 0 || r === void 0 ? "$" : xm(r, i) }),
    d.jsx("span", { className: i1.command, children: V })
]}))
// xm: 目录只取 basename；等于 home 根 → "~"
```

**行首元素**：**SVG 图标组件**，全部 `fill="currentColor"`，`size={14}` 装在 16×16 的 leading 盒里。**没有 ASCII 前缀、没有 `●`/`⏺`/`>`、没有头像。**

```js
// TOOL:1390-1399（注释原文："all glyphs render at 14 inside the 16px leading box"）
const VARIANT_ICONS = {
    search: jsx(IconSearchOutline16, { size: 14 }),
    read:   jsx(IconBrowseOutline16, { size: 14 }),
    bash:   jsx(IconApiOutline14,    { size: 14 }),
    write:  jsx(IconEditOutline16,   { size: 14 }),
    edit:   jsx(IconEditOutline16,   { size: 14 }),
    code:   jsx(IconCodeOutline16,   { size: 14 }),
    others: jsx(IconSparkle16,       { size: 14 })
};
// TOOL:1188-1194
function leadingFor$1(state, icon) {
    switch (state) {
        case "error":   return jsx(StateDot, { state: "error"   });   // 红点
        case "stopped": return jsx(StateDot, { state: "warning" });   // 黄点
        default:        return icon;                                  // 变体图标
    }
}
```

`StateDot`（`SHELL:221311`）的 DOM 与 CSS：

```js
function O6({ state: t, size: r = 10, className: i }) {
    return t === "ongoing"
      ? jsx("svg", { className: Ce(q0.matrix, i), "data-state": "ongoing", width: r, height: r, viewBox: "0 0 10 10", ... })
      : jsx("span", { className: Ce(q0.dot, i), "data-state": t, style: { width: r, height: r }, "aria-hidden": "true" });
}
```
```css
/* SHELLCSS */
._dot_1tljr_3{position:relative;display:inline-block;flex:none}
._dot_1tljr_3:before{content:"";position:absolute;inset:0;border-radius:50%;corner-shape:round;background:currentColor;opacity:.1}
._dot_1tljr_3:after{content:"";position:absolute;inset:20%;border-radius:50%;corner-shape:round;background:currentColor}
._dot_1tljr_3[data-state=done]{color:var(--dsw-alias-state-success-primary)}
._dot_1tljr_3[data-state=warning]{color:var(--dsw-alias-state-warn-primary)}
._dot_1tljr_3[data-state=error]{color:var(--dsw-alias-state-error-primary)}
._dot_1tljr_3[data-state=idle]{color:var(--dsw-alias-label-tertiary)}
```

**子调用缩进（唯一的左侧竖线）**——`TOOL:1500-1502` + `TOOL:1432`：

```js
children: block.subCalls.length > 0
  ? jsx("div", { className: ToolCallTree_module_css_default.subCalls, "data-subcalls": true, children: ... })
  : null
```
```css
.ztWv_q_subCalls{border-left:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:4px;
                 margin:4px 0 2px 22px;padding-left:8px;display:flex}
.ztWv_q_callRow{border-radius:6px}
```

### 2.5 工具结果（tool/result）

结果**不是独立一行**——它和调用共享同一个 `tool-call` 行（`ToolChatData { root: ToolCallBlock }`，`dsh-client-ui-chat/lib/types/client/contract/chat-nodes.d.ts:36-38`；`isSettledTool` / `isRunningTool` 同文件 `:89-99`）。结果只改变同一个 `ToolRow` 的 `data-state`、摘要、与展开体。

| 状态 | `data-state` | 行首 | 摘要色 | 可见文案 |
|---|---|---|---|---|
| 成功 | `ok` | 变体图标（继承 `--dsw-alias-label-tertiary`） | `--dsw-alias-label-tertiary` | **无** |
| 运行 | `running` | 变体图标 + 扫光 | 同上 | 视觉隐藏 `Running` / `运行中` |
| 失败 | `error` | `StateDot state="error"`（红点） | `--dsw-alias-state-error-primary` | 摘要**变成结果首行**；视觉隐藏 `Failed` / `失败` |
| 中断 | `stopped` | `StateDot state="warning"`（黄点） | 正常摘要色 | 视觉隐藏 `Stopped` / `已停止` |

```js
// TOOL:955   状态判定（interrupted 特殊降级为 stopped）
const state = !done ? "running" : block.error?.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";
// TOOL:960   错误摘要 = 结果首行
const errorSummary = state === "error" && output !== null ? firstLine(output) : null;
// TOOL:1231-1235
const status = stateStatus$1(state, t);
const failureLine = state === "error" ? errorSummary ?? null : null;
const summaryText = failureLine ?? terminalBody?.description ?? summary;
// TOOL:1407   bash 非零退出码把 ok 升格为 error（折叠态唯一的失败信号）
const state = model.state === "ok" && terminal !== null && terminalFailed(terminal) ? "error" : model.state;
// TOOL:1199-1206
function stateStatus$1(state, t) {
    switch (state) { case "running": return t("row.running");
                     case "error":   return t("row.failed");
                     case "stopped": return t("row.stopped");
                     default: return null; }
}
```

locale：`row.running` / `row.failed` / `row.stopped` = `运行中/失败/已停止`（`CONV:13724-13726`）↔ `Running/Failed/Stopped`（`CONV:13886-13888`）。

**长内容截断**

| 位置 | 机制 | 文案 |
|---|---|---|
| 折叠摘要 | **仅 CSS** `text-overflow:ellipsis`，无字符上限 | 无 |
| IO 文本（ioText） | `max-height:150px` + `overflow-y:auto` | 无 |
| code 参数体（bodyScroll） | `max-height:260px` 滚动 | 无 |
| DiffBlock / ReadBlock / SearchBlock | React prop `maxLines: 8`（`TOOL:1304/1309/1331`），首尾各半 | `… {n} more lines` / `… 其余 {n} 行` |
| TerminalBlock（行内） | `maxLines: Infinity`，CSS `--dsl-terminal-output-max-height:224px` + 滚动 | — |
| 未知内容块（JsonBlock） | **20000 字符**：`CHAT:300 const MAX_CHARS = 2e4;` + `CHAT:336` | `… truncated, {total} characters total` / `… 已截断，共 {total} 字符` |
| Host 侧 spill | 结果尾部 notice，`hasSpillNotice` 识别（`TOOL:425-463`） | `Omitted N bytes. Full formatted result stored at: <path>` |

```js
// CHAT:300 / CHAT:336
const MAX_CHARS = 2e4;
function boundedText(text, t) {
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n${t("json.truncated", { total: text.length })}` : text;
}
```

**尾注（这个必须说清楚，因为很容易编错）**

- **没有字面 `"ok"` 尾注**。成功态只靠中性的变体图标 + tertiary 文字色表达。
- **工具行没有任何 per-call 毫秒耗时**。`tool/call` / `tool/result` 的 payload 里也没有耗时字段（见第 5 问）；客户端是拿 `event.time` 相减推导 turn/LLM 级耗时，**工具级耗时只进 TokenUsagePanel，不进行内**。
- 实际存在的尾注：
  - **diff 统计** `+N -M`（`TOOL:1234-1239`）：`span.o3BgMG_summarySuffix.o3BgMG_diffStat`，`font-family:var(--ds-font-family-code); font-size:calc(13px - 2px); color:var(--dsw-alias-label-caption); margin-left:10px`。
  - **todo 的 `+N`**（`TOOL:1290`）。
  - **退出码 pill**（仅失败）：`signal {signal}` / `exit code {code}`（`CONV:13783-13784` ↔ `13945-13946`）；TerminalBlock 里 `$!==void 0 && jsx(D6,{className:i1.status,children:$})`，CSS 色 `var(--dsw-alias-state-error-primary)`。
  - **diff 页脚**：`"└ +" + added + " -" + removed + " · " + files`（`SHELL:479341`）；`diff.files.one/other` = `{count} 个文件` / `{count} file(s)`（`CONV:13747-13748`/`13909-13910`）。
  - **读文件行数**：`read.window` = `显示 {shown} / {total} 行` / `Showing {shown} of {total} lines`（`CONV:13752`/`13914`）。
  - **搜索结果统计**：`search.matches` = `{shown} 处匹配 · {files} 个文件` / `{shown} matches · {files} files`（`CONV:13756-13760`/`13918-13922`）。
  - **IO 区标签**：`row.input` / `row.output` = `输入`/`输出` ↔ **`IN`/`OUT`**（`CONV:13727-13728`/`13889-13890`）。
  - **turn 级耗时**（在 turn-tail，不在工具行）：`message.ranFor` = `用时 {duration}` / `Ran for {duration}`（`CHAT:3575`），`formatRunDuration`（`CHAT:930-938`）→ `12s` / `1m 05s`。
- **`"Ran 3 commands in 1.2s"` 形式文案不存在**（已 grep `"Ran "`，无命中）。

### 2.6 todo / write

**没有 `dsh-client-ui-todo` 包**（`PKG/` 下不存在；只有 Host 侧 `dsh-tool-todo`）。todo 的 UI 分两处：

**(a) 对话内的 `todo_write` 工具行**（keyed toolview，key `"todo_write"`，`TOOL:2298-2309`）

```js
function TodoRow({ toolName, block, inspect, t }) {
    const model = toolRowModel(toolName, block);
    const summary = summarize(("kind" in block ? block.call?.argsRaw : block.argsRaw) ?? "", t)
                    ?? { text: model.summary, extra: 0 };
    return jsx(ToolRow, {
        t, variant: model.variant, toolName,
        icon: jsx(IconChecklistOutline14, {}),
        title: t("todo.rowTitle"),                       // "更新任务清单" / "Update to-do list"
        summary: summary.text,                           // "3/7 已完成 · 修复登录超时"
        summarySuffix: summary.extra > 0 ? `+${summary.extra}` : null,   // 并行进行中额外计数
        bodyRaw: model.bodyRaw, output: model.output, errorSummary: model.errorSummary,
        state: model.state, inspect
    });
}
```

摘要格式（`TOOL:2252-2274`）：`t("todo.completed", {done,total})` 即 `"{done}/{total} 已完成"`，若有 `in_progress` 项则追加 `" · " + 第一个 in_progress 的 content`。

locale：`todo.completed` = `{done}/{total} 已完成` / `{done}/{total} completed`（`CONV:13711`/`13873`）。
行结构完全复用 ToolRow（`data-variant="others"`、`data-tool="todo_write"`）。

**(b) 输入框上方的 Todo 面板**（`CONV:16292-16449`）：`section.lXshSW_root[data-testid=todo-panel]` > header button + `ul > li[data-status="completed|in_progress|pending"]`，三种字形分别是实心圆+对勾（`--dsw-alias-state-success-primary`）、渐隐圆环 + `1s linear infinite` 旋转（`--dsw-alias-state-business-primary`）、虚线圆环（`--dsw-alias-label-caption`）。CSS 在 `CONV:16265`。

**`write` / `edit`**：`FileMutationRow` + `fileMutationToolview`，注册 key `"edit"` 与 `"write"`（`TOOL:1869-1910`）。图标 `IconEditOutline16 size={14}`，标题 `写入`/`编辑`，摘要 = 相对路径且渲染为 `button.o3BgMG_fileLink`，展开体 = `DiffBlock maxLines:8`。

### 2.7 turn-process / turn-tail / step/start / step/end

- **`step/start` 与 `step/end` 什么都不渲染**。`ChatNodeKind` 无 `step` 项（第 1.3 节），DOM 里也没有任何对应元素。它们只进入 `StepLocation { start, end, status }` 供 timing 计算（`CONV/.../conversation.d.ts:66-74`，`CHAT:4497-4500`）。
- **turn-process**（`TurnProcessNodeView`，`CHAT:3277-3303`）：`button.l_V-RG_root[data-open][data-turn-process][data-turn-process-messages][data-turn-process-tool-calls][data-turn-process-subagents][aria-expanded]`，高 `33px`，`border-bottom:.5px solid var(--dsw-alias-border-l2)`，尾部 `IconChevronDownOutline14`（`transform:rotate(-90deg)` → open 时 `0`）。文案由计数拼成：`{count} 次工具调用` / `{count} tool call` 等，用 `" · "`（`message.turnProcess.separator`）连接；全空时用 `已思考` / `Thought for a while`（`CHAT:2684`/`2790`）。
- **turn-tail**（`TurnTailNodeView`，`CHAT:3637+`）：`.TS9iAW_root{gap:16px}`，装操作行与 `TokenUsagePanel`。
- **compaction**（`compaction` / `manual-compaction`）：`div.Sixlwa_compactionRow`，高 `calc(24px + δ)` 的 `button.Sixlwa_compactionButton`，leading 16×16 + 标题（`--dsw-alias-label-primary-dimmed`）+ 2×2 圆点 + 单行摘要（`--dsw-alias-label-tertiary`）。
- **model-retry**（`RetryNodeView`）：`div.Sixlwa_retryRow[data-active]`，摘要 `div.Sixlwa_retrySummary` 用 CSS 三角 `border-bottom/right 1.5px + rotate(-45deg)` 做 discloser，active 时文字有 `1.6s ease-in-out infinite` shimmer。

### 2.8 审批（approval）

**审批不是消息流里的一行，而是 composer 接管面板**（注册进 `conversation.composer`，`priority:1`，`APPR:272-281`）。

```js
// APPR:55-99
div.mna1RW_root[data-approval-key="approval:<n>"]
  └ div.mna1RW_card
     ├ div.mna1RW_strip
     │  ├ span.mna1RW_dot                       ← 8×8 圆点
     │  └ t("waiting")                          ← "等待审批" / "Waiting for approval"
     ├ div.mna1RW_body[data-approval-scroll][tabindex=0][role=group][aria-label=t("detail.aria")]
     │  ├ div.mna1RW_headline                    ← pending.reason ?? t("escalation",{toolName})
     │  └ div.mna1RW_command                     ← 可选 detail 槽（等宽字体）
     └ div.mna1RW_actionRow
        ├ Button(variant=outline).mna1RW_reject  t("reject")      "拒绝" / "Reject"
        └ Button(variant=primary)                t("allowOnce")   "允许一次" / "Allow once"
```

```css
/* APPR:11 */
.mna1RW_card{width:100%;max-width:var(--dsh-chat-content-width);border:1px solid var(--dsw-alias-state-warn-secondary);
  background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);border-radius:20px;overflow:hidden}
.mna1RW_strip{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);
  align-items:center;gap:8px;padding:10px 16px;font-size:13px;line-height:18px;display:flex}
.mna1RW_dot{corner-shape:round;background:var(--dsw-alias-state-warn-primary);border-radius:50%;width:8px;height:8px}
.mna1RW_headline{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:24px}
.mna1RW_command{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);word-break:break-all;font-size:13px;line-height:20px}
```

locale（`APPR:209-223`）：zh `{waiting:"等待审批", "detail.aria":"审批详情", escalation:"工具 {toolName} 请求越权执行", reject:"拒绝", allowOnce:"允许一次"}`。

可选详情槽：`conversation.approval.detail`（single/session，owner `{callId}`），由 `APPR:43` 消费。

---

## 3. 流式表现

### 3.1 结论速表

| 问题 | 答案 | 证据 |
|---|---|---|
| 逐字出现？ | **是**，但是**整块重渲染**，不是 DOM 文本节点 append | `SHELL:504314` `MarkdownText` |
| 有光标吗？ | **没有**。全仓无 caret / blink / `data-streaming` 样式 | 见 3.2 |
| 有「正在…」指示器？ | **有**，在消息列**末尾**：`div.EvIC1a_turnStatus` | `CHAT:2036-2061` |
| 动画？ | 文字流光 `1.8s linear infinite`；工具/思考行 300px 扫光 `2.6s ease-out infinite` | `CHAT:1508`, `TOOL:1144`, `CHAT:2848` |

### 3.2 无光标（明确否定，附搜索证据）

对 `SHELL` / `SHELLCSS` / `CHAT` / `CONV` / `TOOL` 搜索以下全部 **0 命中**：
`data-streaming`（在 CSS 选择器里）、`_caret`、`streaming-cursor`、`_cursor`、`cursor-blink`、`caret-blink`、`@keyframes * blink`。

`AssistantMarkdown` 在流式时唯一的变化是根节点多了 `data-streaming` 属性，**样式表里没有针对它的规则**：

```js
// CHAT:3021-3026
return jsx("div", {
    className: AssistantMarkdown_module_css_default.root,
    "data-streaming": streaming || void 0,
    children: jsxs("div", { className: AssistantMarkdown_module_css_default.body, children: [rendered, ...] })
});
```

`MarkdownText` 流式分支只做增量重渲染（`SHELL:504314`）：

```js
const w8 = I.memo(function ({ text: r, streaming: i = !1, labels: s, fileMentions: a, pathImages: c }) {
    ...
    const m = I.useMemo(() => i ? (h.current ??= ...).render(r) : (h.current = null, Tg(r, s, a, c)), [r, i, s, a, c]);
    return d.jsx("div", { className: lt.markdown, children: m });
});
```

### 3.3 「正在生成」指示器：TurnStatus

```js
// CHAT:2036-2061
function TurnStatus({ startTime, t }) {
    const [mountedAt] = (0, react.useState)(() => Date.now());
    const anchor = startTime ?? mountedAt;
    const [elapsedMs, setElapsedMs] = (0, react.useState)(() => Math.max(0, Date.now() - anchor));
    (0, react.useEffect)(() => {
        const tick = () => { setElapsedMs(Math.max(0, Date.now() - anchor)); };
        tick();
        const id = setInterval(tick, 1e3);
        return () => { clearInterval(id); };
    }, [anchor]);
    const showClock = elapsedMs >= 15e3;
    return jsxs("div", {
        className: ChatView_module_css_default.turnStatus,
        role: "status",
        "aria-live": "polite",
        children: [t("chat.deepDiving"), showClock && jsx("span", {
            className: ChatView_module_css_default.turnStatusClock,
            "aria-hidden": true,
            children: formatRunDuration(elapsedMs, t)
        })]
    });
}
```

- 文案：`t("chat.deepDiving")` = **`"深度求索中..."`**（`CHAT:2641`）/ **`"Deep diving..."`**（`CHAT:2747`）。
- 位置：`EvIC1a_column` 的最后一个子元素，紧跟 `ChatNodeList` 之后（`CHAT:2537-2540`）。
- 计时：**只在 elapsed ≥ 15000ms 后出现**，每秒 tick，`formatRunDuration` 格式（`CHAT:930-938`）→ `12s` / `1m 05s`。
- 样式（`CHAT:1508`）：`height:calc(26px + δ)`，`background:linear-gradient(...)` + `background-clip:text` + `-webkit-text-fill-color:transparent` + `animation:1.8s linear infinite EvIC1a_dsh-turn-status-shimmer`。

### 3.4 行内扫光（运行中的工具行 / 思考行 / 命令卡）

四处**完全同构**：一条 300px 宽的渐变从 `left:-300px` 扫到 `left:100%`，`2.6s ease-out infinite`，且都带 `prefers-reduced-motion` 关停。

| 模块 | 选择器 | keyframes | 证据 |
|---|---|---|---|
| ToolRow | `.o3BgMG_root[data-state=running] .o3BgMG_row:after` | `o3BgMG_dsh-tool-row-sweep` | `TOOL:1144` |
| bash 独立行 | `.CY-8Ka_root[data-state=running]:after` | `CY-8Ka_dsh-bash-row-sweep` | `TOOL:1697` |
| ReasoningRow | `.lcKema_root[data-state=running] .lcKema_row:after` | `lcKema_dsh-reasoning-row-sweep` | `CHAT:2848` |
| GenericCommandCard | `._5OnbHa_root[data-state=running] ._5OnbHa_row:after` | `_5OnbHa_dsh-command-row-sweep` | `CHAT:3082` |

```css
/* TOOL:1144 */
.o3BgMG_root[data-state=running] .o3BgMG_row:after{
  content:"";background:linear-gradient(90deg, transparent 0%,
    color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
  pointer-events:none;width:300px;animation:2.6s ease-out infinite o3BgMG_dsh-tool-row-sweep;
  position:absolute;top:0;bottom:0;left:0}
@keyframes o3BgMG_dsh-tool-row-sweep{0%{left:-300px}90%,to{left:100%}}
```

### 3.5 增量数据是怎么来的

三层，别混：

**(1) 传输层帧**（host→browser，非 SessionEvent）

```ts
// CTRL 同级：dsh-api-session-controller/lib/types/types.d.ts:441-468
export type SessionAssistantStreamFrame =
  | { type:'start'; attemptId: LlmAttemptId; revision: number; startedAfterSeq: SessionSeqCursor; turn: number; step: number }
  | { type:'chunk'; attemptId; revision; index: number; time: number; chunk: JsonValue }
  | { type:'end';   attemptId; revision; index: number;
      outcome: { kind:'committed'; eventType:'assistant/message'|'assistant/attempt'; seq: number } | { kind:'abandoned' } };
```

**(2) 客户端专有增量事件 `assistant/live-chunk`** —— 以 `type:'transient'` 的 entry 进入 eventSource window，**不在 durable 日志**：

```ts
// PKG/dsh-api-session-controller/lib/types/client/contract/events.d.ts:6-16
export interface AssistantLiveChunkEvent {
    readonly type: 'assistant/live-chunk';
    readonly seq: number;          // 分数序号：durableCursor + 1 - 1/(transientInGap+1)
    readonly time: number;
    readonly data: { readonly attemptId: LlmAttemptId; readonly turn: number; readonly step: number; readonly chunk: StreamChunk };
}
```
```js
// PKG/dsh-api-session-controller/lib/client/sessions/assistant-stream.js:55-70 / 100-122
seq: this.durableCursor + 1 - 1 / (this.transientInGap + 1),
time: member.time,
data: { attemptId: opening.attemptId, turn: opening.turn, step: opening.step, chunk: member.chunk },
```

**(3) 客户端把 chunk 累加成 block 数组**

```js
// CHAT:4395-4466
function updateChunk(state, chunk, seq, time) {
    const blocks = [...state.blocks];
    switch (chunk.type) {
        case "block-start":  blocks[chunk.index] = emptyAssistantBlock(chunk.blockType); break;
        case "text-delta":   blocks[chunk.index] = { kind:"text", text:(prev?.text ?? "") + chunk.text }; break;
        case "reasoning-delta": blocks[chunk.index] = { kind:"reasoning", text:(prev?.text ?? "") + chunk.text }; break;
        case "tool-call-delta": blocks[chunk.index] = { kind:"tool-call", callId: base.callId || String(chunk.id),
                                                        name: chunk.name ?? base.name, argsRaw: base.argsRaw + chunk.argumentsDelta }; break;
        case "block-end":    blocks[chunk.index] = toAssistantBlock(chunk.block); break;
        case "usage":        return { ...state, usage: chunk.usage };
        default: return state;
    }
    ...
}
```

`AssistantChatData.status` 的三态就是 `'running' | 'settled' | 'interrupted'`（`dsh-client-ui-chat/lib/types/client/contract/chat-nodes.d.ts:22-30`），`AssistantNodeView` 直接把它映射成 `streaming` / `interrupted`：

```js
// CHAT:3046-3099
return jsx(AssistantMarkdown, {
    blocks: data.blocks,
    streaming: data.status === "running",
    interrupted: data.status === "interrupted",
    ...
});
```

---

## 4. 样式清单

### 4.1 CSS 变量

**定义真源只有一个包**：`THEME/lib/client.js` 的 6 张 CSS 字符串，常量表在 `THEME:1066-1073`：

```js
const STYLES = [
    ["base.css", base_css_default],
    ["corner-shape.css", corner_shape_css_default],
    ["design-platform.css", design_platform_css_default],
    ["scrollbar.css", scrollbar_css_default],
    ["gradient-shadow-text.css", gradient_shadow_text_css_default],
    ["shiki.css", shiki_css_default]
];
```

| 变量族 | 定义行 | 默认值 |
|---|---|---|
| `--dsw-font-family` | `THEME:1047` | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif` |
| `--ds-font-family-code` | `THEME:1047` | `"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"` |
| `--ds-ease-in-out` / `--ds-transition-duration{,-fast,-slow}` | `THEME:1047` | `cubic-bezier(.4,0,.2,1)` / `.2s` `.1s` `.3s` |
| `--dsw-corner-shape` | `THEME:1050` | `superellipse(1.5)`（`@supports` 内） |
| `--dsw-static-*`（约 120 个色阶） | `THEME:1053` | light+dark 各一套 |
| `--dsw-alias-*`（约 80 个语义别名） | `THEME:1053` | e.g. `--dsw-alias-label-primary:var(--dsw-static-neutral-bluish-1000)` |
| `--dsw-specific-*` | `THEME:1053` | `--dsw-specific-bubble:var(--dsw-static-deepseek-50)`、`--dsw-specific-sidebar-fill` |
| `--dsw-shadow-lv1/lv2/lv3`、`--dsw-elevation-*`、`--dsw-mask-blur` | `THEME:1059` | `--dsw-shadow-lv1:0 2px 4px 0 #0000000d` |
| `--dsh-scrollbar-thumb{,-hover}`、`--dsh-scrollbar-width` | `THEME:1056` | `var(--dsw-alias-scrollbar-bg-l1)`、`8px` |
| `--dsh-content-font-size{,-secondary}`、`--dsh-content-font-delta{,-secondary}` | `THEME:1059` | `--dsh-content-font-delta:calc(var(--dsh-content-font-size,14px) - 14px)`；`--dsh-content-font-size-secondary:min(calc(...-1px), max(13px, calc(...-2px)))` |
| `--dsw-font-markdown-*` | `THEME:1059` | 见 2.2 |
| `--dsw-font-{xl-24,l-20,m-18,base-16,base-strong-16,s-14,s-strong-14,xs-13,xs-strong-13,xxs-12,xxs-strong-12,xxxs-11,xxxs-strong-11}` | `THEME:1059` | `--dsw-font-s-14:14px/22px var(--dsw-font-family)` |
| `--shiki-*`（12 个） | `THEME:1062` | `--shiki-background:var(--dsw-alias-markdown-code-block)` |

设计 token 字号表（`THEME:1059`，格式 `font: weight size/line-height family`）：

| token | 值 |
|---|---|
| `--dsw-font-xl-24` | `600 24px/32px` |
| `--dsw-font-l-20` | `500 20px/28px` |
| `--dsw-font-m-18` | `500 16px/28px`（名不副实，实际 16px） |
| `--dsw-font-base-16` / `-strong-16` | `400 / 500 16px/24px` |
| `--dsw-font-s-14` / `-strong-14` | `400 / 500 14px/22px` |
| `--dsw-font-xs-13` / `-strong-13` | `400 / 500 13px/20px` |
| `--dsw-font-xxs-12` / `-strong-12` | `400 / 500 12px/18px` |
| `--dsw-font-xxxs-11` / `-strong-11` | `400 / 500 11px/14px` |

**不存在 `--dsw-radius-*` / `--dsw-space-*` / `--dsw-size-*` 变量族** —— 圆角与间距全部是字面量。chat 包的圆角取值集合 = `{1px, 6px, 8px, 12px, 14px, 22px, 24px, 28px, 100px, 999px}`。

**布局变量的动态赋值点**（不是写死在 CSS，而是 ResizeObserver 写 inline style）：

```js
// CONV:14801-14811
seatObserver.current = new ResizeObserver(() => {
    scroller.style.setProperty("--dsh-composer-height", `${seat.offsetHeight}px`);
    scroller.style.setProperty("--dsh-conversation-viewport-height", `${scroller.clientHeight}px`);
});
// CONV:14815-14821
root.style.setProperty("--dsh-conversation-column-width", `${column}px`);
root.style.setProperty("--dsh-chat-user-width", `${resolveContentWidth(column, preference)}px`);
```

`--dsh-content-font-size` 由 host 注入 HTML 的内联 script 写死（`THEME/lib/index.js:46-47`），schema `z.number().step(1).min(12).max(17).default(14)`（`THEME/lib/index.js:25-28`）；插件树激活后由 `ThemePresenter` 接管：

```js
// LAYOUT:443-481
const DARK_ATTRIBUTE = "data-ds-dark-theme";
const CONTENT_FONT_SIZE_VARIABLE = "--dsh-content-font-size";
apply(snapshot) {
    document.documentElement.style.colorScheme = snapshot.active.colorScheme;
    const body = document.body;
    if (snapshot.active.colorScheme === "dark") body.setAttribute(DARK_ATTRIBUTE, ""); else body.removeAttribute(DARK_ATTRIBUTE);
    body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`);
    for (const name of this.appliedTokens) body.style.removeProperty(name);
    this.appliedTokens = [];
    for (const [name, value] of Object.entries(snapshot.active.tokens)) { body.style.setProperty(name, value); this.appliedTokens.push(name); }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
}
```

**关键：全部 `--dsw-*` token 是写在 `document.body` 的 inline style 上的**，所以只要你的元素在 body 子树里（一定在），`var(--dsw-*)` 就能解析。

**悬空变量（有使用、无定义）**：`--dsw-alias-separator-primary`（仅 `CHAT:3842`，全域无定义）、`--dsw-font-sm-13`（仅 `TOOL:1144`，全域无定义）。这两个 `var()` 会失效回退 initial，**不要照抄**。

### 4.2 消息流关键选择器的完整规格

```css
/* ============ 会话根（CONV:14652，ConversationRoot.module.css） ============ */
.wSkVaW_root{background:var(--dsw-alias-bg-base);
  --dsh-chat-content-width:var(--dsh-chat-user-width,clamp(680px, calc(var(--dsh-conversation-column-width,0px) * .64), 920px));
  --dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);
  --dsh-composer-side-clearance:16px; --dsh-composer-dock-inset:8px;
  flex-direction:column;min-width:0;height:100%;display:flex;position:relative}
.wSkVaW_header{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;min-height:76px;padding:10px 28px 0 20px}
.wSkVaW_headerHidden{display:none}
.wSkVaW_tabs{gap:36px;margin-top:10px;padding-left:8px;display:flex;position:relative}
.wSkVaW_tab{color:var(--dsw-alias-label-tertiary);padding:0 0 9px;font-size:13px;font-weight:500;line-height:16px}
.wSkVaW_tab:after{content:"";background:0 0;border-radius:2px;height:2px;position:absolute;bottom:-1px;left:0;right:0}
.wSkVaW_viewArea{flex-direction:column;flex:1;min-height:0;display:flex}
.wSkVaW_composerStack{--dsh-composer-stack-gap:6px;gap:var(--dsh-composer-stack-gap);flex-direction:column;display:flex}
.wSkVaW_composerSeat{--dsh-composer-text-max-height:336px;flex-direction:column;flex:none;display:flex}
.wSkVaW_body{flex-direction:column;flex:1;min-height:0;display:flex;position:relative}
.wSkVaW_scrollBody{scrollbar-gutter:stable;flex-direction:column;flex:1;min-height:0;margin-right:2px;display:flex;overflow-y:auto}
.wSkVaW_root[data-phase=active] .wSkVaW_composerSeat{z-index:7;
  background:linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px);
  position:sticky;bottom:0}

/* ============ 消息列（CHAT:1508，ChatView.module.css） ============ */
.EvIC1a_root{flex-direction:column;flex:auto;min-height:0;display:flex;position:relative}
.EvIC1a_scroll{min-height:0;padding:16px calc(var(--dsh-composer-side-clearance) + 16px);flex:auto;overflow-y:auto;container-type:inline-size}
.EvIC1a_column{max-width:var(--dsh-chat-content-width);flex-direction:column;width:100%;margin:0 auto;display:flex}
.EvIC1a_column>:not([hidden]):not(.EvIC1a_flowItem:empty)~:not([hidden]):not(.EvIC1a_flowItem:empty){margin-top:var(--dsh-chat-flow-gap,16px)}
.EvIC1a_flowItem{min-width:0}
.EvIC1a_flowItem[data-turn-process-answer]{--dsh-chat-flow-gap:8px}
.EvIC1a_flowItem:empty{display:none}
.EvIC1a_callRow{border-radius:6px}
.EvIC1a_turnStatus{height:calc(26px + var(--dsh-content-font-delta,0px));font:var(--dsw-font-s-strong-14);
  font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:nowrap;
  background:linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%,
    var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%);
  color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;
  -webkit-background-clip:text;background-clip:text;flex:none;align-self:flex-start;align-items:center;
  animation:1.8s linear infinite EvIC1a_dsh-turn-status-shimmer;display:inline-flex}
.EvIC1a_turnStatusClock{font:var(--dsw-font-xs-13);font-size:var(--dsh-content-font-size-secondary,13px);
  line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption);margin-left:8px;font-weight:400}
@keyframes EvIC1a_dsh-turn-status-shimmer{to{background-position:0 0}}
.EvIC1a_toBottomSlot{z-index:8;height:0;padding-right:max(0px, calc((100% - var(--dsh-chat-content-width)) / 2));
  pointer-events:none;justify-content:flex-end;display:flex;position:sticky;bottom:16px}
.EvIC1a_toBottom{--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);corner-shape:round;width:34px;height:34px;
  background:var(--dsw-alias-button-floating-fill);box-shadow:var(--dsw-elevation-panel);border:0;border-radius:100px;
  margin-top:-34px;padding:0;display:flex}

/* ============ 工具行（TOOL:1144，ToolRow.module.css） ============ */
.o3BgMG_root{flex-direction:column;display:flex}
.o3BgMG_row{position:relative;overflow:hidden}
.o3BgMG_leading{flex-shrink:0}
.o3BgMG_title{font-weight:400}
.o3BgMG_sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}
.o3BgMG_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;
  font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));
  color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}
.o3BgMG_summarySuffix{white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);
  line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);flex:none;margin-left:4px}
.o3BgMG_errorSummary{color:var(--dsw-alias-state-error-primary)}
.o3BgMG_bodyScroll{max-height:260px;overflow-y:auto}

/* ============ 工具调用树（TOOL:1432） ============ */
.ztWv_q_callRow{border-radius:6px}
.ztWv_q_subCalls{border-left:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:4px;
  margin:4px 0 2px 22px;padding-left:8px;display:flex}

/* ============ DisclosureRow（primitives，SHELLCSS） ============ */
._root_luwio_9{display:flex;flex-direction:column;width:100%;min-width:0}
._row_luwio_16{position:relative;overflow:hidden;display:flex;align-items:center;
  height:calc(24px + var(--dsh-content-font-delta, 0px));min-width:0}
._row_luwio_16[data-expandable]{cursor:pointer}
._leading_luwio_29{position:relative;flex:none;width:calc(16px + var(--dsh-content-font-delta, 0px));
  height:calc(16px + var(--dsh-content-font-delta, 0px));display:inline-flex;align-items:center;justify-content:center;
  margin-right:6px;padding:0;border:none;background:none;color:var(--dsw-alias-label-tertiary)}
._leading_luwio_29 svg:not([data-state]){width:calc(14px + var(--dsh-content-font-delta, 0px));
  height:calc(14px + var(--dsh-content-font-delta, 0px))}
button._leading_luwio_29{cursor:pointer}
._title_luwio_79{flex:none;font-size:var(--dsh-content-font-size-secondary, 13px);
  line-height:calc(24px + var(--dsh-content-font-delta, 0px));color:var(--dsw-alias-label-secondary)}
._iconIdle_luwio_57{display:inline-flex;opacity:1;transition:opacity .1s ease}
._chevronHover_luwio_63{position:absolute;inset:0;margin:auto;opacity:0;transition:opacity .1s ease}
._row_luwio_16:hover ._iconIdle_luwio_57{opacity:0}
._row_luwio_16:hover ._chevronHover_luwio_63{opacity:1}

/* ============ 输入卡片（CONV:15757，InputBar.module.css） ============ */
.uV2eYG_root{padding:0 var(--dsh-composer-side-clearance) 8px;flex-direction:column;align-items:center;display:flex}
.uV2eYG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);
  box-shadow:var(--dsw-elevation-soft);font-size:var(--dsh-content-font-size,14px);
  line-height:calc(24px + var(--dsh-content-font-delta,0px));border:0;border-radius:22px;
  flex-direction:column;gap:12px;padding-top:8px;display:flex;position:relative}
.uV2eYG_input{box-sizing:border-box;min-height:36px;font-family:var(--dsw-font-family);font-size:inherit;
  line-height:inherit;white-space:pre-wrap;color:var(--dsw-alias-label-primary);
  caret-color:var(--dsw-alias-state-business-primary);outline:none;padding:4px 8px 0 14px}
.uV2eYG_row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;
  padding:2px 8px 6px;display:flex;container-type:inline-size}
.uV2eYG_primary{background:var(--dsw-alias-button-info-fill);color:#fff;border:0;border-radius:999px;
  width:34px;height:34px;display:grid;transform:translateY(-2px)}
```

### 4.3 class 命名体系与「稳定钩子」

**没有 `dsw-` / `dsh-` 前缀的稳定 class。** 消息流用的是构建期生成的 CSS Module 哈希前缀类名，形态 `<6字符hash>_<camelCase局部名>`：

| 模块 | hash 前缀 | 来源 |
|---|---|---|
| MessageItem | `Sixlwa_` | `CHAT:164-197` |
| ChatView | `EvIC1a_` | `CHAT:1517-1534` |
| ReasoningRow | `lcKema_` | `CHAT:2857-2870` |
| AssistantMarkdown | `hWmORq_` | `CHAT:2934` |
| MessageIconActions | `xzv4MW_` | `CHAT:1004` |
| TurnProcessNodeView | `l_V-RG_` | `CHAT:3260` |
| TurnTailNodeView | `TS9iAW_` | `CHAT:3621` |
| StatsPills | `bOPqQW_` | `CHAT:3842` |
| ToolRow | `o3BgMG_` | `TOOL:1144` |
| ToolCallTree | `ztWv_q_` | `TOOL:1432` |
| ConversationRoot | `wSkVaW_` | `CONV:14652` |
| InputBar | `uV2eYG_` | `CONV:15757` |
| ApprovalPanel | `mna1RW_` | `APPR:11` |

> **跨版本重构建会变**（前缀来自构建哈希），所以**不要把 class 名写死进插件**。同一 bundle 内 100% 稳定。

**真正可依赖的是 `data-*` 钩子层**（这是本代码库自己的「语义 ABI」）：

| 属性 | 值域 | 证据 |
|---|---|---|
| `data-chat-flow-kind` | 17 个 ChatNodeKind 之一 | `CHAT:1608` |
| `data-chat-anchor-key` / `data-chat-flow-key` | node key | `CHAT:1606-1607` |
| `data-chat-turn` | turn 号 | `CHAT:1609` |
| `data-turn-process-member` / `-hidden` / `-answer` | bool | `CHAT:1610-1612` |
| `data-slot` | slot key（`conversation.view`、`conversation.chat.node`…） | `RENDERER:773` |
| `data-conversation-scroll` | 会话滚动体 | `CONV:14955` |
| `data-composer-seat` | 输入卡片座 | `CONV:14944` |
| `data-phase` | `hero` / `settling` / `active` | `CONV:14950` |
| `data-tool` / `data-variant` / `data-state` | 工具行 | `TOOL:1255-1257` |
| `data-disclosure-row` / `data-expandable` / `data-open` | DisclosureRow 骨架 | `SHELL:326242` |
| `data-chat-call-id` | 工具 callId | `TOOL:1477` |
| `data-approval-key` / `data-approval-scroll` | 审批面板 | `APPR:57/71` |
| `data-shell-overlay` | shell overlay 层 | `LAYOUT:303` |
| `data-rightbar-col` | 右侧栏列 | `LAYOUT:125` |
| `data-sidebar-collapsed` / `data-rightbar-*` / `data-dragging` | frame 状态 | `LAYOUT:281-285` |

### 4.4 注入样式的确切代码位置

**形态 A**（绝大多数包）：**模块 factory 顶层 IIFE，带幂等 querySelector 守卫，注入 `document.head`，无卸载清理**，注入时机 = **模块首次求值（加载）时，与 React 挂载无关**：

```js
// CHAT:1506-1515（ChatView.module.css）；同形态另见
// CHAT:157-163, 265-271, 822-828, 1006-1012, 1510-1516, 1628-1634, 2838-2844, 2850-2856,
//       2936-2942, 3084-3090, 3262-3268, 3444-3450, 3460-3466, 3623-3629, 3844-3850, 7296-7302
// TOOL:1146-1152, 1434-1440, 1698-1704
// CONV:11828-11834, 12223-12229, 13961-13967, 14394-14400, 14501-14507, 14654-14660,
//       15341-15347, 15541-15547, 15759-15765, 16267-16273
// LAYOUT:72-79,  APPR:12-18
const tagId$11 = "@deepseek-ai/dsh-client-ui-chat/ChatView.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$11) + "]") === null) {
    const tag = document.createElement("style");
    tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-chat";
    tag.dataset.pluginCss = tagId$11;
    tag.textContent = css$11;
    document.head.appendChild(tag);
}
```

**形态 B**（仅 theme 的 6 张全局表）：用 `ctx.effect` 绑插件生命周期，可卸载：

```js
// THEME:1078-1091
function installThemeStyles(ctx) {
    if (typeof document === "undefined") return;
    for (const [name, css] of STYLES) ctx.effect(() => {
        const tag = document.createElement("style");
        tag.dataset.plugin = PLUGIN_ID;
        tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`;
        tag.textContent = css;
        document.head.appendChild(tag);
        return () => { tag.remove(); };
    }, `ui-theme: ${name} stylesheet`);
}
```

统计：`grep -c 'createElement("style")'` 命中 **38 个 client.js**；唯一 `data-plugin-css` 标签 id 共 **100 个**，其中消息流核心 16 个来自 `dsh-client-ui-chat`（`AssistantMarkdown / ChatView / ContextBody / ContextInjectionRow / GenericCommandCard / MessageIconActions / MessageItem / ReasoningRow / StatsPills / TranscriptViewRow / TurnNavigator / TurnProcessNodeView / TurnTailNodeView / TurnUsagePanel / accessibility / stat-dialog`）。

**源映射注释保留了原始源码路径**，可用来定位上游 `.module.css`：

```js
// CHAT:154
//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-chat/src/client/chat/MessageItem.module.css.mjs
```
`\0dsh-css:` = CSS Module 产物；`\0dsh-inline-css:` = 手写全局 CSS（`THEME:1061`）。

### 4.5 独立的 `.css` 物理文件

全树**只有 2 个**，且**都不承载会话消息流样式**：

```
PKG/dsh-web-frontend/dist/assets/index-DPX2bQLO.css    51,949 B（1 行，minified）
PKG/dsh-web-frontend/dist/assets/vendor-BNsW4eBh.css   29,288 B（1 行，minified）
```

- `index-DPX2bQLO.css`：boot 外壳（`._boot_1fywu_3` 等）+ **`DisclosureRow` / `StateDot` 等 primitives 的 CSS**（因为 primitives 内联在 `SHELL`）+ 2 处变量定义（`--dsw-elevation-stroke-color:`、`--dsw-hovercard-bg:`）。
- `vendor-BNsW4eBh.css`：第三方（KaTeX 字体等）。
- `dsh-client-ui-*` 包目录内**没有任何 `.css`**（只有 `lib/client.js`、`lib/index.js`、`lib/types/**/*.d.ts`、`README*`、`LICENSE`、`package.json`）。

---

## 5. 事件数据形状

### 5.1 `eventSource.getSnapshot()` 返回什么

`ctx.sessions.binding(id)` → `SessionBinding | undefined`；`.eventSource` 是 `SessionEventSource`。

```ts
// CTRL/sessions/service.d.ts:103-110
export interface SessionBinding {
    readonly sessionId: SessionId;
    readonly session: SessionFace;
    /** Contiguous event window reserved for Conversation assembly. */
    readonly eventSource: SessionEventSource;
    readonly ctx: AgentContext;
}
// CTRL/contract/events.d.ts:56-63
export interface SessionEventWindow {
    readonly entries: readonly SessionEventLikeEntry[];
    readonly hasMore: boolean;
    readonly revision: number;
    readonly change: SessionEventChange;
}
export type SessionEventSource = ObservableSnapshot<SessionEventWindow>;
```

`ObservableSnapshot<T> = { getSnapshot(): T; subscribe(fn: () => void): () => void }`（内联声明 `RUNNER:1840-1841`）。

**⚠️ entry 顶层只有两个字段，没有 `seq` / `time` / `data`：**

```ts
// CTRL/contract/events.d.ts:20-26
export type SessionEventLikeEntry =
  | { readonly type: 'event';     readonly event: SessionEvent }        // durable
  | { readonly type: 'transient'; readonly event: AssistantLiveChunkEvent }; // 客户端专有
```

所以取值路径是 **`entries[i].event.data.*`**。`entries` 是惰性 getter（内部 leaf/concat 树）：

```js
// CTRL/contract/events.js:25-34
function windowSnapshot(node, hasMore, revision, change) {
    let entries;
    return { get entries() { entries ??= materialize(node); return entries; }, hasMore, revision, change };
}
```

**未找到**逐字出现的 `ctx.sessions.binding(id).eventSource.getSnapshot()` 链式表达式；真实消费路径是把它作为 feed 交给 `BoundConversation`：

```js
// CONV:2618-2624
const owner = typeof source === "string" ? this.sessions.binding(source) : source;
if (owner === void 0) throw new Error(`uiConversation.binding: unknown session "${sessionId}"`);
const binding = new BoundConversation(owner.eventSource, new ConversationNodeAssembler(this.events, this.views));
// CONV:2475-2483
this.replace(feed.getSnapshot());
this.disposeFeed = feed.subscribe(() => { this.accept(feed.getSnapshot()); });
```

### 5.2 事件信封

```ts
// SESSION:460-483
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
    [K in SessionEventType]: {
        type: K;
        /** Monotonic sequence number within the session. */
        seq: SessionSeq;          // BrandedNumber<'SessionSeq'>
        /** Unix epoch milliseconds. */
        time: number;
        data: SessionEventMap[K];
        ignorable?: true;
    } & (K extends SurfaceEventType ? SurfaceIntent<K> : { surfaceOp?: never; sourceEventSeqs?: never; });
}[T];
```

- **时间戳**：唯一字段是 `time`（Unix epoch ms）。**没有** `timestamp` / `ts` / `startedAt` / `endedAt`。
- **discriminated union**：注释明确写了 `switch (event.type)` 可直接窄化 `event.data`（`SESSION:448-459`）。
- surface 事件（`system/message` / `user/message` / `assistant/message` / `tool/result`）额外带 `surfaceOp: 'append' | {op:'replace',startSeq,endSeq}` 与 `sourceEventSeqs?: SessionSeq[]`（`SESSION:413-446`）。

### 5.3 逐类 payload（本报告关心的那些）

#### `assistant/message`

```ts
// SESSION:309-317
'assistant/message': {
    turn: number;
    step: number;
    message: AssistantMessage;      // ← 文本在这里
    /** Exact timed model stream, compacted without joining delta boundaries. */
    stream: AssistantStreamRecord[];
    usage?: TokenUsage;
    interrupted?: true;
};
```

**文本路径 = `event.data.message.content[i].text`**（block 数组，**不是** `data.text`）：

```ts
// LLM/message.d.ts:120-138
export interface Message {
    readonly id: MessageId;
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: ContentBlock[];      // ← 文本在 content 数组的 block 里
    readonly source: MessageSource;
}
export interface AssistantMessage extends Message { readonly role: 'assistant'; readonly source: ModelMessageSource; }
// LLM/types.d.ts:38-47
export interface TextBlock      { type: 'text';      text: string; }
export interface ReasoningBlock { type: 'reasoning'; text: string; }
// LLM/types.d.ts:71-86
export interface ToolCallBlock   { type: 'tool-call';   id: ToolCallId; name: string; arguments: string; }
export interface ToolResultBlock { type: 'tool-result'; toolCallId: ToolCallId; content: ContentBlock[]; isError?: boolean; }
```

`TokenUsage`（`LLM/types.d.ts:136-150`）：`{ inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`。

#### reasoning —— **没有独立事件**

推理只存在于两个地方：(a) `ContentBlock` 的 `{ type: 'reasoning'; text }`（`LLM/types.d.ts:44-47`）；(b) 流块 `{ type:'reasoning-delta'; index; text }`（`LLM/types.d.ts:368-371`）。**Session 事件层不存在 `reasoning/*` 或 `thinking/*`。**

#### `tool/call`

```ts
// SESSION:333-339
'tool/call': {
    turn: number;
    step: number;
    callId: ToolCallId;      // 扁平字段
    name: string;            // 工具名（wire 名）
    arguments: string;       // 原始 JSON 字符串，未解析
};
```

**注意**：无嵌套对象；参数名是 `arguments`（字符串），不是 `args`。客户端映射：

```js
// CHAT:6286-6300
if (match.event.type !== "tool/call") throw new Error("tool-call start requires tool/call");
return { callId: String(match.event.data.callId), name: match.event.data.name, argsRaw: match.event.data.arguments,
         turn: match.event.data.turn, step: match.event.data.step, time: match.event.time, subCalls: [] };
```

#### `tool/result`

```ts
// SESSION:351-361
'tool/result': {
    turn: number;
    step: number;
    message: ToolResultMessage;
    /** Optional failure identity; allowed only when the tool-result block has `isError: true`. */
    error?: { name: string; code: string };
    meta?: JsonValue;
};
// LLM/message.d.ts:148-153
export interface ToolResultMessage extends Message {
    readonly role: 'user';
    readonly content: [ToolResultBlock];   // 单元素元组
    readonly source: ToolMessageSource;    // { kind:'tool', callId }
}
```

- **结果内容**：`data.message.content[0].content`（嵌套一层 `ContentBlock[]`）。
- **成功/失败**：`data.message.content[0].isError`（boolean，缺省 = false）。**没有 `ok` 标志。**
- **error**：可选 `data.error: { name, code }`，仅当 `isError` 为 true 时允许。
- **callId**：`data.message.content[0].toolCallId`，同时 `data.message.source.callId`。
- **耗时：未找到。**

```js
// CHAT:6305-6320
function rootResult(match, previous) {
    if (match.event.type !== "tool/result") return void 0;
    const result = match.event.data.message.content[0];
    return { kind: "tool-result", seq: match.event.seq, time: match.event.time,
             callId: String(match.event.data.message.source.callId),
             call: previous === void 0 ? null : { name: previous.name, argsRaw: previous.argsRaw },
             callTime: previous?.time ?? null, content: result.content, isError: result.isError === true,
             ...match.event.data.error === void 0 ? {} : { error: match.event.data.error },
             meta: match.event.data.meta, ... };
}
```

#### `step/start` / `step/end`

```ts
// SESSION:265-273
'step/start': { turn: number; step: number; };
'step/end':   { turn: number; step: number; };
```

**只有编号，没有时间/耗时/状态。** 耗时由客户端用事件 `time` 相减推导：

```js
// CHAT:4497-4500
timing: { stepStartTime: context.start?.event.time ?? null, firstTokenTime: state.firstTokenTime ?? null, completedTime: event.time }
// CHAT:3889
if (node.timing !== void 0 && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
// CHAT:3883-3884
if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
// CHAT:3790-3791
ttftMs:   Math.max(0, timing.firstTokenTime - timing.stepStartTime),
decodeMs: Math.max(0, timing.completedTime  - timing.firstTokenTime),
```

`status: 'open'|'closed'|'unknown'` 也是客户端推导，**不在 payload 里**（`CONV/.../conversation.d.ts:71,80`）。

#### `turn/start` / `turn/end`

```ts
// SESSION:249-263
'turn/start': { turn: number };
'turn/end':   { turn: number; reason: TurnEndReason };
// SESSION:165-201
TurnEndReason = {kind:'completed'} | {kind:'aborted'; reason: TurnEndCancelCause} | {kind:'blocked'}
              | {kind:'error'; error: LlmFailure} | {kind:'max-tokens'} | {kind:'interrupted'};
```

边界事件就这四个（`CONV:2162-2164`）：

```js
function isLocationBoundary(type) {
    return type === "turn/start" || type === "turn/end" || type === "step/start" || type === "step/end";
}
```

#### `user/message`

```ts
// SESSION:281
'user/message': UserMessage;     // { id, role:'user', content: ContentBlock[], source: MessageSource }
```

`source` 是可合并扩展的判别式（`LLM/message.d.ts:94-104`）：`{kind:'user'}` / `{kind:'plugin', plugin}` / `{kind:'tool', callId}` / `{kind:'model'}`；浏览器提交的提示是 `'user-rpc'` 变体（`PKG/dsh-api-session-controller/lib/types/types.d.ts:346-355`）。**直接人类提示 / `agent.inject()` 合成上下文 / goal 续跑共用同一个 `user/message`，靠 `source` 区分。**

#### `todo/write`

```ts
// PKG/dsh-tool-todo/lib/types/types.d.ts:19-32
export interface TodoItem { content: string; status: 'pending' | 'in_progress' | 'completed'; }
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        'todo/write': { todos: TodoItem[]; };    // 整表快照，last-write-wins，log-only
    }
}
```

#### approval

```ts
// PKG/dsh-user-approval/lib/types/types.d.ts:28-52
'approval/asked':   { id: ApprovalRequestId; toolName: string; callId?: ToolCallId; reason?: string; };
'approval/decided': { id: ApprovalRequestId; outcome: 'allowed-once'|'rejected'|'cancelled'|'unavailable' };
// PKG/dsh-user-approval/lib/types/index.d.ts:26-30
'approval/policy':  { policy: 'ask'|'never'; source?: 'delegation' };
```

三者都是 log-only 审计事件（非 surface），asked↔decided 用 `id` 配对。

#### `command/run` / `command/done`

```ts
// PKG/dsh-commands/lib/types/types.d.ts:88-117
'command/run':  { commandId: CommandId; name: string; args?: string; source: CommandSource; };
'command/done': { commandId: CommandId; kind: 'success' | 'error'; text?: string; sourceEventSeq?: SessionSeq; };
```

#### `compaction/*`

```ts
// PKG/dsh-compaction/lib/types/types.d.ts:21-98
'compaction/start':   { compactionId; sourceCommandId?; turn: number | null };
'compaction/summary': { compactionId; sourceCommandId?; summary: ContentBlock[];
                        shadowedRange: {start: SessionSeq; end: SessionSeq}; shadowedSeqs: SessionSeq[];
                        shadowedTokenCount: number; provider: string; model: string;
                        maxTokens?; usage? } & ({ rawOutput: ContentBlock[]; llmStreamCall: true } | { rawOutput?; llmStreamCall?: never });
'compaction/end':     { compactionId; sourceCommandId?; turn: number | null; error?: string };
'compaction/prune':   { shadowedRange: {start; end}; shadowedSeqs: SessionSeq[]; shadowedTokenCount: number };
```

### 5.4 完整事件类型词汇表

权威源（生成物，被 doc-sync 校验）：`PKG/dsh-session/lib/types/known-event-types.js:21-78`，**共 56 条**：

```
agent-preset/selected, agent/inbox/spliced, approval/asked, approval/decided, approval/policy,
assistant/attempt, assistant/message, command/done, command/run,
compaction/end, compaction/prune, compaction/start, compaction/summary, deliverables/presented,
feedback/message-delete, feedback/message-put, feedback/record, goal/change, hook/invoked, hook/result,
llm/retry, llm/retry-started, model/selection, permission/preset, plan/mode,
request/context, request/header, sandbox/mode, schedule/change,
session-log-deepseek/delivery-accepted, session/end-seed, session/title, session/title-llm-request,
step/end, step/start, subagent/catalog, subagent/descriptor, subagent/model-selection-policy,
system/message, team/member, team/message/delivered, team/message/queued, team/task, todo/write,
tool-workflow/agent-end, tool-workflow/agent-start, tool-workflow/run-end, tool-workflow/run-start,
tool/call, tool/ptc-dispatch, tool/ptc-dispatch-start, tool/result,
turn/end, turn/start, user/message, web/deepseek-search-llm-request
```

外加 **1 条客户端专有呈现事件** `assistant/live-chunk`（见第 3 问）。

### 5.5 时间戳 / 耗时 / 状态字段总结

| 问题 | 答案 |
|---|---|
| 时间戳字段 | `entry.event.time`（Unix epoch ms）+ `entry.event.seq` |
| 耗时字段 | **基本没有**。全树只有 `hook/result.durationMs`、`llm/retry.delayMs`、`LlmFailure.providerRetryAfterMs` |
| 流内相对时间 | `AssistantStreamRecord` 的 `time0` + `dt: number[]`（每个 delta 相对 time0 的偏移） |
| 状态字段 | `todo/write.todos[].status`、`team/task.task.status`、`team/member.member.phase`、`command/done.kind`、`turn/end.reason.kind`、`ToolResultBlock.isError` |
| **派生**（不在 payload） | `StepLocation.status` / `TurnLocation.status`、`SessionSnapshot.openState`、`SessionJob.status` |
| 工具/step/turn 的耗时 | **必须客户端用 `event.time` 相减**，参考 `CHAT:3790-3791, 3883-3889, 4497-4500` |

### 5.6 另一条容易混淆的路径

`binding(id).session.getSnapshot()` 返回 **SessionSnapshot，不含事件**（`CTRL/contract/snapshot.d.ts:71-94`）：
`{ sessionId, queue, pendingSubmissions, running, subagent, removed, openState, openError, hasMore, loadingOlder, promptError, blank, lastAgentError, promptAttempted, awaitingFirstTurn }`。别和 `eventSource` 的 window 混。

---

## 6. 会话区固定元素

### 6.1 右侧主区的根容器（第 7 问要用）

**答案：`div.pI_x6G_centerCol`**（`LAYOUT:107-112` / `LAYOUT:296`）。

```js
// LAYOUT:106-112
function CenterColumn(props) {
    return (0, react_jsx_runtime.jsx)("div", {
        className: AppFrame_module_css_default.centerCol,
        children: props.children
    });
}
// LAYOUT:277-285
return jsx("div", {
    ref: frameRef,
    className: AppFrame_module_css_default.frame,
    style: { gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px` },
    "data-sidebar-collapsed": sidebarCollapsed || void 0,
    "data-rightbar-collapsed": cols.rightbar === 0 || void 0,
    "data-rightbar-fullscreen": layoutInfo.rightbarFullscreen || void 0,
    "data-rightbar-instant": layoutInfo.rightbarInstant || void 0,
    "data-dragging": dragging || void 0,
    children: [ DocumentTitle, div.sidebarCol, Fragment[ CenterColumn{main}, RightbarColumn ], div.overlayLayer, DragHandle(sidebar), DragHandle(rightbar) ]
});
```

它**不含 sidebar**（sidebar 是独立的 `div.pI_x6G_sidebarCol`，`LAYOUT:292-295`），所以盖住它是精确的。

```css
/* LAYOUT:71 */
.pI_x6G_frame{background:var(--dsw-alias-bg-base);height:100%;grid-template-rows:100%;display:grid;position:relative;overflow:hidden;
  transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.pI_x6G_sidebarCol{background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3);min-width:0;overflow:hidden}
.pI_x6G_centerCol{flex-direction:column;min-width:0;display:flex;overflow:hidden}
.pI_x6G_rightbarCol{min-width:0;position:relative;overflow:visible}
.pI_x6G_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}
.pI_x6G_overlayLayer>*{pointer-events:auto}
```

**官方 overlay 层已存在**：`div.pI_x6G_overlayLayer[data-shell-overlay]`（`LAYOUT:301-305`），`position:absolute; inset:0; z-index:20; pointer-events:none`，子元素自动 `pointer-events:auto`。**注意它覆盖整个 frame（含 sidebar）**，不是只盖右侧。

侧栏宽度（`LAYOUT:36-45`，`LAYOUT:342-344`）：

```js
function computeColumns(viewport, sidebar, rightbar) {
    const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);   // ← 折叠时 56px，默认 280px
    const available = viewport - s - 400;
    const r = rightbar === 0 || available < 300 ? 0 : Math.min(available, clampWidth(rightbar, 300, viewport * RIGHTBAR_MAX_RATIO));
    return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}
```

### 6.2 右侧主区内的固定元素清单

| # | 元素 | 选择器 | 位置 | 高度 / 尺寸 | 证据 |
|---|---|---|---|---|---|
| 1 | 会话标题栏 | `header.wSkVaW_header` | `wSkVaW_root` 第 1 子级 | **`min-height:76px`**，`padding:10px 28px 0 20px`，`border-bottom:.5px solid var(--dsw-alias-border-l3)` | `CONV:15074` / `CONV:14652` |
| 1a | 面包屑 | `nav.wSkVaW_crumbs` + `span.wSkVaW_crumbSeg` | header 内 | `span.wSkVaW_crumb`：`max-width:220px; border-radius:12px; padding:4px 8px; font-size:14px; line-height:20px` | `CONV:15080-15110` |
| 1b | view 标签页 | `div.wSkVaW_tabs[role=tablist] > button.wSkVaW_tab` | header 内，仅 `tabs.length > 1` 时渲染 | `gap:36px; margin-top:10px; padding-left:8px`；tab `padding:0 0 9px; font-size:13px; font-weight:500` | `CONV:15111-15130` |
| 1c | header 空白时隐藏 | `header.wSkVaW_headerHidden` → `display:none` | blank session + blank phase | — | `CONV:15075-15077`, `CONV:14652` |
| 2 | 滚动容器 | `div.wSkVaW_scrollBody[data-conversation-scroll]` | `wSkVaW_body` 内，`flex:1; min-height:0; overflow-y:auto; scrollbar-gutter:stable; margin-right:2px` | 占满剩余高度 | `CONV:14954-14955`, `CONV:14652` |
| 3 | 会话视图区 | `div.wSkVaW_viewArea` | scrollBody 内（`conversation.session` 槽内） | `flex-direction:column; flex:1; min-height:0` | `CONV:15133-15135` |
| 4 | 消息列滚动体 | `div.EvIC1a_scroll` | ChatView 内 | `padding:16px calc(var(--dsh-composer-side-clearance) + 16px)`（= 16px 32px）；`overflow-y:auto` | `CHAT:2499-2501`, `CHAT:1508` |
| 5 | 消息列 | `div.EvIC1a_column[data-chat-flow]` | scroll 内 | `max-width:var(--dsh-chat-content-width); width:100%; margin:0 auto` | `CHAT:2510-2513`, `CHAT:1508` |
| 6 | 状态行（运行中） | `div.EvIC1a_turnStatus[role=status][aria-live=polite]` | **column 的最后一个子级**（`running` 时） | `height:calc(26px + δ)`，`align-self:flex-start` | `CHAT:2537-2540`, `CHAT:2036-2061` |
| 7 | 「回到底部」悬浮钮 | `div.EvIC1a_toBottomSlot > button.EvIC1a_toBottom` | scroll 内，`position:sticky; bottom:16px` | 按钮 34×34，`border-radius:100px`，`margin-top:-34px` | `CHAT:2550-2566`, `CHAT:1508` |
| 8 | Turn 侧轨 | `div.eGxaPq_slot > div.eGxaPq_frame` | scroll 内，`position:sticky; top:0` | 宽 `28px`，高 `min(natural, max(0, band-64px), 420px)`；`@container (width<=900px)` 时隐藏 | `CHAT:1626`, `CHAT:2503` |
| 9 | 宽度拖拽手柄 ×2 | `div.wSkVaW_widthHandle[data-side=left|right]` | `wSkVaW_body` 内，`position:absolute; top:0; bottom:0` | 宽 `min(40px, ...)` | `CONV:14957-14965`, `CONV:14652` |
| 10 | 输入卡片座 | `div.wSkVaW_composerSeat[data-composer-seat]` | scrollBody 内，**`position:sticky; bottom:0; z-index:7`** | 高 = 内容高；ResizeObserver 把它写进 **`--dsh-composer-height`**（CSS 兜底默认 **`152px`**） | `CONV:14942-14945`, `CONV:14652`, `CHAT:1626` |
| 10a | 输入卡片 | `div.uV2eYG_root > div.uV2eYG_card` | composerSeat 内 | `border-radius:22px`；`--dsh-composer-text-max-height:336px` | `CONV:15757`, `CONV:14652` |
| 11 | 输入 dock（卡片上方） | `div[data-slot="conversation.input.dock"]` | composerStack 内（cards 上方） | 内容高 | `CONV:14926`, `RUNNER:2709-2711` |

**结论**：会话区的固定高度项只有两个 —— **header `min-height:76px`** 与 **composerSeat（由 `--dsh-composer-height` 报告，CSS 兜底 152px）**。消息流本身在 `EvIC1a_scroll` 里滚动。

### 6.3 精确定位「右侧主区」的可用锚点

| 目标 | 选择器 | 说明 |
|---|---|---|
| **右侧主区（推荐）** | `div.pI_x6G_centerCol` | grid 第 2 列；`overflow:hidden`；不含 sidebar、不含 rightbar |
| 会话根 | `div.wSkVaW_root` | centerCol 内部，`height:100%; position:relative` —— **这是最适合 `position:absolute` 覆盖层的容器** |
| 会话滚动体 | `div[data-conversation-scroll]` | 用于插入跟随滚动的内容 |
| 消息列 | `div[data-chat-flow]` | 用于插入与消息同宽同缩进的行 |
| 输入卡片 | `div[data-composer-seat]` | 用于在输入框上方叠内容 |
| 官方 overlay | `div[data-shell-overlay]` | **跨整 frame（含 sidebar）**，`z-index:20`，`pointer-events:none` |

---

## 7. 可复用性结论

### 7.1 三种做法的可行性与风险

#### 做法 A：复用 DSH 的 React 组件（`require("@deepseek-ai/dsh-client-ui-primitives")`）——**最不容易露馅，但有前置条件**

**可行性：高。** module loader 保证解析：

```js
// SHELL:553323
"@deepseek-ai/dsh-client-ui-primitives": Zg
// SHELL:508249
const Zg = Object.freeze(Object.defineProperty({__proto__:null,
    BrandWordmark:uC, Button:w3, CodeBlock:a8, ConnectionIndicator:aC,
    DEFAULT_DIFF_MAX_LINES:$m, DEFAULT_READ_MAX_LINES:Fm, DEFAULT_SEARCH_MAX_LINES:qm, DEFAULT_TERMINAL_MAX_LINES:wm,
    DiffBlock:Wm, DisclosureRow:Yp, ..., JsonBlock:Ag, JsonTree:rm, MarkdownText:w8,
    ReadBlock:Am, SearchBlock:Xm, StateDot:O6, TerminalBlock:km, Tooltip:Fr, WebBlock:Vg,
    diffTotals:i8, fileSizeText:BC, projectUserText:FC, relativeTime:ZC, ...}, ...))
```

所以第三方插件可以 `require("@deepseek-ai/dsh-client-ui-primitives")` 然后直接用 `DisclosureRow`、`StateDot`、`TerminalBlock`、`MarkdownText` —— **像素级一致，因为就是同一份代码 + 同一张 CSS 表**。

**风险**：
1. **无 `.d.ts`**。类型声明只散落在 `RUNNER:1840` 之类的内联注册表里；打包器也会警告 unresolved。要自己写 `declare module`。
2. **图标组件名是内部契约**（`IconSearchOutline16`、`IconApiOutline14`…），跨版本可能改名。
3. primitives 的 CSS 类名是 `_row_luwio_16` 这种**带行号的 Vite 风格哈希**（`_<name>_<hash>_<line>`），与插件模块的 `<hash>_<name>` 形态不同 —— 但因为是同一份 CSS，只要用同一个组件就自然一致。

#### 做法 B：复用 DSH 的 CSS（`className={...}` 或抄选择器）——**不推荐**

**可行性：低。** 哈希前缀（`Sixlwa_`、`o3BgMG_`、`EvIC1a_`…）是构建产物，**跨版本会变**。而且它们由 `var X_module_css_default = {...}` 映射表暴露（`CHAT:164-197`），**不在任何插件可见的导出面上**，第三方拿不到映射表，只能硬编码字符串。

**唯一稳妥的「复用 CSS」方式**是：不写 class，而是在自己的样式里 `var(--dsw-*)` + 抄数值。这可行，因为所有 token 都写在 `document.body` 的 inline style 上（`LAYOUT:472-478`）。

#### 做法 C：完全自己写样式模仿 ——**可行，露馅点可枚举**

**可行性：高**，只要严格照抄第 2 节的度量和第 7.2 节的规格。所有依赖的 CSS 变量都是全局可解析的。

**露馅点（这些是真实存在的破绽）**：
1. **行高/字号轴**：真实行高是 `calc(24px + var(--dsh-content-font-delta, 0px))`。写死 `24px` 在用户把字号设成 17px 时会错位。
2. **leading 图标**：leading 盒是 `calc(16px + δ)`，内含 `calc(14px + δ)` 的 SVG，`margin-right:6px`，色 `var(--dsw-alias-label-tertiary)`。用字符（`●`、`>`、`$`）代替会立刻露馅 —— **DSH 在工具行/思考行里完全不用字符前缀**。
3. **分隔圆点**：是 `2×2px; border-radius:1px; background:var(--dsw-alias-label-caption); margin:0 8px` 的 CSS 盒，不是 `·` 字符（字符宽度、垂直居中位置都不同）。
4. **颜色分层**：标题用 `--dsw-alias-label-secondary`（不是 primary），摘要用 `--dsw-alias-label-tertiary`。用同一色会露馅。
5. **行间距**：`.EvIC1a_flowItem` 之间靠 `~` 兄弟选择器给 `margin-top: var(--dsh-chat-flow-gap, 16px)`。自己加 `margin-bottom` 会导致间距 16px vs 你写的值不一致。
6. **hover 行为**：真实工具行 hover 时 leading 图标淡出、chevron 淡入（`SHELLCSS` 的 `._row_luwio_16:hover ._iconIdle_luwio_57{opacity:0}`）。纯静态 DOM 不会有这个。
7. **`data-*` 缺失**：`.EvIC1a_flowItem` 没有 `data-chat-flow-kind` / `data-chat-turn` 时，TurnNavigator、`anchorElement()`（`CHAT:1940` `list.querySelectorAll("[data-chat-anchor-key]:not([hidden])")`）、以及所有 scroll/anchor 逻辑都不会把它算作一行 —— 表现为「滚动跳转时这行被无视」。

### 7.2 推荐的落点（按侵入性从低到高）

| 落点 | slot / 选择器 | 侵入性 | 说明 |
|---|---|---|---|
| `conversation.input.dock` | 输入卡片上方整宽列表 | 极低 | `kind:"list"`, `scope:"session"`（`RUNNER:2709-2711`）。官方自己的 todo 面板就挂这儿 |
| `shell.overlay` | `[data-shell-overlay]`（跨整 frame） | 低 | `kind:"list"`, `scope:"root"`；官方目录原话：*"This is the additive seat for a frame-wide surface of your own"*（`RUNNER:3948-3952`） |
| `conversation.session.header.utilities` / `.corner` / `.actions` | `wSkVaW_header` 右侧 | 低 | header 内的加法槽（`CONV:15103-15110`） |
| `conversation.view` | `[data-slot="conversation.view"]` | 中 | `kind:"list"`；`replaceRisk:"none"`（`RUNNER:3368`）。**但同一时刻只渲染一个 active view**，所以这是一个「另一个 tab」而不是「叠在 chat 上」 |
| `tool.call.toolview` | keyed by tool name | 中 | 新增 key（如自己工具名）是**真正的加法**，不替换任何东西（`TOOL:2368-2374`, `RUNNER:4533`） |
| `conversation.chat.node` | keyed by 17 个 kind | **高** | `replaceRisk:"shadows-shipped-ui"`（`RUNNER:2395`）；key 是固定表，**不能新增 kind** |
| 直接 `document.querySelector("[data-chat-flow]").appendChild(...)` | — | **最高** | 见 7.3 |

### 7.3 直接注入 DOM 的关键约束（必须知道才不白干）

1. **React 18.2 管理着整棵消息列**。`dsh-web-frontend/package.json` 声明 `"react": "^18.2.0"`。
2. React 只在需要时对未管理的子节点做 `insertBefore` / `removeChild`。**当你注入的节点夹在受管理的兄弟之间时，React 的重排（例如新增一条消息、turn-process 折叠、切换 view）可能把它移到错误位置**。
   - **无法确定**的确切行为：这取决于 React 18 内部 reconciler 对该 parent 走的是「append-only」还是「insert-before」路径，以及 `EvIC1a_column` 的子节点是否全部带 key。**我没有运行 DSH，无法用实验验证；不建议在不验证的情况下依赖它。**
3. **可靠得多的做法**：把自己挂进 `data-slot` 锚点（`RENDERER:765-776` 的 `<div data-slot=... style="display:contents">` 是纯寻址锚点），或在自己的插件组件里 `renderSlot(...)` / 直接把 React 组件注册进槽。这样你的 DOM 由 React 管理，重排时不会丢。
4. `.EvIC1a_column` 的间距规则用 `~` 通用兄弟选择器（`CHAT:1508`），所以**注入节点的位置会直接影响相邻真实行的 `margin-top`**：`.EvIC1a_column>:not([hidden]):not(.EvIC1a_flowItem:empty)~:not([hidden]):not(.EvIC1a_flowItem:empty){margin-top:var(--dsh-chat-flow-gap,16px)}`。也就是说，你插入一个空 div 会「吃掉」或「切断」`~` 链。

### 7.4 最终结论

- **最省事、最不露馅**：`ctx.slots.register` 进一个**加法槽**（`conversation.input.dock` / `shell.overlay` / `tool.call.toolview` 的新 key），并在自己的组件里 `require("@deepseek-ai/dsh-client-ui-primitives")` 用 `DisclosureRow` / `StateDot` / `TerminalBlock` / `MarkdownText` 渲染。
- **想让它看起来就是消息流里的一行**：唯一能拿到完全一致的视觉的路径是**替换 `conversation.chat.node` 的某个 key**（`replaceRisk: "shadows-shipped-ui"`），或者**往 `tool.call.toolview` 注册一个新 tool key**（这个是真加法，不替换任何 shipped UI）。**前者会遮掉真实的那类行，且固定表不允许新 kind。**
- **完全自己写样式**：可行，但必须照抄第 7.2/7.5 节的规格，否则会在字号轴、leading 盒、分隔圆点、颜色分层、hover 行为、`data-*` 缺失这 6 处露馅。
- **不要**硬编码哈希 class（`Sixlwa_*` 等），跨版本会碎。
- **不要**直接 `appendChild` 进 `[data-chat-flow]`（React 18 重排风险 + `~` 间距规则被破坏），除非你已经实测验证过。

---

## 7.5 「合成一条看起来真实的『工具调用 + 结果』行」的照抄规格

> 下面给的是**可以直接照抄的 DOM + 内联样式规格**。所有 class 名来自当前 bundle 的真实哈希；跨版本会变，所以**推荐用等同的内联 style 或自家 class + 相同的属性值**，而不要硬编码 class（见 7.1 做法 B）。

### A. 外层：流式行容器

```html
<div class="EvIC1a_flowItem"           <!-- 或自建 class + 同样式 -->
     data-chat-anchor-key="call:CALLID"
     data-chat-flow-key="call:CALLID"
     data-chat-flow-kind="tool-call"
     data-chat-turn="3">
  <div data-slot="conversation.chat.node" style="display:contents">
    ... 见 B ...
  </div>
</div>
```

必需样式（`CHAT:1508`）：

```css
/* .EvIC1a_flowItem */
min-width: 0;
/* 与前一行的间距由 column 的兄弟选择器给，不要自己写 margin-bottom */
/* .EvIC1a_column > * + * { margin-top: var(--dsh-chat-flow-gap, 16px) } */
```

同时须满足：父容器是 `max-width: var(--dsw-chat-content-width); width:100%; margin:0 auto; display:flex; flex-direction:column`（`ChatView.column`）。

### B. 工具调用行本体（三层）

```html
<!-- B1: ToolCallTree.callRow → TOOL:1475-1486 / TOOL:1432 -->
<div class="ztWv_q_callRow"
     data-chat-anchor-key="call:CALLID"
     data-chat-call-id="CALLID"
     style="border-radius:6px">

  <!-- B2: ToolRow.root → TOOL:1254-1258 -->
  <div class="o3BgMG_root"
       data-variant="bash"        <!-- search|read|bash|write|edit|code|others -->
       data-tool="bash"           <!-- wire 工具名 -->
       data-state="ok"            <!-- running|ok|error|stopped -->
       style="display:flex; flex-direction:column">

    <!-- 仅当 state != ok 时存在；视觉隐藏但读屏可见 -->
    <!-- <span style="clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden">Running</span> -->

    <!-- B3: DisclosureRow（primitives）→ SHELL:326242 -->
    <div class="_root_luwio_9" style="display:flex;flex-direction:column;width:100%;min-width:0">

      <div class="_row_luwio_16 o3BgMG_row"
           data-disclosure-row
           data-expandable
           role="button" tabindex="0" aria-expanded="false"
           style="position:relative;overflow:hidden;display:flex;align-items:center;
                  height:calc(24px + var(--dsh-content-font-delta,0px));min-width:0;cursor:pointer">

        <!-- ① 行首：16px 盒 + 14px SVG，margin-right:6px -->
        <span class="_leading_luwio_29 o3BgMG_leading"
              style="position:relative;flex:none;
                     width:calc(16px + var(--dsh-content-font-delta,0px));
                     height:calc(16px + var(--dsh-content-font-delta,0px));
                     display:inline-flex;align-items:center;justify-content:center;
                     margin-right:6px;padding:0;border:none;background:none;
                     color:var(--dsw-alias-label-tertiary)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
               style="width:calc(14px + var(--dsh-content-font-delta,0px));
                      height:calc(14px + var(--dsh-content-font-delta,0px))">
            <!-- IconApiOutline14 的 path，fill="currentColor" -->
          </svg>
        </span>

        <!-- ② 工具显示名 -->
        <span class="_title_luwio_79 o3BgMG_title"
              style="flex:none;
                     font-size:var(--dsh-content-font-size-secondary,13px);
                     line-height:calc(24px + var(--dsh-content-font-delta,0px));
                     color:var(--dsw-alias-label-secondary);
                     font-weight:400">Bash</span>

        <!-- ③ 分隔圆点：2×2px CSS 盒，不是字符 -->
        <span class="o3BgMG_sep" aria-hidden="true"
              style="background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;
                     width:2px;height:2px;margin:0 8px"></span>

        <!-- ④ 摘要：单行省略。read/write/edit 且摘要来自 path/file_path 时改用 <button> + fileLink 样式 -->
        <span class="o3BgMG_summary"
              style="text-overflow:ellipsis;white-space:nowrap;min-width:0;
                     font-size:var(--dsh-content-font-size-secondary,13px);
                     line-height:calc(24px + var(--dsh-content-font-delta,0px));
                     color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden">列出文件</span>

        <!-- ⑤ 可选尾注（diff 统计 / todo 计数）。失败态的摘要整体换成 --dsw-alias-state-error-primary -->
        <!-- <span class="o3BgMG_summarySuffix" style="white-space:nowrap;
              font-size:var(--dsh-content-font-size-secondary,13px);
              line-height:calc(24px + var(--dsh-content-font-delta,0px));
              color:var(--dsw-alias-label-tertiary);flex:none;margin-left:4px">+12 -3</span> -->
      </div>
    </div>
  </div>
</div>
```

### C. 各状态的差异（照抄表）

| 项 | 成功 `ok` | 运行 `running` | 失败 `error` | 中断 `stopped` |
|---|---|---|---|---|
| `data-state` | `ok` | `running` | `error` | `stopped` |
| ① 行首 | 变体 SVG（14px） | 变体 SVG（14px） | `StateDot state="error"`（红点，`width/height:10px`） | `StateDot state="warning"`（黄点，10px） |
| 行首色 | `var(--dsw-alias-label-tertiary)` | 同左 | `var(--dsw-alias-state-error-primary)` | `var(--dsw-alias-state-warn-primary)` |
| 动画 | 无 | 行内 `.o3BgMG_row::after` 300px 扫光 `2.6s ease-out infinite` | 无 | 无 |
| ④ 摘要色 | `var(--dsw-alias-label-tertiary)` | 同左 | `var(--dsw-alias-state-error-primary)`，文本 = 结果首行 | `var(--dsw-alias-label-tertiary)` |
| 视觉隐藏状态文本 | 无 | `Running`/`运行中` | `Failed`/`失败` | `Stopped`/`已停止` |

`StateDot` 的完整 DOM（`SHELL:221311` + `SHELLCSS`）：

```html
<span class="_dot_1tljr_3" data-state="error" style="width:10px;height:10px" aria-hidden="true"></span>
```
```css
._dot_1tljr_3{position:relative;display:inline-block;flex:none}
._dot_1tljr_3:before{content:"";position:absolute;inset:0;border-radius:50%;corner-shape:round;background:currentColor;opacity:.1}
._dot_1tljr_3:after{content:"";position:absolute;inset:20%;border-radius:50%;corner-shape:round;background:currentColor}
._dot_1tljr_3[data-state=error]{color:var(--dsw-alias-state-error-primary)}
._dot_1tljr_3[data-state=warning]{color:var(--dsw-alias-state-warn-primary)}
```

运行态扫光（照抄 `TOOL:1144`）：

```css
.o3BgMG_row{position:relative;overflow:hidden}
.o3BgMG_root[data-state=running] .o3BgMG_row:after{
  content:"";position:absolute;top:0;bottom:0;left:0;width:300px;pointer-events:none;
  background:linear-gradient(90deg, transparent 0%,
    color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
  animation:2.6s ease-out infinite dsh-tool-row-sweep}
@keyframes dsh-tool-row-sweep{0%{left:-300px}90%,to{left:100%}}
@media (prefers-reduced-motion:reduce){ .o3BgMG_root[data-state=running] .o3BgMG_row:after{animation:none} }
```

### D. 子调用缩进（可选的第二层）

```html
<div class="ztWv_q_subCalls" data-subcalls="true"
     style="border-left:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;
            gap:4px;margin:4px 0 2px 22px;padding-left:8px">
  <!-- 每个子调用再放一个 B 段结构 -->
</div>
```

**这是工具行体系里唯一的左竖线。** 缩进 = `margin-left:22px` + `padding-left:8px` = 内容起点在 30px。

### E. 文案对照（zh / en，`CONV` 的 `conversation` 命名空间）

| 用途 | zh | en |
|---|---|---|
| 工具标题（bash） | `Bash` | `Bash` |
| 工具标题（read / write / edit） | `读取` / `写入` / `编辑` | `Read` / `Write` / `Edit` |
| 工具标题（grep / glob） | `Grep` / `Glob` | `Grep` / `Glob` |
| 工具标题（search / code） | `搜索` / `代码` | `Search` / `Code` |
| 未知工具标题 | `工具调用`（wire 名进摘要，格式 `` `${toolName} · ${summary}` ``） | `Tool call` |
| todo 行标题 | `更新任务清单` | `Update to-do list` |
| todo 摘要 | `{done}/{total} 已完成`（有 in_progress 时追加 `" · " + content`） | `{done}/{total} completed` |
| 思考行标题 | `思考` | `Think` |
| 状态（隐藏） | `运行中` / `失败` / `已停止` | `Running` / `Failed` / `Stopped` |
| IO 标签 | `输入` / `输出` | **`IN` / `OUT`** |
| 退出码 | `退出码 {code}` / `信号 {signal}` | `exit code {code}` / `signal {signal}` |
| diff 文件数 | `{count} 个文件` | `{count} file` / `{count} files` |

### F. 「最容易露馅的 5 个细节」清单

1. 行首**必须是 16px 盒内 14px 的 `currentColor` SVG**，色 `var(--dsw-alias-label-tertiary)`；**任何字符前缀（`$`、`>`、`●`、`⏺`）都是假的** —— DSH 工具行/思考行一个字符前缀都不用。
2. 标题与摘要之间是 **`2×2px` 圆角 1px 的 CSS 盒**，`margin:0 8px`，色 `var(--dsw-alias-label-caption)`；用 `·` 字符宽度和居中位置都会差。
3. **标题 `--dsw-alias-label-secondary`，摘要 `--dsw-alias-label-tertiary`，行高都是 `calc(24px + δ)`**；用同一颜色或写死 24px 会在用户改字号时错位。
4. 行高必须写成 **`calc(24px + var(--dsh-content-font-delta, 0px))`**，字号的次级档写成 **`var(--dsh-content-font-size-secondary, 13px)`**。
5. 必须带 **`data-chat-flow-kind` + `data-chat-anchor-key` + `data-chat-turn`**，否则 DSH 自己的滚动锚点/侧轨/跳转逻辑会无视这一行，表现为「滚动到某处时它消失或跳位」（`CHAT:1940`, `CHAT:1954-1961`, `CHAT:1985`）。

---

## 附录：「未找到 / 无法确定」清单（明确声明，未编造）

1. **未找到**逐字的 `ctx.sessions.binding(id).eventSource.getSnapshot()` 链式表达式（等价实现见 5.1）。
2. **未找到**独立 `reasoning/*` / `thinking/*` 会话事件类型（推理只作为 content block 与 stream chunk 存在）。
3. **未找到** `tool/call`、`tool/result`、`step/start|end`、`turn/*`、`assistant/message` payload 里的耗时或 status 字段（全部客户端用 `event.time` 推导）。
4. **未找到**工具行的 ASCII/emoji 前缀、头像、spinner、可见 `Running…` 文案。
5. **未找到** assistant 生成中的 caret / blink 光标（`data-streaming`、`_caret`、`_cursor`、`streaming-cursor`、`@keyframes * blink` 在 CSS/JS 中全部 0 命中）。
6. **未找到** `"Thought for {duration}"` 形式文案；只有无时长的 `"Thought for a while"` / `"已思考"`（`CHAT:2790` / `CHAT:2684`）。
7. **未找到** `"Ran 3 commands in 1.2s"` 形式文案；只有 turn 级 `"Ran for {duration}"` / `"用时 {duration}"`（`CHAT:3575`）。
8. **未找到**工具行的字面 `"ok"` 尾注、以及 per-call 毫秒耗时尾注。
9. **未找到** `@deepseek-ai/dsh-client-ui-primitives` 的独立安装目录与 `.d.ts`（内联在 `SHELL`，经 module registry 暴露为 `Zg`）。
10. **未找到** `dsh-client-ui-todo` 包（todo UI 在 `dsh-client-ui-tool` 的 todo-row 与 `dsh-client-ui-conversation` 的 TodoPanel）。
11. **未找到** `team/*` 四个事件在本安装内的独立 `.d.ts`（只有 `PKG/dsh-api-session-controller/lib/typert.host.js:1717` 的内联声明与 v0 迁移目录）。
12. **未找到**会话消息流的独立 `.css` 物理文件（全树仅 2 个 `.css`，见 4.5）。
13. **无法确定**：把 DOM 直接 `appendChild` 进 `[data-chat-flow]` 后，React 18.2 在后续 reconcile 时对该节点的确切处置（移到何处 / 是否移除），因为**我没有运行 DSH 做实验**，且这取决于 React 内部 reconciler 对具体子节点形态的选择。**建议不要依赖它**，改用 slot 机制（见 7.3）。
14. **无法确定**：各 CSS Module 哈希前缀（`Sixlwa_`、`o3BgMG_` …）在下一个 DSH 版本是否保持不变。它们是构建期哈希，理论上随构建变化；**本报告只能保证在当前这个安装（`dsh-web-frontend` 构建于 2025-09-16）内准确**。
15. **无法确定**：`run_code` 之外的 `variant: "code"` 工具在展开态的具体渲染细节（只读到 `CodeBlock lang:"typescript"` + `ioCard` 分支，未逐行核对 `CodeBlock` primitive 内部）。
