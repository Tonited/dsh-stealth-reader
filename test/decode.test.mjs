// 文本解码的契约测试。
//
// 这是中文 txt 导入最容易静默失败的地方：GBK 文件被当 UTF-8 读 → 全文乱码，
// 而"看起来有字"会让用户以为文件本身坏了。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decodeGb18030, decodeText, hasBom, looksLikeText, tryDecodeUtf8 } from '../src/client/decode.ts'

/** 用十六进制字面量构造字节，这样测试不依赖宿主的编码器。 */
const bytes = (hex) => {
  const trimmed = hex.trim()
  // 注意：空字符串不能走 split 路径 —— 那会造出 [NaN] → [0]，而不是空数组
  if (trimmed.length === 0) return new Uint8Array(0)
  return new Uint8Array(trimmed.split(/\s+/).map((pair) => Number.parseInt(pair, 16)))
}

const utf8 = (text) => new TextEncoder().encode(text)

const UTF8_HELLO = bytes('e4 bd a0 e5 a5 bd') // 你好
const UTF8_WITH_BOM = bytes('ef bb bf e4 bd a0 e5 a5 bd')
const GBK_HELLO = bytes('c4 e3 ba c3') // 你好（GBK）
const GBK_SENTENCE = bytes('d5 e2 ca c7 d2 bb b1 be d0 a1 cb b5') // 这是一本小说

test('UTF-8 合法内容直接通过，不做多余回退', () => {
  assert.equal(tryDecodeUtf8(UTF8_HELLO), '你好')
  assert.equal(tryDecodeUtf8(UTF8_WITH_BOM), '你好')

  const result = decodeText(UTF8_HELLO)
  assert.equal(result.encoding, 'utf-8')
  assert.equal(result.text, '你好')
  assert.equal(result.error, undefined)
})

test('BOM 被识别（合法 UTF-8 的强证据）', () => {
  assert.equal(hasBom(UTF8_WITH_BOM), true)
  assert.equal(hasBom(UTF8_HELLO), false)
  assert.equal(hasBom(bytes('')), false)
})

test('GBK 内容能解码出正确的中文', () => {
  assert.equal(decodeGb18030(GBK_HELLO), '你好')
})

test('UTF-8 非法字节序列必须抛错（这样才能触发回退）', () => {
  assert.equal(tryDecodeUtf8(GBK_HELLO), undefined, 'GBK 字节不是合法 UTF-8')
})

test('GBK 文件回退到 GB18030 并解出中文', () => {
  const result = decodeText(GBK_SENTENCE)
  assert.equal(result.encoding, 'gb18030')
  assert.equal(result.text, '这是一本小说')
  assert.equal(result.error, undefined)
})

test('二进制垃圾不会被"成功解码"成文本', () => {
  const binary = new Uint8Array(200)
  for (let index = 0; index < binary.length; index += 1) binary[index] = (index * 7) % 256
  binary[10] = 0x00 // NUL 是二进制文件的强特征

  assert.equal(looksLikeText('\u0000abc'), false, '含 NUL 直接判定为非文本')
  assert.equal(looksLikeText(''), false)

  const result = decodeText(binary)
  assert.ok(result.error, '必须报错而不是静默返回垃圾')
})

test('空文件给出明确错误', () => {
  const result = decodeText(bytes(''))
  assert.equal(result.text, '')
  assert.ok(result.error)
})

test('looksLikeText：中文正常，乱码可疑', () => {
  assert.equal(looksLikeText('第一章 这是一段正常的中文正文内容。'), true)
  assert.equal(looksLikeText('\ufffd\ufffd\ufffd'), false, '替换字符是乱码特征')
  assert.equal(looksLikeText('\ue000\ue001\ue002'), false, '私用区是乱码的典型落点')
  assert.equal(looksLikeText('   '), false, '全空白不算文本')
})
