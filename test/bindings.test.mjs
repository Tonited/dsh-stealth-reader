// 事件绑定层的契约测试 —— 这一层存在的唯一理由就是 HMR。
//
// 故障背景（实测）：DSH 客户端插件热替换后，window 上留着**旧**监听器，而新代码因为
// `keysBound` 标志残留以为"已经绑过了"，于是跳过绑定。旧监听器操作的是旧模块的 store
// 实例，新界面读的是新实例 —— 按快捷键毫无反应。
//
// 所以这里用"假 target + 共享槽位"模拟两次插件实例化（旧实例绑监听、新实例更新逻辑），
// 钉住三件事：
//   1. 监听器只绑一份，不随热替换累积；
//   2. 老监听器调用的仍是最新的处理函数；
//   3. 槽位可被清空（handleKeys=false 的调试开关）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BOUND_SLOT,
  KEY_SLOT,
  POINTER_SLOT,
  bindHandlers,
  forwardKey,
  forwardPointer,
  resetBindingForTest,
} from '../src/client/bindings.ts'

/** 最小 window 替身：记下绑定过的监听器，便于手动派发。 */
function fakeTarget() {
  const bound = []
  return {
    bound,
    addEventListener(type, handler, capture) {
      bound.push({ type, handler, capture })
    },
    /** 派发一次事件，返回被调用的监听器数量。 */
    dispatch(type, event) {
      const hits = bound.filter((entry) => entry.type === type)
      for (const entry of hits) entry.handler(event)
      return hits.length
    },
  }
}

const ofType = (target, type) => target.bound.filter((entry) => entry.type === type)

test('首次绑定：五个监听器各就位，且都在 capture 阶段', () => {
  const target = fakeTarget()
  const slots = {}

  const didBind = bindHandlers(target, slots, { keydown: () => {}, pointer: () => {} })

  assert.equal(didBind, true)
  assert.equal(ofType(target, 'keydown').length, 1)
  assert.equal(ofType(target, 'mousemove').length, 1, '鼠标移动是主要退出方式，必须监听')
  assert.equal(ofType(target, 'pointerdown').length, 1)
  assert.equal(ofType(target, 'wheel').length, 1)
  assert.equal(ofType(target, 'touchstart').length, 1)
  // capture：必须早于组件级 stopPropagation，否则隐藏态下可能收不了场。
  for (const entry of target.bound) assert.equal(entry.capture, true)
})

test('热替换：监听器不累积，但总是调用最新实例的处理函数', () => {
  const target = fakeTarget()
  const slots = {} // 共享槽位 ≈ 真实场景里的 globalThis

  const calls = []
  // ---- 旧实例（热替换前）
  bindHandlers(target, slots, {
    keydown: () => calls.push('旧'),
    pointer: () => calls.push('旧指针'),
  })

  // ---- 新实例（热替换后）：target 与 slots 不变，只有处理函数是新的
  const didBind = bindHandlers(target, slots, {
    keydown: () => calls.push('新'),
    pointer: () => calls.push('新指针'),
  })

  assert.equal(didBind, false, '不应该重复绑定')
  assert.equal(ofType(target, 'keydown').length, 1, '监听器必须只有一份')

  target.dispatch('keydown', { code: 'KeyZ' })
  target.dispatch('pointerdown', {})
  assert.deepEqual(calls, ['新', '新指针'], '必须执行最新逻辑，而不是热替换前留下的那份')
})

test('多次热替换后仍只有一份监听器', () => {
  const target = fakeTarget()
  const slots = {}
  for (let round = 0; round < 5; round += 1) {
    bindHandlers(target, slots, { keydown: () => {}, pointer: () => {} })
  }
  assert.equal(ofType(target, 'keydown').length, 1)
  assert.equal(target.bound.length, 5)
})

test('调试开关：处理函数置空后转发器仍在，但什么也不做', () => {
  const target = fakeTarget()
  const slots = {}
  let hits = 0

  bindHandlers(target, slots, { keydown: () => (hits += 1), pointer: () => {} })
  target.dispatch('keydown', {})

  // 等价于 handleKeys = false
  bindHandlers(target, slots, { keydown: null, pointer: null })
  target.dispatch('keydown', {})
  target.dispatch('pointerdown', {})

  assert.equal(hits, 1, '关闭后不应再被调用')
  assert.equal(slots[KEY_SLOT], undefined)
  assert.equal(slots[POINTER_SLOT], undefined)
})

test('转发器不吞掉事件对象，也不在槽位为空时抛错', () => {
  const seen = []
  const slots = { [KEY_SLOT]: (event) => seen.push(event.code) }

  forwardKey(slots, { code: 'KeyZ' })
  forwardKey({}, { code: 'KeyA' }) // 槽位为空
  forwardPointer({}, { type: 'mousemove' })

  assert.deepEqual(seen, ['KeyZ'])
})

test('resetBindingForTest 让下一次绑定重新生效（用例隔离用）', () => {
  const target = fakeTarget()
  const slots = {}

  bindHandlers(target, slots, { keydown: () => {} })
  assert.equal(slots[BOUND_SLOT], true)
  assert.equal(bindHandlers(target, slots, { keydown: () => {} }), false)

  resetBindingForTest(slots)
  assert.equal(slots[BOUND_SLOT], undefined)
  assert.equal(bindHandlers(target, slots, { keydown: () => {} }), true)
})
