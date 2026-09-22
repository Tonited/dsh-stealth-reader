// 真实会话 → 对话行（纯函数）。
//
// 伪装的输入是**用户当前会话的真实历史**：用户消息、AI 回复、工具调用。
// 它们与小说段落混在同一股流里 —— "这看起来就是我的会话"这件事因此是**真的**，
// 不是编出来的日志。
//
// 字段形状来自对前端产物的实测（`docs/dsh-conversation-ui.md` §5），几个容易搞错的地方：
// - 事件信封是 `{type, seq, time, data}`（**不是 `kind`**），`entries[i] = {type, event}`；
// - assistant 文本在 `data.message.content[i].text`（**不是 `data.text`**）；
// - `tool/call.data.arguments` 是**原始 JSON 字符串**，工具名在 `data.name`；
// - `tool/result` 的内容在 `data.message.content[0].content`，**失败标志是 `isError`，
//   没有 `ok` 字段** —— 按 `ok` 判断会让所有失败的工具都显示成成功。
import { extractText, redact, toolNameOf } from './readers.ts'

export type DialogueRole = 'user' | 'assistant' | 'tool' | 'result'

export interface DialogueLine {
  role: DialogueRole
  text: string
  /** 仅 `tool`：工具名。 */
  name?: string
  /** 仅 `result`：是否成功。 */
  ok?: boolean
}

/**
 * 真实对话行的长度上限。
 *
 * 收得比"一整段回复"短得多是有意的：伪装流里的真实内容扮演的是**工作痕迹**
 * （工具调用、命令、路径摘要），不是正文。一条 180 字的系统注入就能占掉四行屏幕，
 * 把小说挤走 —— 实测截图里一眼就看出来比例失衡了。
 */
export const MAX_DIALOGUE_LINE = 96

/** 从一条会话事件里读出它的类型（信封字段是 `type`，老形状里可能叫 `kind`）。 */
export function kindOf(entry: any): string | undefined {
  const event = entry?.event ?? entry
  const kind = event?.type ?? event?.kind
  return typeof kind === 'string' && kind ? kind : undefined
}

/** 事件信封里的 payload。 */
function dataOf(entry: any): any {
  const event = entry?.event ?? entry
  return event?.data ?? event
}

/**
 * 类型 → 角色。
 *
 * 用包含关系而不是全等：官方事件名很长（`assistant/message`、`tool/call`…），
 * 硬编码全等会因为一个名字对不上就整条流水少掉 —— 而且失败是静默的。
 */
export function roleOf(kind: string | undefined): DialogueRole | null {
  if (!kind) return null
  const lower = kind.toLowerCase()

  // transient 的增量块（assistant/live-chunk）不单独成行：它的内容会在最终消息里再出现一次。
  if (lower.includes('chunk') || lower.includes('delta')) return null

  // 系统注入（当前运行时上下文、系统提示词）**不是工作痕迹**。
  //
  // 它们的类型里带 `assistant`，所以会被下面的分支捞进来；但它们又长又像系统信息
  // （"Current runtime context… DSH file policy…"），混进伪装流里既占掉好几行，
  // 又让整块屏幕看起来像在打印配置 —— 实测截图里一眼就看出来了。
  if (lower.includes('context') || lower.includes('system')) return null

  if (lower.includes('tool')) return lower.includes('result') ? 'result' : 'tool'
  if (lower.includes('assistant')) return 'assistant'
  if (lower.includes('user') || lower.includes('human')) return 'user'
  return null
}

/**
 * 把工具参数（原始 JSON 字符串）压成一行摘要。
 *
 * 取最常见的几个键；取不到就返回空字符串（宁可只有工具名，也不要显示一整坨 JSON）。
 */
export function summarizeArguments(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return ''

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return ''
  }
  if (!parsed || typeof parsed !== 'object') return ''

  const keys = ['file_path', 'path', 'filePath', 'pattern', 'query', 'command', 'url', 'glob']
  for (const key of keys) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) return shortenPath(value.trim())
  }
  return ''
}

/**
 * 路径只保留尾部两段。
 *
 * DSH 自己显示的是相对 cwd 的路径，而绝对路径会把真实目录结构摊在屏幕上
 * （`/home/dev/my-app/secret/x.ts`）—— 那正是这个功能最不该泄露的东西。
 */
export function shortenPath(value: string): string {
  if (!/[/\\]/.test(value)) return value
  const parts = value.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return parts.slice(-2).join('/')
}

/** 把一条事件转成对话行；认不出来就返回 null。 */
export function lineOf(entry: any): DialogueLine | null {
  const role = roleOf(kindOf(entry))
  if (!role) return null
  const data = dataOf(entry)

  if (role === 'tool') {
    const name = toolNameOf(data)
    if (!name) return null
    return {
      role,
      name: redact(name, 32),
      text: summarizeArguments(data?.arguments ?? data?.args),
    }
  }

  if (role === 'result') {
    // 实测：内容在 message.content[0].content，失败标志是同一个块的 isError。
    const block = data?.message?.content?.[0]
    const body =
      typeof block?.content === 'string' && block.content.trim()
        ? block.content
        : (extractText(data) ?? '')
    const text = redact(body, MAX_DIALOGUE_LINE)
    if (!text) return null
    const failed = block?.isError === true || data?.error != null
    return { role, text, ok: !failed }
  }

  const raw = extractText(data)
  if (!raw) return null
  const text = redact(raw, MAX_DIALOGUE_LINE)
  if (!text) return null
  return { role, text }
}

/**
 * 取最近若干条真实对话行，**按发生顺序**排列（最新的在最后，像一段正常的会话记录）。
 *
 * 工具结果**不单独成行**：实测里它只是把**调用那一行**的状态改掉 —— 成功什么都不显示，
 * 失败则换成红点 + 结果首行。如果把它拆成两行，屏幕上就会出现 DSH 永远不会有的
 * "一行调用 + 一行结果"，这是很容易被一眼看穿的破绽。
 *
 * @param limit - 最多取多少行。真实内容只是"配料"：小说才是主体，真实行只用来把
 *   小说段落之间填得像一次真实会话。
 */
export function dialogueFromEntries(entries: readonly any[], limit = 40): DialogueLine[] {
  if (!Array.isArray(entries)) return []

  const lines: DialogueLine[] = []
  let pending: DialogueLine | null = null

  for (const entry of entries) {
    const role = roleOf(kindOf(entry))

    if (role === 'tool') {
      const call = lineOf(entry)
      pending = call
      if (call) lines.push(call)
      continue
    }

    if (role === 'result') {
      const result = lineOf(entry)
      if (pending && result) {
        pending.ok = result.ok
        // 失败时摘要换成结果首行（成功则保留原摘要）—— 与实测行为一致。
        if (result.ok === false && result.text) pending.text = result.text.slice(0, 60)
      }
      pending = null
      continue
    }

    // 遇到别的行，说明这一次调用已经翻篇。
    pending = null
    const line = lineOf(entry)
    if (line) lines.push(line)
  }

  // 保留**最后** limit 条：最近发生的内容才和"我正在干活"对得上。
  return lines.slice(-limit)
}
