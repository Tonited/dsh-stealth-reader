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

// ------------------------------------------------------------------ 「当前会话」

/**
 * 「当前会话」探针槽位。
 *
 * 为什么要一个全局槽位，而不是模块级变量：客户端插件会被 HMR **热替换**，
 * 写入方（index.tsx 注册在 session 作用域槽 `conversation.input.dock` 上的探针组件）
 * 和读取方（`readDialogue` 的闭包）**可能不是同一次模块实例**。模块级变量会重演
 * store.ts 注释里那个故障：值写进了"另一个宇宙"。槽位在 globalThis 上，新旧模块看到同一份。
 *
 * 0.1.7 里这个 id 只能这样拿：`SessionListState` 只有
 * `{ ids, byId, phase, projectionsBySession }`（`dsh-api-session-controller/lib/types/client/sessions/service.d.ts:43-52`），
 * **没有 `current` 字段** —— 旧写法 `state.current` 永远是 undefined。
 * 而 session 作用域槽的组件会拿到框架合成的标准 prop `sessionId`
 * （类型：`dsh-client-ui-slots/lib/types/index.d.ts:191-217,222` 的
 * `SessionStandardProps.sessionId` → `ScopeStandardProps` → `PropsRuntime`；
 * 运行时的赋值来源：`dsh-client-ui-session/lib/client.js:124,128`
 * 「`props: ["sessionId"]` / `props: { sessionId: binding.sessionId }`」→ `:378-397` 的
 * `materialize()` 把 descriptor 声明的 prop 拷进 binding，
 * 再由 `dsh-client-ui-renderer/lib/client.js:715-717,771-776` 把 standard kit 展开成组件 props）。
 */
export const SESSION_ID_SLOT = '__STEALTH_READER_SESSION_ID__'

function slots(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>
}

/**
 * 记下探针看到的当前会话 id。
 *
 * 只接受非空字符串，且**不清除**已有值：宿主没给 prop（异形版本、session-maybe 场景、
 * 单元测试直接调用组件）时不该把已知的会话 id 擦掉 —— 宁可用一个稍旧的 id
 * （它至少是真会话），也不要退回"列表首行"。
 */
export function noteSessionId(id: unknown): void {
  if (typeof id === 'string' && id.length > 0) slots()[SESSION_ID_SLOT] = id
}

/** 读探针记下的当前会话 id；从没记过就返回 undefined。 */
export function notedSessionId(): string | undefined {
  const id = slots()[SESSION_ID_SLOT]
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** 仅测试用：清掉槽位。 */
export function resetSessionIdForTest(): void {
  delete slots()[SESSION_ID_SLOT]
}

/**
 * 候选会话 id 的顺序（越靠前越像「当前会话」）。
 *
 * 0.1.7 没有现成的「当前会话」字段，只能按可靠度分层拼：
 *
 *   1. `preferred` —— 探针从 session 作用域槽的 `sessionId` prop 上抓到的**真实**会话。
 *      这是唯一"框架亲口告诉你"的来源，见 `SESSION_ID_SLOT`。
 *   2. 被主视图 retain 的那一个 —— 官方 ui-session 自己就是这么定义"当前会话"的
 *      （`dsh-client-ui-session/lib/client.js:283`：
 *      `Object.values(byId).find((candidate) => (candidate.retainedBy.mainView ?? 0) > 0)?.id`；
 *      `retainedBy` 就在列表行上：`…/sessions/service.d.ts:29` 的 `SessionSummary.retainedBy`）。
 *      旧版的 `state.current` 语义正是"主视图那个会话"，这一层是它最贴近的替身。
 *   3. 其余按宿主列表顺序（`state.ids`）。
 *
 * 为什么要排这么多层：`ISessions.binding(id)` **只对已经被 retain 的会话**返回 binding
 * （`…/contract/sessions.d.ts:146-153`：Borrow an already-retained Session binding without
 * extending its lifetime … undefined without a retained generation），所以猜错 id 是常态，
 * 而 id 猜错的代价是"伪装内容退化成硬编码模板"（违反 ADR-0002）。
 */
export function sessionCandidates(state: any, preferred?: string): string[] {
  const ids: string[] = Array.isArray(state?.ids) ? state.ids : []
  const byId: Record<string, any> = state?.byId ?? {}
  const ordered: string[] = []
  const push = (id: unknown): void => {
    if (typeof id === 'string' && id.length > 0 && !ordered.includes(id)) ordered.push(id)
  }

  push(preferred)
  for (const id of ids) if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) push(id)
  for (const id of ids) push(id)
  return ordered
}

/**
 * 取一个会话的事件窗口条目。
 *
 * 契约路径：`sessions.binding(id).eventSource.getSnapshot()`，快照形状
 * `{ entries, hasMore, revision, change }`（`…/contract/events.d.ts:56-61,63`、`…/sessions/service.d.ts:81`）。
 */
export function bindingEntries(sessions: any, id: string): readonly any[] {
  const binding = sessions?.binding?.(id)
  return binding?.eventSource?.getSnapshot?.()?.entries ?? []
}

/**
 * 取「真实工作痕迹」：按 `sessionCandidates` 的顺序，用第一个**真的读得到内容**的会话。
 *
 * 三层降级，每一层都比上一层弱：
 *   1. 真实 sessionId 的 binding；
 *   2. 其它 id 里第一个能拿到 binding（且窗口非空）的 —— 只为"至少是真实历史"，
 *      哪怕它未必是屏幕上正在看的那个会话（ADR-0002 只要求"取自真实会话历史，不是合成日志"）；
 *   3. 都没有 → 返回空表，由调用方退回硬编码模板（index.tsx 的 `DEFAULT_TEMPLATES`）。
 *
 * @param sessions - `ctx.sessions`（形状未完全文档化，故一律容错）。
 * @param preferred - 探针抓到的当前会话 id（`notedSessionId()`）。
 * @returns 事件条目；一层都拿不到时是空表（**不是**异常）。
 */
export function currentSessionEntries(sessions: any, preferred?: string): readonly any[] {
  try {
    const state = readSnapshot(sessions?.list)
    for (const id of sessionCandidates(state, preferred)) {
      const entries = bindingEntries(sessions, id)
      if (entries.length > 0) return entries
    }
    return []
  } catch {
    return []
  }
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
