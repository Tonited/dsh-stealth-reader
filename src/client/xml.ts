// 最小 XML/HTML 工具（纯函数，零依赖）。
//
// 为什么不引 XML 库：本插件的产物要打进**单文件客户端 bundle**，只有 10 个基线模块
// 可以 require，其余依赖都得打包进去。epub 的 OPF/container 结构极简单，为此拖进一个
// 完整 XML 解析器不划算 —— 代价是这里必须**明确知道自己支持的子集**：
//
//   支持：常规开/闭标签、自闭合标签、带命名空间前缀（`dc:title` / `opf:item`）、
//         单双引号属性、命名/十进制/十六进制实体。
//   不支持：CDATA 里的伪标签、同名标签嵌套（`findElements` 取最近的一个闭合标签）、
//         未加引号的属性值（XML 本身不允许）。
//
// 这些限制对 epub 的元数据文件无影响；正文提取走 `stripTags`，不依赖标签配对。

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

const ENTITY_PATTERN = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g

function fromCodePoint(code: number): string | null {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null
  // 代理区单独出现是非法码点，fromCodePoint 会照收，但它是无效字符。
  if (code >= 0xd800 && code <= 0xdfff) return null
  try {
    return String.fromCodePoint(code)
  } catch {
    return null
  }
}

/**
 * 解码实体。**单次扫描**，所以 `&amp;lt;` 正确得到 `&lt;` 而不是 `<`。
 * 无法识别的实体原样保留（宁可留下 `&foo;`，也不要悄悄吞掉内容）。
 */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return fromCodePoint(Number.parseInt(body.slice(2), 16)) ?? whole
    }
    if (body.startsWith('#')) {
      return fromCodePoint(Number.parseInt(body.slice(1), 10)) ?? whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 解析一段标签内的属性。值一律经过实体解码。 */
export function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw)) !== null) {
    attrs[match[1]!] = decodeEntities(match[2] ?? match[3] ?? '')
  }
  return attrs
}

export interface XmlElement {
  /** 实际出现的标签名（含前缀，如 `dc:title`）。 */
  name: string
  attrs: Record<string, string>
  inner: string
  selfClosing: boolean
}

/** 属性名匹配：既接受全名（`dc:title`），也接受本地名（`title` 命中 `dc:title`）。 */
export function attr(element: XmlElement, ...names: string[]): string | undefined {
  for (const name of names) {
    if (element.attrs[name] !== undefined) return element.attrs[name]
    const lower = name.toLowerCase()
    for (const [key, value] of Object.entries(element.attrs)) {
      const local = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key
      if (local.toLowerCase() === lower) return value
    }
  }
  return undefined
}

function openTagPattern(name: string): RegExp {
  // 标签名后必须跟空白、`/` 或 `>`，避免 `item` 误配 `itemref`。
  return new RegExp(`<([A-Za-z_][\\w.-]*:)?${escapeRegExp(name)}(?=[\\s/>])([^>]*?)(/?)>`, 'gi')
}

function findCloseIndex(xml: string, name: string, from: number): number {
  const pattern = new RegExp(`</([A-Za-z_][\\w.-]*:)?${escapeRegExp(name)}\\s*>`, 'i')
  const match = pattern.exec(xml.slice(from))
  return match ? from + match.index : -1
}

/**
 * 找出所有指定标签。不区分大小写，且忽略命名空间前缀
 * （`findElements(opf, 'item')` 同时命中 `<item>` 与 `<opf:item>`）。
 */
export function findElements(xml: string, name: string): XmlElement[] {
  const found: XmlElement[] = []
  const pattern = openTagPattern(name)
  let match: RegExpExecArray | null

  while ((match = pattern.exec(xml)) !== null) {
    const raw = match[2] ?? ''
    const selfClosing = match[3] === '/' || /\/\s*$/.test(raw)
    const contentStart = match.index + match[0].length

    if (selfClosing) {
      found.push({
        name: match[1] ? `${match[1]}${name}` : name,
        attrs: parseAttributes(raw.replace(/\/\s*$/, '')),
        inner: '',
        selfClosing: true,
      })
      continue
    }

    const closeIndex = findCloseIndex(xml, name, contentStart)
    // 找不到闭合标签时把剩余内容视为 inner —— 破损文件也好过丢内容。
    const inner = closeIndex === -1 ? xml.slice(contentStart) : xml.slice(contentStart, closeIndex)
    found.push({
      name: match[1] ? `${match[1]}${name}` : name,
      attrs: parseAttributes(raw),
      inner,
      selfClosing: false,
    })
  }

  return found
}

/** 第一个匹配元素的**文本内容**（已去标签、已解码实体）。 */
export function firstText(xml: string, name: string): string | undefined {
  const [element] = findElements(xml, name)
  if (!element) return undefined
  // 注意：`stripTags` 内部**已经**解码实体，这里绝不能再解一次 ——
  // 否则 `&amp;lt;` 会被解成 `<`（双重解码，实测踩过）。
  const text = stripTags(element.inner, { blockBreaks: false }).trim()
  return text.length > 0 ? text : undefined
}

/** 会强制换行的标签：块级元素与 `<br>`。 */
const BLOCK_TAGS =
  'p|div|br|li|tr|td|th|section|article|blockquote|pre|figcaption|h[1-6]|hr|title|dd|dt'

export interface StripOptions {
  /** 把块级标签转成换行（正文用）。关闭则仅删标签（元数据用）。 */
  blockBreaks?: boolean
}

/**
 * 删除标签、解码实体。
 *
 * 先整段移除 `script`/`style`/注释/处理指令：它们的**内容**不该出现在正文里
 * （epub 的 XHTML 常带一大段 CSS，直接删标签会把 CSS 文本漏进正文）。
 */
export function stripTags(html: string, options: StripOptions = {}): string {
  const blockBreaks = options.blockBreaks !== false

  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(new RegExp(`<(${['script', 'style', 'head'].join('|')})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<(${['script', 'style', 'head'].join('|')})\\b[^>]*/>`, 'gi'), '')

  if (blockBreaks) {
    text = text.replace(new RegExp(`<\\s*(/\\s*)?(${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
  }

  text = text
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')

  return decodeEntities(text)
}

/**
 * 规范正文排版：统一换行、去掉行尾空格、压缩连续空行（最多一个空行）、去首尾空白。
 * 段落之间保留空行 —— 阅读器按空行分段。
 */
export function normalizeParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
