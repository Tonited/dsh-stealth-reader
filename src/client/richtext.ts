// 正文里的插图占位符（纯函数）。
//
// epub 的插图埋在 XHTML 的 `<img>` 里，而本项目把正文存成**纯文本**。要把图片位置
// 保留下来，就得在文本里放一个标记。选 `U+FFFC`（OBJECT REPLACEMENT CHARACTER，
// 本就是为"这里有个 Embedded Object"设计的）而不是 `![](x)` 这类可见写法：
//
//   * 小说正文里几乎不可能出现 `U+FFFC` —— 不需要转义；
//   * 即使渲染层失效，它在阅读器里也是一个不可见/占位字符，不会漏出源码味；
//   * 用索引而不是路径：正文不必重复携带长路径，改名/重排也不影响。

/** 占位符定界字符。 */
export const PLACEHOLDER = '\uFFFC'

const PLACEHOLDER_PATTERN = /\uFFFC(\d+)\uFFFC/g

/** 构造第 `index` 张图的占位符。 */
export function imagePlaceholder(index: number): string {
  return `${PLACEHOLDER}${index}${PLACEHOLDER}`
}

/**
 * 解析占位符里的索引。
 *
 * 必须用**安全整数**而不是 `Number.isFinite`：`Number.parseInt('9'.repeat(30))` 得到
 * `1e30`，它是有限数但不是有效索引 —— 采信它会把正文里的畸形标记静默吞掉。
 */
function parseIndex(raw: string): number | undefined {
  const index = Number.parseInt(raw, 10)
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined
}

export type RichBlock =
  | { type: 'text'; value: string }
  | { type: 'image'; index: number }

/**
 * 把正文切成「文本 / 图片」块序列。
 *
 * 相邻的纯文本会被合并，空文本块被丢弃 —— 渲染层因此只需要处理两种节点。
 */
export function splitImagePlaceholders(text: string): RichBlock[] {
  const blocks: RichBlock[] = []
  let cursor = 0

  PLACEHOLDER_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      blocks.push({ type: 'text', value: text.slice(cursor, match.index) })
    }
    const index = parseIndex(match[1]!)
    // 畸形占位符当作普通文本处理，不要凭空造一张图、也不要吞掉字符。
    if (index === undefined) blocks.push({ type: 'text', value: match[0] })
    else blocks.push({ type: 'image', index })
    cursor = match.index + match[0].length
  }

  if (cursor < text.length) blocks.push({ type: 'text', value: text.slice(cursor) })
  return blocks.filter((block) => block.type !== 'text' || block.value.length > 0)
}

/** 去掉占位符，得到纯文本（用于章节字数统计、进度换算）。 */
export function stripImagePlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_PATTERN, '')
}

/** 正文里出现的图片索引（去重、升序）。 */
export function imageIndexesIn(text: string): number[] {
  const found = new Set<number>()
  PLACEHOLDER_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLACEHOLDER_PATTERN.exec(text)) !== null) {
    const index = parseIndex(match[1]!)
    if (index !== undefined) found.add(index)
  }
  return [...found].sort((left, right) => left - right)
}
