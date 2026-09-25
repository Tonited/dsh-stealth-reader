// `@deepseek-ai/dsh-client-ui-primitives` 的本地声明。
//
// ⚠️ 旧注释（"这个包在磁盘上没有独立目录、也没有官方 .d.ts"）**从 0.1.7 起已过期**：
// 安装产物里有完整的
//   node_modules/@deepseek-ai/dsh-client-ui-primitives/package.json  （types: lib/types/index.d.ts）
//   node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/types/**
// 运行时它仍然是前端 shell 的**静态模块表**成员（`dsh-web-frontend/dist/assets/index-3dwByubT.js`
// 里的 `"@deepseek-ai/dsh-client-ui-primitives": lb`），所以 `require()` 拿到的就是这一份。
//
// 那为什么还留着自己写声明：**因为访问路径根本不走它**。所有使用点都经过
// `src/client/primitives.ts` 的 `PrimitivesLike`（成员一律可选、一律 `any`）与
// `pickIcon()` / `withSafePrimitives()`，目的是"原语改名或改 props 时只降级、不炸"。
// 把官方签名逐字搬进来当契约，等于把"升级后 props 变了"从一次温和降级变成一个类型错误。
//
// 这份声明的作用因此只有两个：让 `require` 这一句有类型，以及**把 0.1.7 的真实契约写在
// 代码里当物证**。下面每个成员都标了来源。
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /**
   * 折叠行。
   *
   * 0.1.7 契约（`lib/types/DisclosureRow.d.ts:3-31`）：
   * `{ icon: ReactNode; title: string; open: boolean; expandable: boolean;
   *    onToggle: () => void; … }` —— **`onToggle` 是必填**（`expandable: false` 时不会
   * 被调用，靠 prop 的值兜住，见 reading.tsx 的调用点）。
   */
  export const DisclosureRow: any
  /** 状态点：`lib/types/StateDot.d.ts:14-19`，`{ state: 'error' | …, size?, className? }`。 */
  export const StateDot: any
  /**
   * Markdown 正文渲染器。
   *
   * 0.1.7 的真实 props（`lib/types/markdown/MarkdownText.d.ts:41-48`）：
   * ```ts
   * { text: string; streaming?: boolean; labels: MarkdownLabels;
   *   fileMentions?: …; pathImages?: …; variant?: 'body' | 'compact' }
   * ```
   * 三条与旧版不同、必须记住的：
   *   1. **`labels` 必填**（`lib/types/markdown/render.d.ts:29-35`：`{ code: { copyLabel,
   *      copiedLabel, toolbarLabels? }, footnotes }`），而实现是**无保护解引用**
   *      （`lib/index.js:10725-10727` 的 `context.labels.code.copyLabel`、
   *      `lib/index.js:11025` 的 `context.labels.footnotes`）→ 不传就"遇到代码块/脚注即崩"。
   *      本插件在 `primitives.ts` 的 `withSafeLabels()` 里统一补上安全值。
   *   2. **没有 `className`**：实现只解构已知 props、不 spread rest（`lib/index.js:11178`），
   *      传了会被**静默丢弃**。需要挂 class 时自己在外层包一个容器。
   *   3. 新增 `variant`（`'body'` 默认 / `'compact'` 次要字号）。
   */
  export const MarkdownText: any

  /**
   * 图标。0.1.7 起命名改成"形状名 + `Regular`(1px) / `Medium`(1.3px)"，
   * 字号只由 `IconProps.size` 传（`lib/types/icons/props.d.ts:2-8`；默认值是字形自带尺寸，
   * 例：`IconChevronRightOutlineArtwork` 的 `size = 14`，`lib/index.js:493`）。
   *
   * `…Outline14` / `…Outline16` 这批旧名在 0.1.7 里**一个都没有**
   * （`lib/types/icons/index.d.ts` 里 `grep -c "Outline14\|Outline16"` = 0）。
   * 这里**刻意不声明旧名**——它们在本版不存在；旧名只作为运行时候选出现在
   * `primitives.ts` 的 `PrimitivesLike` 里（`pickIcon()` 负责"新名优先、旧名兜底"）。
   */
  export const IconThinkOutlineRegular: any
  export const IconThinkOutlineMedium: any
  export const IconChevronRightOutlineRegular: any
  export const IconChevronRightOutlineMedium: any
  export const IconChevronDownOutlineRegular: any
  export const IconChevronDownOutlineMedium: any
}
