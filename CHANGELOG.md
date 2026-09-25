# 更新日志

本项目的版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.2.0

### 新增

- **快速跳章**：书架每行右侧的 `≡` 展开该书的步骤清单，滚动点选直接跳到任意一章；打开时当前章自动居中。点整行仍然是选中这本书接着读（ADR-0008）。
- **快进**：按住 `Shift` + `↓` / `→` 时输出的时钟走 40 倍（约每秒二十多行），松开立刻回到正常速度。快进的结束认**真实松手事件**而不是定时器，所以按住就是连着一大片出来。仍然是逐行逐字长出来的，不是整段蹦出（ADR-0009）。
- **书单能用鼠标**：书单开着时鼠标不触发退出 —— 否则手刚移到书名上界面就没了，等于根本点不到书。点书名打开、点 `✕` 删除、拖文件导入都能用；此时用 `Ctrl+Shift+Alt+Z` 收起（ADR-0007）。

### 修复：适配 DeepSeek Harness 0.1.7-rc.1

0.1.7 改了客户端插件与基线原语的若干契约，逐条按**实际安装产物**（`lib/*.js` 与
`lib/types/**/*.d.ts`）对齐，并在一个隔离的 DSH 0.1.7 实例里用 CDP 驱动真实浏览器端到端验证：
快捷键进出、空书库下的鼠标行为、拖放导入 txt、自动进入阅读、鼠标一动收场 —— 全通过。

- **`MarkdownText` 在运行时根本取不到，正文渲染整条静默降级**。0.1.7 的 `MarkdownText` 与
  `DisclosureRow` 都是 `React.memo(...)` 的产物（`.d.ts` 声明的类型就是 `MemoExoticComponent`），
  而 `React.memo` 返回的是**对象**：

  ```
  typeof MarkdownText       → 'object'
  Object.keys(MarkdownText) → ['$$typeof', 'type', 'compare']
  MarkdownText.$$typeof     → Symbol(react.memo)
  ```

  原判据是 `typeof value === 'function'`，于是 `withSafePrimitives` 认定"基线没有 MarkdownText"
  并直接返回**未包装**的模块 —— 下一节的 labels 兜底因此整条失效。判据改为
  「函数，**或带 `$$typeof` 的对象**」。

- **`labels` 从可选变必填，而渲染器是「无保护解引用」**。0.1.7 的实现直接读
  `context.labels.code.copyLabel`（`dsh-client-ui-primitives/lib/index.js:10725-10727`，围栏/缩进代码块）
  与 `context.labels.footnotes`（`:11025`）。漏传的后果不是"文案不对"，而是**正文里一旦出现
  代码块或脚注就 TypeError**，slot entry 被错误边界整条摘掉 —— 屏幕上那一段阅读流直接消失，
  且只在特定章节复现。改为在 `primitives.ts` 这一层给 `MarkdownText` 套上"labels 永远合法"的
  外壳（调用点照旧只传 `{ text, streaming: false }`），兜底文案取自 0.1.7 自带的中文词典
  （`dsh-client-locale/lib/client.js:933-937`、`:966`），不是自己编的。

- **拿不到「当前会话」，退化成 `ids[0]`**。0.1.7 的 `SessionListState` 只有
  `{ ids, byId, phase, projectionsBySession }`，**没有 `current` 字段**
  （`dsh-api-session-controller/lib/types/client/sessions/service.d.ts:43-52`）；而
  `sessions.binding(id)` 只对**已被 retain** 的会话返回 binding（`contract/sessions.d.ts:149-153`）。
  旧代码的 `state.current` 永远是 undefined，一旦 `ids[0]` 不是被 retain 的那个就拿不到事件流，
  只能退回硬编码模板 —— 那违反 ADR-0002（工作痕迹行必须来自**真实**会话历史）。
  改为从 session 作用域槽的 `sessionId` props 记录真实会话 id，兜底顺序写死为：
  真实 id 的 binding → 其余 id 中第一个能拿到非空 binding 的（`retainedBy.mainView` 优先）→ 模板。

- **图标名整批改名**。0.1.7 里 `Icon…Outline14` / `Icon…Outline16` **一个都不剩**
  （`grep -c "Outline14\|Outline16" lib/types/icons/index.d.ts` = 0），统一成
  `Icon…OutlineRegular`（1px 描边）/ `Icon…OutlineMedium`（1.3px 描边），尺寸只由 `size` 决定。
  取值改为「新名 → 旧名」降级链，同一份代码在新旧两版上都能取到图标。

- **`DisclosureRow` 的 `onToggle` 变必填**。当前靠 `expandable: false` 在运行时没崩
  （`lib/index.js:3046-3092` 证明不可展开时它从不被调用），但那是"靠一个 prop 的值兜住"的
  脆弱状态 —— 谁把 `expandable` 改成 true 就立刻崩。补一个模块级稳定 `noop`（写成常量而不是
  内联箭头：`DisclosureRow` 是 memo 的，回调每帧换新对象会让浅比较失效）。

### 其他

- 单测 193 → 212 条。新增的 `test/primitives.test.mjs` 用**逐字复刻 0.1.7 无保护解引用**的替身
  做红绿可证的验证：先断言裸调用必抛 TypeError，再断言套上外壳后既不会崩、也照常输出正文；
  另外钉住了「memo 形态的组件必须被当成组件」这条判据。
- `lib/` 已随源码重建（仓库直接消费产物，见 README「为什么 `lib/` 进版本库」）。

## 0.1.0

首个版本。

### 功能

- **伪装阅读**：把小说正文与你当前会话的真实工作痕迹行逐行交错，渲染成一股正在流式输出的日志流。屏幕上只有一种形态 —— 没有"书页模式"。
- **一键切换**：`Ctrl+Shift+Alt+Z` 进出伪装阅读态；**鼠标移动 1px 或点一下**立刻回到 DSH 真实界面。
- **只占右侧主区**：伪装层精确覆盖会话区里 Tab 之下、输入框之上的那一段，顶部标题栏、底部输入框、左侧栏都是真的。
- **导入**：拖入 `.txt`（自动识别 UTF-8 / GBK）或 `.epub`（保留插图，加密书明确报错）。
- **书架**：按 `L` 打开伪装成「最近的任务」的书架，进度即百分比。
- **进度记忆**：按"已输出字符占全章的比例"记录，重开精确停在离开处并自动滚过去。
- **逐字输出节奏**：按行分配时间预算（`charsPerSecond` / `minLineMs` / `maxLineMs`），短行不闪、长段落不干等。
- **上下微调**：`↑` `↓` 一次滚动十行正文。

### 设计取舍

- 只有伪装阅读一种形态：衬线字体 + 居中大留白的排版本身一眼就是阅读器，那是最直接的暴露面。
- 工作痕迹行取自**真实会话历史**，不是合成日志 —— 编出来的日志经不起多看两眼。
- 键盘永不退出伪装态，否则读到一半会被自己按没；退出只认鼠标 —— 书单是唯一例外，那个界面只能用鼠标操作。

### 隐私

- 无网络请求，无遥测，不读写工作区目录。
- 书籍只存在本机浏览器的 IndexedDB 里。
