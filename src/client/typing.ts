// 逐字输出的节奏（纯函数，可单测）。
//
// 为什么不是"全局匀速按字符推进"：那样会把两件事混在一起算 ——
// 一行有多长决定它占多少时间。于是短行（工具调用、真实会话行）一闪而过、看不见，
// 长段落却要人干等十几秒；读者感受到的是"一行蹦出来，然后卡很久"，
// 恰恰**不是**打字机。
//
// 这里改成**按行分配时间**，每行一个上、下限：
//
//   - `minLineMs`：一行至少占这么久。短行也有"出现"这个动作，不会瞬现。
//   - `maxLineMs`：一行最多占这么久。长段落不能让人等到心焦。
//   - 两头之间按 `charsPerSecond` 逐字，这才是看得见的打字机。
//
// 另外，真实会话行（`quick`）直接按 `minLineMs` 冲过去：日志行本来就该闪一下就没，
// 混进来之后不该拖住后面的正文。
//
// 这三个数就是全部的"手感"旋钮。觉得不对就调它们 —— 别去动组件。

export interface TypingTempo {
  /** 行内逐字速度（字/秒）。 */
  charsPerSecond: number
  /** 一行占用的**下限**（毫秒）。 */
  minLineMs: number
  /** 一行占用的**上限**（毫秒）。 */
  maxLineMs: number
}

export const DEFAULT_TEMPO: TypingTempo = {
  charsPerSecond: 18,
  minLineMs: 90,
  maxLineMs: 2600,
}

export interface TypingLine {
  /** 这一行的字符数。 */
  chars: number
  /** 快速通过：真实会话的"工作痕迹"行，闪一下就走。 */
  quick?: boolean
}

export interface LineSlot {
  beginMs: number
  endMs: number
  /** 这一行开始的字符位置（含前面所有行）。 */
  beginChars: number
  /** 这一行结束的字符位置（含行尾换行占的那一个单位）。 */
  endChars: number
}

/** 一行的时长。 */
export function lineDuration(
  chars: number,
  tempo: TypingTempo = DEFAULT_TEMPO,
  quick = false,
): number {
  if (quick) return Math.max(1, tempo.minLineMs)
  const perChar = tempo.charsPerSecond > 0 ? 1000 / tempo.charsPerSecond : 0
  const byChars = Math.max(0, chars) * perChar
  const floor = Math.max(1, tempo.minLineMs)
  const ceiling = Math.max(floor, tempo.maxLineMs)
  return Math.min(Math.max(byChars, floor), ceiling)
}

/**
 * 排一份输出时间表：从 `startChars` 开始，每一行占用哪一段时间、覆盖哪一段字符。
 *
 * 字符的算法必须与 `streamLength` / `revealLines` 一致（每行 `长度 + 1`，
 * 行尾换行也算一个输出单位），否则表尾会和全章长度对不上，最后一行永远长不完。
 *
 * @param lines - 每一行的字符数（顺序与渲染一致）
 * @param startChars - 从第几个字符开始（续读时是上次读到的位置）
 */
export function typingSchedule(
  lines: readonly TypingLine[],
  startChars: number,
  tempo: TypingTempo = DEFAULT_TEMPO,
): LineSlot[] {
  const from = Number.isFinite(startChars) ? Math.max(0, Math.floor(startChars)) : 0
  const slots: LineSlot[] = []
  let cursor = 0
  let clock = 0

  for (const line of lines) {
    const begin = cursor
    const end = cursor + Math.max(0, line.chars) + 1

    // 完全在起点之前的行不占时间；跨过起点的那一行只算它剩下的部分。
    if (end > from) {
      const slotBegin = Math.max(begin, from)
      const duration = lineDuration(end - slotBegin, tempo, line.quick === true)
      slots.push({
        beginMs: clock,
        endMs: clock + duration,
        beginChars: slotBegin,
        endChars: end,
      })
      clock += duration
    }

    cursor = end
  }

  return slots
}

/** 整份时间表跑完需要多久。 */
export function scheduleDuration(slots: readonly LineSlot[]): number {
  return slots.length === 0 ? 0 : slots[slots.length - 1].endMs
}

/**
 * 已经过去了 `elapsedMs` 时，应该输出到第几个字符。
 *
 * 超出表尾就停在最后一个字符位置 —— 全章输出完毕。绝不返回负数或回退。
 */
export function charsAt(slots: readonly LineSlot[], elapsedMs: number): number {
  if (slots.length === 0) return 0

  const first = slots[0]
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return first.beginChars

  const last = slots[slots.length - 1]
  if (elapsedMs >= last.endMs) return last.endChars

  for (const slot of slots) {
    if (elapsedMs >= slot.endMs) continue
    const span = slot.endMs - slot.beginMs
    if (!(span > 0)) return slot.endChars
    const progress = (Math.max(elapsedMs, slot.beginMs) - slot.beginMs) / span
    const chars = slot.beginChars + (slot.endChars - slot.beginChars) * progress
    return Math.floor(chars)
  }

  return last.endChars
}

// ------------------------------------------------------------------ 快进

/**
 * 快进（按住 Shift + ↓ 或 →）。
 *
 * 为什么需要它：逐字输出的节奏是伪装的一部分，但它也是"想读快一点"时唯一的阻碍 ——
 * 而且**滚动救不了这件事**：视口恒在已输出内容的底部，还没输出的字滚也滚不出来。
 * 唯一的办法是让输出本身变快。
 *
 * 做法上刻意**不是**"跳字数"。快进让虚拟时钟走快，而每一行的时间预算原封不动，
 * 于是文字仍然逐行长出来 —— 看上去还是"在生成"，只是快。整段整段地蹦出来会立刻
 * 露馅：那不像 AI 在输出，像有人在翻页。
 */
export const FAST_FORWARD = {
  /** 快进期间虚拟时钟走多快。 */
  rate: 12,
  /**
   * 一次按键让快进持续多久。
   *
   * 键盘自动重复会不断刷新它，所以"按住"就等于持续快进；同时它让**点一下**
   * 也能拿到一整段快进 —— 点一下快进一小段，按住就一直快。
   */
  windowMs: 600,
}

/**
 * 收到一次快进按键之后，快进应该持续到哪个时刻。
 *
 * 取 `max` 而不是直接覆盖：自动重复只应该把到期时刻往后推，不该因为某次重复
 * 来得早而缩短已经承诺出去的那一段。
 */
export function extendFastForward(
  now: number,
  currentUntil: number,
  windowMs = FAST_FORWARD.windowMs,
): number {
  return Math.max(currentUntil, now + windowMs)
}

/**
 * 推进虚拟时钟。
 *
 * 不变量：单调不减、不为负、不超过 `durationMs`（跑完就停在末尾，不会越界）。
 * `durationMs` 的封顶很重要 —— 它保证"快进"最多把这一章推完，不会溢到下一章的坐标里。
 */
export function advanceClock(
  elapsedMs: number,
  deltaMs: number,
  fast: boolean,
  durationMs: number,
  rate = FAST_FORWARD.rate,
): number {
  const step = Math.max(0, deltaMs) * (fast ? Math.max(1, rate) : 1)
  const next = Math.max(0, elapsedMs) + step
  return Math.min(next, Math.max(0, durationMs))
}
