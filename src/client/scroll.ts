// 阅读位置与进度的算术（纯函数，可单测）。
//
// 抽出来的理由：这几条都是"差一点就难受"的体验细节，而它们又都能用几个数字算清楚 ——
// 放进组件里只能靠手测，放进这里就能钉住。
//
//   1. **续读要精确回到上次读到的位置**，视口再自动跟过去（见 `restoreRevealed`）。
//   2. **上下键一次滚十行正文**：浏览器默认的上下键只滚约 40px（不到两行），
//      在这种长文里跟蜗牛一样。
//
// 关于"行"的定义：用户要的是**小说正文的行**，不是工具调用行、也不是段落的像素高度。
// 一个段落折行成三行时它的 `offsetHeight` 是三倍 —— 拿它当行高，"滚十行"会变成
// "滚三十行"。所以正文行高取的是**单行的 `line-height`**（见 `proseRowHeight`）。
export const LINES_PER_ARROW = 10

/** 兜底行高：取不到真实行高时用它（约等于 DSH 的 `calc(24px + δ)`）。 */
export const FALLBACK_ROW_HEIGHT = 24

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/** 把比例夹进 [0,1]；非有限值按 0 处理。 */
export function clampRatio(ratio: number): number {
  return clamp(ratio, 0, 1)
}

/** 解析一个 CSS 长度（`"24px"` → 24）；解析不出或非正数返回 0。 */
export function parseLength(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0
  if (typeof value !== 'string') return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * 一行正文的高度。
 *
 * 优先用 `line-height`：它才是"一行"的定义，不受段落折了几行影响。
 * `line-height: normal` 时浏览器可能原样返回 `"normal"`，此时按正文字号估 1.5 倍
 * （正文的常见行距），再取不到就用兜底值 —— 绝不让 0 传进乘法里。
 */
export function proseRowHeight(
  lineHeight: string | number | null | undefined,
  fontSize: string | number | null | undefined,
): number {
  const height = parseLength(lineHeight)
  if (height > 0) return height
  const size = parseLength(fontSize)
  return size > 0 ? size * 1.5 : FALLBACK_ROW_HEIGHT
}

/**
 * 当前的阅读进度：已输出字符占全章的比例，落在 `[0,1]`。
 *
 * **绝不能用滚动位置算这个数**。自动跟随让视口恒在底部，`scrollTop / scrollable`
 * 几乎永远是 1 —— 用它记录进度，等于每读完一屏就宣布"整章读完了"，
 * 续读时被判定成"从头再来"。用户看到的就是"进度完全没留住"。
 */
export function readingRatio(revealed: number, total: number): number {
  if (!(total > 0)) return 0
  if (!Number.isFinite(revealed)) return 0
  return clampRatio(revealed / total)
}

/**
 * 把"已读比例"换算成续读时的**起始字符数**。
 *
 * 这里不返回 `scrollTop`，因为在"贴底自动跟随"的输出模型里，恢复滚动位置没有意义：
 * 内容是从记录处继续长出来的，先跳到某个 `scrollTop` 会被下一次跟随立刻覆盖。
 * 唯一有意义的续读是"从上次读到的字符处继续长"，视口再自动跟过去。
 *
 * **不做任何回退**：用户要的是"就在上次关闭的地方"。回退几行看似体贴，
 * 实际是每次回来都重复读一遍同样几行。
 *
 * @param total - 全章字符总数（与 `streamLength` 同一套计数）
 * @param ratio - 上次记录的章内阅读进度（`0`–`1`）
 */
export function restoreRevealed(total: number, ratio: number): number {
  if (!(total > 0)) return 0
  const target = Math.round(total * clampRatio(ratio))
  return Math.min(Math.max(target, 0), total)
}

/**
 * 上下键一次的滚动量。
 *
 * @param rowHeight - 一行正文的高度
 * @param direction - `1` 向下、`-1` 向上
 */
export function arrowScrollDelta(
  rowHeight: number,
  direction: 1 | -1,
  lines: number = LINES_PER_ARROW,
): number {
  const height = rowHeight > 0 ? rowHeight : FALLBACK_ROW_HEIGHT
  return height * Math.max(1, lines) * direction
}

/**
 * 从测量到的行高里挑一个可用的值。
 *
 * 取不到就退回 24px，绝不让 0 或 NaN 传进算术里 —— 那会让"滚十行"变成"滚 0 行"，
 * 用户只会觉得按键坏了。
 */
export function pickRowHeight(candidates: readonly number[]): number {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return FALLBACK_ROW_HEIGHT
}
