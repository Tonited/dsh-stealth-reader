// `@deepseek-ai/dsh-client-ui-primitives` 的本地声明。
//
// 这个包**在磁盘上没有独立目录、也没有官方 .d.ts** —— 它内联在 DSH 的前端产物里，
// 由宿主在运行时通过模块表提供给插件。所以类型只能自己写。
//
// 下面的接口是从官方调用点**实测反推**的（见 `docs/dsh-conversation-ui.md` §7），
// 故意写得很窄：只声明本项目真正用到的成员，且一律用 `any` 表示 props ——
// 因为我们没有权威签名，写细了反而会让"升级后 props 变了"变成一个类型错误而不是
// 一次温和的降级（使用点都有存在性检查，见 primitives.ts）。
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** 折叠行：`[图标盒] 标题 · 折叠内容 …`。 */
  export const DisclosureRow: any
  /** 状态点：`{ state: 'error' | 'warning' | …, className? }`。 */
  export const StateDot: any
  /** Markdown 正文渲染器：`{ text, streaming?, labels?, fileMentions?, pathImages? }`。 */
  export const MarkdownText: any

  export const IconThinkOutline14: any
  export const IconChevronRightOutline14: any
  export const IconChevronDownOutline14: any
}
