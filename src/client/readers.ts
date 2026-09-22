// 会话数据读取器（纯函数，可单测）。
//
// 单独成文件的理由：这里每一个"猜测"都曾经真实地把插件打坏过 ——
// 最初把 ObservableSnapshot 的取值写成 `get()` / `.value`，而契约方法是 `getSnapshot()`，
// 于是永远读到空快照（0 个会话）。这类错误在浏览器里表现为"功能静默无效"，
// 必须用单测把契约钉住。

/** `ObservableSnapshot` 的取值方法名（官方 UI 用法：`sessions.list.getSnapshot()`）。 */
export const SNAPSHOT_READER = 'getSnapshot'

/**
 * 读取 ObservableSnapshot。优先契约方法 `getSnapshot()`，
 * 其余分支只作为旧/异形实现的兜底。
 */
export function readSnapshot(observable: any): any {
  if (!observable) return undefined
  if (typeof observable[SNAPSHOT_READER] === 'function') return observable[SNAPSHOT_READER]()
  if (typeof observable.get === 'function') return observable.get()
  return observable.value
}

/** 会话列表快照是否已经有行。 */
export function hasRows(state: any): boolean {
  return Array.isArray(state?.ids) && state.ids.length > 0
}

/** 取会话简要信息；`displayTitle` 有回退链，可能退化成项目目录名。 */
export function summarize(state: any, limit = 5): Array<{ id: string; title: string }> {
  const ids: string[] = state?.ids ?? []
  const byId: Record<string, any> = state?.byId ?? {}
  return ids.slice(0, limit).map((id) => ({
    id,
    title: byId[id]?.displayTitle ?? byId[id]?.title ?? '',
  }))
}

/** 一条事件窗口里可读文本的提取结果。 */
export interface Excerpt {
  kind: string
  text: string
}

/** 从事件窗口里提取可读文本片段（按出现顺序，最多 `limit` 条）。 */
export function extractExcerpts(entries: readonly any[], limit = 3): Excerpt[] {
  const excerpts: Excerpt[] = []
  for (const entry of entries) {
    const event = entry?.event ?? entry
    const kind = String(event?.kind ?? event?.type ?? '')
    const text = extractText(event)
    if (text) excerpts.push({ kind, text })
    if (excerpts.length >= limit) break
  }
  return excerpts
}

/** 事件窗口里出现过的事件类型（用于诊断"真实形状与我预期不符"）。 */
export function seenEventKinds(entries: readonly any[]): string[] {
  const kinds = new Set<string>()
  for (const entry of entries) {
    const event = entry?.event ?? entry
    const kind = event?.kind ?? event?.type
    if (typeof kind === 'string' && kind) kinds.add(kind)
  }
  return [...kinds]
}

/**
 * 从一条会话事件里取出纯文本。
 * 形状未文档化，所以做多形态尝试；取不到就返回 undefined（由调用方决定是否上报）。
 */
export function extractText(event: any): string | undefined {
  if (!event) return undefined
  const data = event.data ?? event

  // 形态 A：{ message: { content: [...] } }（assistant/message 的常见形态）
  // 形态 B：{ content: [...] }
  // 形态 C：{ text: '...' }
  const content = data?.message?.content ?? data?.content ?? data?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const joined = content
      .map((part: any) => (typeof part === 'string' ? part : (part?.text ?? part?.value ?? '')))
      .filter(Boolean)
      .join(' ')
    if (joined.trim()) return joined
  }
  return undefined
}

/**
 * 片段脱敏。伪装壳里绝不能出现路径、URL 或长 token ——
 * 这正是 ADR-0002 的取材边界要守住的东西。
 */
export function redact(text: string, maxLength = 60): string {
  return text
    .replace(/https?:\/\/\S+/g, '…')
    .replace(/[\w.-]*\/[\w./-]+/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** 看起来像路径/文件名的标题不可用于伪装壳（displayTitle 会退化成项目目录名）。 */
export function looksSuspicious(title: string): boolean {
  return /[/\\]/.test(title) || /\.\w{1,5}$/.test(title)
}

/**
 * 从事件窗口提取"短片段"（ADR-0002 的正文片段）。
 * 与 `extractExcerpts` 的区别：这里先脱敏再截断，且丢弃可疑内容 —— 因为这些字会真的显示在屏幕上。
 */
export function collectSnippets(entries: readonly any[], limit = 3): string[] {
  const snippets: string[] = []
  for (const excerpt of extractExcerpts(entries, limit * 3)) {
    const text = redact(excerpt.text)
    if (!text || looksSuspicious(text)) continue
    snippets.push(text)
    if (snippets.length >= limit) break
  }
  return snippets
}

/** 从 `tool/call` / `tool/result` 事件里取工具名。 */
export function toolNameOf(event: any): string | undefined {
  const data = event?.data ?? event
  const direct = data?.name ?? data?.tool ?? data?.toolName
  if (typeof direct === 'string' && direct) return direct
  const nested = data?.call?.name ?? data?.result?.name
  return typeof nested === 'string' && nested ? nested : undefined
}

/**
 * 工具名统计，如 `Read × 12 · Bash × 5`。
 *
 * 这是三条伪装数据源里**风险最低**的一条：只有工具名与次数，不含任何内容。
 * 同次数的按**首次出现顺序**排（不是字母序）—— 否则日志里的顺序会显得随机、像 bug。
 */
export function summarizeToolCalls(entries: readonly any[], limit = 4): string[] {
  const counts = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  let index = 0

  for (const entry of entries) {
    const event = entry?.event ?? entry
    const kind = event?.kind ?? event?.type
    if (kind !== 'tool/call' && kind !== 'tool/result') continue
    const name = toolNameOf(event)
    if (!name) continue
    if (!counts.has(name)) firstSeen.set(name, index++)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || firstSeen.get(left[0])! - firstSeen.get(right[0])!)
    .slice(0, limit)
    .map(([name, count]) => `${name} × ${count}`)
}
