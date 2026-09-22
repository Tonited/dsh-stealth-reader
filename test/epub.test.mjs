// epub 解析的契约测试（SPEC §2 单元测试清单的最后一项）。
//
// 这里覆盖三条**必须按规范做对**的事，它们在真实 epub 里天天出现、写错了却不报错：
//   1. 章节顺序 = spine 顺序（不是文件名、不是 manifest 顺序）
//   2. 图片相对路径解析（`../Images/a.jpg`、`%20`、大小写不一致）
//   3. 加密检测要区分"字体混淆"（可读）与"正文 DRM"（必须拒绝）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { strToU8, zipSync } from 'fflate'

import {
  extractChapterText,
  extractChapterTitle,
  findEntry,
  findOpfPath,
  guessMediaType,
  inlineImages,
  inspectEncryption,
  normalizePath,
  parseEpub,
  parseOpf,
  readZip,
  resolveHref,
} from '../src/client/epub.ts'
import { splitImagePlaceholders } from '../src/client/richtext.ts'

// ------------------------------------------------------------------ 测试数据

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

/**
 * OPF 故意把 manifest 顺序、文件名顺序都和 spine 顺序**错开**：
 * spine 是 chapter2 → chapter10，而按文件名排会得到 chapter10 → chapter2。
 */
const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试书籍 &amp; 附录</dc:title>
    <dc:identifier id="bookid">urn:uuid:test</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch10" href="Text/chapter10.xhtml" media-type="application/xhtml+xml"/>
    <item id="pic" href="Images/my pic.png" media-type="image/png"/>
    <item id="ch2" href="Text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="Text/notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch2"/>
    <itemref idref="ch10"/>
    <itemref idref="notes" linear="no"/>
  </spine>
</package>`

const CHAPTER_2 = `<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>兜底标题</title><style>p { color: red; }</style></head>
<body>
  <h1>第二章 风起</h1>
  <p>第一段 &amp; 转义。</p>
  <p>第二段。</p>
  <img src="../Images/my%20pic.png" alt="插图"/>
  <p>第三段。</p>
  <img src="../Images/my%20pic.png" alt="重复引用"/>
</body></html>`

const CHAPTER_10 = `<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第十章 归途</title></head>
<body><p>第十章正文。</p></body></html>`

const NOTES = `<html><body><p>这页不该出现（linear="no"）。</p></body></html>`

/** 1×1 的透明 PNG，用作插图字节。 */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
])

function makeEpub(files) {
  const entries = {}
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === 'string' ? strToU8(content) : content
  }
  return zipSync(entries)
}

function validEpub(extra = {}) {
  return makeEpub({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': OPF,
    'OEBPS/Text/chapter2.xhtml': CHAPTER_2,
    'OEBPS/Text/chapter10.xhtml': CHAPTER_10,
    'OEBPS/Text/notes.xhtml': NOTES,
    'OEBPS/Images/my pic.png': PNG,
    ...extra,
  })
}

// ------------------------------------------------------------------ 路径

test('normalizePath：折叠 . 与 ..，统一斜杠', () => {
  assert.equal(normalizePath('a/./b/../c'), 'a/c')
  assert.equal(normalizePath('OEBPS\\Text\\a.xhtml'), 'OEBPS/Text/a.xhtml')
  assert.equal(normalizePath('/a//b/'), 'a/b')
  assert.equal(normalizePath('../a'), 'a', '越过根目录时不留残余 ..')
})

test('resolveHref：相对当前文件所在目录，并处理 %20 与 fragment', () => {
  assert.equal(resolveHref('OEBPS/Text', '../Images/my%20pic.png'), 'OEBPS/Images/my pic.png')
  assert.equal(resolveHref('OEBPS/Text', 'chapter2.xhtml'), 'OEBPS/Text/chapter2.xhtml')
  assert.equal(resolveHref('OEBPS/Text', 'a.xhtml#section1'), 'OEBPS/Text/a.xhtml')
  assert.equal(resolveHref('', '/root.xhtml'), 'root.xhtml')
  // 非法百分号编码不能抛异常
  assert.equal(resolveHref('OEBPS', 'bad%2.xhtml'), 'OEBPS/bad%2.xhtml')
})

test('guessMediaType：只认图片，其它一律 undefined', () => {
  assert.equal(guessMediaType('a/b.JPG'), 'image/jpeg')
  assert.equal(guessMediaType('cover.svg'), 'image/svg+xml')
  assert.equal(guessMediaType('sound.mp3'), undefined)
  assert.equal(guessMediaType('noext'), undefined)
})

test('findEntry：精确优先，其次忽略大小写', () => {
  const entries = new Map([['OEBPS/Text/A.xhtml', new Uint8Array([1])]])
  assert.equal(findEntry(entries, 'OEBPS/Text/A.xhtml')?.length, 1)
  assert.equal(findEntry(entries, 'oebps/text/a.xhtml')?.length, 1)
  assert.equal(findEntry(entries, 'OEBPS/Text/B.xhtml'), undefined)
})

// ------------------------------------------------------------------ 加密

test('加密检测：没有 encryption.xml 不算加密', () => {
  assert.deepEqual(inspectEncryption(undefined), { encrypted: false, fontOnly: false, targets: [] })
  assert.equal(inspectEncryption('   ').encrypted, false)
})

test('加密检测：只加密字体时放行（正版 epub 常见）', () => {
  const xml = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
      <EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
      <CipherData><CipherReference URI="OEBPS/Fonts/serif.otf"/></CipherData>
    </EncryptedData>
  </encryption>`

  const result = inspectEncryption(xml)
  assert.equal(result.encrypted, true)
  assert.equal(result.fontOnly, true, '字体混淆必须被识别为可读')
  assert.deepEqual(result.targets, ['OEBPS/Fonts/serif.otf'])
})

test('加密检测：加密正文时判定为 DRM', () => {
  const xml = `<encryption>
    <EncryptedData>
      <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
      <CipherData><CipherReference URI="OEBPS/Text/chapter1.xhtml"/></CipherData>
    </EncryptedData>
  </encryption>`

  const result = inspectEncryption(xml)
  assert.equal(result.encrypted, true)
  assert.equal(result.fontOnly, false)
  assert.deepEqual(result.targets, ['OEBPS/Text/chapter1.xhtml'])
})

test('加密检测：字体与正文混在一起时，按 DRM 处理（保守）', () => {
  const xml = `<encryption>
    <EncryptedData>
      <EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
      <CipherReference URI="OEBPS/Fonts/serif.otf"/>
    </EncryptedData>
    <EncryptedData>
      <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
      <CipherReference URI="OEBPS/Text/chapter1.xhtml"/>
    </EncryptedData>
  </encryption>`

  assert.equal(inspectEncryption(xml).fontOnly, false)
})

test('DRM epub：明确报错，且错误信息说人话', () => {
  const bytes = validEpub({
    'META-INF/encryption.xml': `<encryption>
      <EncryptedData>
        <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
        <CipherReference URI="OEBPS/Text/chapter2.xhtml"/>
      </EncryptedData>
    </encryption>`,
  })

  const result = parseEpub(bytes, '测试')
  assert.equal(result.ok, false)
  assert.match(result.error, /DRM/)
  assert.match(result.error, /chapter2\.xhtml/, '错误信息应指出被加密的内容，便于用户判断')
})

test('只有字体加密的 epub：可以正常读，并带上告警', () => {
  const bytes = validEpub({
    'META-INF/encryption.xml': `<encryption>
      <EncryptedData>
        <EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
        <CipherReference URI="OEBPS/Fonts/serif.otf"/>
      </EncryptedData>
    </encryption>`,
    'OEBPS/Fonts/serif.otf': new Uint8Array([0, 1, 2]),
  })

  const result = parseEpub(bytes, '测试')
  assert.equal(result.ok, true)
  assert.deepEqual(result.book.warnings, ['字体已加密（不影响阅读）'])
})

// ------------------------------------------------------------------ OPF

test('parseOpf：章节按 spine 顺序，跳过 linear="no"', () => {
  const opf = parseOpf(OPF, 'OEBPS/content.opf')

  assert.deepEqual(opf.spine, ['ch2', 'ch10'], 'linear="no" 的辅助页不该进正文顺序')
  assert.equal(opf.title, '测试书籍 & 附录', '元数据里的实体必须被解码')
  assert.equal(opf.opfDir, 'OEBPS')
  assert.equal(opf.manifest.get('pic')?.mediaType, 'image/png')
})

test('parseOpf：全是 linear="no" 时不能把整本书丢空', () => {
  const xml = OPF.replace('<itemref idref="ch2"/>', '<itemref idref="ch2" linear="no"/>').replace(
    '<itemref idref="ch10"/>',
    '<itemref idref="ch10" linear="no"/>',
  )
  const opf = parseOpf(xml, 'OEBPS/content.opf')
  assert.deepEqual(
    opf.spine,
    ['ch2', 'ch10', 'notes'],
    '宁可多给内容（退回全部项），也不要给一本空书',
  )
})

test('findOpfPath：container.xml 优先，缺失时扫描 .opf', () => {
  const withContainer = new Map([['OEBPS/content.opf', new Uint8Array([1])]])
  assert.equal(findOpfPath(CONTAINER, withContainer), 'OEBPS/content.opf')

  const noContainer = new Map([['book/book.opf', new Uint8Array([1])]])
  assert.equal(findOpfPath(undefined, noContainer), 'book/book.opf')

  assert.equal(findOpfPath(undefined, new Map([['a.txt', new Uint8Array([1])]])), undefined)
})

// ------------------------------------------------------------------ 正文

test('inlineImages：图片换成占位符，找不到的图整段删掉', () => {
  const png = inlineImages('<p>a<img src="x.png"/>b</p>', () => 0)
  assert.equal(png, '<p>a\uFFFC0\uFFFCb</p>')

  assert.equal(inlineImages('<p>a<img src="x.png"/>b</p>', () => null), '<p>ab</p>')
  assert.equal(inlineImages('<p><img/></p>', () => 0), '<p></p>', '没有 src 的图不该造占位符')
  // SVG 里的 image 用 xlink:href
  assert.equal(inlineImages('<image xlink:href="y.svg"/>', () => 1), '\uFFFC1\uFFFC')
})

test('extractChapterText：剥掉 style 内容，保留段落与图片占位', () => {
  const text = extractChapterText(CHAPTER_2, () => 0)

  assert.ok(!text.includes('color: red'), `CSS 不能漏进正文，实际：${text}`)
  assert.ok(!text.includes('<'), '不应残留标签')
  assert.ok(text.includes('第一段 & 转义。'), '实体必须解码且只解一次')

  // 排版契约：标题、每个 <p>、每张图各自成段，段间恰好一个空行。
  // 图片独占一段是刻意的 —— 渲染层据此把它当块级元素处理。
  assert.deepEqual(text.split('\n\n'), [
    '第二章 风起',
    '第一段 & 转义。',
    '第二段。',
    '\uFFFC0\uFFFC',
    '第三段。',
    '\uFFFC0\uFFFC',
  ])
})

test('extractChapterTitle：h1 优先，其次 <title>，超长标题不可信', () => {
  assert.equal(extractChapterTitle(CHAPTER_2, '兜底'), '第二章 风起')
  assert.equal(extractChapterTitle(CHAPTER_10, '兜底'), '第十章 归途', '没有 h1 时用 <title>')

  const longHeading = `<h1>${'很长的正文'.repeat(40)}</h1><title>真标题</title>`
  assert.equal(
    extractChapterTitle(longHeading, '兜底'),
    '真标题',
    'h1 里塞了整章正文时不能采信，要退到 <title>',
  )

  assert.equal(extractChapterTitle('<body><p>没有标题</p></body>', '兜底'), '兜底')
})

// ------------------------------------------------------------------ 端到端

test('parseEpub：章节按 spine 顺序（而不是文件名/manifest 顺序）', () => {
  const result = parseEpub(validEpub(), '文件名兜底')
  assert.equal(result.ok, true)

  const titles = result.book.chapters.map((chapter) => chapter.title)
  assert.deepEqual(
    titles,
    ['第二章 风起', '第十章 归途'],
    `必须按 spine 顺序；按文件名排会得到相反结果，实际：${JSON.stringify(titles)}`,
  )
  assert.ok(
    !result.book.chapters.some((chapter) => chapter.text.includes('不该出现')),
    'linear="no" 的页面不该进正文',
  )
  assert.deepEqual(
    result.book.chapters.map((chapter) => chapter.index),
    [0, 1],
    'index 必须连续重排，不能被 spine 里的原始位置带偏',
  )
})

test('parseEpub：书名取元数据，元数据缺失时退回文件名', () => {
  assert.equal(parseEpub(validEpub(), '文件名兜底').book.title, '测试书籍 & 附录')

  const noTitle = OPF.replace(/<dc:title>.*<\/dc:title>/, '')
  const bytes = validEpub({ 'OEBPS/content.opf': noTitle })
  assert.equal(parseEpub(bytes, '文件名兜底').book.title, '文件名兜底')
})

test('parseEpub：插图按相对路径解析，同一张图复用同一索引', () => {
  const result = parseEpub(validEpub(), '兜底')
  const [chapter] = result.book.chapters

  assert.equal(chapter.images.length, 1, '同一张图被引用两次只应存一份')
  assert.equal(chapter.images[0].name, 'OEBPS/Images/my pic.png')
  assert.equal(chapter.images[0].mediaType, 'image/png')
  assert.equal(chapter.images[0].data.length, PNG.length)

  const placeholders = splitImagePlaceholders(chapter.text).filter((block) => block.type === 'image')
  assert.equal(placeholders.length, 2, '两处引用都要留下位置')
  assert.deepEqual(
    placeholders.map((block) => block.index),
    [0, 0],
    '两处引用同一个索引',
  )
})

test('parseEpub：图片缺失或非图片时不产生占位符，也不炸', () => {
  const bytes = validEpub({
    'OEBPS/Text/chapter2.xhtml': `<html><body>
      <p>正文</p>
      <img src="../Images/missing.png"/>
      <img src="../Text/chapter10.xhtml"/>
    </body></html>`,
  })

  const result = parseEpub(bytes, '兜底')
  assert.equal(result.ok, true)
  const [chapter] = result.book.chapters
  assert.deepEqual(chapter.images, [])
  assert.equal(chapter.text, '正文')
})

test('parseEpub：缺少 OPF / 空 spine / 非 zip 都给出明确错误', () => {
  const noOpf = makeEpub({ 'a.txt': 'not an epub' })
  const missing = parseEpub(noOpf, '兜底')
  assert.equal(missing.ok, false)
  assert.match(missing.error, /找不到 \.opf|缺少书目信息/)

  const emptySpine = validEpub({
    'OEBPS/content.opf': OPF.replace(/<spine>[\s\S]*?<\/spine>/, '<spine></spine>'),
  })
  const spine = parseEpub(emptySpine, '兜底')
  assert.equal(spine.ok, false)
  assert.match(spine.error, /没有可读的正文/)

  const garbage = parseEpub(strToU8('这根本不是 zip 文件'), '兜底')
  assert.equal(garbage.ok, false)
  assert.match(garbage.error, /不是有效的 epub/)

  const empty = parseEpub(new Uint8Array(0), '兜底')
  assert.equal(empty.ok, false)
  assert.match(empty.error, /空的/)
})

test('readZip：目录条目被规范化，正文文件能被查到', () => {
  const zip = readZip(validEpub())
  assert.equal(zip.ok, true)
  assert.ok(zip.entries.has('OEBPS/Text/chapter2.xhtml'))
  assert.ok(zip.entries.has('META-INF/container.xml'))
})

test('parseEpub：章节正文里不会漏出 XHTML 的 head 内容', () => {
  const result = parseEpub(validEpub(), '兜底')
  for (const chapter of result.book.chapters) {
    assert.ok(!/xmlns|<html|<p>/.test(chapter.text), `正文不该含标签：${chapter.text.slice(0, 80)}`)
  }
})
