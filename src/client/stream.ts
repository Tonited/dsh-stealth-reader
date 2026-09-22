// 内容流的排布核心（纯函数）。
//
// 屏幕上是"一段正在进行的会话"：**真实会话历史**（用户消息、AI 回复、工具调用）与
// **小说段落**混在同一股流里，逐行出现。小说段落按比例借两种身份登场 ——
// 多数冒充"工具调用的输出"（看小说 = AI 在读一个大文件，这个场景最不引人好奇），
// 少数冒充"AI 的回复正文"。
//
// 两条硬要求：
//
//   1. **确定性**：同一章每次渲染必须得到完全相同的行序列。否则滚动到一半重新渲染
//      （翻页、进度回写都可能触发）时内容会整体位移，读者直接丢失位置。
//      所以身份与间距都不能真的用 Math.random，要用章节号做种子的伪随机。
//   2. **小说是主体**：真实会话行只是把段落之间填得像一次真实会话，不能反客为主
//      （间距有下界）。
import type { DialogueLine, DialogueRole } from './dialogue.ts'

export type StreamLineKind = 'chapter' | DialogueRole

export interface StreamLine {
  kind: StreamLineKind
  text: string
  /**
   * 这一行是**真实会话内容**还是**小说正文**。
   *
   * 渲染时两者共用同一套样式（这正是伪装的关键），但必须留下这个标记：
   * 否则"哪一行是小说"在数据层就丢了 —— 测试无法断言，将来想给小说段落单独
   * 调一点缩进或透明度也做不到。角色（kind）只描述"看起来是什么"。
   */
  source: 'real' | 'novel'
  /** 仅章节行：形如 `[3/512]`。 */
  marker?: string
  /** 仅工具行：工具名。 */
  name?: string
  /** 仅工具结果行：是否成功。 */
  ok?: boolean
}

export interface WeaveStreamInput {
  /** 真实会话行（交错用）。 */
  dialogue: readonly DialogueLine[]
  /** 本章正文（`\n\n` 分段，可能含插图占位符）。 */
  chapterText: string
  chapterTitle: string
  chapterIndex: number
  chapterCount: number
  /** 小说段落以"工具输出"身份出现的比例（0~1）。 */
  toolOutputRatio?: number
}

/** 两行真实会话内容之间至少/至多夹几段小说。 */
export const MIN_GAP = 3
export const MAX_GAP = 6

/** 默认：七成小说段落冒充工具输出，三成冒充 AI 回复正文。 */
export const DEFAULT_TOOL_OUTPUT_RATIO = 0.7

/**
 * 确定性伪随机（线性同余）。
 *
 * 用它而不是 `Math.random()` 是**功能要求**而非洁癖：节奏必须可复现，见文件头说明。
 */
export function seededRandom(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** 按空行分段；段内的单个换行保留（小说常靠它排版对话与诗歌）。 */
export function splitParagraphs(text: string): string[] {
  if (typeof text !== 'string') return []
  // 按**换行**分段，而不是只按空行。
  //
  // 中文小说（txt 与多数 epub）是"一行一段"：段落之间只有一个换行，空行反而是排版噪声。
  // 只认空行的话整章会被当成**一整段** —— 于是既没有段落可分，也没有位置去交错工作痕迹行，
  // 伪装效果直接归零：屏幕上就是一整块纯正文。
  return text
    .split('\n')
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

/** 章节行的文案：`[3/512] 第一章 风起` —— 伪装成任务进度。 */
export function chapterLine(
  chapterIndex: number,
  chapterCount: number,
  chapterTitle: string,
): StreamLine {
  const marker = `[${chapterIndex + 1}/${chapterCount}]`
  const title = (chapterTitle ?? '').trim() || `第 ${chapterIndex + 1} 章`
  return { kind: 'chapter', source: 'novel', text: `${marker} ${title}`, marker }
}

function clampRatio(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_TOOL_OUTPUT_RATIO
  return Math.min(Math.max(value, 0), 1)
}

/** 把一条真实对话行转成流里的行。 */
export function dialogueToStreamLine(line: DialogueLine): StreamLine {
  return { kind: line.role, source: 'real', text: line.text, name: line.name, ok: line.ok }
}

/**
 * 把一章正文与真实会话行交错成内容流。
 *
 * 输出首行永远是章节行（读者需要一个方位锚点）。
 */
export function weaveStream(input: WeaveStreamInput): StreamLine[] {
  const lines: StreamLine[] = [
    chapterLine(input.chapterIndex, input.chapterCount, input.chapterTitle),
  ]

  const paragraphs = splitParagraphs(input.chapterText)
  if (paragraphs.length === 0) return lines

  const dialogue = (input.dialogue ?? []).filter(
    (line) => line && typeof line.text === 'string' && line.text.trim().length > 0,
  )
  const ratio = clampRatio(input.toolOutputRatio)

  const random = seededRandom(input.chapterIndex + 1)
  let cursor = 0
  // 章节行之后先给一小段正文，别让读者一进来就撞上会话噪声。
  let gap = MIN_GAP

  for (const paragraph of paragraphs) {
    // 身份由种子决定：同一段小说每次都以同一种身份出现。
    lines.push(
      random() < ratio
        ? { kind: 'result', source: 'novel', text: paragraph, ok: true }
        : { kind: 'assistant', source: 'novel', text: paragraph },
    )

    gap -= 1
    if (gap > 0 || dialogue.length === 0) continue

    lines.push(dialogueToStreamLine(dialogue[cursor % dialogue.length]!))
    cursor += 1
    gap = MIN_GAP + Math.floor(random() * (MAX_GAP - MIN_GAP + 1))
  }

  return lines
}
