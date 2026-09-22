// 真实会话 → 对话行的契约测试。
//
// 这些字段形状是实测出来的（docs/dsh-conversation-ui.md §5），而它们几乎都不直观：
// 事件信封字段叫 `type` 不叫 `kind`；assistant 文本埋在 `message.content[i].text`；
// 工具参数是**原始 JSON 字符串**；工具结果**没有 ok 字段**，失败看 `content[0].isError`。
// 每一条都写反过就会静默地少一行或把失败显示成成功。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_DIALOGUE_LINE,
  dialogueFromEntries,
  kindOf,
  lineOf,
  roleOf,
  shortenPath,
  summarizeArguments,
} from '../src/client/dialogue.ts'

/** 按实测的信封形状包一条事件。 */
const envelope = (type, data, extra = {}) => ({
  type: 'event',
  event: { type, seq: 1, time: 1700000000000, data, ...extra },
})

test('kindOf：读的是信封的 type（不是 kind）', () => {
  assert.equal(kindOf(envelope('assistant/message', {})), 'assistant/message')
  assert.equal(kindOf({ event: { kind: 'tool/call' } }), 'tool/call', '老形状也认')
  assert.equal(kindOf({ type: 'assistant/message' }), 'assistant/message', '裸事件也认')
  assert.equal(kindOf(null), undefined)
})

test('roleOf：类型 → 角色', () => {
  assert.equal(roleOf('user/message'), 'user')
  assert.equal(roleOf('assistant/message'), 'assistant')
  assert.equal(roleOf('tool/call'), 'tool')
  assert.equal(roleOf('tool/result'), 'result')
  assert.equal(roleOf('step/start'), null, 'step 不产生对话行')
  assert.equal(roleOf('assistant/live-chunk'), null, '增量块会在最终消息里再出现一次')
  assert.equal(roleOf(undefined), null)
})

test('assistant 文本在 message.content[i].text 里', () => {
  const entry = envelope('assistant/message', {
    turn: 1,
    step: 2,
    message: { content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] },
  })

  const line = lineOf(entry)
  assert.equal(line.role, 'assistant')
  assert.equal(line.text, '第一段 第二段')
})

test('用户消息取得到文本（多形态容错）', () => {
  assert.equal(lineOf(envelope('user/message', { text: '帮我看下这个' })).text, '帮我看下这个')
  assert.equal(
    lineOf(envelope('user/message', { message: { content: [{ text: '换个写法' }] } })).text,
    '换个写法',
  )
})

test('工具调用：名称来自 data.name，摘要来自 arguments（原始 JSON 字符串）', () => {
  const entry = envelope('tool/call', {
    turn: 1,
    step: 1,
    callId: 'call_1',
    name: 'Read',
    arguments: JSON.stringify({ file_path: '/home/dev/work/project/secret/notes.md' }),
  })

  const line = lineOf(entry)
  assert.equal(line.role, 'tool')
  assert.equal(line.name, 'Read')
  assert.equal(
    line.text,
    'secret/notes.md',
    '只保留尾部两段：绝对路径会把真实目录结构摊在屏幕上',
  )
})

test('summarizeArguments：坏 JSON / 陌生键都安全返回空串', () => {
  assert.equal(summarizeArguments('不是 JSON'), '')
  assert.equal(summarizeArguments(''), '')
  assert.equal(summarizeArguments(undefined), '')
  assert.equal(summarizeArguments('{"无关":1}'), '')
  assert.equal(summarizeArguments(JSON.stringify({ command: 'npm test' })), 'npm test')
  assert.equal(summarizeArguments(JSON.stringify({ pattern: 'TODO' })), 'TODO')
})

test('工具结果：内容在 message.content[0].content，失败看 isError（没有 ok 字段）', () => {
  const ok = lineOf(
    envelope('tool/result', {
      turn: 1,
      step: 1,
      message: { content: [{ content: '共 12 个文件', isError: false }] },
    }),
  )
  assert.equal(ok.role, 'result')
  assert.equal(ok.ok, true)
  assert.equal(ok.text, '共 12 个文件')

  const failed = lineOf(
    envelope('tool/result', {
      turn: 1,
      step: 1,
      message: { content: [{ content: 'ENOENT: no such file', isError: true }] },
    }),
  )
  assert.equal(failed.ok, false, 'isError 为真就是失败，不能因为缺少 ok 字段就当成成功')

  const withError = lineOf(
    envelope('tool/result', { message: { content: [{ content: '炸了' }] }, error: { name: 'X' } }),
  )
  assert.equal(withError.ok, false, '信封上的 error 同样代表失败')
})

test('step 事件与增量块不产生对话行', () => {
  assert.equal(lineOf(envelope('step/start', { turn: 1, step: 1 })), null)
  assert.equal(lineOf(envelope('step/end', { turn: 1, step: 1 })), null)
  assert.equal(
    lineOf(envelope('assistant/live-chunk', { chunk: { text: '正在' } })),
    null,
    '增量块若单独成行，同一段内容会在屏幕上出现两次',
  )
})

test('文本一律脱敏并限长', () => {
  const long = lineOf(
    envelope('assistant/message', { message: { content: [{ text: '字'.repeat(500) }] } }),
  )
  assert.ok(long.text.length <= MAX_DIALOGUE_LINE, `限长失效：${long.text.length}`)

  const secret = lineOf(
    envelope('assistant/message', {
      message: { content: [{ text: '看 https://internal.example.com/a/b?token=xyz 这个' }] },
    }),
  )
  assert.ok(!secret.text.includes('internal.example.com'), `URL 必须被抹掉：${secret.text}`)
})

test('shortenPath：无分隔符时原样返回，多段时只留尾部两段', () => {
  assert.equal(shortenPath('notes.md'), 'notes.md')
  assert.equal(shortenPath('a/b'), 'a/b')
  assert.equal(shortenPath('/a/b/c/d.ts'), 'c/d.ts')
  assert.equal(shortenPath('C:\\work\\proj\\x.ts'), 'proj/x.ts')
})

test('dialogueFromEntries：保序、丢弃认不出的、只留最后 limit 条', () => {
  const entries = [
    envelope('step/start', { turn: 1, step: 1 }),
    envelope('user/message', { text: '一' }),
    envelope('assistant/message', { message: { content: [{ text: '二' }] } }),
    envelope('tool/call', { name: 'Bash', arguments: JSON.stringify({ command: 'ls' }) }),
    envelope('unknown/thing', {}),
  ]

  const lines = dialogueFromEntries(entries)
  assert.deepEqual(
    lines.map((line) => line.role),
    ['user', 'assistant', 'tool'],
    '顺序必须与发生顺序一致，且认不出的丢掉',
  )

  assert.deepEqual(
    dialogueFromEntries(entries, 2).map((line) => line.role),
    ['assistant', 'tool'],
    '只保留最后几条：最近发生的才和"我正在干活"对得上',
  )

  assert.deepEqual(dialogueFromEntries(null), [])
  assert.deepEqual(dialogueFromEntries('不是数组'), [])
})

test('roleOf：系统注入不算工作痕迹（它会占掉好几行，还像在打印配置）', () => {
  assert.equal(roleOf('assistant/context-injection'), null)
  assert.equal(roleOf('system/prompt'), null)
  assert.equal(roleOf('session/runtime-context'), null)
  // 真正的回复与工具调用照旧
  assert.equal(roleOf('assistant/message'), 'assistant')
  assert.equal(roleOf('tool/call'), 'tool')
  assert.equal(roleOf('tool/result'), 'result')
  assert.equal(roleOf('user/message'), 'user')
})
