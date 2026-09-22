// epub 解析（纯函数 + fflate 解压，不碰 DOM）。
//
// epub 就是一个 zip：`META-INF/container.xml` 指向 OPF，OPF 里有 manifest（文件表）、
// spine（**阅读顺序**）和元数据；正文是 spine 逐项对应的 XHTML。
//
// 三条容易做错、这里刻意做对的：
//
//   1. **章节顺序必须按 spine，不能按文件名或 manifest 顺序** —— manifest 是字典，
//      `chapter10.xhtml` 排在 `chapter2.xhtml` 前面是常态（SPEC 验收项）。
//   2. **加密检测要看加密的是什么**：正版 epub 普遍用 encryption.xml 做**字体混淆**，
//      正文并未加密。一律拒绝会把能读的书挡在门外；一律放行又会撞上 DRM 乱码。
//   3. **图片路径要按所在 XHTML 解析相对路径**（`../Images/a.jpg`、`%20`），
//      而不是当成 zip 根目录下的名字。
import { unzipSync } from 'fflate'

import { imagePlaceholder } from './richtext.ts'
import {
  attr,
  decodeEntities,
  findElements,
  firstText,
  normalizeParagraphs,
  parseAttributes,
  stripTags,
} from './xml.ts'

export interface EpubImage {
  /** zip 内规范化路径，作为章节内唯一键。 */
  name: string
  mediaType: string
  data: Uint8Array
}

export interface EpubChapter {
  index: number
  title: string
  /** 正文；插图位置由 richtext 的占位符标出。 */
  text: string
  images: EpubImage[]
}

export interface EpubBook {
  title: string
  chapters: EpubChapter[]
  warnings: string[]
}

export type EpubResult = { ok: true; book: EpubBook } | { ok: false; error: string }

// ------------------------------------------------------------------ 路径

/** 规范化 zip 内路径：去掉 `./`、折叠 `..`、统一正斜杠。 */
export function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/**
 * 把 href 解析成 zip 内的绝对路径。
 *
 * @param baseDir - 引用方所在目录（如 `OEBPS/Text`）
 */
export function resolveHref(baseDir: string, href: string): string {
  const withoutFragment = href.split('#')[0]!.split('?')[0]!
  let decoded = withoutFragment
  try {
    decoded = decodeURIComponent(withoutFragment)
  } catch {
    // 非法百分号编码：保留原样，宁可查不到也不要抛。
  }
  if (decoded.startsWith('/')) return normalizePath(decoded)
  return normalizePath(baseDir ? `${baseDir}/${decoded}` : decoded)
}

function dirOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

/** 在 zip 表里查条目：先精确匹配，再忽略大小写（部分制作工具大小写不一致）。 */
export function findEntry(
  entries: Map<string, Uint8Array>,
  path: string,
): Uint8Array | undefined {
  const direct = entries.get(path)
  if (direct) return direct
  const lower = path.toLowerCase()
  for (const [key, value] of entries) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

// ------------------------------------------------------------------ 图片类型

const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

/** 按扩展名猜媒体类型；只认图片（epub 里还可能有音视频，本项目一律忽略）。 */
export function guessMediaType(path: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(path)
  if (!match) return undefined
  return MEDIA_TYPES[match[1]!.toLowerCase()]
}

// ------------------------------------------------------------------ 加密检测

/** 字体混淆算法 —— 正版 epub 常见，**不影响正文可读性**。 */
const FONT_OBFUSCATION = 'embedding'

export interface EncryptionInspection {
  /** 是否有任何加密条目。 */
  encrypted: boolean
  /** 是否只加密了字体（可以照常读）。 */
  fontOnly: boolean
  /** 被加密的资源路径，用于错误提示。 */
  targets: string[]
}

/**
 * 检查 `META-INF/encryption.xml`。
 *
 * 判定规则（SPEC：加密 epub 必须明确报错，且不进书架）：
 * - 加密目标是字体（算法含 `embedding`，或路径是字体文件）→ 放行，只记告警；
 * - 其它任何加密目标（正文、样式、图片）→ 视为 DRM，拒绝。
 */
export function inspectEncryption(encryptionXml: string | undefined): EncryptionInspection {
  if (!encryptionXml || encryptionXml.trim().length === 0) {
    return { encrypted: false, fontOnly: false, targets: [] }
  }

  const targets: string[] = []
  let allFonts = true

  for (const data of findElements(encryptionXml, 'EncryptedData')) {
    const method = findElements(data.inner, 'EncryptionMethod')[0]
    const algorithm = method ? (attr(method, 'Algorithm') ?? '') : ''
    const reference = findElements(data.inner, 'CipherReference')[0]
    const uri = reference ? (attr(reference, 'URI') ?? '') : ''

    if (uri) targets.push(uri.replace(/^\//, ''))

    const looksLikeFont =
      algorithm.toLowerCase().includes(FONT_OBFUSCATION) ||
      /\.(otf|ttf|ttc|woff2?|eot)$/i.test(uri)
    if (!looksLikeFont) allFonts = false
  }

  return { encrypted: true, fontOnly: allFonts && targets.length > 0, targets }
}

// ------------------------------------------------------------------ OPF

export interface ManifestItem {
  id: string
  /** 相对 OPF 所在目录的 href（已解码，未解析成绝对路径）。 */
  href: string
  mediaType: string
  properties: string
}

export interface OpfDocument {
  title?: string
  opfPath: string
  opfDir: string
  manifest: Map<string, ManifestItem>
  /** spine 顺序的 manifest id。 */
  spine: string[]
}

/** 解析 OPF。spine 里 `linear="no"` 的项（弹窗脚注等）默认跳过。 */
export function parseOpf(xml: string, opfPath: string): OpfDocument {
  const manifest = new Map<string, ManifestItem>()
  for (const element of findElements(xml, 'item')) {
    const id = attr(element, 'id')
    const href = attr(element, 'href')
    if (!id || !href) continue
    manifest.set(id, {
      id,
      href,
      mediaType: attr(element, 'media-type') ?? guessMediaType(href) ?? '',
      properties: attr(element, 'properties') ?? '',
    })
  }

  const spineElement = findElements(xml, 'spine')[0]
  const spineSource = spineElement ? spineElement.inner : xml

  const linear: string[] = []
  const nonLinear: string[] = []
  for (const element of findElements(spineSource, 'itemref')) {
    const idref = attr(element, 'idref')
    if (!idref || !manifest.has(idref)) continue
    if ((attr(element, 'linear') ?? '').toLowerCase() === 'no') nonLinear.push(idref)
    else linear.push(idref)
  }

  return {
    title: firstText(xml, 'title'),
    opfPath,
    opfDir: dirOf(opfPath),
    manifest,
    // 全是 linear="no" 时（奇形怪状的书）不能把整本书丢空，退回全部项。
    spine: linear.length > 0 ? linear : nonLinear,
  }
}

/** 从 container.xml 找 OPF 路径；找不到就扫描 zip 里的 `.opf`。 */
export function findOpfPath(
  containerXml: string | undefined,
  entries: Map<string, Uint8Array>,
): string | undefined {
  if (containerXml) {
    const rootfile = findElements(containerXml, 'rootfile')
    for (const element of rootfile) {
      const fullPath = attr(element, 'full-path')
      if (fullPath) return normalizePath(fullPath)
    }
  }
  for (const key of entries.keys()) {
    if (/\.opf$/i.test(key)) return normalizePath(key)
  }
  return undefined
}

// ------------------------------------------------------------------ 正文

const IMAGE_TAG = /<(img|image)\b([^>]*?)(\/?)>/gi

/**
 * 把 `<img>`/`<image>` 换成占位符。
 *
 * `resolve` 返回 null 表示图片不可用（缺失或非图片）—— 此时整段删掉，
 * 正文里不留"破图"痕迹。
 */
export function inlineImages(html: string, resolve: (src: string) => number | null): string {
  return html.replace(IMAGE_TAG, (_whole, _tag: string, rawAttrs: string) => {
    const attrs = parseAttributes(rawAttrs)
    const src = attrs['src'] ?? attrs['xlink:href'] ?? attrs['href'] ?? attrs['data-src']
    if (!src) return ''
    const index = resolve(src)
    return index === null ? '' : imagePlaceholder(index)
  })
}

function bodyOf(xhtml: string): string {
  const [body] = findElements(xhtml, 'body')
  return body ? body.inner : xhtml
}

/** 取正文文本（含图片占位符）。 */
export function extractChapterText(xhtml: string, resolve: (src: string) => number | null): string {
  return normalizeParagraphs(stripTags(inlineImages(bodyOf(xhtml), resolve)))
}

/** 章节标题上限：超过这个长度说明抓到的不是标题而是正文。 */
export const MAX_TITLE_LENGTH = 120

/**
 * 章节标题：`h1`→`h6` → `<title>` → 调用方给的兜底名。
 *
 * 长度设上限是必要的：有些 epub 把整章塞进一个 `<h1>`，直接采信会让目录里出现整段正文。
 */
export function extractChapterTitle(xhtml: string, fallback: string): string {
  for (let level = 1; level <= 6; level += 1) {
    const heading = firstText(xhtml, `h${level}`)
    if (heading && heading.length <= MAX_TITLE_LENGTH) return heading
  }
  const title = firstText(xhtml, 'title')
  if (title && title.length <= MAX_TITLE_LENGTH) return title
  return fallback
}

// ------------------------------------------------------------------ 主流程

/** 解压 epub。返回的错误是给**用户看的**，不是给日志看的。 */
export function readZip(bytes: Uint8Array): { ok: true; entries: Map<string, Uint8Array> } | { ok: false; error: string } {
  if (!bytes || bytes.length === 0) return { ok: false, error: '这个文件是空的' }
  try {
    const unzipped = unzipSync(bytes)
    const entries = new Map<string, Uint8Array>()
    for (const [key, value] of Object.entries(unzipped)) {
      // 目录条目的长度为 0，忽略即可，不影响后续查找。
      entries.set(normalizePath(key), value)
    }
    if (entries.size === 0) return { ok: false, error: '这个 epub 里没有任何内容' }
    return { ok: true, entries }
  } catch {
    return { ok: false, error: '这个文件不是有效的 epub（无法解压，可能已损坏或不是 epub）' }
  }
}

function decodeXhtml(bytes: Uint8Array): string {
  // XHTML 允许声明其它编码，但现实中一律是 UTF-8；用非致命解码，坏字节变 U+FFFD 而不是抛错。
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/**
 * 解析一本 epub。
 *
 * @param fallbackTitle - OPF 里没有书名时用的名字（通常是文件名）
 */
export function parseEpub(bytes: Uint8Array, fallbackTitle: string): EpubResult {
  const zip = readZip(bytes)
  if (!zip.ok) return zip
  const { entries } = zip

  // ---- 加密：必须在读正文**之前**判定，否则只会得到一堆乱码。
  const encryptionXml = findEntry(entries, 'META-INF/encryption.xml')
  const encryption = inspectEncryption(encryptionXml ? decodeXhtml(encryptionXml) : undefined)
  if (encryption.encrypted && !encryption.fontOnly) {
    const where = encryption.targets.slice(0, 3).join('、')
    return {
      ok: false,
      error: `这本 epub 有 DRM 加密，无法读取${where ? `（加密内容：${where}）` : ''}`,
    }
  }

  // ---- OPF
  const containerBytes = findEntry(entries, 'META-INF/container.xml')
  const opfPath = findOpfPath(containerBytes ? decodeXhtml(containerBytes) : undefined, entries)
  if (!opfPath) return { ok: false, error: '这本 epub 缺少书目信息（找不到 .opf 文件）' }

  const opfBytes = findEntry(entries, opfPath)
  if (!opfBytes) return { ok: false, error: '这本 epub 的书目信息已损坏（.opf 文件缺失）' }

  const opf = parseOpf(decodeXhtml(opfBytes), opfPath)
  if (opf.spine.length === 0) return { ok: false, error: '这本 epub 没有可读的正文（spine 为空）' }

  const warnings: string[] = []
  if (encryption.fontOnly) warnings.push('字体已加密（不影响阅读）')

  const chapters: EpubChapter[] = []

  for (const idref of opf.spine) {
    const item = opf.manifest.get(idref)
    if (!item) continue

    const itemPath = resolveHref(opf.opfDir, item.href)
    const itemBytes = findEntry(entries, itemPath)
    if (!itemBytes) {
      warnings.push(`缺少正文文件：${itemPath}`)
      continue
    }

    const xhtml = decodeXhtml(itemBytes)
    const baseDir = dirOf(itemPath)

    // 每章自己的图片表：同名路径复用同一索引，避免正文里重复携带图片。
    const images: EpubImage[] = []
    const indexByName = new Map<string, number>()

    const resolveImage = (src: string): number | null => {
      const imagePath = resolveHref(baseDir, src)
      const existing = indexByName.get(imagePath)
      if (existing !== undefined) return existing

      const manifestItem = findManifestByPath(opf, imagePath)
      const mediaType = manifestItem?.mediaType || guessMediaType(imagePath)
      if (!mediaType || !mediaType.startsWith('image/')) return null

      const data = findEntry(entries, imagePath)
      if (!data || data.length === 0) return null

      const index = images.length
      images.push({ name: imagePath, mediaType, data })
      indexByName.set(imagePath, index)
      return index
    }

    const text = extractChapterText(xhtml, resolveImage)
    if (text.length === 0 && images.length === 0) continue

    chapters.push({
      index: chapters.length,
      // 兜底名不拿书名充数：目录里出现一行书名只会让人困惑。
      title: extractChapterTitle(xhtml, `第 ${chapters.length + 1} 章`),
      text,
      images,
    })
  }

  if (chapters.length === 0) return { ok: false, error: '这本 epub 里没有可读的正文' }

  return {
    ok: true,
    book: {
      title: opf.title && opf.title.length > 0 ? opf.title : fallbackTitle,
      chapters,
      warnings,
    },
  }
}

/** 在 manifest 里按解析后的绝对路径反查条目（用于拿图片的 media-type）。 */
function findManifestByPath(opf: OpfDocument, path: string): ManifestItem | undefined {
  for (const item of opf.manifest.values()) {
    if (resolveHref(opf.opfDir, item.href) === path) return item
  }
  return undefined
}
