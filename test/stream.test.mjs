// 内容流排布的契约测试。
//
// 最要紧的一条是**确定性**：同一章两次渲染必须逐行相同。否则读者滚动到一半时
// 任何一次重渲染（进度回写、翻章、切回来）都会让内容整体位移，位置直接丢失。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_TOOL_OUTPUT_RATIO,
  MAX_GAP,
  MIN_GAP,
  chapterLine,
  dialogueToStreamLine,
  seededRandom,
  splitParagraphs,
  weaveStream,
} from '../src/client/stream.ts'

/** 一批"真实会话行"，用来交错。 */
const DIALOGUE = [
  { role: 'user', text: '帮我看下这个模块' },
  { role: 'assistant', text: '好的，我先读一下相关文件。' },
  { role: 'tool', name: 'Read', text: 'src/index.ts' },
  { role: 'result', text: '导出 12 个符号', ok: true },
]

const chapter = (count) =>
  Array.from({ length: count }, (_, index) => `第 ${index + 1} 段正文，写了一些内容。`).join('\n\n')

const weave = (overrides = {}) =>
  weaveStream({
    dialogue: DIALOGUE,
    chapterText: chapter(40),
    chapterTitle: '第一章 风起',
    chapterIndex: 2,
    chapterCount: 512,
    ...overrides,
  })

test('首行永远是章节行，伪装成任务进度', () => {
  const [first] = weave()
  assert.equal(first.kind, 'chapter')
  assert.equal(first.text, '[3/512] 第一章 风起')
  assert.equal(first.marker, '[3/512]')
})

test('章节标题为空时给兜底名', () => {
  assert.equal(chapterLine(0, 10, '   ').text, '[1/10] 第 1 章')
  assert.equal(chapterLine(4, 10, undefined).text, '[5/10] 第 5 章')
})

test('确定性：同一章渲染两次逐行相同', () => {
  assert.deepEqual(weave(), weave())
  assert.deepEqual(weave({ chapterIndex: 7 }), weave({ chapterIndex: 7 }))
  assert.notDeepEqual(weave({ chapterIndex: 1 }), weave({ chapterIndex: 7 }))
})

test('小说段落一个不少、顺序不变（排版不能吃掉内容）', () => {
  const lines = weave()
  const prose = lines
    .filter((line) => line.source === 'novel' && line.kind !== 'chapter')
    .map((line) => line.text)

  assert.equal(prose.length, 40)
  assert.deepEqual(prose, splitParagraphs(chapter(40)))
})

test('小说段落的身份只可能是"工具输出"或"AI 回复"', () => {
  const lines = weave()
  for (const line of lines) {
    assert.ok(
      ['chapter', 'user', 'assistant', 'tool', 'result'].includes(line.kind),
      `未知的行类型：${line.kind}`,
    )
  }

  const proseKinds = new Set(
    lines.filter((line) => line.source === 'novel' && line.kind !== 'chapter').map((l) => l.kind),
  )
  assert.ok(proseKinds.has('result'), '必须有冒充工具输出的段落')
  assert.ok(proseKinds.has('assistant'), '必须有冒充 AI 回复的段落')
})

test('工具输出占比接近设定的比例（默认七成）', () => {
  const lines = weave({ chapterText: chapter(400) })
  const prose = lines.filter((line) => line.source === 'novel' && line.kind !== 'chapter')
  const asResult = prose.filter((line) => line.kind === 'result').length
  const share = asResult / prose.length

  assert.ok(
    Math.abs(share - DEFAULT_TOOL_OUTPUT_RATIO) < 0.1,
    `工具输出占比应接近 ${DEFAULT_TOOL_OUTPUT_RATIO}，实际 ${share.toFixed(2)}`,
  )
})

test('比例可调：0 全是 AI 回复，1 全是工具输出', () => {
  const novel = (lines) => lines.filter((line) => line.source === 'novel' && line.kind !== 'chapter')

  assert.ok(novel(weave({ toolOutputRatio: 0 })).every((line) => line.kind === 'assistant'))
  assert.ok(novel(weave({ toolOutputRatio: 1 })).every((line) => line.kind === 'result'))
})

test('真实会话行与小说交错，间距落在契约区间内', () => {
  const lines = weave()
  const dialogueCount = lines.filter((line) => line.source === 'real').length
  assert.ok(dialogueCount > 0, '几十段正文之间至少该出现一次真实会话行')

  // 统计连续小说段数
  const gaps = []
  let current = 0
  for (const line of lines.slice(1)) {
    if (line.source === 'novel') current += 1
    else {
      gaps.push(current)
      current = 0
    }
  }
  gaps.push(current)

  for (const gap of gaps.slice(0, -1)) {
    assert.ok(
      gap >= MIN_GAP && gap <= MAX_GAP,
      `两行真实会话之间应夹 ${MIN_GAP}~${MAX_GAP} 段小说，实际 ${gap}`,
    )
  }
})

test('真实会话行循环使用：行数多于素材时也不缺行', () => {
  const lines = weave({ chapterText: chapter(400) })
  const dialogue = lines.filter((line) => line.source === 'real')
  assert.ok(dialogue.length > 0)
  for (const line of dialogue) {
    assert.ok(
      DIALOGUE.some((item) => item.text === line.text),
      `不得凭空编造会话行：${line.text}`,
    )
  }
})

test('没有真实会话行时只剩正文，不报错也不留空洞', () => {
  const lines = weave({ dialogue: [] })
  assert.equal(lines.length, 41, '章节行 + 40 段正文')
  assert.equal(lines[0].kind, 'chapter')
  for (const line of lines.slice(1)) {
    assert.equal(line.source, 'novel', `不该出现会话行：${line.kind}`)
  }
})

test('空正文：只给章节行', () => {
  assert.equal(weave({ chapterText: '' }).length, 1)
  assert.equal(weave({ chapterText: '   \n\n  ' }).length, 1)
  assert.equal(weave({ chapterText: undefined }).length, 1)
})

test('一行一段：中文小说的单换行也分段（否则整章会变成一整段）', () => {
  // 曾经的实现只认空行，中文 txt 小说因此整章挤成一段 —— 没有段落、也没有位置交错
  // 工作痕迹行，屏幕上就是一整块纯正文。这是用户实测发现的问题。
  const lines = weaveStream({
    dialogue: [],
    chapterText: '第一行\n第二行\n\n下一段',
    chapterTitle: 't',
    chapterIndex: 0,
    chapterCount: 1,
  })
  assert.deepEqual(
    lines.slice(1).map((line) => line.text),
    ['第一行', '第二行', '下一段'],
  )
})

test('dialogueToStreamLine：角色、工具名、成败都带过去，且标记为真实来源', () => {
  assert.deepEqual(dialogueToStreamLine({ role: 'tool', name: 'Read', text: 'a.ts' }), {
    kind: 'tool',
    source: 'real',
    text: 'a.ts',
    name: 'Read',
    ok: undefined,
  })
  assert.deepEqual(dialogueToStreamLine({ role: 'result', text: 'ok', ok: false }), {
    kind: 'result',
    source: 'real',
    text: 'ok',
    name: undefined,
    ok: false,
  })
})

test('splitParagraphs：单换行与空行都算分段，忽略空段', () => {
  assert.deepEqual(splitParagraphs('\n\n甲\n\n\n\n乙\n\n'), ['甲', '乙'])
  assert.deepEqual(splitParagraphs('甲\n乙\n丙'), ['甲', '乙', '丙'], '一行一段')
  assert.deepEqual(splitParagraphs('甲\r\n\r\n乙'), ['甲', '乙'], 'CRLF 也要认')
  assert.deepEqual(splitParagraphs(''), [])
  assert.deepEqual(splitParagraphs(undefined), [])
})

test('seededRandom：同种子同序列，不同种子不同序列', () => {
  const a = Array.from({ length: 5 }, seededRandom(3))
  const b = Array.from({ length: 5 }, seededRandom(3))
  const c = Array.from({ length: 5 }, seededRandom(4))

  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
  assert.ok(a.every((value) => value >= 0 && value < 1))
})
