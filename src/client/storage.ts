// 书籍存储（IndexedDB）。
//
// 存这里而不是 DSH settings，理由见 ADR-0001：正文是大块数据，不该进宿主配置；
// 而且纯客户端插件没有别的持久化通道。
//
// 关键约定（SPEC 数据模型）：**解析成功才落库** —— 半本书不进书架。
// 因此写入是"一个事务里的三张表"，要么全成功，要么什么都不留。

const DB_NAME = 'dsh-stealth-reader'
const DB_VERSION = 1

export const STORE_BOOKS = 'books'
export const STORE_CHAPTERS = 'chapters'
export const STORE_PROGRESS = 'progress'

export interface ChapterImageRecord {
  /** zip 内路径；仅用于调试与去重判断。 */
  name: string
  mediaType: string
  data: Uint8Array
}

export interface ChapterRecord {
  bookId: string
  index: number
  title: string
  /** 正文。epub 的插图位置由 richtext 的占位符标出（见 src/client/richtext.ts）。 */
  text: string
  /** 本章插图（epub 专有）。索引与正文占位符一一对应。 */
  images?: ChapterImageRecord[]
}

export interface BookRecord {
  id: string
  title: string
  format: 'txt' | 'epub'
  encoding?: string
  chapterCount: number
  addedAt: number
  /** 导入时的告警（例如"疑似乱码"），不阻止入库。 */
  warning?: string
}

export interface ProgressRecord {
  bookId: string
  chapterIndex: number
  /**
   * 已读到的字符占该章总长度的比例（ADR-0004）。
   *
   * 是"读到哪里"，不是"滚到哪里"：本插件的视口恒在底部自动跟随，
   * 滚动位置几乎永远是 1，拿它当进度等于没有进度。
   */
  ratio: number
  updatedAt: number
}

export function newBookId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return random ?? `book-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/**
 * 打开（或首次创建）数据库。
 *
 * @param name - 数据库名，默认本插件的库。测试可传入独立名字以隔离用例
 *   （fake-indexeddb 下 `deleteDatabase` 会挂起，所以隔离靠"换名字"而不是"删库"）。
 */
export function openDatabase(name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
        const store = db.createObjectStore(STORE_CHAPTERS, { keyPath: ['bookId', 'index'] })
        store.createIndex('byBook', 'bookId')
      }
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        db.createObjectStore(STORE_PROGRESS, { keyPath: 'bookId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地书库'))
  })
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 等事务真正提交 —— 只等 request 成功是不够的，事务可能随后被中止。 */
function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('写入被中止'))
  })
}

/**
 * 把一本书（元数据 + 全部章节）与初始进度写入库中。
 * 走单个事务：任何一步失败都不会留下半本书。
 */
export async function putBook(
  db: IDBDatabase,
  book: BookRecord,
  chapters: readonly ChapterRecord[],
  progress?: ProgressRecord,
): Promise<void> {
  const transaction = db.transaction([STORE_BOOKS, STORE_CHAPTERS, STORE_PROGRESS], 'readwrite')
  const books = transaction.objectStore(STORE_BOOKS)
  const chapterStore = transaction.objectStore(STORE_CHAPTERS)
  const progressStore = transaction.objectStore(STORE_PROGRESS)

  books.put(book)
  for (const chapter of chapters) chapterStore.put(chapter)
  progressStore.put(
    progress ?? { bookId: book.id, chapterIndex: 0, ratio: 0, updatedAt: Date.now() },
  )

  await promisifyTransaction(transaction)
}

export async function listBooks(db: IDBDatabase): Promise<BookRecord[]> {
  const rows = await promisifyRequest(db.transaction(STORE_BOOKS).objectStore(STORE_BOOKS).getAll())
  return (rows as BookRecord[]).sort((left, right) => right.addedAt - left.addedAt)
}

export async function getBook(db: IDBDatabase, bookId: string): Promise<BookRecord | undefined> {
  const store = db.transaction(STORE_BOOKS).objectStore(STORE_BOOKS)
  return (await promisifyRequest(store.get(bookId))) as BookRecord | undefined
}

export async function getChapter(
  db: IDBDatabase,
  bookId: string,
  index: number,
): Promise<ChapterRecord | undefined> {
  const store = db.transaction(STORE_CHAPTERS).objectStore(STORE_CHAPTERS)
  return (await promisifyRequest(store.get([bookId, index]))) as ChapterRecord | undefined
}

export async function listChapterTitles(
  db: IDBDatabase,
  bookId: string,
): Promise<Array<{ index: number; title: string }>> {
  const store = db.transaction(STORE_CHAPTERS).objectStore(STORE_CHAPTERS)
  const rows = (await promisifyRequest(store.index('byBook').getAll(bookId))) as ChapterRecord[]
  return rows
    .map((row) => ({ index: row.index, title: row.title }))
    .sort((left, right) => left.index - right.index)
}

export async function getProgress(
  db: IDBDatabase,
  bookId: string,
): Promise<ProgressRecord | undefined> {
  const store = db.transaction(STORE_PROGRESS).objectStore(STORE_PROGRESS)
  return (await promisifyRequest(store.get(bookId))) as ProgressRecord | undefined
}

export async function putProgress(db: IDBDatabase, progress: ProgressRecord): Promise<void> {
  const transaction = db.transaction(STORE_PROGRESS, 'readwrite')
  transaction.objectStore(STORE_PROGRESS).put(progress)
  await promisifyTransaction(transaction)
}

export async function deleteBook(db: IDBDatabase, bookId: string): Promise<void> {
  const transaction = db.transaction(
    [STORE_BOOKS, STORE_CHAPTERS, STORE_PROGRESS],
    'readwrite',
  )
  transaction.objectStore(STORE_BOOKS).delete(bookId)
  transaction.objectStore(STORE_PROGRESS).delete(bookId)
  const index = transaction.objectStore(STORE_CHAPTERS).index('byBook')
  const keys = await promisifyRequest(index.getAllKeys(bookId))
  for (const key of keys) transaction.objectStore(STORE_CHAPTERS).delete(key)
  await promisifyTransaction(transaction)
}
