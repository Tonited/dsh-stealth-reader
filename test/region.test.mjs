// 右侧主区定位的契约测试。
//
// 这一层的失败模式很具体：**盖错了地方**。盖住左侧栏就把"这是正常工作的界面"这个
// 最强掩护给弄没了；盖得太小又会露出输入框和标题栏，一眼就不像会话。所以判据要钉死。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MIN_HEIGHT_RATIO,
  MIN_WIDTH_RATIO,
  clampToViewport,
  isMainLike,
  nextRegion,
  paneRegion,
  pickMainRegion,
  rectFromEdges,
  regionStyle,
} from '../src/client/region.ts'

const VIEWPORT = { width: 1440, height: 900 }

/** 一个典型的 DSH 布局：左侧栏 260px + 右侧主区。 */
const SIDEBAR = { left: 0, top: 0, width: 260, height: 900 }
const MAIN = { left: 260, top: 0, width: 1180, height: 900 }

test('贴左边缘的容器不算主区（否则会连左侧栏一起盖掉）', () => {
  assert.equal(isMainLike(SIDEBAR, VIEWPORT), false)
  assert.equal(isMainLike({ left: 0, top: 0, width: 1440, height: 900 }, VIEWPORT), false, '整页容器')
  assert.equal(isMainLike(MAIN, VIEWPORT), true)
})

test('太窄或太矮的容器不算主区（那是主区内部的小容器）', () => {
  const tooNarrow = { left: 300, top: 100, width: VIEWPORT.width * MIN_WIDTH_RATIO - 1, height: 900 }
  const tooShort = { left: 300, top: 100, width: 900, height: VIEWPORT.height * MIN_HEIGHT_RATIO - 1 }

  assert.equal(isMainLike(tooNarrow, VIEWPORT), false)
  assert.equal(isMainLike(tooShort, VIEWPORT), false)
  assert.equal(isMainLike({ left: 300, top: 100, width: 0, height: 900 }, VIEWPORT), false)
  assert.equal(isMainLike(undefined, VIEWPORT), false)
})

test('取最外层的"像主区"的祖先，而不是最内层', () => {
  // 由内向外：输入卡片 → 消息列表 → 会话主区 → 整个 app 容器
  const candidates = [
    { left: 300, top: 800, width: 1100, height: 80 }, // 输入卡片：太矮
    { left: 300, top: 60, width: 1100, height: 700 }, // 消息列表：像主区
    { left: 260, top: 0, width: 1180, height: 900 }, // 会话主区：也像，且更外层
    { left: 0, top: 0, width: 1440, height: 900 }, // 整个 app：贴左边缘，排除
  ]

  assert.deepEqual(pickMainRegion(candidates, VIEWPORT), MAIN)
})

test('侧栏收起时（主区贴左边缘）找不到主区 → 调用方回退全屏', () => {
  const fullbleed = [{ left: 0, top: 0, width: 1440, height: 900 }]
  assert.equal(pickMainRegion(fullbleed, VIEWPORT), null)
  assert.equal(pickMainRegion([], VIEWPORT), null)
  assert.equal(pickMainRegion(undefined, VIEWPORT), null)
})

test('视口异常时不做判断（避免用 0 尺寸算出一堆假阳性）', () => {
  assert.equal(pickMainRegion([MAIN], { width: 0, height: 0 }), null)
  assert.equal(pickMainRegion([MAIN], undefined), null)
})

test('侧栏变宽后重新测量：仍然只盖右侧', () => {
  const wideSidebar = { left: 0, top: 0, width: 420, height: 900 }
  const narrowMain = { left: 420, top: 0, width: 1020, height: 900 }

  assert.deepEqual(pickMainRegion([narrowMain, wideSidebar], VIEWPORT), narrowMain)
})

test('clampToViewport：裁进视口，不产生负尺寸', () => {
  assert.deepEqual(clampToViewport({ left: 260, top: 0, width: 1180, height: 900 }, VIEWPORT), MAIN)
  assert.deepEqual(
    clampToViewport({ left: 1400, top: 880, width: 400, height: 400 }, VIEWPORT),
    { left: 1400, top: 880, width: 40, height: 20 },
  )
  assert.deepEqual(
    clampToViewport({ left: -50, top: -50, width: 100, height: 100 }, VIEWPORT),
    { left: 0, top: 0, width: 50, height: 50 },
  )
})

test('regionStyle：有矩形就贴着矩形，没矩形回退全屏（不是 0 尺寸）', () => {
  assert.deepEqual(regionStyle(MAIN), {
    position: 'fixed',
    left: 260,
    top: 0,
    width: 1180,
    height: 900,
  })

  assert.deepEqual(
    regionStyle(null),
    { position: 'fixed', inset: 0 },
    '测量失败必须回退全屏：0 尺寸的覆盖层等于把小说直接露在 DSH 界面上',
  )
})

test('nextRegion：测量失败时保留上一次的结果，不要突然变全屏', () => {
  assert.deepEqual(nextRegion(MAIN, null), MAIN)
  assert.deepEqual(nextRegion(null, MAIN), MAIN)
  assert.deepEqual(nextRegion(MAIN, SIDEBAR), SIDEBAR)
  assert.equal(nextRegion(null, null), null)
})

// ------------------------------------------------------- 会话列表区（Tab 下面、输入框上面）

/** DSH 的三段：header（Tab 栏）76px、滚动容器、sticky 在底部的输入卡片座。 */
const SCROLL = { left: 300, top: 0, right: 1400, bottom: 900 }
const HEADER = { left: 300, top: 0, right: 1400, bottom: 76 }
const SEAT = { left: 300, top: 700, right: 1400, bottom: 900 }

test('paneRegion：Tab 下面、输入框上面那一段', () => {
  const region = paneRegion({ scroll: SCROLL, header: HEADER, seat: SEAT }, VIEWPORT)
  assert.deepEqual(region, { left: 300, top: 76, width: 1100, height: 624 })
})

test('paneRegion：header 被隐藏（空会话）时上边界退回滚动容器顶部', () => {
  // `display:none` 的元素 `getBoundingClientRect()` 全是 0 —— 不能当成"贴着顶部的 header"。
  const hidden = { left: 0, top: 0, right: 0, bottom: 0 }
  const region = paneRegion({ scroll: SCROLL, header: hidden, seat: null }, VIEWPORT)
  assert.equal(region.top, 0)
  assert.equal(region.height, 900)
})

test('paneRegion：没有输入卡片座时下边界退回滚动容器底部', () => {
  const region = paneRegion({ scroll: SCROLL, header: HEADER }, VIEWPORT)
  assert.equal(region.top, 76)
  assert.equal(region.top + region.height, 900)
})

test('paneRegion：输入框把区域吃光时返回 null（调用方回退全屏）', () => {
  const greedy = { left: 300, top: 0, right: 1400, bottom: 900 }
  assert.equal(paneRegion({ scroll: SCROLL, header: HEADER, seat: greedy }, VIEWPORT), null)
  // 上下贴在一起（零高度）同样不能返回一个空壳。
  const touching = { left: 300, top: 76, right: 1400, bottom: 900 }
  assert.equal(paneRegion({ scroll: SCROLL, header: HEADER, seat: touching }, VIEWPORT), null)
})

test('paneRegion：太窄说明量到了侧栏里的小容器，宁可回退', () => {
  const narrow = { left: 0, top: 0, right: 200, bottom: 900 }
  assert.equal(paneRegion({ scroll: narrow }, VIEWPORT), null)
})

test('paneRegion：视口非法或没有滚动容器时返回 null', () => {
  assert.equal(paneRegion({ scroll: SCROLL }, { width: 0, height: 900 }), null)
  assert.equal(paneRegion({ scroll: SCROLL }, undefined), null)
})

test('rectFromEdges：反向或退化的边一律返回 null', () => {
  const box = (left, top, right, bottom) => ({ left, top, right, bottom })
  assert.deepEqual(rectFromEdges(box(0, 0, 10, 10)), { left: 0, top: 0, width: 10, height: 10 })
  assert.equal(rectFromEdges(box(10, 0, 0, 10)), null, '左右反了')
  assert.equal(rectFromEdges(box(0, 10, 10, 0)), null, '上下反了')
  assert.equal(rectFromEdges(box(5, 5, 5, 5)), null, '零尺寸')
  assert.equal(rectFromEdges(box(0, 0, 0, 10)), null, '零宽')
})
