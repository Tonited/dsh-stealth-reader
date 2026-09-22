// 章节切分（纯函数，可单测）。
//
// 中文 txt 的现实：有的每章一行"第X章"，有的是"1."、"一、"甚至只有空行，还有整本无标记。
// 所以策略是启发式识别标记，**识别不到就按字数切块** —— 绝不能把一本百万字长文
// 变成一个没有导航的无底滚轴（见 SPEC 的验收标准）。

export interface Chapter {
  index: number
  title: string
  text: string
}

/** 无标记长文的目标块长（字）。 */
export const CHUNK_CHARS = 5000

// 行首 + 中文章节标记 + 短行（标题通常很短；后半段限制可挡住正文里提到的"第X章"）
const CHAPTER_PATTERN =
  /^(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇部集]|Chapter\s+\d+|\d{1,4}[.、]\s*\S)[^\n]{0,38}$/

export interface SplitOptions {
  chunkChars?: number
  /** 少于这个章节数就退化为按字数切（默认 2：只有 1 个标记说明多半是误判）。 */
  minChapters?: number
}

/**
 * 把正文切成章节。
 *
 * - 识别到足够的章节标记 → 按标记切；
 * - 标记太少 → 退化为按字数均分（在空行处断开，尽量不切在句子中间）。
 */
export function splitChapters(raw: string, options: SplitOptions = {}): Chapter[] {
  const chunkChars = options.chunkChars ?? CHUNK_CHARS
  const minChapters = options.minChapters ?? 2

  const text = raw.replace(/\r\n?/g, '\n')
  if (text.trim().length === 0) return []

  const marked = splitByMarkers(text)
  if (marked.length >= minChapters) return marked
  return splitByLength(text, chunkChars)
}

function splitByMarkers(text: string): Chapter[] {
  const lines = text.split('\n')
  const starts: Array<{ line: number; title: string }> = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line.length === 0 || line.length > 48) continue
    if (CHAPTER_PATTERN.test(line)) starts.push({ line: index, title: line })
  }

  if (starts.length === 0) return []

  const chapters: Chapter[] = []
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]
    const end = index + 1 < starts.length ? starts[index + 1].line : lines.length
    const body = lines
      .slice(start.line + 1, end)
      .join('\n')
      .trim()
    chapters.push({ index: chapters.length, title: start.title, text: body })
  }

  return chapters
}

function splitByLength(text: string, chunkChars: number): Chapter[] {
  const total = text.length
  if (total === 0) return []

  // 短文本就是一章；否则按 chunkChars 分块，并在附近找空行/换行断开。
  const target = total <= chunkChars * 1.5 ? total : chunkChars
  const chapters: Chapter[] = []

  let cursor = 0
  while (cursor < total) {
    let end = Math.min(total, cursor + target)
    if (end < total) {
      end = adjustBoundary(text, end)
    }
    const body = text.slice(cursor, end).trim()
    if (body.length > 0) {
      chapters.push({
        index: chapters.length,
        title: `第 ${chapters.length + 1} 节`,
        text: body,
      })
    }
    cursor = end
  }

  if (chapters.length === 0) return [{ index: 0, title: '全文', text: text.trim() }]
  // 短文本就是一章：不叫"第 1 节"，那读起来像被切过
  if (chapters.length === 1 && chapters[0].text.length === text.trim().length) {
    return [{ index: 0, title: '全文', text: chapters[0].text }]
  }
  return chapters
}

/** 从切割点向后找一个自然的断点（空行 > 换行 > 硬切），最多多取 400 字。 */
function adjustBoundary(text: string, position: number): number {
  const search = text.slice(position, Math.min(text.length, position + 400))
  const blank = search.search(/\n\s*\n/)
  if (blank >= 0) return position + blank + 1
  const newline = search.indexOf('\n')
  if (newline >= 0) return position + newline + 1
  return position
}
