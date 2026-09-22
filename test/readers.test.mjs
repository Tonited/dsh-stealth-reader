// 会话读取器的契约测试。
//
// 这些测试存在的唯一理由：两个真实故障都是"我猜了 API 形状而不是照契约写"，
// 而在浏览器里它们的表现都只是"功能静默无效"：
//   1. ObservableSnapshot 被写成 `get()` / `.value`，契约方法是 `getSnapshot()` → 永远 0 个会话
//   2. 事件正文形状猜错 → 片段永远取不到
// 所以这里把契约方法名与事件形状**钉死成断言**。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SNAPSHOT_READER,
  collectSnippets,
  extractExcerpts,
  extractText,
  hasRows,
  looksSuspicious,
  readSnapshot,
  redact,
  seenEventKinds,
  summarize,
  summarizeToolCalls,
} from '../src/client/readers.ts'

test('快照取值走契约方法 getSnapshot（不是 get/value）', () => {
  assert.equal(SNAPSHOT_READER, 'getSnapshot')

  const state = { ids: ['s1'], byId: { s1: { displayTitle: 'T' } }, phase: 'ready' }
  const snapshot = { getSnapshot: () => state }

  assert.equal(readSnapshot(snapshot), state)
  // 关键回归：只有 get() 的异形实现不该被误当成契约实现
  assert.equal(readSnapshot({ get: () => 'wrong', getSnapshot: () => state }), state)
  assert.equal(readSnapshot(undefined), undefined)
  assert.equal(readSnapshot({}), undefined)
})

test('会话列表快照能读出标题（displayTitle 优先，title 兜底）', () => {
  const state = {
    ids: ['a', 'b', 'c'],
    byId: {
      a: { displayTitle: '标题 A' },
      b: { title: '只有 title' },
      c: {},
    },
  }

  assert.equal(hasRows(state), true)
  assert.equal(hasRows({ ids: [] }), false)
  assert.equal(hasRows(undefined), false)

  assert.deepEqual(summarize(state), [
    { id: 'a', title: '标题 A' },
    { id: 'b', title: '只有 title' },
    { id: 'c', title: '' },
  ])
})

test('正文从 SessionEventSource 的事件窗口里取得', () => {
  // 官方 UI 的读取路径：sessions.binding(id).eventSource.getSnapshot().entries
  const binding = {
    eventSource: {
      getSnapshot: () => ({
        entries: [
          { type: 'event', event: { kind: 'user/message', data: { text: '帮我看下这个 bug' } } },
          {
            type: 'event',
            event: { kind: 'assistant/message', data: { message: { content: [{ text: '好的' }] } } },
          },
          { type: 'transient', event: { kind: 'assistant/live-chunk' } },
        ],
        hasMore: false,
        revision: 3,
      }),
    },
  }

  const entries = binding.eventSource.getSnapshot().entries
  const excerpts = extractExcerpts(entries, 5)

  assert.equal(excerpts.length, 2, '只提取含文本的事件')
  assert.equal(excerpts[0].kind, 'user/message')
  assert.equal(excerpts[0].text, '帮我看下这个 bug')
  assert.equal(excerpts[1].kind, 'assistant/message')
  assert.equal(excerpts[1].text, '好的')

  // 类型清单用于诊断"真实形状与预期不符"
  assert.deepEqual(seenEventKinds(entries), [
    'user/message',
    'assistant/message',
    'assistant/live-chunk',
  ])
})

test('正文提取容忍多种未文档化形状，且不虚构文本', () => {
  assert.equal(extractText({ data: { text: '直接 text' } }), '直接 text')
  assert.equal(extractText({ data: { content: '字符串 content' } }), '字符串 content')
  assert.equal(
    extractText({ data: { message: { content: [{ text: 'A' }, { text: 'B' }] } } }),
    'A B',
  )
  assert.equal(extractText({ data: { content: [{ value: 'V' }] } }), 'V')
  assert.equal(extractText({ data: { nothing: true } }), undefined)
  assert.equal(extractText(undefined), undefined)
})

test('片段脱敏：路径、URL、长 token 不得进入伪装壳', () => {
  assert.equal(redact('看下 /home/dev/project/src/index.ts 这个文件'), '看下 … 这个文件')
  assert.equal(redact('参考 https://example.com/a/b 的说明'), '参考 … 的说明')
  assert.equal(redact('短'), '短')

  const long = 'x'.repeat(200)
  assert.equal(redact(long, 60).length, 60, '必须有长度上限')

  // 多行/多空白压成一行：伪装壳是"一行一条日志"
  assert.equal(redact('a\n\n  b   c'), 'a b c')
})

// ---------------------------------------------------------------- 伪装壳信号

const makeToolCall = (name) => ({ type: 'event', event: { kind: 'tool/call', data: { name } } })
const makeAssistant = (text) => ({
  type: 'event',
  event: { kind: 'assistant/message', data: { message: { content: [{ text }] } } },
})

test('标题过滤：displayTitle 退化成路径/文件名时不可用', () => {
  assert.equal(looksSuspicious('/home/dev/project'), true)
  assert.equal(looksSuspicious('project'), false)
  assert.equal(looksSuspicious('index.ts'), true, '文件名同样不可用')
  assert.equal(looksSuspicious('DeepSeek隐藏看小说插件开发'), false)
})

test('工具名统计：按次数降序，只数 tool/call 与 tool/result', () => {
  const entries = [
    makeToolCall('Read'),
    makeToolCall('Read'),
    makeToolCall('Bash'),
    { type: 'event', event: { kind: 'tool/result', data: { name: 'Bash' } } },
    makeToolCall('Edit'),
    { type: 'event', event: { kind: 'tool/call', data: {} } }, // 无名字：忽略
    makeAssistant('这段不该被算作工具'),
  ]

  assert.deepEqual(summarizeToolCalls(entries), ['Read × 2', 'Bash × 2', 'Edit × 1'])
  assert.deepEqual(summarizeToolCalls(entries, 1), ['Read × 2'])
  assert.deepEqual(summarizeToolCalls([]), [])
})

test('片段收集：脱敏、拒绝可疑内容、限长限量', () => {
  const entries = [
    makeAssistant('看下 /home/dev/project/src/index.ts 这个文件'),
    makeAssistant('run build.mjs'),
    makeAssistant('把两态机实现出来'),
    makeAssistant('第四段不该出现'),
  ]

  const snippets = collectSnippets(entries, 2)
  assert.equal(snippets.length, 2, '必须限量')
  assert.equal(snippets[0], '看下 … 这个文件', '路径必须被脱敏')
  assert.ok(!snippets.includes('run build.mjs'), '看起来像文件名的片段必须被丢弃')
  assert.equal(snippets[1], '把两态机实现出来')

  // 每个片段都要满足长度上限（它们会真的显示在屏幕上）
  for (const snippet of collectSnippets(entries, 3)) {
    assert.ok(snippet.length <= 60)
  }
})
