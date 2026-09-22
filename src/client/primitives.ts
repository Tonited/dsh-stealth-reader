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
//
// ⚠️ 如果 DSH 升级后换掉了这个模块名，需要改的就是下面的字面量。

/**
 * 本项目实际用到的 primitives 成员。
 *
 * props 形状来自对官方调用点的实测（`docs/dsh-conversation-ui.md` §7），不是猜的：
 * - `DisclosureRow`: `{ icon, title, collapsedContent, open, expandable, expandOnRowClick?,
 *   keepContentWhenOpen?, onToggle?, children? }`
 * - `StateDot`: `{ state: 'error' | 'warning' | …, className? }`
 * - `MarkdownText`: `{ text, streaming?, labels?, fileMentions?, pathImages? }`
 */
export interface PrimitivesLike {
  DisclosureRow?: any
  StateDot?: any
  MarkdownText?: any
  IconThinkOutline14?: any
  IconChevronRightOutline14?: any
  IconChevronDownOutline14?: any
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
    return module && typeof module === 'object' ? (module as PrimitivesLike) : null
  } catch {
    return null
  }
}

/**
 * 取 primitives 模块。
 *
 * 没有独立包目录、也没有官方 `.d.ts`，所以这里用自己写的窄接口
 * （见 `src/client/dsh-primitives.d.ts`）而不是把整个模块当 `any` 到处传。
 */
export function getPrimitives(): PrimitivesLike | null {
  if (cached === undefined) cached = loadModule()
  return cached
}

/** 仅测试用：清掉缓存。 */
export function resetPrimitivesForTest(): void {
  cached = undefined
}
