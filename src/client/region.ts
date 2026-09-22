// 右侧主区的定位（纯逻辑 + 依赖注入，可单测）。
//
// 为什么需要它：伪装层只该盖住**右侧会话区**，左侧栏要原样保留 —— 左侧栏是"真实的工作
// 界面"，它露在那儿本身就是最好的掩护（旁观者一看：哦，他的会话列表还在，人在正常工作）。
//
// 不能硬编码尺寸：DSH 的侧栏宽度是**可拖拽调整**的（`dsh-client-ui-layout` 里有
// "width preference in px (0 = closed)"），右侧栏也可能打开。所以只能运行时测量。
//
// 测量方式：我们能在会话区**内部**挂载（见 index.tsx 的探针 slot），从那个元素向上走，
// 收集每一层祖先的矩形；"像右侧主区"的那一层就是我们要盖住的区域。
// 找不到时调用方必须回退全屏 —— 盖多了只是难看，盖不住才是暴露。

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/** 主区至少要占视口的这个比例，否则认定那是内部的小容器。 */
export const MIN_WIDTH_RATIO = 0.4
export const MIN_HEIGHT_RATIO = 0.5

/** 贴左边缘的容差（子像素舍入）。 */
const LEFT_EDGE_EPSILON = 0.5

/**
 * 一个矩形"像不像右侧主区"。
 *
 * 三个条件缺一不可：
 * - **不贴视口左边缘**：贴着左边说明它是整页容器或侧栏，盖住它就会连左侧栏一起吃掉；
 * - 够宽、够高：否则那是主区内部某个小容器（消息列表、输入卡片）。
 */
export function isMainLike(rect: Rect | undefined, viewport: Viewport): boolean {
  if (!rect) return false
  if (!(rect.width > 0) || !(rect.height > 0)) return false
  if (rect.left <= LEFT_EDGE_EPSILON) return false
  if (rect.width < viewport.width * MIN_WIDTH_RATIO) return false
  if (rect.height < viewport.height * MIN_HEIGHT_RATIO) return false
  return true
}

/**
 * 从候选祖先里挑出右侧主区的矩形。
 *
 * @param candidates - **由内向外**排列的祖先矩形（探针元素自己排在最前）
 * @returns 最外层那个"像主区"的矩形；一个都没有则 `null`（调用方回退全屏）
 *
 * 取**最外层**而不是最内层：主区包含标题栏、消息流、输入卡片，只盖住消息流会露出
 * 输入框，看起来就不像一个"正在工作的会话"了。
 */
export function pickMainRegion(candidates: readonly Rect[], viewport: Viewport): Rect | null {
  if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) return null
  if (!candidates || candidates.length === 0) return null

  let found: Rect | null = null
  for (const rect of candidates) {
    if (isMainLike(rect, viewport)) found = rect
  }
  return found
}

/**
 * 把矩形裁进视口。
 *
 * 是**求交集**（裁掉露出视口的部分），而不是简单地把各边夹到边界里 —— 后者在
 * `left < 0` 时会保留整个宽度，让覆盖层盖到主区之外的地方去。多盖一点虽然不影响
 * 伪装，但会让"只占右侧"这件事在边缘情况下失真。
 */
export function clampToViewport(rect: Rect, viewport: Viewport): Rect {
  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(viewport.width, rect.left + rect.width)
  const bottom = Math.min(viewport.height, rect.top + rect.height)

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

/**
 * 覆盖层的定位样式。
 *
 * `region` 为 `null`（测量失败）时**回退全屏**：盖多了只是难看，盖不住才是暴露 ——
 * 注意返形态是 `inset: 0` 而不是 0 尺寸，写成 0 尺寸会得到一层看不见的覆盖层，
 * 那等于把小说直接露在 DSH 界面上。
 */
export type RegionStyle =
  | { position: 'fixed'; inset: 0 }
  | { position: 'fixed'; left: number; top: number; width: number; height: number }

export function regionStyle(region: Rect | null): RegionStyle {
  if (!region) return { position: 'fixed', inset: 0 }
  return {
    position: 'fixed',
    left: region.left,
    top: region.top,
    width: region.width,
    height: region.height,
  }
}

/** 用 `?? ` 合并"新测到的矩形"与"上一次的矩形"：测失败时保留旧值，不要突然全屏。 */
export function nextRegion(previous: Rect | null, measured: Rect | null): Rect | null {
  return measured ?? previous
}

// ------------------------------------------------------------------ 会话列表区

/** 一个元素的四条边（`getBoundingClientRect()` 的形状）。 */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** 从四条边构造矩形；反过来或退化的边返回 `null`（调用方回退）。 */
export function rectFromEdges(box: Box): Rect | null {
  const width = box.right - box.left
  const height = box.bottom - box.top
  if (!(width > 0) || !(height > 0)) return null
  return { left: box.left, top: box.top, width, height }
}

/** 元素真的占了位置吗（`display:none` 的 `getBoundingClientRect()` 全是 0）。 */
function hasArea(box: Box | null | undefined): box is Box {
  return !!box && box.bottom - box.top > 0 && box.right - box.left > 0
}

/**
 * 从会话区的三段结构里裁出**消息列表区**：Tab（header）下面、输入框上面那一段。
 *
 * 为什么不盖整个右侧主区：标题栏和输入框是 DSH 最"像在工作"的两个部件 ——
 * 盖住它们反而可疑（一个没有输入框的会话界面）。只盖中间那一段，
 * 上面的 Tab 和下面的输入框都还是真的。
 *
 * 三段来自 DSH 的实际布局（见 `docs/dsh-conversation-ui.md` §布局层级）：
 *
 * ```
 * div.wSkVaW_root
 *   ├ header.wSkVaW_header        ← 顶部 Tab 栏（min-height:76px，空会话时 display:none）
 *   └ div.wSkVaW_body
 *       └ [data-conversation-scroll]        ← 滚动容器：左右边界取它
 *           ├ div.EvIC1a_scroll             ← 消息流
 *           └ [data-composer-seat]          ← 输入卡片座（sticky 在底部）
 * ```
 *
 * @param input - 三段各自的矩形（header / seat 取不到就传 `null`）
 * @param viewport - 视口尺寸，用于否决明显不对的测量结果
 */
export function paneRegion(
  input: { scroll: Box; header?: Box | null; seat?: Box | null },
  viewport: Viewport,
): Rect | null {
  if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) return null
  if (!input || !input.scroll) return null

  const { scroll } = input
  const top = hasArea(input.header) ? input.header.bottom : scroll.top
  const bottom = hasArea(input.seat) ? input.seat.top : scroll.bottom

  const rect = rectFromEdges({ left: scroll.left, top, right: scroll.right, bottom })
  if (!rect) return null

  // 太窄说明量到的不是会话区（多半是侧栏里某个小容器）—— 宁可回退全屏也不能露馅。
  if (rect.width < viewport.width * MIN_WIDTH_RATIO) return null
  return rect
}
