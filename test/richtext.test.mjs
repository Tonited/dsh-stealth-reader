// 正文占位符工具的契约测试。
//
// 渲染层（readerview 的 ChapterBody）直接依赖它把正文切成节点，
// 所以"畸形占位符"这类输入必须钉住：宁可当普通文本，也不要凭空造一张图或吞掉正文。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLACEHOLDER,
  imageIndexesIn,
  imagePlaceholder,
  splitImagePlaceholders,
  stripImagePlaceholders,
} from '../src/client/richtext.ts'

test('imagePlaceholder：定界可信、可逆', () => {
  const text = `前${imagePlaceholder(3)}后`
  assert.deepEqual(splitImagePlaceholders(text), [
    { type: 'text', value: '前' },
    { type: 'image', index: 3 },
    { type: 'text', value: '后' },
  ])
})

test('占位符用的是 U+FFFC（小说正文里不会自然出现）', () => {
  assert.equal(PLACEHOLDER, '\uFFFC')
})

test('纯文本：原样一块返回，空串返回空数组', () => {
  assert.deepEqual(splitImagePlaceholders('只有正文'), [{ type: 'text', value: '只有正文' }])
  assert.deepEqual(splitImagePlaceholders(''), [])
})

test('连续占位符：每个都单独成块，中间不插空文本块', () => {
  const text = `${imagePlaceholder(0)}${imagePlaceholder(1)}`
  assert.deepEqual(splitImagePlaceholders(text), [
    { type: 'image', index: 0 },
    { type: 'image', index: 1 },
  ])
})

test('行首行尾的占位符不会产生空文本块', () => {
  assert.deepEqual(splitImagePlaceholders(imagePlaceholder(2)), [{ type: 'image', index: 2 }])
})

test('畸形占位符当普通文本处理，不凭空造图', () => {
  // 只有前定界符
  assert.deepEqual(splitImagePlaceholders('正文\uFFFC'), [{ type: 'text', value: '正文\uFFFC' }])
  // 没有数字
  assert.deepEqual(splitImagePlaceholders('\uFFFC\uFFFC'), [{ type: 'text', value: '\uFFFC\uFFFC' }])
  // 数字溢出
  const overflow = `\uFFFC${'9'.repeat(30)}\uFFFC`
  assert.deepEqual(splitImagePlaceholders(overflow), [{ type: 'text', value: overflow }])
})

test('stripImagePlaceholders：去掉标记后是干净正文', () => {
  const text = `第一段。${imagePlaceholder(0)}第二段。`
  assert.equal(stripImagePlaceholders(text), '第一段。第二段。')
  assert.equal(stripImagePlaceholders('没有图'), '没有图')
})

test('imageIndexesIn：去重且升序', () => {
  const text = `${imagePlaceholder(2)}文字${imagePlaceholder(0)}${imagePlaceholder(2)}`
  assert.deepEqual(imageIndexesIn(text), [0, 2])
  assert.deepEqual(imageIndexesIn('没有图'), [])
})
