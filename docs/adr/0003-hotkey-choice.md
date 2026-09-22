# ADR 0003 — 快捷键定为 Ctrl+Shift+Alt+Z，并保留命令面板兜底

- 状态：已接受
- 日期：2026-09-22

## 背景

"隐蔽"的根本要求是**不留下可见入口**，所以主要入口是键盘快捷键而非按钮。但：

1. **DSH 客户端插件没有键位绑定 API**（官方全部客户端 `*.d.ts` 中 `hotkey|keybinding|accelerator|registerShortcut` 零命中），插件只能自己挂 `window` 的 keydown 监听，没有任何冲突仲裁机制。
2. Windows + 中文输入法环境下，大量看起来自然的三键组合其实是系统热键。

用户最初的两次选择（`Shift+Alt+Z`、`Ctrl+Shift+Z`）都撞上了硬冲突：

| 组合 | 冲突来源 |
| --- | --- |
| `Shift+Alt+Z` | `Alt+Shift` = Windows 输入语言/键盘布局切换热键（`HKCU\Keyboard Layout\Toggle`，Win11 仍普遍默认）；微软拼音把**单独的 Shift** 定义为中英模式切换 |
| `Ctrl+Shift+Z` | **DSH 官方 Web UI 把"重做"绑在这里**（`dsh-client-ui-conversation/lib/client.js:5023-5037`）；浏览器也用它重开刚关闭的标签页 |

## 决策

主键 **`Ctrl+Shift+Alt+Z`**，并同时注册一条**命令面板命令**作为兜底入口。键位写入 DSH settings，可改。

## 理由

1. 该组合不在 Windows 快捷键总表、不是布局切换热键、不是微软拼音自用键、不撞 DSH 现有绑定；本机 12 个已装插件也没有占用任何带修饰键的组合。
2. **没有任何全局键位能对第三方 IME 自定义热键免疫**，所以兜底入口是必需品而非可选项——这是本决策的一半。
3. 键位可改，意味着押错也只是配置问题，不是重新设计。

## 代价

- **三个修饰键手感偏重**，是本次全部候选里最别扭的一个。
- 命令面板路径**没有实践样本**：全部已装第三方插件都没有调用过 `ctx.commandUi.register()`，这条 API 需要自己趟通（见 `docs/dsh-client-plugin-notes.md` §7）。
- 被排除的次优选择 `Ctrl+Alt+Z` 手感更好，但在含 AltGr 的键盘布局上 `Ctrl+Alt ≡ AltGr`，会误触字符输入。

## 实现约束（由本决策派生，不是偏好）

- handler 挂在 `window` 的 **capture 阶段**（避免被组件级 `stopPropagation` 截断）。
- 顶部必须有 IME 守卫：`if (e.isComposing || e.keyCode === 229) return;`（MDN 明确要求同时检查 `keyCode`，只查 `isComposing` 会漏掉边界情形）。
- 必须处理 `e.repeat`（长按去重）。
- 判定用 `e.code === 'KeyZ'`（物理键位，不受布局影响），**不要用 `e.key`**（随布局与 Shift 变化，组合期可能是 `'Process'`）。
