// 章节切分的契约测试。
//
// 中文 txt 没有统一格式，所以这里覆盖的是"真实会遇到的各种样子"：
// 标准标记、阿拉伯数字标记、完全没有标记、以及超长无空行段落。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CHUNK_CHARS, splitChapters } from '../src/client/chapters.ts'

const novel = [
  '第一章 初入江湖',
  '',
  '他睁开眼，发现自己躺在一张陌生的床上。',
  '',
  '第二章 拜师',
  '',
  '清晨的山门笼罩在雾气里。',
  '',
  '第三章 试炼',
  '',
  '三年之后，他终于站在了试炼场上。',
].join('\n')

test('识别中文章节标记并按标记切分', () => {
  const chapters = splitChapters(novel)

  assert.equal(chapters.length, 3)
  assert.deepEqual(
    chapters.map((chapter) => chapter.title),
    ['第一章 初入江湖', '第二章 拜师', '第三章 试炼'],
  )
  assert.ok(chapters[0].text.includes('陌生的床'), '正文必须归属于对应章节')
  assert.ok(!chapters[0].text.includes('试炼场'), '正文不得串到下一章')
  assert.deepEqual(
    chapters.map((chapter) => chapter.index),
    [0, 1, 2],
  )
})

test('支持阿拉伯数字与英文标记', () => {
  const text = ['1. 起点', '内容一', '2. 转折', '内容二', 'Chapter 3', '内容三'].join('\n')
  const chapters = splitChapters(text)
  assert.equal(chapters.length, 3)
  assert.equal(chapters[0].title, '1. 起点')
  assert.equal(chapters[2].title, 'Chapter 3')
})

test('正文里提到"第X章"不会误切（标题行必须很短）', () => {
  const text = [
    '第一章 开始',
    '他翻到书的第三十二章那一页，发现上面写着这样一句话，然后继续往下读了很多内容。',
    '第二章 继续',
    '又是很长的一段正文内容，用来占位。',
  ].join('\n')

  const chapters = splitChapters(text)
  assert.equal(chapters.length, 2, '长句里的"第三十二章"不是章节标题')
})

test('没有标记时按字数切块，且不产生无底滚轴', () => {
  // 12 万个字、没有换行、没有任何章节标记
  const raw = '这是一段没有任何章节标记的长文本，用来验证按字数切块的兜底策略。'.repeat(4000)
  assert.ok(raw.length > CHUNK_CHARS * 10)

  const chapters = splitChapters(raw)
  assert.ok(chapters.length > 10, `应切成多块，实际 ${chapters.length}`)
  for (const chapter of chapters) {
    // 允许在断点附近多取一点（adjustBoundary 最多 +400）
    assert.ok(chapter.text.length <= CHUNK_CHARS + 400, `单块过长：${chapter.text.length}`)
  }
  // 不能丢内容
  const joined = chapters.map((chapter) => chapter.text).join('').replace(/\s/g, '')
  assert.equal(joined.length, raw.replace(/\s/g, '').length, '切分不得丢字')
})

test('优先在空行处断开', () => {
  // 段落数要够多，否则整篇会被当成一章（那测的是另一个分支）
  const paragraphs = Array.from({ length: 2000 }, (_, index) => `这是第${index + 1}段正文内容。`)
  const raw = paragraphs.join('\n\n')
  const chapters = splitChapters(raw)

  assert.ok(chapters.length > 1)
  for (const chapter of chapters.slice(0, -1)) {
    const tail = chapter.text.slice(-1)
    assert.ok(tail === '。' || tail === '\n' || tail.trim().length === 0, `断点不自然：${JSON.stringify(tail)}`)
  }
})

test('只有 1 个标记时退化为按字数切（避免误判整本只有一章）', () => {
  const raw = `第一章 唯一的标记\n${'正文内容。'.repeat(3000)}`
  const chapters = splitChapters(raw)

  assert.ok(chapters.length > 1, '单个标记不足以认定章节结构')
  assert.equal(chapters[0].title, '第 1 节', '退化模式使用顺序标题')
})

test('短文本成为单章；空文本返回空数组', () => {
  const short = splitChapters('只有一小段文字。')
  assert.equal(short.length, 1)
  assert.equal(short[0].title, '全文')
  assert.equal(short[0].text, '只有一小段文字。')

  assert.deepEqual(splitChapters(''), [])
  assert.deepEqual(splitChapters('   \n\n  '), [])
})

test('CRLF 与 CR 行尾都能处理', () => {
  const text = '第一章 甲\r\n正文甲\r\n第二章 乙\r\n正文乙'
  const chapters = splitChapters(text)
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].text, '正文甲')
  assert.equal(chapters[1].text, '正文乙')
})
