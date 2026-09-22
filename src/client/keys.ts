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

/**
 * 交互裁决。
 *
 * @returns 期望的下一个模式；`null` 表示"这个事件不该由本插件处置"。
 */
export function resolveInteraction(mode: Mode, event: any): Mode | null {
  // 快捷键在两种状态下都生效。
  if (isToggleShortcut(event)) return resolveToggle(mode)

  // 只有内容流需要额外裁决；真实界面下插件什么都不该管。
  if (mode !== 'stream') return null

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
