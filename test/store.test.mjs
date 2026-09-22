// 三态 store 的契约测试（ADR-0005 之后的状态机）。
//
// 除了状态机本身，这里钉住一条**被故障验证过**的实现约束：状态必须放在 globalThis 槽位上。
// 客户端插件热替换后模块级变量会重新初始化，而 window 上的监听器属于旧实例 ——
// 状态一旦是模块私有的，两边的 mode 就会分叉，按快捷键只改到"没人监听的那一份"。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as store from '../src/client/store.ts'

const SLOT = '__STEALTH_READER_STORE__'

test.beforeEach(() => {
  store.resetForTest()
})

test('初始为 closed', () => {
  assert.equal(store.current(), 'closed')
})

test('toggle：两态之间来回（按一下进内容流，再按一下回真实界面）', () => {
  store.toggle()
  assert.equal(store.current(), 'stream', 'closed → stream')

  store.toggle()
  assert.equal(store.current(), 'closed', 'stream → closed')
})

test('openStream / close / goTo', () => {
  store.openStream()
  assert.equal(store.current(), 'stream')

  store.close()
  assert.equal(store.current(), 'closed')

  store.goTo('stream')
  assert.equal(store.current(), 'stream')
})

test('subscribe 立即回调当前值，并在变化时通知', () => {
  const seen = []
  const unsubscribe = store.subscribe((mode) => seen.push(mode))

  assert.deepEqual(seen, ['closed'], '订阅时立刻用当前值回调一次')
  store.openStream()
  store.close()
  assert.deepEqual(seen, ['closed', 'stream', 'closed'])

  unsubscribe()
  store.openStream()
  assert.deepEqual(seen, ['closed', 'stream', 'closed'], '退订后不再收到通知')
})

test('重复设置同一个模式不会重复通知（避免无谓重渲染）', () => {
  const seen = []
  store.subscribe((mode) => seen.push(mode))
  store.openStream()
  store.openStream()
  assert.deepEqual(seen, ['closed', 'stream'])
})

test('回调里退订自己：本轮遍历不受影响，下一轮才少一个', () => {
  const order = []
  // 注意：subscribe 会**立即回调**，那一刻 unsubscribe 还没返回给调用方，
  // 所以回调里要退订自己必须用 `let` 先占位（用 const 会撞 TDZ）。
  let unsubscribeFirst = () => {}
  unsubscribeFirst = store.subscribe(() => {
    order.push('first')
    unsubscribeFirst()
  })
  store.subscribe(() => order.push('second'))

  assert.deepEqual(order, ['first', 'second'], '订阅时各自立即回调一次')

  store.openStream()
  assert.deepEqual(
    order,
    ['first', 'second', 'first', 'second'],
    '本轮遍历用的是快照：first 当场退订，也不该吞掉 second 的回调',
  )

  store.close()
  store.openStream()
  assert.deepEqual(
    order,
    ['first', 'second', 'first', 'second', 'second', 'second'],
    '下一轮起只剩 second',
  )
})

test('状态落在 globalThis 槽位上，可被另一份模块实例看到（热替换安全）', () => {
  store.openStream()

  const shared = globalThis[SLOT]
  assert.ok(shared, '状态必须在 globalThis 槽位上，而不是模块私有变量')
  assert.equal(shared.mode, 'stream')

  // 模拟"另一个模块实例"（热替换后的新闭包）改写状态：
  shared.mode = 'closed'
  assert.equal(
    store.current(),
    'closed',
    '本实例必须读到共享槽位，否则新旧实例的 mode 会分叉',
  )

  // 监听器集合同样必须是共享的，否则新实例的通知到不了旧实例的订阅者。
  const seen = []
  store.subscribe((mode) => seen.push(mode))
  assert.deepEqual(seen, ['closed'])
  assert.ok(shared.listeners.size >= 1)
})
