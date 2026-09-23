// 快捷键判定与两态交互裁决（纯函数，可单测）。
//
// 抽出来的理由：DSH 客户端插件**没有键位绑定 API**，插件只能自己挂 window 监听；
// 而这里的裁决规则就是"被撞见时能不能收场"那一条，必须有测试钉住。
//
// 交互模型（两态，见 CONTEXT.md）：
// - 按一下快捷键 → 进内容流；
// - **鼠标移动 1px 或点击 → 立刻回到 DSH 真实界面**（那本身就是最好的掩护）；
// - 再按一下快捷键 → 同样回到真实界面。
//
// 键盘在内容流里**不**收场：那是翻页与跳章要用的。收场交给鼠标 —— 慌乱时手总会先碰鼠标。
//
// 唯一的例外是书单（`listVisible`，见 ADR-0007）：书单是要用鼠标操作的 ——
// 点书名打开、点 ✕ 删除、把文件拖进来 —— 鼠标一动就收场等于根本点不到书。

export type Mode = 'closed' | 'stream'

/** 默认快捷键。避开了 Windows 布局切换（Alt+Shift）、微软拼音（Shift）与 DSH 的 Ctrl+Shift+Z。 */
export const DEFAULT_SHORTCUT = { ctrl: true, shift: true, alt: true, code: 'KeyZ' }

/**
 * 快捷键是否匹配。
 *
 * 用 `e.code`（物理键位）而不是 `e.key`：后者随布局与 Shift 变化，组合期还可能变成 `'Process'`。
 * IME 守卫必须同时看 `isComposing` 与 `keyCode === 229`（MDN 明确要求，只查前者会漏边界情形）。
 */
export function isToggleShortcut(event: any, shortcut = DEFAULT_SHORTCUT): boolean {
  if (!event) return false
  if (event.isComposing || event.keyCode === 229) return false
  if (event.repeat) return false
  return (
    event.ctrlKey === shortcut.ctrl &&
    event.shiftKey === shortcut.shift &&
    event.altKey === shortcut.alt &&
    event.code === shortcut.code
  )
}

/** 按一下快捷键之后该去哪个状态：两态之间来回切换。 */
export function resolveToggle(mode: Mode): Mode {
  return mode === 'stream' ? 'closed' : 'stream'
}

/** 会立刻收场的鼠标事件类型。**滚轮不在其中** —— 那是用来滚动阅读的。 */
const DISMISSING_POINTER_EVENTS = new Set(['mousemove', 'click', 'pointerdown'])

/** `resolveInteraction` 的额外上下文。 */
export interface InteractionOptions {
  /**
   * 屏幕上此刻是不是书单（ADR-0007）。
   *
   * 是的话鼠标事件一律不参与收场 —— 书单只能用鼠标操作，一动就收场等于点不到书。
   * 这个状态下收场只走快捷键。默认 `false`，也就是"鼠标一动就收场"的原契约。
   */
  listVisible?: boolean
}

/**
 * 屏幕上此刻是不是书单 —— 决定鼠标要不要参与收场（ADR-0007）。
 *
 * 两个来源要一起看：用户按 `L` 把书单打开了（`listOpen`），或者**根本没有打开的书**
 * （`bookOpened` 为 false —— 此时书单就是覆盖层的全部内容）。只看前者，空书库下
 * 鼠标一动就收场，什么也点不到。
 */
export function isListSurface(surface: { bookOpened: boolean; listOpen: boolean }): boolean {
  return !surface.bookOpened || surface.listOpen
}

/**
 * 交互裁决。
 *
 * @returns 期望的下一个模式；`null` 表示"这个事件不该由本插件处置"。
 */
export function resolveInteraction(
  mode: Mode,
  event: any,
  options: InteractionOptions = {},
): Mode | null {
  // 快捷键在两种状态下都生效；书单开着时它还是唯一能收场的入口。
  if (isToggleShortcut(event)) return resolveToggle(mode)

  // 只有内容流需要额外裁决；真实界面下插件什么都不该管。
  if (mode !== 'stream') return null

  // 书单在屏幕上：鼠标交给书单自己用。这一条必须在模式判定**之后** ——
  // 书单只存在于内容流里，`closed` 下压根没有书单可点。
  if (options.listVisible) return null

  // 鼠标一动就收场。刻意**不**设位移阈值：被撞见时手总会先碰鼠标，
  // 那一下必须立刻见效 —— 晚半拍就晚了。
  if (DISMISSING_POINTER_EVENTS.has(event?.type)) return 'closed'

  return null
}

/** 内容流里的键盘操作。 */
export type ReadingAction =
  | 'nextChapter'
  | 'prevChapter'
  | 'toggleList'
  | 'lineUp'
  | 'lineDown'
  /** 快进：让逐字输出的虚拟时钟走快（见 typing.ts 的 `FAST_FORWARD`）。 */
  | 'fastForward'

/**
 * 阅读态按键 → 操作。
 *
 * 只认**无修饰键**的组合：带 Ctrl/Alt/Meta 的按键留给浏览器与系统（复制、切换标签页等），
 * 插件不该抢。翻页刻意**不**在这里处理 —— 交给浏览器默认的 Space/PageDown 滚动，
 * 少一层自己的滚动实现就少一类偏移 bug。
 */
export function resolveReadingKey(event: any): ReadingAction | null {
  if (!event) return null
  if (event.isComposing || event.keyCode === 229) return null
  if (event.ctrlKey || event.altKey || event.metaKey) return null

  // 快进：Shift + 前向方向键。
  //
  // 为什么需要它：滚动解决不了"想读快一点" —— 视口恒在已输出内容的底部，
  // 还没输出的字滚也滚不出来，唯一的办法是让输出本身变快。
  //
  // 只重定义**前向**那一对。Shift+↑ / Shift+← 沿用原来的滚动与翻章（Shift 本来就不在
  // 上面的排除列表里），所以这个改动只影响两个"往前走"的组合。
  if (event.shiftKey && (event.code === 'ArrowDown' || event.code === 'ArrowRight')) {
    return 'fastForward'
  }

  switch (event.code) {
    case 'ArrowRight':
    case 'BracketRight':
      return 'nextChapter'
    case 'ArrowLeft':
    case 'BracketLeft':
      return 'prevChapter'
    case 'KeyL':
      return 'toggleList'
    case 'ArrowUp':
      return 'lineUp'
    case 'ArrowDown':
      return 'lineDown'
    default:
      return null
  }
}
