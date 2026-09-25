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
  SESSION_ID_SLOT,
  SNAPSHOT_READER,
  bindingEntries,
  collectSnippets,
  currentSessionEntries,
  extractExcerpts,
  extractText,
  hasRows,
  looksSuspicious,
  noteSessionId,
  notedSessionId,
  readSnapshot,
  redact,
  resetSessionIdForTest,
  seenEventKinds,
  sessionCandidates,
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

// ---------------------------------------------------------------- 「当前会话」

// 为什么这一组必须存在：0.1.7 的 `SessionListState` 里**没有** `current`
// （`dsh-api-session-controller/lib/types/client/sessions/service.d.ts:43-52` 只有
// ids/byId/phase/projectionsBySession），旧写法永远退化成 `ids[0]`；
// 而 `sessions.binding(id)` 只对**已经被 retain 的会话**返回 binding
// （`…/contract/sessions.d.ts:146-153`）。猜错 id 的代价是伪装内容退化成硬编码模板
// —— 违反 ADR-0002，且**没有任何报错**。所以这里把兜底顺序钉成断言。

/** 一个会话列表快照；`mainView` 为真的行表示"主视图正开着它"。 */
const listState = (rows) => ({
  ids: rows.map((row) => row.id),
  byId: Object.fromEntries(
    rows.map((row) => [row.id, { id: row.id, retainedBy: { mainView: row.mainView ? 1 : 0 } }]),
  ),
  phase: 'ready',
  projectionsBySession: {},
})

const list = (rows) => ({ getSnapshot: () => listState(rows) })

const eventEntry = (text) => ({
  type: 'event',
  event: { type: 'assistant/message', data: { message: { content: [{ text }] } } },
})

/** 只有「被 retain 过」的会话才拿得到 binding —— 逐字复刻契约语义。 */
const sessionsOf = (retained) => ({
  list: list([
    { id: 's0', mainView: false },
    { id: 's1', mainView: true },
    { id: 's2', mainView: false },
  ]),
  binding: (id) => (Object.hasOwn(retained, id) ? { eventSource: { getSnapshot: () => ({ entries: retained[id] }) } } : undefined),
})

test('当前会话：候选顺序 = 探针 id → 主视图 retain → 列表顺序', () => {
  const state = listState([
    { id: 's0', mainView: false },
    { id: 's1', mainView: true },
    { id: 's2', mainView: false },
  ])

  assert.deepEqual(sessionCandidates(state), ['s1', 's0', 's2'], '没有探针 id 时先给主视图那个')
  assert.deepEqual(sessionCandidates(state, 's2'), ['s2', 's1', 's0'], '探针 id 排最前')
  assert.deepEqual(sessionCandidates(state, 's1'), ['s1', 's0', 's2'], '不许重复')
  assert.deepEqual(sessionCandidates(state, ''), ['s1', 's0', 's2'], '空串不算 id')
  assert.deepEqual(sessionCandidates(undefined), [], '快照拿不到时不虚构 id')
})

/** 事件窗口里的第一段正文（断言用）。 */
const textOf = (entries) => entries[0]?.event?.data?.message?.content?.[0]?.text

test('当前会话：探针抓到的真实 sessionId 优先（不是 ids[0]）', () => {
  const sessions = sessionsOf({ s0: [eventEntry('列表首行')], s2: [eventEntry('真正在看的那个')] })

  // s0 同样拿得到 binding：不用探针时它才是最早命中的那个。
  assert.equal(textOf(currentSessionEntries(sessions)), '列表首行')
  assert.equal(textOf(currentSessionEntries(sessions, 's2')), '真正在看的那个')
})

test('当前会话：没有探针 id 时优先主视图 retain 的那个', () => {
  const sessions = sessionsOf({ s0: [eventEntry('列表首行')], s1: [eventEntry('主视图')] })

  // s1 在 ids 里排第二，但它是"主视图正开着"的那个 —— 旧版 `state.current` 的语义。
  assert.equal(textOf(currentSessionEntries(sessions)), '主视图')
})

test('当前会话：拿不到 binding 时退到"其它 id 里第一个能拿到的"', () => {
  const sessions = sessionsOf({ s0: [eventEntry('兜底')] })

  // 探针说 s2，但 s2 没被 retain（binding 返回 undefined）→ 退到 s0。
  const entries = currentSessionEntries(sessions, 's2')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].event.data.message.content[0].text, '兜底')

  // 读取路径是契约路径：binding(id).eventSource.getSnapshot().entries
  assert.equal(bindingEntries(sessions, 's2').length, 0, '没被 retain 的会话拿不到 binding')
  assert.equal(bindingEntries(sessions, 's0').length, 1)
  assert.deepEqual(bindingEntries(sessions, '不存在'), [])
})

test('当前会话：一层都拿不到时返回空表（由调用方退回硬编码模板）', () => {
  const sessions = sessionsOf({})
  assert.deepEqual(currentSessionEntries(sessions, 's2'), [])
  assert.deepEqual(currentSessionEntries(sessions), [])
  // 空窗口也算"拿不到"：不能因为 binding 存在就把调用方钉在一个空壳上
  assert.deepEqual(currentSessionEntries(sessionsOf({ s0: [] }), 's0'), [])
  // 异形/缺失的服务一律降级，不抛
  assert.deepEqual(currentSessionEntries(undefined, 's0'), [])
  assert.deepEqual(currentSessionEntries({}, 's0'), [])
  assert.deepEqual(
    currentSessionEntries({ list: () => { throw new Error('boom') } }, 's0'),
    [],
    '读取期异常必须被吞掉（热替换与宿主刷新都可能出现半初始化状态）',
  )
})

test('当前会话 id 槽位：存活在 globalThis 上（热替换后新旧模块看同一份）', () => {
  resetSessionIdForTest()
  assert.equal(notedSessionId(), undefined, '先清干净，避免用例之间互相影响')

  noteSessionId('session-abc')
  assert.equal(notedSessionId(), 'session-abc')
  // 关键：槽位必须在 globalThis 上 —— 热替换后读取方是另一份模块实例，
  // 模块级变量会重演 store.ts 注释里"改在了另一个宇宙"的故障。
  assert.equal(globalThis[SESSION_ID_SLOT], 'session-abc')

  noteSessionId('session-def')
  assert.equal(notedSessionId(), 'session-def', '换会话要跟着变')

  // 非字符串 / 空串不代表"没有当前会话"，不许把已知值擦掉
  noteSessionId(undefined)
  noteSessionId('')
  noteSessionId(42)
  assert.equal(notedSessionId(), 'session-def')

  resetSessionIdForTest()
  assert.equal(notedSessionId(), undefined)
})
