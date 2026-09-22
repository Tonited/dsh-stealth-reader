// 导入流程的端到端测试（内存版 IndexedDB）。
//
// 覆盖的是"用户最常撞的那条路"：拖一个 GBK 编码的 txt 进来，能不能读出正常中文。
// 同时钉住 SPEC §2 的事务性要求：**解析成功才落库**，失败不留半本书。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'

import { strToU8, zipSync } from 'fflate'

import { importFile, importTxt, formatOf, titleFromFileName } from '../src/client/library.ts'
import { getChapter, listBooks, openDatabase } from '../src/client/storage.ts'

const bytes = (hex) => {
  const trimmed = hex.trim()
  if (trimmed.length === 0) return new Uint8Array(0)
  return new Uint8Array(trimmed.split(/\s+/).map((pair) => Number.parseInt(pair, 16)))
}

const utf8 = (text) => new TextEncoder().encode(text)

// '第一章 开始\n这是一本测试小说。' 的 GBK 编码
const GBK_NOVEL = bytes(`
  b5 da d2 bb d5 c2 20 bf aa ca bc 0a
  d5 e2 ca c7 d2 bb b1 be b2 e2 ca d4 d0 a1 cb b5 a1 a3
`)

/**
 * 每个用例用一个全新的数据库名做隔离。
 *
 * 刻意不用 `deleteDatabase`：在 fake-indexeddb 下它的回调会挂起，
 * 让测试以"Promise resolution is still pending"超时结束。换名字同样干净，且不会挂。
 */
let databaseCounter = 0
function freshDatabase() {
  databaseCounter += 1
  return openDatabase(`dsh-stealth-reader-test-${databaseCounter}`)
}

test('书名从文件名推导：去扩展名、下划线转空格、去首尾噪声', () => {
  assert.equal(titleFromFileName('斗破苍穹.txt'), '斗破苍穹')
  assert.equal(titleFromFileName('my_novel.epub'), 'my novel')
  assert.equal(titleFromFileName('  多余空格  .txt'), '多余空格')
  assert.equal(titleFromFileName('.txt'), '未命名书籍', '没有名字时给兜底名')
  assert.equal(titleFromFileName('a.b.c.txt'), 'a.b.c', '只去掉最后一个扩展名')
})

test('格式识别：按扩展名，不认识的按 txt', () => {
  assert.equal(formatOf('book.epub'), 'epub')
  assert.equal(formatOf('BOOK.EPUB'), 'epub', '大小写不敏感')
  assert.equal(formatOf('book.txt'), 'txt')
  assert.equal(formatOf('book'), 'txt')
  assert.equal(formatOf('book.md'), 'txt', '未知扩展名按纯文本处理')
})

test('导入 GBK 编码的 txt：能读出正确中文，并记为 gb18030', async () => {
  const db = await freshDatabase()
  const result = await importTxt(db, '斗破苍穹.txt', GBK_NOVEL)

  assert.equal(result.ok, true)
  assert.equal(result.book.title, '斗破苍穹')
  assert.equal(result.book.format, 'txt')
  assert.equal(result.book.encoding, 'gb18030', '必须识别出是 GBK 而不是当成 UTF-8')
  assert.ok(result.book.chapterCount >= 1)

  const chapter = await getChapter(db, result.book.id, 0)
  assert.ok(chapter)
  assert.ok(chapter.text.includes('这是一本测试小说'), `正文应为正确中文，实际：${chapter.text}`)
  assert.ok(!chapter.text.includes('\ufffd'), '不得出现替换字符（那是乱码的标志）')
})

test('导入 UTF-8 多章 txt：章数、标题与正文都对', async () => {
  const db = await freshDatabase()
  const source = [
    '第一章 初入江湖',
    '',
    '他睁开眼。',
    '',
    '第二章 拜师',
    '',
    '清晨的山门。',
  ].join('\n')

  const result = await importTxt(db, '测试书.txt', utf8(source))
  assert.equal(result.ok, true)
  assert.equal(result.book.encoding, 'utf-8')
  assert.equal(result.book.chapterCount, 2)

  const books = await listBooks(db)
  assert.equal(books.length, 1)
  assert.equal(books[0].title, '测试书')
})

test('空文件被拒绝，且不产生书架条目（解析成功才落库）', async () => {
  const db = await freshDatabase()

  const empty = await importTxt(db, '空.txt', bytes(''))
  assert.equal(empty.ok, false)
  assert.ok(empty.error)
  assert.deepEqual(await listBooks(db), [], '失败不得留下半本书')

  const blank = await importTxt(db, '全空白.txt', utf8('   \n\n   \t '))
  assert.equal(blank.ok, false)
  assert.deepEqual(await listBooks(db), [])
})

/**
 * 构造一本最小可读的 epub（真 zip），供端到端导入用。
 * @param overrides - 覆盖任意 zip 条目（用来造 DRM / 残缺等故障书）
 */
function makeEpub(overrides = {}) {
  const container = `<?xml version="1.0"?>
    <container version="1.0"><rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles></container>`

  const opf = `<?xml version="1.0" encoding="utf-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>插图小说</dc:title>
      </metadata>
      <manifest>
        <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="p1" href="Images/pic.png" media-type="image/png"/>
      </manifest>
      <spine><itemref idref="c1"/></spine>
    </package>`

  const chapter = `<html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>第一章 开端</title></head>
    <body><h1>第一章 开端</h1><p>正文一段。</p><img src="../Images/pic.png"/></body>
  </html>`

  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': container,
    'OEBPS/content.opf': opf,
    'OEBPS/Text/ch1.xhtml': chapter,
    'OEBPS/Images/pic.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
    ...overrides,
  }
  for (const [path, value] of Object.entries(files)) {
    if (typeof value === 'string') files[path] = strToU8(value)
  }
  return zipSync(files)
}

test('导入 epub：章节、书名与插图都真的落库了', async () => {
  const db = await freshDatabase()
  const result = await importFile(db, '插图小说.epub', makeEpub())

  assert.equal(result.ok, true, result.ok ? '' : result.error)
  assert.equal(result.book.format, 'epub')
  assert.equal(result.book.title, '插图小说', '书名取 OPF 元数据而不是文件名')
  assert.equal(result.book.chapterCount, 1)
  assert.equal(result.book.warning, undefined, '干净的书不该带告警')

  const chapter = await getChapter(db, result.book.id, 0)
  assert.equal(chapter.title, '第一章 开端')
  assert.ok(chapter.text.includes('正文一段。'))
  assert.ok(chapter.text.includes('\uFFFC0\uFFFC'), '插图位置必须保留占位符')
  assert.equal(chapter.images.length, 1, '插图字节要一起存下来')
  assert.equal(chapter.images[0].mediaType, 'image/png')
  assert.equal(chapter.images[0].data.length, 11, '存的是原图字节，不是引用')
})

test('DRM epub：明确报错，且书架里不出现这本书（SPEC 验收项）', async () => {
  const db = await freshDatabase()
  const encryption = `<encryption>
    <EncryptedData>
      <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
      <CipherReference URI="OEBPS/Text/ch1.xhtml"/>
    </EncryptedData>
  </encryption>`

  const result = await importFile(db, '加密书.epub', makeEpub({ 'META-INF/encryption.xml': encryption }))

  assert.equal(result.ok, false)
  assert.match(result.error, /DRM/)
  assert.deepEqual(await listBooks(db), [], '解析失败绝不能留下半本书')
})

test('损坏的 epub：报错而不是静默失败', async () => {
  const db = await freshDatabase()
  const result = await importFile(db, '坏的.epub', bytes('50 4b 03 04'))

  assert.equal(result.ok, false)
  assert.match(result.error, /不是有效的 epub/)
  assert.deepEqual(await listBooks(db), [])
})
