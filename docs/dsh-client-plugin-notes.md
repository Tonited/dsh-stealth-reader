# DSH 客户端插件开发笔记

> 来源：2026-09-22 对已安装产物的只读调研（DSH 0.1.5-rc.2，web profile）。
> 每条都带证据路径；路径根：
> - `DSH` = `/home/ashley/.local/opt/node-v24.9.0-linux-x64/lib/node_modules/@deepseek-ai/dsh`
> - `WEB` = `/home/ashley/.dsh/profiles/web/node_modules`
>
> 本文件是**工程事实清单**，不是产品设计文档。产品决策见 `CONTEXT.md` / `docs/adr/`。

## 1. 客户端插件的最小骨架

一个客户端插件由四部分组成：

| 文件 | 作用 |
| --- | --- |
| `package.json` | `dsh.client` 声明 + `exports["./client"]` 指向**预构建单文件** |
| `cordis.patch.yml` | 一行 `insert`，把插件行插入 profile 的 loader 树 |
| `lib/index.js` | 宿主半（可选）：注册 settings 命名空间、提供工具等 |
| `lib/client.js` | 浏览器半：构建产物，真正被浏览器加载的东西 |

`cordis.patch.yml` 全文形态（`WEB/dsh-auto-collapse/cordis.patch.yml`）：

```yaml
- insert:
    - id: dsh-auto-collapse
      name: dsh-auto-collapse
```

`dsh.client` 字段的权威类型（`DSH/node_modules/@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts:39-52`）：

```ts
export interface DshClientManifest {
    platform: string;        // Web consumer 只认 'web'，非 'web' 直接不进 graph
    inject?: string[];       // 文档原文："Informational package-name dependencies, not Cordis service injection."
    immediately?: boolean;   // boot 第一阶段注册屏障；缺省=共享 application 批次
    external?: string[];     // 超出基线的精确模块请求（含 `<pkg>/client` 子路径）
}
```

**易踩的坑（本机实际踩过，插件整个加载失败）**：`inject` 在**两个地方**出现，语义完全不同：

| 位置 | 内容 | 语义 |
| --- | --- | --- |
| `package.json` → `dsh.client.inject` | **包名**（如 `@deepseek-ai/dsh-client-ui-slots`） | 仅"依赖信息"，不做 cordis 注入 |
| bundle 导出对象的 `inject` | **服务名**（如 `slots`） | 真正的服务闸（cordis fiber 的 inject 声明） |

`apply(ctx)` 里**直接读** `ctx.slots` 时，契约必须声明 `inject: ['slots']`；
漏声明不会静默降级，而是由 cordis 直接抛错：

```
cannot get property "slots" without inject
```

- 抛错位置：`@deepseek-ai/cordis/lib/index.js:675`
- 该规则在 client runner 的注释里也有说明：`dsh-cordis-client-runner/lib/client.js:311-320`
  —— "ctx.serviceName access is gated by the fiber's inject declaration"

**为什么单测容易漏掉它**：手搓一个"带 slots 属性"的假 ctx 直接调 `apply`，会绕过这道闸，
于是 `inject: []` 也能全绿。必须用**守卫 ctx**（只暴露契约声明的服务，其余抛错）来测，
见 `test/bundle.test.mjs` 的「apply 只访问契约里声明的服务」。

**另一个附带教训**：`@deepseek-ai/dsh-client-ui-slots` 是 10 个基线模块之一，
不要写进 `dsh.client.external`（那里只放"超出基线的精确模块请求"）。

替代写法：把所有服务访问放进 `ctx.inject([...], cb)` 嵌套块里（旧宿主缺该服务时不会让整个插件挂掉），但**模块级 `inject` 仍然要声明**，否则连 `ctx.inject` 这个入口都拿不到。

校验逻辑（`DSH/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:144-166`）：
- 声明了 `dsh.client` 但缺 `exports["./client"]` → 抛 `declares dsh.client but exports no "./client" bundle`。
- `exports["./client"]` 接受字符串**或** `{default: "..."}` 对象，其他形态报错。

## 2. 构建产物格式是固定的（硬约束）

浏览器端**只能是** lazy-CJS 工厂，由 `window.__ModuleLoader__.load({id, factory})` 注册：

```js
window.__ModuleLoader__.load({
  id: "dsh-git-review",
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    // ...
    exports.apply = apply; exports.inject = inject;
    return module.exports;
  }
});
```

证据：
- `DSH/node_modules/@deepseek-ai/dsh-client-modules/README.md:46` —— "The host serves built client bundles, so `pnpm run build` must have produced each `lib/client.js` before launch; a missing bundle fails activation loudly"。
- `lib/index.js:91` 常量 `CLIENT_BUNDLE_BUILD_INSTRUCTION = "run \`pnpm run build\` before launch"`；缺失时抛 `MissingClientBundleError`。
- `lib/client.js:303-318` —— `require` 只能命中静态模块表/已物化模块/已注册工厂，否则抛 "missed the module table"。

**不能**把 `.ts`/`.tsx`/原始 ESM(JSX) 当作 `./client` 指向的产物。`exports["./client"]` 的解析器不检查扩展名，但内容必须是合法 JS 的 CJS 工厂。

跨插件**值导入被禁止**（`WEB/.../settings-scope.d.ts:93-99`，client bundle purity gate）；要跨插件通信必须写进 `dsh.client.external` 再 `require("<pkg>/client")`。

静态（外部）模块基线只有 10 个：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。不在表里的第三方库**必须打进 bundle**。

## 3. 可用挂载点（slot）

权威清单：`DSH/node_modules/@deepseek-ai/dsh-cordis-client-runner/lib/client.js:2201` 的 `CLIENT_SLOT_API`（由 `scripts/gen-client-catalog.ts` 生成），共 61 个。`SlotKind = 'single'|'list'|'keyed'|'chain'`，`SlotScope = 'root'|'session-maybe'|'session'`。

注意：`@deepseek-ai/dsh-client-ui-slots` **在磁盘上没有独立包目录**，它被编译进前端 dist 的静态模块表，所以没有可读的 `.d.ts`；类型分散在各 `client-ui-*` 包的 `declare module '@deepseek-ai/dsh-client-ui-slots'` 里。

本项目相关的几个：

| slot | kind/scope | 用途 |
| --- | --- | --- |
| `shell.overlay` | list/root | **全帧浮动层**（高于所有列、滚动容器之外），加性、层本身点击穿透，条目自己 opt-in pointer events |
| `root` | single/root | 渲染树根洞，唯一由 shell 自己渲染的 slot（`ui-layout` 的 `AppFrame` 占用） |
| `settings.plugin.item` | keyed/root | 插件配置页里的一张卡，key = 你的 settings 命名空间 |
| `settings.general.item` | list/root | 通用设置里的一行偏好（不需要整页时用） |
| `conversation.session.header.actions` | list/session | 会话标题旁的动作 |
| `conversation.input.dock` | list/session | 输入卡片上方整宽条目（第三方插件最常用） |

注册 API（服务 `ctx.slots`，`lib/client.js:1338-1357`）：`register` 与 `inject(key, cb)`。**推荐所有注册都包在 `ctx.slots.inject(key, cb)` 里** —— slot 已存在则同步跑，否则等 owner 提交后跑，且返回幂等 disposer。

`register` 选项：`list` → `id`(必需)/`order`/`label`；`keyed` → `key`(必需)；`chain` → `select`；`single` → 无。第三方插件普遍还传 `locale`（已注册的 locale 命名空间）与 `inject: () => ({...})`。

`shell.overlay` 实测使用者：`WEB/dsh-context/lib/client.js:11440-11446`、`dshmarket/src/client/index.ts:192-197`、`@nanmicoder/dsh-agent-teams/lib/client/index.js:32-38`。要做固定定位就在组件里写 `position: fixed`，并自己把 CSS 字符串 `document.head.appendChild` 注入（例 `@y1x1n/dsh-prompt-optimizer/lib/client.js:1461-1467`）。

## 4. 命令与快捷键

- **命令**：`ctx.commandUi.register(contribution)`（`WEB/@deepseek-ai/dsh-client-ui-commands/lib/types/client/contract.d.ts:86-99`）。契约：`{name, description(), available(session), ui: PopupSelectSpec | ActionSpec}`，重名抛错（不会遮蔽宿主命令）。
- **快捷键：没有官方 API。** 插件一律自己挂 DOM 监听：`document.addEventListener('keydown', handler, true)`（实测 8+ 处，如 `WEB/dsh-better-sidebar/src/client/selection-popup.ts:120`、`@michengai/dsh-btw/lib/client.js:13532`）。
- 实测**没有任何第三方插件**调用过 `ctx.commandUi.register()` —— 该 API 存在但缺乏实践样本，需要自己趟。
- 反面教材：`@michengai/dsh-btw/lib/client.js:13672-13700` 猴补宿主内部方法（`attachOfficialBtw`）。别照抄。

## 5. 持久化

服务优先：`ctx.settingsScope.bind({namespace})`（`WEB/@deepseek-ai/dsh-client-ui-settings/lib/types/client/settings-scope.d.ts:88-140`，注入键 `settingsScope`）。

- 客户端：`getSnapshot()` / `subscribe(fn)` / `set(field, value)` / `unset(field)` / `mutate(ops, expectedRevision?)`。
- 快照形态：`{status: 'loading'|'ready'|'unavailable', value, base, user, revision, writable, mode: 'host'|'memory'}`。`mode: 'memory'` 时不可写（非 loopback 页面）。
- **宿主半必须注册同名命名空间**，否则客户端侧永远 `unavailable`：

```js
// lib/index.js（宿主半）
import z from "@deepseek-ai/schemastery";
export const name = "my-plugin";
export const inject = [];
export function apply(ctx) {
  ctx.inject(["settings"], (s) =>
    s.settings.register(name, z.object({ foo: z.string().default("") }), { base: { foo: "" } }));
}
```

`localStorage` 也可用，但只适合纯前端 UI 状态（`WEB/dsh-better-sidebar/src/client/state.ts:4`）。

## 6. 改代码后如何生效

**HMR 其实是可用的，但依赖"有东西真的重写了 bundle 文件"：**

1. `client-hmr` 行在 web profile 中**无条件挂载**（`DSH/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:162-168`）："always mounted: it is idle until a rebuild watcher (pnpm run dev:web) actually rewrites client bundles"。
2. 宿主每 500ms stat-poll 每个 graph bundle 的 `lib/client.js`，比对 `mtimeMs + size`（`DSH/node_modules/@deepseek-ai/dsh-client-hmr/lib/index.js:16-60`），变了才哈希。
3. 经 SSE `/plugins/events` 推 `{type:'rebuilt', id, rev}`，浏览器半 invalidate → prefetch → 拆旧 fiber → `entry.refresh()`，**原地热替换、不用刷新页面**（React 局部 state 丢失，会话状态保留）。

推论：
- 只改源码不重建 = 什么都不发生。
- **只要构建脚本真的写出 `lib/client.js`，HMR 就会自动热替换** —— 不需要 `pnpm run dev:web`（那条命令只是 DSH 源码仓库里的 watcher，本机没有源码 checkout）。
- 新增/删除插件行需要**重启 DSH**（loader 树重扫；HMR 只覆盖已在 graph 里的 row）。
- shell / 非插件包（react、cordis、前端 dist）改动仍需刷新页面。

### 6.1 热替换的代价：模块级状态会分叉（实测踩过）

HMR 是"原地热替换"，**旧模块实例的副作用不会自动撤销**。两条推论都能把插件搞成"看起来正常、实际没反应"：

| 留在旧实例里的东西 | 后果 |
| --- | --- |
| `window` 上的事件监听器 | 新代码**无法**移除它（拿不到旧函数引用）。若每次 `apply` 都 `addEventListener`，一次按键会切换好几轮；若用 `globalThis` 标志跳过绑定，window 上留住的就是**旧**判定逻辑 |
| 模块级变量（`let mode` / `const listeners = new Set()`） | 旧监听器改它的状态，新组件订阅的是新实例 —— 状态变在"另一个宇宙"，界面纹丝不动 |

本项目就是这样丢掉快捷键的：按键有反应（旧监听器在跑），`mode` 也在变（旧的那份），但没有任何订阅者看见。

两条应对（`src/client/bindings.ts`、`src/client/store.ts` 的实现依据）：

1. **跨热替换存活的状态一律放 `globalThis` 固定槽位**，不要用模块级 `let`；
2. **监听器只绑一次，且绑的是"稳定转发器"**：转发器不持有业务状态，每次调用都从 `globalThis` 槽位取**最新**处理函数。新代码只覆盖槽位即可生效 —— 既不累积监听器，也不会新旧逻辑并存。

已经有一份旧监听器残留的页面，**刷新一次**是最干净的收敛方式。

## 7. 键盘快捷键：没有 API，而且键位选择有雷区

**DSH 插件侧不存在键位绑定 API**（全部官方客户端 `*.d.ts` 中 `hotkey|keybinding|keyBinding|accelerator|registerShortcut` 零命中）。插件只能自己挂 `window.addEventListener('keydown', handler, true)`（capture 阶段，避免被组件级 `stopPropagation` 截断）。

### 本机现有占用（全部无修饰键）

扫描 `WEB/` 下 12 个已装插件 + 官方 Web UI：**没有任何插件占用带修饰键的组合**，keydown 监听只用 `Escape`（少数加 `ArrowLeft`/`ArrowRight`/`Enter`）。

- `@michengai/dsh-btw/lib/client.js:13531`、`@michengai/dsh-im-connect/lib/client.js:795/1216`、`@nanmicoder/dsh-agent-teams/lib/client.js:2186`、`@y1x1n/dsh-prompt-optimizer/lib/client.js:796`、`dsh-context/lib/client.js:3647/5177`、`dsh-git-review/lib/client.js:762/1261`、`dshmarket/client/client.js:3085/5842/6559`
- `dsh-auto-collapse` / `dsh-cost-meter` / `dsh-revert` 无 keydown 监听
- 唯一带修饰键的框架是内嵌的 PDF.js `KeyboardManager.#parseShortcut`（`dsh-client-ui-sidebar-documentpreview/lib/client.js:4828`），不是 DSH API

### 但 DSH 自身占用了 Ctrl+Shift+Z

官方 Web UI 的 Lexical 富文本把**重做**绑在 `Ctrl+Shift+Z` / `Ctrl+Y`（`DSH/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:5023-5037`）。浏览器也把 `Ctrl+Shift+Z` 用作"重开刚关闭的标签页"。→ **`Ctrl+Shift+Z` 不可用**。

### Windows + 中文输入法的雷区

| 组合 | 判定 | 原因 |
| --- | --- | --- |
| `Shift+Alt+字母` | 不可用 | `Alt+Shift` 是 Windows"输入语言/键盘布局切换"热键（`HKCU\Keyboard Layout\Toggle` → `Language Hotkey`=1，Win11 仍普遍默认）。Chromium 不消费该事件（[CL 348293002](https://codereview.chromium.org/348293002)），但布局在按键中途切换会污染后续 `key`/修饰键状态 |
| `Ctrl+Shift+字母` | 不可用 | 官方帮助页把 `Ctrl+Shift` 列为键盘布局切换键；且撞 DSH 重做 |
| 单独的 `Shift` | 不可用 | 微软拼音把 `Shift` 定义为中英模式切换（[官方 IME 帮助](https://support.microsoft.com/en-us/windows/microsoft-simplified-chinese-ime-9b962a3b-2fa4-4f37-811c-b1886320dd72)） |
| `Ctrl+Alt+字母` | 有条件可用 | 含 AltGr 的布局上 `Ctrl+Alt` ≡ `AltGr`（[MDN getModifierState](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState)） |
| `Win+字母` | 不可用 | 系统大量占用（`Win+Z` = Snap Layouts） |
| **`Ctrl+Shift+Alt+字母`** | **推荐** | 不在官方快捷键总表、非布局切换热键、非微软拼音自用键、不撞 DSH 绑定 |

Firefox (Windows) 额外有"单独按 Alt 打开菜单栏"的干扰，Chrome/Edge 无此问题。

### 必须的 handler 守卫

```js
window.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;  // IME 组合期放过（MDN 明确要求同时看 keyCode）
  if (e.repeat) return;                            // 长按去重
  if (e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyZ') {
    e.preventDefault();
    toggleReader();
  }
}, true);
```

`e.code`（物理键位 `'KeyZ'`）不受布局影响，是正确判断依据；`e.key` 会随布局/Shift 变化，组合期还可能变成 `'Process'`。

**没有任何全局键位对第三方 IME 自定义热键免疫** —— 因此兜底入口（命令面板）是必需品，不是可选项。

### 命令 API（不是快捷键 API）

**客户端命令**：`ctx.commandUi.register(contribution: CommandContribution): () => void`
（契约：`@deepseek-ai/dsh-client-ui-commands/lib/types/client/contract.d.ts`）

```ts
interface CommandContribution {
  readonly name: string                       // 不带前导斜杠
  readonly description: () => string          // 请求候选项时才求值（本地化时机）
  available(session: ClientSessionContext): boolean  // 每次候选都重新调用
  readonly ui: PopupSelectSpec | ActionSpec
}
// ActionSpec     { kind: 'action',      run(session): void }
// PopupSelectSpec{ kind: 'popupSelect', options(session, signal), onSelect(option, session) }
```

关键性质（契约注释原文）：这是**"行为完全在客户端"的斜杠菜单项**（"no host descriptor"），
与宿主目录按名合并，**重名在候选合成时 loud fail，绝不遮蔽宿主命令**。
`action` 型"消费触发 token 并跑一个客户端回调，不提交任何东西"——这正是"打开阅读器"需要的形态。

还有 `decorate(decoration)`：给**宿主命令的裸调用**挂一个客户端弹窗，它不制造菜单行，
只替换裸调用行为。（本项目用不到。）

**宿主侧命令**是另一回事：`ctx.commands.register({...})`（实例 `@michengai/dsh-btw/lib/index.js:462/474/487`，
描述符 `CommandDescriptor`，见 `@deepseek-ai/dsh-commands`）。它注册的是**后端命令**，
调用后返回文本结果 —— 对"切换一个前端界面"无能为力。

**实测（本项目 H1）**：`ctx.commandUi.register()` 可以用。第三方插件此前**零使用样本**，
所以这条路是我们第一次趟通；契约校验（命令名、description/available 形态、ui.kind）已写成单测。

### 会话数据读取（`ctx.sessions`）

`ctx.sessions` 的类型是 `ISessions`（`@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/sessions.d.ts`）：

- `list: ObservableSnapshot<SessionListState>` —— 会话列表快照；
  `get()` 或 `.value` 取值，字段为 `{ ids: SessionId[], byId: Record<id, SessionSummary>, current, phase, ... }`。
- `SessionSummary` 有 `id / title? / displayTitle / cwd? / parentId? / running / completed?` ——
  **`displayTitle` 是"durable title → 项目目录名 → 会话 id"依次回退的展示名，一定有值**。
- 另有 `open(id)` / `refresh()` / `search(query, signal)`（搜索走宿主的消息内容索引）。

**重要缺口**：`SessionSummary` **不含任何消息正文**；`SessionSnapshot`（`ISession.snapshot`）
只有 `queue` / `pendingSubmissions` / `running` / `openState` 等**生命周期状态**，也没有对话历史。
所以"伪装壳里放真实消息片段"需要另找数据面（会话投影或 conversation 服务），
这不是 `sessions.list` 能提供的东西。

## 8. 怎么验证一个插件真的被加载了（不必靠肉眼）

浏览器侧的 401 挡住了直接看 HTML，但有两个不用认证的入口：

**① SSE 事件流（推荐）** —— 会推送完整的客户端模块图：

```bash
timeout 4 curl -sN http://127.0.0.1:3080/plugins/events
```

返回 `data: {"type":"graph","graph":{"entries":[...],"batches":[...]}}`。
在 `entries` 里找你的插件 id，能看到它的 `url` / `rev` / `inject` / `external`；
在 `batches` 里能看到它排在哪个批次（`bootstrap` / `application`）。
**插件不在 entries 里 = loader 树根本没加载它**（先去查 profile 的 `dsh.profile.bundles`）。

**② 直接取 bundle** —— 用 entries 里的 `url` 原样请求：

```bash
curl -s "http://127.0.0.1:3080/plugins/??<pkg>/client.js&rev=<rev>"
```

宿主会在响应末尾追加 `//# sourceMappingURL=...`，所以**字节数与 md5 与本地产物不同是正常的**，
比对时忽略末尾那一行即可。

**③ `dsh --profile web --dump-config`** —— 打印组合后的 loader 树。
注意：它只反映宿主侧条目，**不含客户端 bundle 表**，
所以客户端插件在这里查不到是正常的，不要据此判断失败。

**失败时的线索位置**：插件加载错误不出现在 HTTP 层，而在浏览器 console；
服务端日志通常只有 `dsh web: http://...` 这类启动信息。修复后若 HMR 不能自愈
（例如条目此前加载失败），重启 `dsh web` 是可靠做法。

## 9. 用 `file:` 依赖开发时的同步陷阱

以 `pnpm add file:/path/to/plugin` 装进 profile 后，pnpm **复制**了当时的产物（inode 与工作区不同，
说明不是符号链接）。后果：

> 工作区里 `pnpm run build` 重新生成 `lib/client.js` 之后，
> **必须再复制进 profile**，否则 DSH 的 client-hmr 永远看不到变化
> （它 stat-poll 的是 profile 里那份的 mtime/size）。

本项目的 `deploy.mjs`（`pnpm run deploy`）把"构建 + 复制到 profile"合成一步。
判定是否已同步：比对两侧 `md5sum`（只比 `lib/`，不要比整个包）。

注意 deploy 需要写 `$DSH_HOME/profiles/<profile>/node_modules/<pkg>/lib/`，
在受限沙箱里会被拒 —— 这是预期行为，不是脚本 bug。

## 10. 未解明 / 待验证

- `ctx.commandUi.register()` 的**浏览器端**呈现待确认：菜单里是否真的出现 `/stealth` 行、`action` 型选中后是否只消费 token 不产生消息。
- 伪装壳要的**消息正文**来源未找到：`sessions.list` 只给标题，`SessionSnapshot` 只给生命周期状态；
  可能要走会话投影（projection）或 conversation 服务。
- 61 个 slot 的 `session-maybe` 与 `session` 作用域差异在插件生命周期中的实际表现（尤其是 overlay 在"无会话"页面时是否仍渲染）。
- 非 loopback 访问（局域网打开 GUI）时 settings 变只读，对本地插件无影响但需注意。
