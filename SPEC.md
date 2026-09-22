# SPEC — dsh-stealth-reader 实现规格

> 本文是**实现契约**：范围、验收标准、实现顺序、高风险假设。
> 术语定义见 `CONTEXT.md`；为什么这么定见 `docs/adr/`；DSH 平台事实见 `docs/dsh-client-plugin-notes.md`。
>
> 状态：已封版（2026-09-22）。后续变更需同步更新本文件或对应 ADR。

## 1. 目标与非目标

**一句话**：让用户在工作场景下隐蔽地读自己导入的本地小说，并且**随时一键消失**。

### 做

- 浏览器端导入本地 `txt` / `epub`（选文件 + 拖拽）。
- 全屏阅读器：限宽居中排版、章节切分、目录跳转、续读。
- 三层互斥界面状态与秒级切换（阅读态 / 隐藏态 / DSH 真实界面）。
- 书架（低调列表）、外观偏好设置卡。
- 快捷键 `Ctrl+Shift+Alt+Z` + 命令面板命令兜底。

### 明确不做

全文搜索、pdf/mobi/azw3、加密（DRM）epub、在线书源、AI 联动（总结/问答）、纯图片 epub、跨设备同步、npm 发布。

## 2. 验收标准

> ⚠️ 本节已按 **ADR-0005** 修订：书页排版被取消，唯一的阅读形态是**伪装阅读**
> （正文与工作痕迹行交错）。原"衬线 + 居中 + 大留白"的验收项作废。

主链路（端到端手测）：

- [ ] 拖一个 5MB 的 **GBK 编码** txt 进去，任务列表出现这本书，正文**不是乱码**。
- [ ] `/stealth` 能读：正文以**等宽排版**呈现，工作痕迹行穿插其间，可滚动。
- [ ] `←` `→` 能跳到上下章；`L` 打开任务列表。
- [ ] 关掉浏览器标签页重新打开 DSH，这本书的阅读进度**回到原处**（误差半屏内）。
- [ ] 在伪装阅读里按 `Ctrl+Shift+Alt+Z`，**正文立刻消失**、只剩工作痕迹（阅读位置不丢）。
- [ ] 在 DSH 真实界面按 `Ctrl+Shift+Alt+Z`，屏幕立刻变成"AI 正在跑长任务"的日志流。
- [ ] `stream` 态下**鼠标移动 1px / 点击 / pointerdown** 立刻回到 DSH 真实界面（键盘与滚轮不退出，见 ADR-0006）。
- [ ] 伪装阅读里点一下鼠标：正文消失但**不**跳回 DSH 界面；再点一下才回 DSH 界面。
- [ ] 命令面板里能找到一条**进入伪装阅读**的命令。
- [ ] 导入一本加密 epub，得到明确错误提示，**任务列表里不出现这本书**。
- [ ] 导入中途刷新页面，任务列表里**不出现**半本书。

单元测试（`node:test`，纯函数）：

- [x] txt 章节切分：有「第X章」标记、无标记、混合标记、超长无空行段落。
- [x] 编码回退：UTF-8 合法 → 不误判；GBK 文本 → 回退成功；二进制垃圾 → 明确失败。
- [x] epub 解析：章节顺序（按 spine 而非文件名）、图片路径解析、加密检测。
- [x] 任务流排布：**确定性**（同章两次渲染逐行相同）、正文一段不丢、痕迹行间距在契约区间内。
- [ ] 进度比例换算：给定字号/窗口变化后的重排布局，恢复位置误差在半屏内。

## 3. 界面状态机（本项目的核心）

状态定义与转换见 **ADR-0005**。三个**互斥**状态：

| 状态 | 屏幕上是 | 交互契约 |
| --- | --- | --- |
| `closed` | DSH 真实界面 | —— |
| `disguise` | 只有工作痕迹 | **任何点击/按键立刻回到 DSH 真实界面** |
| `reading` | 工作痕迹 + 正文交错 | 滚动/翻页/跳章；**点击 = 降级到 `disguise`** |

```
closed ──快捷键──▶ disguise ──快捷键──▶ reading
   ▲                  │                   │
   │                  │ 任意交互           │ 快捷键（正文立刻消失）
   └──────────────────┘◀──────────────────┘
                      ▲
                      └── reading 点击（渐进降级）
```

不变式：

1. **切换只朝"减少暴露"的方向发生**。`closed → disguise`（先藏起来）、`reading → disguise`
   （正文消失）都是"更安全"；只有 `disguise → reading` 会把正文显示回来，而那要求用户
   已经处于"藏好"的状态。所以**任何状态下按快捷键都不会让屏幕上多出小说内容**。
2. `disguise` 下**任何交互**（click / wheel / keydown / touchstart）都退回 DSH 真实界面。
3. `reading` 下**不**收场：否则就没法读书。点击只降一级（`reading → disguise`）。
4. 阅读进度在状态切换中**永不丢失**（切换只改显示层）。
5. `disguise` **永不白屏**：取不到会话数据也必须渲染出通用模板。
6. 任务流的排布必须**确定性**：同一章每次渲染逐行相同，否则滚动位置会漂移。

实现载体：`shell.overlay`（DSH 的全帧浮动层 slot，root 作用域、加性、点击穿透），条目内自行 `position: fixed` 铺满视口。

## 4. 数据模型（概念层）

- **Book**：`{ id, title, format: 'txt'|'epub', chapters: Chapter[], addedAt, coverThumb? }`
- **Chapter**：`{ index, title, text, images? }`（`text` 里的插图位置由 `U+FFFC` 占位符标出）
- **Progress**：`{ bookId, chapterIndex, ratio }` —— `ratio` 是**章内滚动比例**（见 ADR-0004 的偏离说明）
- **Prefs**（存 DSH settings）：`{ hotkey, fontSize, lineHeight, theme, disguise: { useExcerpts, customLines[] } }`

存储边界：Book/Chapter/Progress → **IndexedDB**（正文大，不进 settings）；Prefs → **DSH settings**。

导入事务性要求：**解析成功才落库**。半途中断的导入不产生书架条目（临时状态仅存内存）。

## 5. 实现顺序（每步都必须能独立验证）

| 步 | 内容 | 验证方式 |
| --- | --- | --- |
| 1 | 骨架：`package.json` / `cordis.patch.yml` / esbuild 构建脚本 / 宿主半（settings 命名空间）/ 空客户端半 | 构建产出合法的 `lib/client.js`；装进 profile 后 DSH 能启动、控制台无错 |
| 2 | **高风险探针**：`ctx.commandUi.register()` 能否注册；客户端能否拿到会话数据 | 探针日志与命令面板实测（见 §6） |
| 3 | txt 导入 + 章节切分 + 编码回退 + 书架列表 | 拖 5MB GBK txt，书架出现且不乱码 |
| 4 | 阅读态（限宽排版 + 滚动 + 顶底栏自动隐藏） | 能读 |
| 5 | **三态机 + 快捷键 + 伪装壳** | §2 的全部切换类验收项 |
| 6 | 进度持久化 + 比例重定位 | 改字号后进度不跑偏 |
| 7 | 目录跳转 | 能跳章 |
| 8 | epub 导入（fflate + spine 顺序 + 图片） | epub 能读、插图正常、加密书报错 |
| 9 | 设置卡（`settings.plugin.item`） | 字号/行距/主题/键位/伪装日志开关可改 |
| 10 | 单元测试补齐 | `node --test` 全绿 |

**第 5 步是本项目的成败所在**：隐藏机制不可信，其余功能全部无意义。所以它排在 epub 之前。

## 6. 高风险假设与验证方式

这三条是"文档里查不到、只能实测"的：

| # | 假设 | 结果（2026-09-22 实测） |
| --- | --- | --- |
| H1 | `ctx.commandUi.register()` 能注册客户端命令 | **✔ 已验证**：`/stealth` 注册成功（第三方插件此前零使用样本） |
| H2 | 能读到"最近会话"的数据 | **✔ 已验证，且比预期多**：`sessions.list.getSnapshot()` 给到 505 个会话标题；`sessions.binding(id).eventSource.getSnapshot().entries` 给到正文与 `tool/call` |
| H3 | 构建产物写出后 HMR 能热替换 | **✔ 已验证**：SSE 收到 `{type:'rebuilt'}` 帧，浏览器原地热替换 |

### 探针纠正的两处实现错误（都已在单测里钉住）

1. **`ObservableSnapshot` 的取值方法是 `getSnapshot()`**，不是 `get()` / `.value`。
   最初按猜测写成后者 → 永远读到空快照（表现为"0 个会话"）。
   官方用法证据：`dsh-client-ui-workspace/lib/client.js:50/83/122`。
2. **正文来自 `SessionBinding.eventSource` 的事件窗口**，`SessionSummary` 与 `SessionSnapshot` 都不含正文。
   实测事件类型：`assistant/message, tool/call, tool/result, step/end, step/start, approval/asked, approval/decided, todo/write`。

### 由探针带来的新选项（优于原计划）

`tool/call` 事件存在 → **工具名统计**（`Read × 12 · Bash × 5`）可以真实生成。
它只有工具名与次数、没有内容，**是三条数据源里风险最低的**，
比正文片段更适合做伪装壳的主体。正文片段（ADR-0002 里用户坚持要的）作为叠加层，用设置项控制。

`displayTitle` 的回退链是 `durable title → 项目目录名 → 会话 id`，所以标题必须过路径过滤。

## 7. 平台约束（来自 `docs/dsh-client-plugin-notes.md`，不要重新推导）

- 客户端产物**必须**是 `window.__ModuleLoader__.load({id, factory})` 的 lazy-CJS 单文件；不能是 TS/JSX/原始 ESM。
- 第三方库（fflate）**必须打进 bundle**；`require` 只能命中 10 个基线模块之一。
- slot 注册一律包在 `ctx.slots.inject(key, cb)` 里。
- 宿主半必须注册 settings 命名空间，否则客户端侧永远 `unavailable`。
- 快捷键无官方 API，自己挂 `window` keydown（capture）+ IME 守卫 + `e.repeat` 去重 + 用 `e.code`。
- 新增/删除插件行需**重启 DSH**；只改代码则 HMR 自动生效（前提是构建真的重写了 `lib/client.js`）。

## 8. 工程约定

- 源码 `src/`（TS/TSX），构建产物 `lib/`（不手改）。
- 构建：`esbuild` 打包 + 自写 wrapper 生成 ModuleLoader 头；`tsc --noEmit` 类型检查。
- 包管理：**pnpm**。
- 测试：`node:test`，只测纯函数；UI 手测。
- 开发装载：web profile 的 `package.json` 加 `file:/path/to/dsh-stealth-reader`。
