// 阅读位置与进度的算术契约测试。
//
// 这几条都直接影响"能不能顺畅读下去"：续读位置偏了、上下键没反应、滚到负数……
// 每一个都是用户会立刻察觉、但在代码里看起来完全正常的那类问题。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FALLBACK_ROW_HEIGHT,
  LINES_PER_ARROW,
  arrowScrollDelta,
  clampRatio,
  parseLength,
  pickRowHeight,
  proseRowHeight,
  readingRatio,
  restoreRevealed,
} from '../src/client/scroll.ts'

test('clampRatio：夹进 [0,1]，非法值按 0', () => {
  assert.equal(clampRatio(0.5), 0.5)
  assert.equal(clampRatio(-1), 0)
  assert.equal(clampRatio(2), 1)
  assert.equal(clampRatio(Number.NaN), 0)
  assert.equal(clampRatio(undefined), 0)
})

test('readingRatio：进度是"读到哪里"，不是"滚到哪里"', () => {
  assert.equal(readingRatio(0, 100), 0)
  assert.equal(readingRatio(40, 100), 0.4)
  assert.equal(readingRatio(100, 100), 1)
  assert.equal(readingRatio(150, 100), 1, '夹在 1 以内')
  assert.equal(readingRatio(-5, 100), 0)
  assert.equal(readingRatio(40, 0), 0, '空章节没有进度')
  assert.equal(readingRatio(Number.NaN, 100), 0)
})

test('restoreRevealed：精确回到上次读到的字符处，绝不回退', () => {
  assert.equal(restoreRevealed(1000, 0.5), 500)
  assert.equal(restoreRevealed(1000, 0.333), 333)
  assert.equal(restoreRevealed(1000, 0), 0)
  assert.equal(restoreRevealed(1000, 1), 1000)
  // 用户明确要求过不要"往前退三行"：回来就该停在离开的地方。
  assert.equal(restoreRevealed(1000, 0.5), 500, '不做任何回退')
})

test('restoreRevealed：越界与非法的比例都夹回合法范围', () => {
  assert.equal(restoreRevealed(1000, 2), 1000)
  assert.equal(restoreRevealed(1000, -1), 0)
  assert.equal(restoreRevealed(1000, Number.NaN), 0)
  assert.equal(restoreRevealed(0, 0.5), 0, '空章节')
  assert.equal(restoreRevealed(-5, 0.5), 0)
})

test('进度闭环：读到哪儿 → 记住 → 下次就在那儿接着读', () => {
  const total = 4000
  const revealed = 1500

  const saved = readingRatio(revealed, total)
  const resumed = restoreRevealed(total, saved)

  assert.equal(saved, 0.375)
  assert.equal(resumed, revealed, '必须精确回到上次的位置')
  assert.ok(resumed > 0, '回到 0 就是用户报的"还是从本章开头"')
})

test('parseLength：解析出正数，其余一律 0', () => {
  assert.equal(parseLength('24px'), 24)
  assert.equal(parseLength('21.5px'), 21.5)
  assert.equal(parseLength(30), 30)
  assert.equal(parseLength('normal'), 0, '"normal" 不是长度')
  assert.equal(parseLength('0px'), 0)
  assert.equal(parseLength(''), 0)
  assert.equal(parseLength(null), 0)
  assert.equal(parseLength(Number.NaN), 0)
})

test('proseRowHeight：行高优先，没有行高才按字号估', () => {
  assert.equal(proseRowHeight('24px', '14px'), 24, 'calc(24px + δ) 求值后就在 24 附近')
  assert.equal(proseRowHeight('normal', '14px'), 21, 'line-height:normal → 字号 × 1.5')
  assert.equal(proseRowHeight('normal', '16px'), 24)
  assert.equal(proseRowHeight('normal', 'normal'), FALLBACK_ROW_HEIGHT)
  assert.equal(proseRowHeight(null, null), FALLBACK_ROW_HEIGHT)
})

test('proseRowHeight：量的必须是"一行"，不是段落像素高度', () => {
  // 用户明确纠正过的语义：上下键滚十行，十行的单位是小说正文的行。
  // 折了三行的段落 offsetHeight 约 72px —— 拿它当行高，"滚十行"会变成"滚三十行"。
  const oneLine = proseRowHeight('24px', '14px')
  assert.equal(oneLine, 24)
  assert.equal(arrowScrollDelta(oneLine, 1), 240, '十行正文 = 240px')
})

test('arrowScrollDelta：一次十行左右，方向正确', () => {
  assert.equal(arrowScrollDelta(24, 1), 24 * LINES_PER_ARROW)
  assert.equal(arrowScrollDelta(24, -1), -24 * LINES_PER_ARROW)
  assert.equal(arrowScrollDelta(24, 1, 5), 120)
  assert.ok(
    Math.abs(arrowScrollDelta(24, 1)) > 40,
    '必须明显大于浏览器默认的上下键滚动（约 40px），否则等于没做',
  )
})

test('arrowScrollDelta：行高非法也给出可用值（否则表现为"按键坏了"）', () => {
  assert.equal(arrowScrollDelta(Number.NaN, 1), FALLBACK_ROW_HEIGHT * LINES_PER_ARROW)
  assert.equal(arrowScrollDelta(0, 1), FALLBACK_ROW_HEIGHT * LINES_PER_ARROW)
  assert.equal(arrowScrollDelta(24, 1, 0), 24, '行数下限为 1')
})

test('pickRowHeight：取第一个可用值，全不可用就兜底', () => {
  assert.equal(pickRowHeight([0, Number.NaN, 26, 30]), 26)
  assert.equal(pickRowHeight([32]), 32)
  assert.equal(pickRowHeight([]), FALLBACK_ROW_HEIGHT)
  assert.equal(pickRowHeight([0, -1, Number.NaN]), FALLBACK_ROW_HEIGHT)
  assert.equal(pickRowHeight([undefined, null, 25]), 25)
})
