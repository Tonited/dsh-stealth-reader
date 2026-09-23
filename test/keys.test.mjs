// 快捷键与隐藏态裁决的契约测试。
//
// ACC 0003 的结论是：DSH 客户端插件没有键位绑定 API，只能自己挂 window 监听。
// 所以这两条路径必须被钉住：
//   1. 快捷键识别（避开 Windows/IME 雷区、用 e.code、IME 守卫）
//   2. **隐藏态下任何交互都退回真实界面** —— 被撞见时能不能收场就看它
//      （书单是唯一例外，见 ADR-0007：那个界面只能靠鼠标操作）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_SHORTCUT,
  isListSurface,
  isToggleShortcut,
  resolveInteraction,
  resolveReadingKey,
  resolveToggle,
} from '../src/client/keys.ts'

const hotkey = (extra = {}) => ({
  ctrlKey: true,
  shiftKey: true,
  altKey: true,
  code: 'KeyZ',
  isComposing: false,
  repeat: false,
  ...extra,
})

test('快捷键：默认组合能识别', () => {
  assert.deepEqual(DEFAULT_SHORTCUT, { ctrl: true, shift: true, alt: true, code: 'KeyZ' })
  assert.equal(isToggleShortcut(hotkey()), true)
})

test('快捷键：IME 组合期与长按必须放过（否则会误触发）', () => {
  assert.equal(isToggleShortcut(hotkey({ isComposing: true })), false, '组合期必须放过')
  assert.equal(isToggleShortcut(hotkey({ keyCode: 229 })), false, 'MDN：keyCode 229 也是组合期')
  assert.equal(isToggleShortcut(hotkey({ repeat: true })), false, '长按去重')
})

test('快捷键：少一个修饰键都不算（避免与浏览器/DSH 抢键）', () => {
  assert.equal(isToggleShortcut(hotkey({ altKey: false })), false)
  assert.equal(isToggleShortcut(hotkey({ ctrlKey: false })), false)
  assert.equal(isToggleShortcut(hotkey({ shiftKey: false })), false)
  assert.equal(isToggleShortcut(hotkey({ code: 'KeyY' })), false)
  assert.equal(isToggleShortcut(hotkey({ ctrlKey: false, shiftKey: false })), false)
})

test('快捷键：判定用 e.code，因此不受键盘布局影响', () => {
  // 同一个物理键，在另一种布局下 e.key 会变，但 code 不变 —— 这正是选 code 的原因。
  assert.equal(isToggleShortcut(hotkey({ key: 'γ' })), true)
  assert.equal(isToggleShortcut(null), false)
  assert.equal(isToggleShortcut(undefined), false)
  assert.equal(isToggleShortcut({}), false)
})

test('两态切换：按一下进内容流，再按一下回真实界面', () => {
  assert.equal(resolveInteraction('closed', hotkey()), 'stream', '按一下 → 内容流')
  assert.equal(resolveInteraction('stream', hotkey()), 'closed', '再按一下 → 真实界面')
  assert.equal(resolveToggle('closed'), 'stream')
  assert.equal(resolveToggle('stream'), 'closed')
})

test('内容流里：鼠标一动、或点一下，立刻收场', () => {
  assert.equal(resolveInteraction('stream', { type: 'mousemove' }), 'closed')
  assert.equal(resolveInteraction('stream', { type: 'click' }), 'closed')
  assert.equal(resolveInteraction('stream', { type: 'pointerdown' }), 'closed')
})

test('书单开着时鼠标**不**收场，否则根本点不到书（ADR-0007）', () => {
  const list = { listVisible: true }
  assert.equal(resolveInteraction('stream', { type: 'mousemove' }, list), null, '移动要留给书单')
  assert.equal(resolveInteraction('stream', { type: 'click' }, list), null, '点书名打开')
  assert.equal(resolveInteraction('stream', { type: 'pointerdown' }, list), null, '点 ✕ 删除')
  assert.equal(
    resolveInteraction('stream', hotkey(), list),
    'closed',
    '快捷键仍然是书单开着时唯一的出口',
  )
})

test('书单标记默认关闭：不传 options 就等于原来的"一动就收场"', () => {
  assert.equal(resolveInteraction('stream', { type: 'mousemove' }), 'closed', '省略 options')
  assert.equal(resolveInteraction('stream', { type: 'mousemove' }, {}), 'closed', '空 options')
  assert.equal(
    resolveInteraction('stream', { type: 'mousemove' }, { listVisible: false }),
    'closed',
    '显式 false',
  )
})

test('书单只在内容流里存在：closed 下带书单标记也什么都不管', () => {
  assert.equal(resolveInteraction('closed', { type: 'mousemove' }, { listVisible: true }), null)
  assert.equal(resolveInteraction('closed', { type: 'pointerdown' }, { listVisible: true }), null)
  assert.equal(resolveInteraction('closed', hotkey(), { listVisible: true }), 'stream')
})

test('isListSurface：书单在屏幕上 = 按 L 打开了，**或**压根没有打开的书', () => {
  assert.equal(isListSurface({ bookOpened: true, listOpen: false }), false, '在读书，不是书单')
  assert.equal(isListSurface({ bookOpened: true, listOpen: true }), true, '按 L 盖在正文上')
  assert.equal(
    isListSurface({ bookOpened: false, listOpen: false }),
    true,
    '空书库：书单就是覆盖层的全部内容，那同样是要用鼠标点的界面',
  )
  assert.equal(isListSurface({ bookOpened: false, listOpen: true }), true)
})

test('内容流里滚轮与键盘**不**收场（那是阅读操作要用的）', () => {
  assert.equal(resolveInteraction('stream', { type: 'wheel' }), null, '滚轮用来滚动阅读')
  assert.equal(resolveInteraction('stream', { code: 'Space', keyCode: 32 }), null, '翻页')
  assert.equal(resolveInteraction('stream', { code: 'ArrowRight', keyCode: 39 }), null, '跳章')
  assert.equal(resolveInteraction('stream', null), null)
  assert.equal(resolveInteraction('stream', undefined), null)
})

test('真实界面下插件什么都不管（除了快捷键）', () => {
  assert.equal(resolveInteraction('closed', { type: 'mousemove' }), null)
  assert.equal(resolveInteraction('closed', { type: 'pointerdown' }), null)
  assert.equal(resolveInteraction('closed', { type: 'wheel' }), null)
  assert.equal(resolveInteraction('closed', { code: 'KeyA', keyCode: 65 }), null)
})

test('IME 组合期的快捷键不算数', () => {
  assert.equal(resolveInteraction('closed', hotkey({ isComposing: true })), null)
  assert.equal(resolveInteraction('stream', hotkey({ keyCode: 229 })), null)
})

test('阅读操作键：上下滚十行、左右跳章、l 切任务列表', () => {
  assert.equal(resolveReadingKey({ code: 'ArrowUp', keyCode: 38 }), 'lineUp')
  assert.equal(resolveReadingKey({ code: 'ArrowDown', keyCode: 40 }), 'lineDown')
  assert.equal(resolveReadingKey({ code: 'ArrowRight', keyCode: 39 }), 'nextChapter')
  assert.equal(resolveReadingKey({ code: 'BracketRight', keyCode: 221 }), 'nextChapter')
  assert.equal(resolveReadingKey({ code: 'ArrowLeft', keyCode: 37 }), 'prevChapter')
  assert.equal(resolveReadingKey({ code: 'KeyL', keyCode: 76 }), 'toggleList')
  assert.equal(resolveReadingKey({ code: 'KeyA', keyCode: 65 }), null)
})

test('阅读操作键不抢带修饰键的组合（留给浏览器与系统）', () => {
  assert.equal(resolveReadingKey({ code: 'ArrowRight', keyCode: 39, ctrlKey: true }), null)
  assert.equal(resolveReadingKey({ code: 'ArrowRight', keyCode: 39, altKey: true }), null)
  assert.equal(resolveReadingKey({ code: 'KeyL', keyCode: 76, metaKey: true }), null)
  assert.equal(resolveReadingKey({ code: 'KeyL', keyCode: 229 }), null)
  assert.equal(resolveReadingKey({ code: 'KeyL', keyCode: 76, isComposing: true }), null)
})

// ---------------------------------------------------------------- 快进

test('快进：Shift + 前向方向键（↓ / →）', () => {
  assert.equal(resolveReadingKey({ code: 'ArrowDown', keyCode: 40, shiftKey: true }), 'fastForward')
  assert.equal(resolveReadingKey({ code: 'ArrowRight', keyCode: 39, shiftKey: true }), 'fastForward')
})

test('快进只重定义前向那一对：Shift+↑ / Shift+← 沿用滚动与翻章', () => {
  assert.equal(resolveReadingKey({ code: 'ArrowUp', keyCode: 38, shiftKey: true }), 'lineUp')
  assert.equal(resolveReadingKey({ code: 'ArrowLeft', keyCode: 37, shiftKey: true }), 'prevChapter')
})

test('快进不越过修饰键红线：带 Ctrl/Alt/Meta 一律放过', () => {
  assert.equal(
    resolveReadingKey({ code: 'ArrowDown', keyCode: 40, shiftKey: true, ctrlKey: true }),
    null,
  )
  assert.equal(
    resolveReadingKey({ code: 'ArrowRight', keyCode: 39, shiftKey: true, altKey: true }),
    null,
  )
  assert.equal(
    resolveReadingKey({ code: 'ArrowDown', keyCode: 40, shiftKey: true, isComposing: true }),
    null,
  )
})

test('不快进时方向键语义不变（回归护栏）', () => {
  assert.equal(resolveReadingKey({ code: 'ArrowDown', keyCode: 40 }), 'lineDown')
  assert.equal(resolveReadingKey({ code: 'ArrowRight', keyCode: 39 }), 'nextChapter')
  assert.equal(resolveReadingKey({ code: 'ArrowUp', keyCode: 38 }), 'lineUp')
  assert.equal(resolveReadingKey({ code: 'ArrowLeft', keyCode: 37 }), 'prevChapter')
})
