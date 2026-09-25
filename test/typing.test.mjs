// 逐字输出节奏的契约测试。
//
// 用户的原始反馈是："一行的内容显示太快了，但显示下一行又太慢了" —— 这正是
// "全局匀速按字符推进"的病症：一行的长度直接决定它占多少时间，于是短行瞬现、
// 长段落干等。这里钉住"按行分配时间"的几条性质：
//
//   1. 一行是**逐字**长出来的，不是一次蹦出来；
//   2. 短行有**下限**（出现这个动作要看得见）；
//   3. 长行有**上限**（不能让人等到心焦）；
//   4. 真实会话行快速通过，且**行间不留空档**。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_TEMPO,
  FAST_FORWARD,
  advanceClock,
  charsAt,
  extendFastForward,
  isFastForwarding,
  lineDuration,
  scheduleDuration,
  typingSchedule,
} from '../src/client/typing.ts'

/** 好算的节奏：10 字/秒，下限 100ms，上限 1000ms。 */
const TEMPO = { charsPerSecond: 10, minLineMs: 100, maxLineMs: 1000 }

test('lineDuration：两头夹住，中间按速度逐字', () => {
  assert.equal(lineDuration(1, TEMPO), 100, '1 个字也要占满下限，不能瞬现')
  assert.equal(lineDuration(5, TEMPO), 500, '5 字 / 10 字每秒 = 500ms，落在两头之间')
  assert.equal(lineDuration(50, TEMPO), 1000, '长行撞上限')
  assert.equal(lineDuration(5000, TEMPO), 1000)
})

test('lineDuration：快速行一律走下限', () => {
  assert.equal(lineDuration(400, TEMPO, true), 100)
  assert.equal(lineDuration(0, TEMPO, true), 100)
  assert.equal(lineDuration(400, TEMPO, false), 1000)
})

test('一行是逐字长出来的，不是一次蹦出来的', () => {
  // 这里刻意放开上限：要验的就是"没有上限时，逐字长度确实随时间线性增长"。
  const loose = { charsPerSecond: 10, minLineMs: 1, maxLineMs: 100000 }
  const slots = typingSchedule([{ chars: 100 }], 0, loose)
  // 100 字 + 行尾 1 个输出单位 = 101，按 10 字/秒就是 10100ms
  assert.equal(scheduleDuration(slots), 10100)

  assert.equal(charsAt(slots, 100), 1, '100ms 后就该多一个字')
  assert.equal(charsAt(slots, 200), 2)

  const middle = charsAt(slots, 2000)
  assert.equal(middle, 20)
  assert.ok(middle > 0 && middle < 101, '中途必须是个真正的中间值 —— 否则就是整行蹦出来')
})

test('短行有下限：不会一闪就没（否则看不到"出现"）', () => {
  const slots = typingSchedule([{ chars: 1 }], 0, {
    charsPerSecond: 1000,
    minLineMs: 120,
    maxLineMs: 5000,
  })
  assert.equal(scheduleDuration(slots), 120, '哪怕只有 1 个字也要占满下限')
})

test('长行有上限：不会让人干等（用户抱怨过"下一行太慢"）', () => {
  const slots = typingSchedule([{ chars: 5000 }], 0, DEFAULT_TEMPO)
  assert.equal(scheduleDuration(slots), DEFAULT_TEMPO.maxLineMs)
  assert.ok(
    DEFAULT_TEMPO.maxLineMs <= 3000,
    '上限超过三秒就违背了"下一行别让我等" —— 这个数是手感旋钮，别随手调大',
  )
})

test('真实会话行快速通过，且下一行立刻开始', () => {
  const slots = typingSchedule([{ chars: 400, quick: true }, { chars: 10 }], 0, DEFAULT_TEMPO)

  assert.equal(slots[0].endMs, DEFAULT_TEMPO.minLineMs, '日志行闪一下就走')
  assert.ok(slots[0].endMs < 200, '"混进真实内容之后的下一行"要快点来')
  assert.equal(slots[1].beginMs, slots[0].endMs, '行间不留空档')
})

test('时间表连续：行与行之间没有空档', () => {
  const slots = typingSchedule([{ chars: 30 }, { chars: 30 }, { chars: 30 }], 0, TEMPO)
  assert.equal(slots.length, 3)
  for (let index = 1; index < slots.length; index += 1) {
    assert.equal(slots[index].beginMs, slots[index - 1].endMs)
  }
})

test('字符累计与 streamLength 同一套算法（每行长度 + 1）', () => {
  const lines = [{ chars: 5 }, { chars: 20 }, { chars: 7 }]
  const slots = typingSchedule(lines, 0, TEMPO)

  assert.equal(slots[0].beginChars, 0)
  assert.equal(slots[0].endChars, 6)
  assert.equal(slots[1].beginChars, 6)
  assert.equal(slots[1].endChars, 27)
  // 与 streamLength(lines) 完全一致，否则最后一行永远长不完。
  assert.equal(slots[slots.length - 1].endChars, 6 + 21 + 8)
})

test('从行中间续读：之前的行不占时间，跨过起点的那行只算剩下的', () => {
  const lines = [{ chars: 9 }, { chars: 9 }] // 每行 10 个单位，全章 20
  const slots = typingSchedule(lines, 12, TEMPO)

  assert.equal(slots.length, 1, '起点之前的行不该出现在表里')
  assert.equal(slots[0].beginChars, 12, '从记录处开始，不是从行首')
  assert.equal(slots[0].endChars, 20)
  assert.equal(slots[0].beginMs, 0, '时间表从 0 起算')
  assert.equal(charsAt(slots, 0), 12, '一上来就是记录处，不会从头重放')
})

test('起点恰好落在行首时，那一行从头开始', () => {
  const lines = [{ chars: 9 }, { chars: 9 }]
  const slots = typingSchedule(lines, 10, TEMPO)

  assert.equal(slots.length, 1)
  assert.equal(slots[0].beginChars, 10)
  assert.equal(slots[0].endChars, 20)
})

test('起点越过全章时给出空表（整章已读完）', () => {
  const slots = typingSchedule([{ chars: 5 }], 999, TEMPO)
  assert.deepEqual(slots, [])
  assert.equal(scheduleDuration(slots), 0)
  assert.equal(charsAt(slots, 1234), 0)
})

test('charsAt：单调不减、不越界、非法时间不炸', () => {
  const lines = [{ chars: 20 }, { chars: 20 }]
  const slots = typingSchedule(lines, 0, TEMPO)
  const total = 42

  let previous = -1
  for (let ms = 0; ms <= scheduleDuration(slots) + 500; ms += 37) {
    const value = charsAt(slots, ms)
    assert.ok(value >= previous, `时间前进时字符数不能回退：${ms}ms → ${value} < ${previous}`)
    assert.ok(value >= 0 && value <= total, `越界：${value}`)
    previous = value
  }

  assert.equal(charsAt(slots, -100), 0)
  assert.equal(charsAt(slots, Number.NaN), 0)
  assert.equal(charsAt(slots, 999999), total, '跑完就停在结尾')
})

// ---------------------------------------------------------------- 快进
//
// 需求是"按住 Shift + 方向键时快速显示内容"。这里钉住的不是"跳了多少字"，
// 而是"时钟走多快" —— 因为快进必须仍然逐行长出来，整段蹦出来会立刻露馅。

test('快进：重复按键只会把到期时刻往后推，不会被更早的一次缩短', () => {
  const first = extendFastForward(1000, 0)
  assert.equal(first, 1000 + FAST_FORWARD.holdGraceMs, '第一次按下从当下算起')

  // 关键性质：取 max。手上的重复来得密时，新算出来的到期时刻可能反而更早，
  // 那一下绝不能把已经承诺出去的那一段削短。
  // 这里注入 grace，免得这条性质受 FAST_FORWARD.holdGraceMs 的具体数值影响。
  assert.equal(extendFastForward(1200, 3000, 600), 3000, '算出来更早就不动它')
  assert.equal(extendFastForward(1200, 3000, 3000), 4200, '算出来更晚就继续往后推')
  assert.equal(
    extendFastForward(2000, first),
    2000 + FAST_FORWARD.holdGraceMs,
    '算出来更晚就继续往后推',
  )
})

test('isFastForwarding：按住期间为真，松手（到期时刻置 0）立刻为假', () => {
  const until = extendFastForward(1000, 0)

  assert.equal(isFastForwarding(1000, until), true, '刚按下')
  assert.equal(isFastForwarding(until - 1, until), true, '还没到期')
  assert.equal(isFastForwarding(until, until), false, '到期即为假（左闭右开）')
  assert.equal(isFastForwarding(999999, until), false, '过了安全网会自己停，不会永远快进')

  // 这条是这次修的要害：松手必须**立刻**结束，不能靠等定时器 ——
  // 靠定时器就等于把"按住"寄托在键盘自动重复上。
  assert.equal(isFastForwarding(1000, 0), false, 'keyup 置 0 之后立刻为假')
})

test('安全网必须显著长于自动重复的首延迟，否则按住会被自己的安全网掐断', () => {
  assert.ok(
    FAST_FORWARD.holdGraceMs >= 2000,
    `自动重复的首延迟各系统可达 1s，安全网只有 ${FAST_FORWARD.holdGraceMs}ms 会中途停顿`,
  )
})

test('快进倍率足以"甩开"输出速度：一秒至少十几行', () => {
  // 一行按 30 字算：正常 18 字/秒 ≈ 0.6 行/秒。用户反馈 12 倍（≈6 行/秒）"还是没那么快"。
  const slots = typingSchedule([{ chars: 30 }], 0, DEFAULT_TEMPO)
  const msPerLine = scheduleDuration(slots)
  const linesPerSecond = (1000 / msPerLine) * FAST_FORWARD.rate

  assert.ok(
    linesPerSecond >= 15,
    `按住快进一秒只有 ${linesPerSecond.toFixed(1)} 行 —— 快进的意义是甩开输出速度，不是略快一点`,
  )
})

test('advanceClock：不快进就是实时，快进按倍率走', () => {
  assert.equal(advanceClock(0, 50, false, 10000), 50)
  assert.equal(advanceClock(0, 50, true, 10000), 50 * FAST_FORWARD.rate)
  assert.equal(advanceClock(0, 50, true, 10000, 3), 150, '倍率可注入（也便于测试）')
})

test('advanceClock：单调不减、不为负、不越过分章结尾', () => {
  assert.equal(advanceClock(500, 50, false, 10000), 550, '正常递增')
  assert.equal(advanceClock(500, -100, false, 10000), 500, '负数步长也不倒退')
  // 用显式倍率，免得这条断言绑死在 FAST_FORWARD.rate 的具体数值上。
  assert.equal(advanceClock(100, 50, true, 1000, 3), 250, '快进不会跳出 duration')
  assert.equal(advanceClock(100, 50, true, 1000, 100), 1000, '倍率再大也封顶在 duration')
  assert.equal(advanceClock(9900, 50, true, 10000), 10000, '正好封顶在 duration')
  assert.equal(advanceClock(0, 50, true, 0), 0, '空章节不越界')
})

test('advanceClock：倍率下限是 1，不会被 0 或负数冻住', () => {
  assert.equal(advanceClock(0, 50, true, 10000, 0), 50)
  assert.equal(advanceClock(0, 50, true, 10000, -5), 50)
})

test('快进仍然逐字：它把时钟提前，而不是一次性把全章吐出来', () => {
  const lines = [{ chars: 40 }, { chars: 40 }, { chars: 40 }, { chars: 40 }]
  const slots = typingSchedule(lines, 0, DEFAULT_TEMPO)
  const duration = scheduleDuration(slots)
  const totalChars = slots[slots.length - 1].endChars

  // 一个 tick（100ms）里：不快进是正常速度，快进按 rate 倍走。
  const slow = charsAt(slots, advanceClock(0, 100, false, duration))
  const fast = charsAt(slots, advanceClock(0, 100, true, duration))

  assert.ok(fast > slow, '快进确实走得更远')
  assert.ok(
    fast < totalChars,
    '一个 tick 的快进不该把整章吐完 —— 那是"跳字数"，而跳字数会立刻露馅',
  )
})
