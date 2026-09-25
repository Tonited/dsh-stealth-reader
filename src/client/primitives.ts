// DSH UI primitives 的接入。
//
// 复用 DSH 自己的组件是"最不露馅"的做法：同一份代码、同一张 CSS，像素级一致。
// 自己照着实测规格模仿总会差一点 —— 尤其是行高与图标盒的对齐。
//
// 这里有两个刻意的取舍：
//
//   1. **必须用静态 import**。esbuild 只对静态 import / 字面量 `require` 做 external
//      处理；写成 `loader(MODULE_NAME)`（变量）时它根本不认识这个模块，产物里连
//      一次请求都不会出现 —— 表现为"代码看起来对，运行时永远走回退分支"，很难发现。
//   2. **容错放在组件级**：模块本身在 DSH 的基线模块表里（多个官方包都在 require 它），
//      但**具体某个组件**未来可能改名或挪走，所以每个使用点都检查存在性，
//      缺了就退回自绘样式。这样最坏情况是"样式差一点"，而不是"插件加载失败"。
//      组件**内部契约**变了（props 从可选变必填、导出名改后缀）也走同一原则：
//      能补的补、能降的降，绝不把异常抛到渲染树上（见 withSafePrimitives / pickIcon）。
//
// ⚠️ 如果 DSH 升级后换掉了这个模块名，需要改的就是下面的字面量。
import * as React from 'react'

/**
 * 本项目实际用到的 primitives 成员。
 *
 * props 形状以 **0.1.7 安装产物里的官方 `.d.ts` 为准**（0.1.6 时代那份"实测反推"的
 * 注释已过期：0.1.7 起该包在磁盘上有独立目录和官方类型，`types: lib/types/index.d.ts`）：
 * - `DisclosureRow`：`dsh-client-ui-primitives/lib/types/DisclosureRow.d.ts:3-31`，
 *   `{ icon, title, open, expandable, onToggle, … }` —— **`onToggle` 是必填**。
 * - `StateDot`：`lib/types/StateDot.d.ts:14-19`，`{ state: 'error' | …, size?, className? }`。
 * - `MarkdownText`：`lib/types/markdown/MarkdownText.d.ts:41-48`，
 *   `{ text, streaming?, labels, fileMentions?, pathImages?, variant? }` —— **`labels` 是必填**。
 *
 * 成员一律可选、一律 `any`：我们只保证"拿不到就降级"，不保证签名永远一致。
 */
export interface PrimitivesLike {
  DisclosureRow?: any
  StateDot?: any
  MarkdownText?: any
  /**
   * 图标。
   *
   * 0.1.7 起图标**不再把字号写进名字**：形状名 + `Regular`（1px 描边）/ `Medium`（1.3px），
   * 尺寸只由 `IconProps.size` 决定（`lib/types/icons/index.d.ts:1-6`、`lib/types/icons/props.d.ts:2-8`）。
   * 旧名（`…Outline14` / `…Outline16`）在 0.1.7 里**一个都不剩**
   * （`grep -c "Outline14\|Outline16" lib/types/icons/index.d.ts` = 0），但插件要能同时跑在
   * 旧版与 0.1.7 上，所以两边都留着，由 `pickIcon()` 按"新名优先、旧名兜底"取。
   */
  IconThinkOutlineRegular?: any
  IconThinkOutlineMedium?: any
  IconThinkOutline14?: any
  IconChevronRightOutlineRegular?: any
  IconChevronRightOutlineMedium?: any
  IconChevronRightOutline14?: any
  IconChevronDownOutlineRegular?: any
  IconChevronDownOutlineMedium?: any
  IconChevronDownOutline14?: any
}

/** MarkdownText 的 `labels.code`（`lib/types/markdown/render.d.ts:22-28`）。 */
export interface MarkdownCodeLabelsLike {
  copyLabel?: string
  copiedLabel?: string
  /** 可选：缺省时 0.1.7 的 CodeBlock 不渲染工具栏（见下方 FALLBACK 的注释）。 */
  toolbarLabels?: { codeLabel?: string; wrapLabel?: string; unwrapLabel?: string }
}

/** MarkdownText 的 `labels`（`lib/types/markdown/render.d.ts:29-35`）。 */
export interface MarkdownLabelsLike {
  code?: MarkdownCodeLabelsLike
  footnotes?: string
}

/**
 * 兜底的 Markdown chrome 文案。
 *
 * 存在的理由：0.1.7 的 `MarkdownText` 把 `labels` 从可选改成了**必填**，而渲染器是
 * **无保护解引用**：
 *   - `lib/index.js:10725-10727` —— `copyLabel: context.labels.code.copyLabel`（围栏 / 缩进代码块）
 *   - `lib/index.js:11025`        —— `children: context.labels.footnotes`（脚注）
 * 少传一个 `labels` 就等于"章节正文里一旦出现代码块或脚注就 TypeError"，
 * 而 slot entry 抛错会被错误边界整条摘掉 —— 屏幕上那一段阅读流直接消失。
 *
 * 文案**照抄 0.1.7 自带的中文词典**，不自己编：
 *   `dsh-client-locale/lib/client.js:933-937`（copy=复制 / copied=复制成功 /
 *   codeBlock.title=代码块 / codeBlock.wrap=自动换行 / codeBlock.unwrap=取消自动换行）
 *   `dsh-client-locale/lib/client.js:966`（markdown.footnotes=脚注）
 * 为什么不去取实时的 `t()`：本插件的覆盖层注册在 **root 作用域**的 `shell.overlay` 上，
 * 没有 locale 座位（`dsh-client-ui-renderer/lib/client.js:723-726`：只有 `entry.locale`
 * 非空才会合成 `t`）；为一个文案去 inject 新服务，一旦服务名不存在就会**静默 pending、
 * apply 永不执行**（审计报告 §2.1 点出的最危险失败模式）。不值得。
 *
 * `toolbarLabels` 一并给出，好让代码块长出和真实消息一样的卡片头（不传时 0.1.7 会退成无
 * 工具栏的朴素版，`lib/index.js:10239-10248` 用 `toolbarLabels !== void 0` 分流）。
 *
 * ⚠️ 必须**引用稳定**：`MarkdownText` 的 props 文档明说 labels 换新对象会丢掉流式渲染缓存
 * （`lib/types/markdown/MarkdownText.d.ts:21-28`）。所以这里冻结成单例，缺省路径永远返回
 * 同一个对象（见 `resolveMarkdownLabels`）。
 */
export const FALLBACK_MARKDOWN_LABELS: MarkdownLabelsLike = Object.freeze({
  code: Object.freeze({
    copyLabel: '复制',
    copiedLabel: '复制成功',
    toolbarLabels: Object.freeze({
      codeLabel: '代码块',
      wrapLabel: '自动换行',
      unwrapLabel: '取消自动换行',
    }),
  }),
  footnotes: '脚注',
})

/** 是不是可用的字符串。0.1.7 渲染器要的三样（copyLabel / copiedLabel / footnotes）都是 string。 */
function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/** 工具栏文案是可选的，但**给了就必须成形**：`CodeToolbar` 会直接读 `labels.codeLabel`。 */
function isToolbarSafe(value: unknown): boolean {
  const toolbar = value as { codeLabel?: unknown; wrapLabel?: unknown; unwrapLabel?: unknown } | null
  return (
    isText(toolbar?.codeLabel) && isText(toolbar?.wrapLabel) && isText(toolbar?.unwrapLabel)
  )
}

/** `labels` 是否已经是 0.1.7 认的完整形状（完整就原样放行，不制造新对象）。 */
function isCompleteLabels(labels: unknown): boolean {
  const candidate = labels as MarkdownLabelsLike | null
  if (!isText(candidate?.code?.copyLabel)) return false
  if (!isText(candidate.code.copiedLabel)) return false
  if (!isText(candidate.footnotes)) return false
  const toolbar = candidate.code.toolbarLabels
  return toolbar === undefined || isToolbarSafe(toolbar)
}

/** 同一个畸形对象只合并一次：见 FALLBACK_MARKDOWN_LABELS 的"引用稳定"说明。 */
const mergedCache = new WeakMap<object, MarkdownLabelsLike>()

/**
 * 把任意 `labels` 归一到"0.1.7 渲染器绝不会读空"的形状。
 *
 * 三种输入都安全：
 *   - 完整 → 原样返回（保持调用方的引用，连 `toolbarLabels` 的"故意省略"也尊重）；
 *   - 缺失（undefined/null/非对象）→ 单例 `FALLBACK_MARKDOWN_LABELS`；
 *   - 畸形（`{ code: null }` / `{ code: { copyLabel: 42 } }` / 少了 footnotes …）→
 *     逐字段补齐，并按对象身份缓存，保证同一份输入永远得到同一个输出对象。
 */
export function resolveMarkdownLabels(labels: unknown): MarkdownLabelsLike {
  if (labels === undefined || labels === null) return FALLBACK_MARKDOWN_LABELS
  if (typeof labels !== 'object') return FALLBACK_MARKDOWN_LABELS
  if (isCompleteLabels(labels)) return labels as MarkdownLabelsLike

  const hit = mergedCache.get(labels)
  if (hit !== undefined) return hit

  const code = (labels as MarkdownLabelsLike).code
  const fallbackCode = FALLBACK_MARKDOWN_LABELS.code!
  const merged: MarkdownLabelsLike = {
    code: {
      copyLabel: isText(code?.copyLabel) ? code.copyLabel : fallbackCode.copyLabel,
      copiedLabel: isText(code?.copiedLabel) ? code.copiedLabel : fallbackCode.copiedLabel,
      toolbarLabels: isToolbarSafe(code?.toolbarLabels) ? code!.toolbarLabels : fallbackCode.toolbarLabels,
    },
    footnotes: isText((labels as MarkdownLabelsLike).footnotes)
      ? (labels as MarkdownLabelsLike).footnotes
      : FALLBACK_MARKDOWN_LABELS.footnotes,
  }
  mergedCache.set(labels, merged)
  return merged
}

/**
 * 判断一个导出值是不是**可渲染的 React 组件**。
 *
 * 为什么不能只写 `typeof value === 'function'`（本项目在 0.1.7 上栽过的坑）：
 * 0.1.7 的 `MarkdownText` 与 `DisclosureRow` 都是 `React.memo(...)` 的产物，
 * 而 `React.memo` 返回的是**对象**而不是函数。隔离环境里实测：
 *
 * ```
 * typeof MarkdownText      → 'object'
 * Object.keys(MarkdownText) → ['$$typeof', 'type', 'compare']
 * MarkdownText.$$typeof     → Symbol(react.memo)
 * ```
 *
 * 官方 `.d.ts` 同样写着 `MemoExoticComponent`（`lib/types/markdown/MarkdownText.d.ts:41-48`）。
 * 只认函数的后果不是"少个图标"，而是：`withSafePrimitives` 认定"基线没有 MarkdownText"
 * 就直接返回**未包装**的模块，于是 `labels` 兜底整条失效，正文里一旦出现代码块或脚注
 * 就是 TypeError；同时 `pickIcon` 会把 memo 形态的组件当成"名字在但值不是组件"而丢弃。
 * 两处都是静默的。
 *
 * @param value - 从基线模块表取到的导出值。
 * @returns 是否可以交给 `React.createElement`。
 */
export function isRenderableComponent(value: unknown): boolean {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && '$$typeof' in value
}

/**
 * 给一个 MarkdownText 组件套上"labels 永远合法"的外壳。
 *
 * 为什么包在**这一层**而不是在每个调用点传：调用点只知道"我要渲染一段正文"，
 * 让它去关心 DSH 某个版本的 props 是不是必填，等于把版本差异扩散到整个渲染树；
 * 而且**漏传一次就是一次崩**。包在这里，调用点照旧 `{ text, streaming: false }` 即可。
 */
export function withSafeLabels(component: any): any {
  if (!isRenderableComponent(component)) return component
  const SafeMarkdownText = (props: any): any =>
    React.createElement(component, { ...props, labels: resolveMarkdownLabels(props?.labels) })
  return SafeMarkdownText
}

/**
 * 把模块里的 `MarkdownText` 换成带兜底的外壳（其余成员原样透传）。
 *
 * 单独成一个可注入的函数（而不是塞在 `loadModule` 里）是为了能单测：
 * 测试传进来的假组件会**逐字复刻 0.1.7 的无保护解引用**，以此证明这层壳真的挡住了崩溃。
 *
 * @param module - `require('@deepseek-ai/dsh-client-ui-primitives')` 的返回值（任意形状）。
 * @returns 窄接口视图；不是对象时返回 null（调用方退回自绘）。
 */
export function withSafePrimitives(module: unknown): PrimitivesLike | null {
  if (!module || typeof module !== 'object') return null
  const primitives = module as PrimitivesLike
  // 判据必须是 isRenderableComponent 而不是 typeof === 'function' —— 0.1.7 的
  // MarkdownText 是 React.memo 对象，用函数判据会在这里就提前 return，兜底全部失效。
  if (!isRenderableComponent(primitives.MarkdownText)) return primitives
  // 展开而不是就地赋值：ESM 命名空间对象的属性是只读的，赋值会抛。
  return { ...primitives, MarkdownText: withSafeLabels(primitives.MarkdownText) }
}

export const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

let cached: PrimitivesLike | null | undefined

/**
 * 尝试加载模块。
 *
 * 三件事必须同时成立，缺一个都会静默失效：
 *   1. **字面量调用** `require("…")` —— esbuild 只认字面量，写成变量它根本不会
 *      把这里当成外部依赖，产物里连一次请求都不会出现；
 *   2. **不做 `typeof require === 'function'` 之类的守卫** —— browser 平台上
 *      esbuild 会把那个判断常量折叠成 false，整个分支被删掉（第一版就是这么失败的）；
 *   3. **try/catch 兜底** —— 模块缺失时 `require` 会抛，这里吞掉并返回 null，
 *      让调用方退回自绘，而不是让整个插件加载失败。
 */
function loadModule(): PrimitivesLike | null {
  try {
    const module: unknown = require('@deepseek-ai/dsh-client-ui-primitives')
    return withSafePrimitives(module)
  } catch {
    return null
  }
}

/**
 * 取 primitives 模块。
 *
 * 0.1.7 起该包**有**官方 `.d.ts`（`lib/types/index.d.ts`），但这里仍然只暴露自己写的
 * 窄接口（见 `src/client/dsh-primitives.d.ts`）：我们要的是"拿不到就降级"，
 * 而不是把整份官方签名搬进来当契约。
 */
export function getPrimitives(): PrimitivesLike | null {
  if (cached === undefined) cached = loadModule()
  return cached
}

/**
 * 按候选名取一个图标组件：**新名在前、旧名在后**。
 *
 * 0.1.7 把整批图标改了后缀（`IconChevronRightOutline14` → `…OutlineRegular` / `…OutlineMedium`），
 * 而这些名字**在产物里是查得到的**：`lib/types/icons/index.d.ts` 里 `Outline14|Outline16` 命中 0，
 * 运行时导出清单（`lib/index.js:11680`）里只有 `Regular` / `Medium`。
 * 旧版反过来。候选顺序让同一份代码在两版上都能取到图标。
 *
 * 只接受**可渲染的组件**（见 `isRenderableComponent`）：名字在、值不是组件时按"没有"处理
 * （这样才不会把非组件塞进 createElement）。注意判据包含 `React.memo` 对象 ——
 * 图标现在虽然都是普通函数，但基线把某个图标改成 `memo(...)` 只是时间问题。
 *
 * @param primitives - `getPrimitives()` 的结果（可能是 null）。
 * @param names - 候选导出名，按优先级排列。
 * @returns 图标组件；全部缺失时返回 undefined（调用方按"无图标"渲染）。
 */
export function pickIcon(primitives: PrimitivesLike | null, ...names: string[]): any {
  if (!primitives) return undefined
  const table = primitives as Record<string, any>
  for (const name of names) {
    const candidate = table[name]
    if (isRenderableComponent(candidate)) return candidate
  }
  return undefined
}

/** 仅测试用：清掉缓存。 */
export function resetPrimitivesForTest(): void {
  cached = undefined
}
