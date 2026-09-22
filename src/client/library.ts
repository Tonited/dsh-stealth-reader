// 导入流程与书架读写。
//
// 事务性要求（SPEC §2）：**解析成功才落库** —— 中途失败不产生书架条目，也不留半本书。
// 因此这里的顺序是：解码 → 切章 → 校验 → 一次性写入（见 storage.putBook 的单事务写入）。
import { splitChapters } from './chapters.ts'
import { decodeText } from './decode.ts'
import { parseEpub } from './epub.ts'
import {
  newBookId,
  putBook,
  type BookRecord,
  type ChapterRecord,
} from './storage.ts'

export interface ImportSuccess {
  ok: true
  book: BookRecord
}

export interface ImportFailure {
  ok: false
  error: string
}

export type ImportResult = ImportSuccess | ImportFailure

/** 从文件名推书名：去掉扩展名，下划线转空格，去掉常见站点后缀噪声。 */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : '未命名书籍'
}

/** 从扩展名判断格式；不认识的按 txt 处理（纯文本是唯一能"猜"的格式）。 */
export function formatOf(fileName: string): 'txt' | 'epub' {
  return /\.epub$/i.test(fileName) ? 'epub' : 'txt'
}

/**
 * 导入一个 txt 文件。
 *
 * 失败面（都会变成书架里的一条明确错误，而不是静默无反应）：
 * - 空文件
 * - 编码无法识别（二进制垃圾）
 */
export async function importTxt(db: IDBDatabase, fileName: string, bytes: Uint8Array): Promise<ImportResult> {
  if (!bytes || bytes.length === 0) {
    return { ok: false, error: '这个文件没有可读内容' }
  }

  const decoded = decodeText(bytes)
  if (decoded.error && decoded.text.trim().length === 0) {
    return { ok: false, error: decoded.error }
  }

  const chapters = splitChapters(decoded.text)
  if (chapters.length === 0) {
    return { ok: false, error: '这个文件没有可读内容' }
  }

  const book: BookRecord = {
    id: newBookId(),
    title: titleFromFileName(fileName),
    format: 'txt',
    encoding: decoded.encoding,
    chapterCount: chapters.length,
    addedAt: Date.now(),
    // 编码可疑时仍然入库（"宁可让你能读，也不要白白丢掉整本书"），但把告警带上。
    warning: decoded.error,
  }

  const records: ChapterRecord[] = chapters.map((chapter) => ({
    bookId: book.id,
    index: chapter.index,
    title: chapter.title,
    text: chapter.text,
  }))

  await putBook(db, book, records)
  return { ok: true, book }
}

/**
 * 导入一本 epub。
 *
 * 失败面（都变成书架里的一条明确错误，且**不留半本书**）：
 * - 不是有效 zip / 缺 OPF / spine 为空
 * - DRM 加密（字体混淆不算加密）
 */
export async function importEpub(
  db: IDBDatabase,
  fileName: string,
  bytes: Uint8Array,
): Promise<ImportResult> {
  if (!bytes || bytes.length === 0) {
    return { ok: false, error: '这个文件没有可读内容' }
  }

  const parsed = parseEpub(bytes, titleFromFileName(fileName))
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const book: BookRecord = {
    id: newBookId(),
    title: parsed.book.title,
    format: 'epub',
    chapterCount: parsed.book.chapters.length,
    addedAt: Date.now(),
    warning: parsed.book.warnings.length > 0 ? parsed.book.warnings.join('；') : undefined,
  }

  const records: ChapterRecord[] = parsed.book.chapters.map((chapter) => ({
    bookId: book.id,
    index: chapter.index,
    title: chapter.title,
    text: chapter.text,
    // 没有插图时字段整个省略，不存空数组。
    images: chapter.images.length > 0 ? chapter.images : undefined,
  }))

  await putBook(db, book, records)
  return { ok: true, book }
}

/** 按文件名分派导入。两种格式都会给出明确错误，绝不静默失败。 */
export async function importFile(db: IDBDatabase, fileName: string, bytes: Uint8Array): Promise<ImportResult> {
  const format = formatOf(fileName)
  if (format === 'epub') return importEpub(db, fileName, bytes)
  return importTxt(db, fileName, bytes)
}
