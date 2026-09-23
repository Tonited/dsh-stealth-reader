// 内容流（本项目唯一的内容展示形态）。
//
// 屏幕上是"一段正在进行的会话"：真实会话历史与小说段落混在同一股流里，逐字出现 ——
// 模仿 DSH 自己的流式输出。只盖住**右侧主区**，左侧栏原样保留（那是"人在正常工作"
// 最好的掩护，见 region.ts）。
//
// 退出方式只有鼠标：移动 1px 或点击，立刻回到 DSH 真实界面（keys.ts 的裁决）。
// 键盘留给阅读操作（翻页、跳章、任务列表），所以这里**不**收场。
import * as React from 'react'

import type { DialogueLine } from './dialogue.ts'
import { isListSurface, resolveReadingKey } from './keys.ts'
import {
  clampToViewport,
  nextRegion,
  paneRegion,
  pickMainRegion,
  regionStyle,
  type Box,
  type Rect,
} from './region.ts'
import {
  arrowScrollDelta,
  pickRowHeight,
  proseRowHeight,
  readingRatio,
  restoreRevealed,
} from './scroll.ts'
import { advanceClock, charsAt, extendFastForward, scheduleDuration, typingSchedule } from './typing.ts'
import { getPrimitives } from './primitives.ts'
import { PLACEHOLDER, splitImagePlaceholders } from './richtext.ts'
import type { BookRecord, ChapterImageRecord, ChapterRecord, ProgressRecord } from './storage.ts'
import * as store from './store.ts'
import { weaveStream, type StreamLine } from './stream.ts'

const Z_OVERLAY = 2147483000

/** 进度回写节流：输出进度变化时不要每个 tick 都写库。 */
const PROGRESS_THROTTLE_MS = 800

/**
 * 定时器间隔。输出的"手感"由 typing.ts 的 `DEFAULT_TEMPO` 决定，这里只管刷新频率 ——
 * 50ms 足够让逐字看起来是连续的，又不至于每个字都触发一次渲染。
 */
const TICK_MS = 50

/** 自动跟随的容差：离底部多近算"还跟着"。 */
const FOLLOW_TOLERANCE = 40

export interface AppApi {
  listBooks(): Promise<BookRecord[]>
  listProgress(): Promise<Record<string, ProgressRecord | undefined>>
  importFile(file: File): Promise<{ ok: boolean; error?: string }>
  deleteBook(bookId: string): Promise<void>
  getChapter(bookId: string, index: number): Promise<ChapterRecord | undefined>
  listChapterTitles(bookId: string): Promise<Array<{ index: number; title: string }>>
  putProgress(progress: ProgressRecord): Promise<void>
}

const AppContext = React.createContext<AppApi | null>(null)

export function AppProvider({
  api,
  children,
}: {
  api: AppApi
  children?: React.ReactNode
}): React.ReactElement {
  return React.createElement(AppContext.Provider, { value: api }, children)
}

export function useApp(): AppApi {
  const api = React.useContext(AppContext)
  if (!api) throw new Error('useApp 必须放在 AppProvider 内')
  return api
}

// ------------------------------------------------------------------ 排版

/**
 * 等宽优先的字体栈。
 *
 * 英文在前、中文兜底：装了 Sarasa Mono 这类中英等宽字体时最统一；没装则英文走 Consolas、
 * 中文走系统黑体。关键是**真实会话行与小说段落共用同一个字体栈** —— 这样"散文"和
 * "工具输出"看起来才是同一种东西。
 */
const MONO =
  'Consolas, "Cascadia Mono", "Sarasa Mono SC", "Microsoft YaHei UI", ui-monospace, monospace'

const ROOT_BASE: React.CSSProperties = {
  // 关键：覆盖层是 `width: <主区宽度>` + 左右 padding，而 CSS 默认 content-box
  // 会让实际宽度 = 宽度 + 两侧 padding —— 右侧内容正好被裁掉，看起来就是"文字出界"。
  boxSizing: 'border-box',
  zIndex: Z_OVERLAY,
  background: 'var(--dsw-alias-bg-base, #16161a)',
  color: 'var(--dsw-alias-label-secondary, #b9b9c0)',
  overflowY: 'auto',
  overflowX: 'hidden',
  // 覆盖区已经在输入框上方，这里按 DSH 消息流的实际内边距来（16px 32px）。
  padding: '16px 32px 24px',
  fontFamily: MONO,
  fontSize: 14,
  lineHeight: 1.95,
  cursor: 'default',
  userSelect: 'none',
}

/**
 * DSH 会话界面的真实排版常量。
 *
 * 全部来自对前端产物的实测（见 `docs/dsh-conversation-ui.md`）：
 * 正文 14px / 行高 `calc(24px + δ)`，次级 13px，δ 是 DSH 自己的字号增量变量。
 * 变量都写在 `document.body` 的 inline style 上，所以插件元素一定解析得到。
 */
const FONT_DELTA = 'var(--dsh-content-font-delta, 0px)'
const ROW_HEIGHT = `calc(24px + ${FONT_DELTA})`
const FONT_BODY = 'var(--dsh-content-font-size, 14px)'
const FONT_SECONDARY = 'var(--dsh-content-font-size-secondary, 13px)'

const LINE_BASE: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  // `break-word` 对付不了没有空格的超长串（URL、base64、连续标点）。
  overflowWrap: 'anywhere',
}

/**
 * 小说段落，以"AI 回复正文"的身份出现：无行首元素、无缩进。
 *
 * 注意 DSH 的正文行**没有**任何前缀或装饰（实测：assistant 是
 * `root > body`，无 leading 元素）—— 任何"⏺"「>」之类的字符前缀都会立刻露馅。
 */
const ASSISTANT_STYLE: React.CSSProperties = {
  ...LINE_BASE,
  fontSize: FONT_BODY,
  lineHeight: ROW_HEIGHT,
  color: 'var(--dsw-alias-label-primary, #e6e6ea)',
  margin: '4px 0',
}

/**
 * 小说段落，以"工具输出内容"的身份出现。
 *
 * 视觉标志用的是 DSH 自己给子内容/工具输出的**左侧细竖线**（实测：
 * `border-left:.5px solid var(--dsw-alias-border-l2); margin:4px 0 2px 22px; padding-left:8px`），
 * 而不是自己编一个缩进。
 *
 * 为什么小说不真的塞进工具输出里：实测 DSH 的工具输出默认**折叠**，且展开后
 * IO 区限高 150px、read/diff 类内容只显示 8 行 —— 放进去会读不全，做大又会违反它
 * 自己的显示规格。所以小说走正文（那里不截断），工具调用行只作为身份暗示穿插。
 */
const RESULT_STYLE: React.CSSProperties = {
  ...LINE_BASE,
  fontSize: FONT_BODY,
  lineHeight: ROW_HEIGHT,
  color: 'var(--dsw-alias-label-primary, #e6e6ea)',
  borderLeft: '0.5px solid var(--dsw-alias-border-l2, rgba(128,128,140,0.3))',
  margin: '4px 0 2px 22px',
  paddingLeft: 8,
  opacity: 0.95,
}

/** 工具调用行：16px 图标盒 + 名称（secondary）+ 2×2 圆点 + 摘要（tertiary）。 */
const TOOL_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: ROW_HEIGHT,
  minWidth: 0,
  margin: '2px 0',
}

const TOOL_LEADING: React.CSSProperties = {
  position: 'relative',
  flex: 'none',
  width: `calc(16px + ${FONT_DELTA})`,
  height: `calc(16px + ${FONT_DELTA})`,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 6,
  color: 'var(--dsw-alias-label-tertiary, #8a8a95)',
}

const TOOL_NAME: React.CSSProperties = {
  flex: 'none',
  fontSize: FONT_SECONDARY,
  lineHeight: ROW_HEIGHT,
  color: 'var(--dsw-alias-label-secondary, #b9b9c0)',
}

/** 名称与摘要之间的分隔是 2×2 的方块，**不是** `·` 之类的字符。 */
const TOOL_DOT: React.CSSProperties = {
  background: 'var(--dsw-alias-label-caption, #6a6a75)',
  borderRadius: 1,
  flex: 'none',
  width: 2,
  height: 2,
  margin: '0 8px',
}

const TOOL_SUMMARY: React.CSSProperties = {
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  fontSize: FONT_SECONDARY,
  lineHeight: ROW_HEIGHT,
  color: 'var(--dsw-alias-label-tertiary, #8a8a95)',
  flex: 'auto',
  overflow: 'hidden',
}

/** 可选尾注（DSH 用它显示 `+12 -3` 这类信息）。 */
const TOOL_SUFFIX: React.CSSProperties = {
  flex: 'none',
  marginLeft: 10,
  fontSize: 11,
  fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
  color: 'var(--dsw-alias-label-caption, #6a6a75)',
}

/** 用户消息：右对齐气泡（实测：圆角 22px、padding 10px 16px、宽度上限 82%）。 */
const USER_ROW: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  margin: '10px 0',
}

const USER_BUBBLE: React.CSSProperties = {
  background: 'var(--dsw-specific-bubble, rgba(90,110,150,0.25))',
  borderRadius: 22,
  padding: '10px 16px',
  maxWidth: '82%',
  fontSize: FONT_BODY,
  lineHeight: ROW_HEIGHT,
  color: 'var(--dsw-alias-label-primary, #e6e6ea)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

/** 任务列表里的次要文字（与工具行摘要同一层级）。 */
const LIST_TEXT: React.CSSProperties = {
  fontSize: FONT_SECONDARY,
  lineHeight: ROW_HEIGHT,
  color: 'var(--dsw-alias-label-tertiary, #8a8a95)',
}

/** 章节行：伪装成一次"读文件"的工具调用，是读者唯一的方位锚点。 */
const CHAPTER_ROW: React.CSSProperties = {
  ...TOOL_ROW,
  margin: '18px 0 6px',
}

/** 流式指示器：DSH 唯一的"正在生成"标志（文字流光，1.8s）。 */
const TURN_STATUS: React.CSSProperties = {
  fontSize: FONT_SECONDARY,
  lineHeight: ROW_HEIGHT,
  color: 'var(--dsw-alias-label-tertiary, #8a8a95)',
  margin: '6px 0',
  backgroundImage:
    'linear-gradient(90deg, currentColor 0%, currentColor 35%, transparent 50%, currentColor 65%, currentColor 100%)',
  backgroundSize: '200% 100%',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  animation: 'dsh-stealth-shimmer 1.8s linear infinite',
}

const KEYFRAMES_ID = 'dsh-stealth-reader-keyframes'

/**
 * 注入本插件需要的 keyframes。
 *
 * DSH 自己就是这么干的（CSS Module 编译成 JS 字符串，模块首次求值时写 `<style>`），
 * 所以这里同样是"和它一样"的做法，而不是另一套样式体系。
 */
function ensureKeyframes(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(KEYFRAMES_ID)) return
  const style = document.createElement('style')
  style.id = KEYFRAMES_ID
  style.textContent = [
    '@keyframes dsh-stealth-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}',
  ].join('')
  document.head.appendChild(style)
}

// --------------------------------------------------------------- 主区测量

/** 一个元素的四条边。 */
function boxOf(node: Element | null | undefined): Box | null {
  if (!node) return null
  const box = node.getBoundingClientRect()
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
}

/** 从滚动容器向上找它的顶层容器（含 header 的那一层）。 */
function findHeader(scroll: Element): Element | null {
  let node: Element | null = scroll.parentElement
  for (let depth = 0; node && depth < 8; depth += 1) {
    const header = node.querySelector(':scope > header')
    if (header) return header
    node = node.parentElement
  }
  return null
}

/**
 * 量出**会话列表区**的矩形：Tab（header）下面、输入框上面那一段。
 *
 * 锚点是 index.tsx 挂在会话区**内部**的探针（`[data-stealth-reader="probe"]`）。
 * 优先走 DSH 布局里的三个稳定锚点：
 *
 *   - `[data-conversation-scroll]` —— 滚动容器，给出左右边界
 *   - 它上层的 `<header>` —— 顶部 Tab 栏，给出上边界
 *   - `[data-composer-seat]` —— 输入卡片座，给出下边界
 *
 * 任何一个对不上（DSH 改版、探针挂到了别处），就退回"最外层那个像主区的祖先"；
 * 全都测不到才返回 `null`，由 `regionStyle` 回退全屏 —— 盖多了只是难看，盖不住才是暴露。
 */
export function measureMainRegion(doc: Document): Rect | null {
  const probe = doc.querySelector('[data-stealth-reader="probe"]')
  if (!probe) return null

  const viewport = { width: window.innerWidth, height: window.innerHeight }

  const scroll = probe.closest('[data-conversation-scroll]')
  if (scroll) {
    const pane = paneRegion(
      {
        scroll: boxOf(scroll) as Box,
        header: boxOf(findHeader(scroll)),
        seat: boxOf(probe.closest('[data-composer-seat]')),
      },
      viewport,
    )
    if (pane) return clampToViewport(pane, viewport)
  }

  // 退回旧路径：逐级向上收集祖先矩形，挑最外层那个"像主区的"。
  const candidates: Rect[] = []
  let node: Element | null = probe
  while (node && node !== doc.body) {
    const box = node.getBoundingClientRect()
    candidates.push({ left: box.left, top: box.top, width: box.width, height: box.height })
    node = node.parentElement
  }

  const region = pickMainRegion(candidates, viewport)
  return region ? clampToViewport(region, viewport) : null
}

/**
 * 跟踪主区矩形。
 *
 * 三种触发都要有：窗口 resize；探针可能比本组件晚挂载（所以开头补测几次）；
 * 以及**拖拽侧栏**——那只改变主区宽度，不触发 window resize，只能靠低频轮询兜住。
 */
function useMainRegion(): Rect | null {
  const [region, setRegion] = React.useState<Rect | null>(null)

  React.useEffect(() => {
    let frame = 0
    const remeasure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setRegion((previous) => nextRegion(previous, measureMainRegion(document)))
      })
    }

    remeasure()
    const timers = [120, 450, 1200].map((delay) => window.setTimeout(remeasure, delay))
    window.addEventListener('resize', remeasure)
    const poll = window.setInterval(remeasure, 1500)

    return () => {
      cancelAnimationFrame(frame)
      for (const timer of timers) window.clearTimeout(timer)
      window.clearInterval(poll)
      window.removeEventListener('resize', remeasure)
    }
  }, [])

  return region
}

// ------------------------------------------------------------------ 行渲染

/**
 * 单张插图。图片以 `Uint8Array` 存在 IndexedDB 里，渲染时转 object URL，
 * **卸载时必须 revoke**，否则每翻一章都会漏掉一批 blob。
 */
function ChapterImage({ image }: { image: ChapterImageRecord | undefined }) {
  const url = React.useMemo(() => {
    const data = image?.data
    if (!data) return null
    try {
      const bytes = new Uint8Array(data)
      return URL.createObjectURL(new Blob([bytes], { type: image.mediaType || 'image/png' }))
    } catch {
      return null
    }
  }, [image])

  React.useEffect(() => {
    if (!url) return undefined
    return () => URL.revokeObjectURL(url)
  }, [url])

  if (!url) return null
  return React.createElement('img', {
    src: url,
    alt: '',
    style: {
      display: 'block',
      maxWidth: '100%',
      height: 'auto',
      margin: '0.6em 0 0.6em 2ch',
      borderRadius: 2,
      opacity: 0.9,
    },
  })
}

/** 一段正文（可能含插图占位符）。 */
function ProseBlock({ text, images }: { text: string; images?: ChapterImageRecord[] }) {
  const blocks = React.useMemo(() => splitImagePlaceholders(text), [text])

  if (blocks.every((block) => block.type === 'text')) {
    return React.createElement(React.Fragment, null, text)
  }

  return React.createElement(
    React.Fragment,
    null,
    blocks.map((block, index) =>
      block.type === 'text'
        ? React.createElement('span', { key: `t${index}` }, block.value)
        : React.createElement(ChapterImage, {
            key: `i${index}`,
            image: images?.[block.index],
          }),
    ),
  )
}

/** 14px 的行首图标。DSH 用 `currentColor` SVG，任何字符前缀（`$`/`>`/`●`）都是假的。 */
function LeadingIcon(): React.ReactElement {
  return React.createElement(
    'svg',
    {
      width: 14,
      height: 14,
      viewBox: '0 0 14 14',
      fill: 'none',
      'aria-hidden': 'true',
      style: {
        width: `calc(14px + ${FONT_DELTA})`,
        height: `calc(14px + ${FONT_DELTA})`,
      },
    },
    React.createElement('circle', { cx: 7, cy: 7, r: 5.2, stroke: 'currentColor', strokeWidth: 1.2 }),
  )
}

/**
 * 工具调用行。
 *
 * **优先复用 DSH 自己的 `DisclosureRow`**：同一份代码、同一张 CSS，行高与图标盒天然对齐，
 * 比自己照着规格模仿可靠得多。拿不到 primitives 时才退回这里手写的等价结构 ——
 * 结构仍按实测规格（16px 图标盒 / 名称 secondary / 2×2 方块 / 摘要 tertiary）。
 */
function ToolRow({
  name,
  summary,
  suffix,
  failed,
}: {
  name: string
  summary: string
  suffix?: string
  failed?: boolean
}): React.ReactElement {
  const prim = getPrimitives()
  const dot = React.createElement('span', { 'aria-hidden': 'true', style: TOOL_DOT })
  const summaryNode = React.createElement('span', { style: TOOL_SUMMARY }, summary)
  const suffixNode = suffix ? React.createElement('span', { style: TOOL_SUFFIX }, suffix) : null

  if (prim?.DisclosureRow) {
    // 失败的调用行：行首换成红色状态点（实测行为）。
    const icon =
      failed && prim.StateDot
        ? React.createElement(prim.StateDot, { state: 'error' })
        : React.createElement(prim.IconChevronRightOutline14 ?? LeadingIcon, { size: 14 })

    return React.createElement(prim.DisclosureRow, {
      icon,
      title: name,
      // 分隔符由调用方提供（实测：collapsedContent 自己带 sep）。
      collapsedContent: React.createElement(
        React.Fragment,
        null,
        dot,
        summaryNode,
        suffixNode,
      ),
      // 不展开：展开态会露出"里面到底是什么"，而我们并没有一个真实的调用可以展开。
      expandable: false,
      open: false,
    })
  }

  return React.createElement(
    'div',
    { style: TOOL_ROW },
    React.createElement(
      'span',
      { style: TOOL_LEADING },
      failed && prim?.StateDot
        ? React.createElement(prim.StateDot, { state: 'error' })
        : React.createElement(LeadingIcon, null),
    ),
    React.createElement('span', { style: TOOL_NAME }, name),
    dot,
    summaryNode,
    suffixNode,
  )
}

/**
 * 正文行。
 *
 * 有插图时自绘（`MarkdownText` 不认识我们用 `U+FFFC` 标的图片位置），
 * 否则交给 DSH 的 `MarkdownText` —— 那是真实 assistant 消息的渲染器，字体、
 * 段落间距、代码块样式全都一致。
 */
function ProseLine({
  text,
  images,
  indented,
}: {
  text: string
  images?: ChapterImageRecord[]
  indented?: boolean
}): React.ReactElement {
  const prim = getPrimitives()
  const hasImages = text.includes(PLACEHOLDER) || (images?.length ?? 0) > 0

  const content = !hasImages && prim?.MarkdownText
    ? React.createElement(prim.MarkdownText, { text, streaming: false })
    : React.createElement(ProseBlock, { text, images })

  return React.createElement(
    'div',
    {
      style: indented ? RESULT_STYLE : ASSISTANT_STYLE,
      // 量"一行正文有多高"时的锚点：上下键一次滚十行，十行的单位就是这里的高度。
      'data-stealth-line': 'prose',
    },
    content,
  )
}

function StreamLineView({
  line,
  images,
}: {
  line: StreamLine
  images?: ChapterImageRecord[]
}) {
  // 小说正文：七成带 DSH 标记子内容用的左侧细竖线（"工具输出"的身份），三成是裸正文。
  if (line.source === 'novel') {
    if (line.kind === 'chapter') {
      // 章节行伪装成一次"读文件"的调用 —— DSH 的消息流里没有"章节标题"这种东西。
      return React.createElement(ToolRow, {
        name: 'Read',
        summary: line.text.replace(/^\[\d+\/\d+\]\s*/, ''),
        suffix: line.marker,
      })
    }
    return React.createElement(ProseLine, {
      text: line.text,
      images,
      indented: line.kind === 'result',
    })
  }

  // 真实会话行
  switch (line.kind) {
    case 'user':
      return React.createElement(
        'div',
        { style: USER_ROW },
        React.createElement('div', { style: USER_BUBBLE }, line.text),
      )
    case 'tool':
      return React.createElement(ToolRow, {
        name: line.name ?? 'Tool call',
        summary: line.text || '',
        failed: line.ok === false,
      })
    default:
      return React.createElement(ProseLine, { text: line.text, images })
  }
}

/**
 * 按"已输出的字符数"裁剪行。
 *
 * 逐字输出（而不是逐行）是为了贴近 DSH 自己的流式观感：内容是一点点长出来的，
 * 而不是一行行跳出来。行是渲染单位，字符才是输出单位。
 */
export function revealLines(
  lines: readonly StreamLine[],
  revealed: number,
): Array<{ line: StreamLine; text: string }> {
  const out: Array<{ line: StreamLine; text: string }> = []
  let used = 0

  for (const line of lines) {
    if (used >= revealed) break
    const budget = revealed - used
    const text = line.text.length <= budget ? line.text : line.text.slice(0, budget)
    out.push({ line, text })
    used += line.text.length + 1 // +1：行尾的换行也占一个"输出单位"
  }

  return out
}

/**
 * 量"一行正文"的高度。
 *
 * 首选一个正文段落的 `line-height`：**行**的定义是单行文本的高度，与段落折了几行无关。
 * 拿段落元素的 `offsetHeight` 会随折行数膨胀 —— 一个折了三行的段落会报 72px，
 * 于是"滚十行"变成"滚三十行"，快得看不清。
 *
 * 一条正文都还没长出来时（流刚开始）退回整行的固定高度。量不到时 `pickRowHeight`
 * 会给兜底值 —— 传 0 或 NaN 进去会让"滚十行"变成"滚 0 行"，用户只会觉得按键坏了。
 */
function rowHeightOf(node: HTMLElement | null): number {
  if (!node) return 0

  const prose = node.querySelector('[data-stealth-line="prose"]')
  if (prose instanceof HTMLElement) {
    const style = getComputedStyle(prose)
    return proseRowHeight(style.lineHeight, style.fontSize)
  }

  const first = node.firstElementChild
  const height = first instanceof HTMLElement ? first.offsetHeight : 0
  return pickRowHeight([height])
}

/** 内容流总长度（字符数），用于判断是否输出完毕。 */
export function streamLength(lines: readonly StreamLine[]): number {
  return lines.reduce((total, line) => total + line.text.length + 1, 0)
}

// ------------------------------------------------------------------ 内容流

interface OpenState {
  book: BookRecord
  chapterIndex: number
  chapter: ChapterRecord | undefined
  loading: boolean
}

interface StreamBodyProps {
  book: BookRecord
  chapterIndex: number
  chapter: ChapterRecord | undefined
  loading: boolean
  initialRatio: number
  forceTop: boolean
  /**
   * 上面盖着别的东西（任务列表）时不收键盘。
   *
   * 内容流在后端继续长、组件不卸载 —— 从列表回来时进度才不会倒退回打开列表之前
   * （`progressMap` 是挂载时的快照，用它重新定位就会倒退）。
   */
  covered: boolean
  dialogue: readonly DialogueLine[]
  region: Rect | null
  app: AppApi
  onChapter: (index: number) => void
  onToggleList: () => void
}

function StreamBody({
  book,
  chapterIndex,
  chapter,
  loading,
  initialRatio,
  forceTop,
  covered,
  dialogue,
  region,
  app,
  onChapter,
  onToggleList,
}: StreamBodyProps): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const lastWriteRef = React.useRef(0)
  /** 已定位过的"书:章"。续读只发生一次 —— 进度刷新不该把读者从当前位置拽走。 */
  const locatedRef = React.useRef<string | null>(null)
  /** 用户手动向上滚动后暂停自动跟随，回到底部再恢复。 */
  const followRef = React.useRef(true)

  const lines = React.useMemo(
    () =>
      chapter
        ? weaveStream({
            dialogue,
            chapterText: chapter.text,
            chapterTitle: chapter.title,
            chapterIndex,
            chapterCount: book.chapterCount,
          })
        : [],
    [chapter, chapterIndex, book.chapterCount, dialogue],
  )

  const total = React.useMemo(() => streamLength(lines), [lines])

  /** 本次输出的起始字符数；`null` = 还没定位，此时不开始输出。 */
  const [startAt, setStartAt] = React.useState<number | null>(null)
  const [revealed, setRevealed] = React.useState(0)

  /**
   * 输出时间表：每一行占用哪一段时间、覆盖哪一段字符。
   *
   * 真实会话行标 `quick` —— 它是"工作痕迹"，闪一下就走；小说正文按 `DEFAULT_TEMPO`
   * 一个字一个字长出来。两者混在一起时，读者的观感正是"日志很快过去、正文在打字"。
   */
  const schedule = React.useMemo(
    () =>
      typingSchedule(
        lines.map((line) => ({ chars: line.text.length, quick: line.source === 'real' })),
        startAt ?? 0,
      ),
    [lines, startAt],
  )
  const duration = React.useMemo(() => scheduleDuration(schedule), [schedule])

  // 本插件需要的 keyframes（DSH 自己也是在模块求值时注入 <style>）。
  React.useEffect(() => {
    ensureKeyframes()
  }, [])

  // 续读定位：把上次的阅读进度换算成本次的**起始字符数**。
  //
  // 为什么不是恢复 `scrollTop`：内容是流式长出来的，定位时 `scrollHeight` 还几乎为零，
  // 算出来的位置本身就没有意义；就算算出了，紧接着的自动跟随也会把它覆盖掉。
  // 结果是"每次都从本章开头"——恢复滚动位置在这个输出模型里是假的。
  // 真正能留住进度的只有一件事：**从上次读到的字符处继续长**。
  React.useEffect(() => {
    if (loading || !chapter || total <= 0) return

    const key = `${book.id}:${chapterIndex}`
    if (locatedRef.current === key) return
    locatedRef.current = key

    // 精确回到上次读到的字符处，不回退 —— 视口随后由自动跟随跟过去。
    const start = forceTop ? 0 : restoreRevealed(total, initialRatio)
    setStartAt(start)
    setRevealed(start)
    followRef.current = true
  }, [loading, chapter, total, chapterIndex, book.id, forceTop, initialRatio])

  // 快进到期的时刻。放 ref 而不是 state：它每 TICK_MS 被读一次，进 state 会让整个
  // 组件每 tick 重渲染一遍，而它本身不需要触发任何渲染。
  const fastUntilRef = React.useRef(0)

  // 流式输出：按时间表从起始位置长出来，直到整章输出完。
  //
  // 为什么不是"每 tick 加固定字数"：那样"一行有多长"就直接决定了"它占多少时间"，
  // 于是短行一闪而过看不见、长段落却要干等十几秒。打字机的手感来自**按行分配时间**
  // （见 typing.ts），而不是一个全局匀速的字符流。
  //
  // 用**自己累加的虚拟时钟**，而不是每 tick 重算 `Date.now() - begin`：快进要做的
  // 正是让这个时钟走快，而每行的时间预算原封不动 —— 所以快进看上去仍是打字机。
  React.useEffect(() => {
    if (startAt === null || schedule.length === 0 || duration <= 0) return undefined

    let elapsed = 0
    let last = Date.now()
    const timer = window.setInterval(() => {
      const now = Date.now()
      elapsed = advanceClock(elapsed, now - last, now < fastUntilRef.current, duration)
      last = now
      setRevealed(charsAt(schedule, elapsed))
      if (elapsed >= duration) window.clearInterval(timer)
    }, TICK_MS)

    return () => window.clearInterval(timer)
  }, [schedule, startAt, duration])

  // 自动跟随：新内容长出来时视口跟着走（像终端），用户手动上滚则暂停。
  React.useEffect(() => {
    const node = scrollRef.current
    if (!node || !followRef.current) return
    node.scrollTop = node.scrollHeight
  }, [revealed])

  /** 当前阅读进度（已输出字符占全章的比例，见 `readingRatio`）。 */
  const currentRatio = React.useCallback(
    (): number => readingRatio(revealed, total),
    [revealed, total],
  )

  const saveProgress = React.useCallback(
    async (index: number, value: number) => {
      try {
        await app.putProgress({
          bookId: book.id,
          chapterIndex: index,
          ratio: value,
          updatedAt: Date.now(),
        })
      } catch {
        // 进度写失败不该打断阅读。
      }
    },
    [app, book.id],
  )

  // 滚动只用来判断"还要不要自动跟随"。
  React.useEffect(() => {
    const node = scrollRef.current
    if (!node) return undefined

    const onScroll = () => {
      // 贴近底部 → 继续自动跟随；手动上滚 → 暂停跟随。
      const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      followRef.current = distanceToBottom < FOLLOW_TOLERANCE
    }

    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [chapter])

  // 进度回写：输出进度一变就（节流）记一次，整章输出完时立刻记 ——
  // 否则最后一段可能刚好落在节流窗口里，下次续读会退回去一点。
  React.useEffect(() => {
    if (!chapter || total <= 0) return
    const finished = revealed >= total
    const now = Date.now()
    if (!finished && now - lastWriteRef.current < PROGRESS_THROTTLE_MS) return
    lastWriteRef.current = now
    void saveProgress(chapterIndex, currentRatio())
  }, [chapter, chapterIndex, currentRatio, revealed, total, saveProgress])

  // 离开这一章时补一次进度，避免丢掉最后一段的位移。
  React.useEffect(
    () => () => {
      void saveProgress(chapterIndex, currentRatio())
    },
    [chapterIndex, currentRatio, saveProgress],
  )

  React.useEffect(() => {
    if (covered) return undefined

    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveReadingKey(event)
      if (!action) return
      // 书单盖在上面时，只有"开关书单"这一个键还有意义。
      if (covered && action !== 'toggleList') return
      event.preventDefault()
      event.stopPropagation()

      if (action === 'toggleList') {
        void saveProgress(chapterIndex, currentRatio())
        onToggleList()
        return
      }

      // 快进：只把虚拟时钟推快，不动已输出的字数（见 typing.ts 的 advanceClock）。
      // 自动重复会不断刷新到期时刻，所以按住就是持续快进。
      if (action === 'fastForward') {
        fastUntilRef.current = extendFastForward(Date.now(), fastUntilRef.current)
        return
      }

      // 上下键一次滚十行左右：浏览器默认只滚约 40px，在这种长文里跟蜗牛一样。
      if (action === 'lineUp' || action === 'lineDown') {
        const node = scrollRef.current
        if (node) {
          node.scrollBy({
            top: arrowScrollDelta(rowHeightOf(node), action === 'lineDown' ? 1 : -1),
          })
        }
        return
      }
      const next = action === 'nextChapter' ? chapterIndex + 1 : chapterIndex - 1
      if (next < 0 || next >= book.chapterCount) return
      void saveProgress(chapterIndex, currentRatio())
      onChapter(next)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [book.chapterCount, chapterIndex, covered, currentRatio, onChapter, onToggleList, saveProgress])

  const visible = React.useMemo(() => revealLines(lines, revealed), [lines, revealed])
  const streaming = revealed < total

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      {
        ref: scrollRef,
        style: { ...ROOT_BASE, ...regionStyle(region) },
        'data-stealth-reader': 'stream',
        // 诊断用。逐字输出或续读出问题时，看一眼这四个数就够定位：
        //   data-start    本次从第几个字符开始（0 = 从头；几千 = 续读成功）
        //   data-revealed 已经输出到第几个字符
        //   data-total    全章字符总数（revealed == total 就是输出完了）
        //   data-ratio    阅读进度百分比（续读时会立刻跳到上次的位置）
        'data-start': startAt ?? 0,
        'data-revealed': revealed,
        'data-total': total,
        'data-ratio': Math.round(readingRatio(revealed, total) * 100),
      },
      loading || !chapter
        ? React.createElement('div', { style: TOOL_NAME }, 'loading…')
        : visible.map((row, index) =>
            React.createElement(StreamLineView, {
              key: index,
              line: row.line,
              images: chapter.images,
            }),
          ),
      // DSH 唯一的"正在生成"标志就是这一行（**没有光标**，全仓 0 命中）。
      streaming
        ? React.createElement(
            'div',
            { role: 'status', style: TURN_STATUS },
            '深度求索中...',
          )
        : null,
    ),
  )
}

// ------------------------------------------------------------------ 任务列表

const LIST_ROW: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'baseline',
  padding: '5px 2ch',
  cursor: 'pointer',
  borderRadius: 3,
}

/**
 * 书架，伪装成"最近的任务列表"。
 *
 * 每本书就是一个任务，进度就是它的百分比 —— 这样书架本身也在伪装语言之内，
 * 不需要为它单开一个界面。
 */
/** 列表底部的灰色小字（书架与章节目录共用）。 */
function footnote(text: string): React.ReactElement {
  return React.createElement('div', { style: { ...LIST_TEXT, opacity: 0.38, marginTop: 2 } }, text)
}

function TaskList({
  books,
  progressMap,
  importing,
  error,
  activeId,
  region,
  onImport,
  onOpen,
  onOpenChapters,
  onDelete,
  onClose,
}: {
  books: BookRecord[]
  progressMap: Record<string, ProgressRecord | undefined>
  importing: boolean
  error?: string
  activeId?: string
  region: Rect | null
  onImport: (file: File) => void
  /** 点整行 → 选中这本书开读（续读上次的位置）。 */
  onOpen: (bookId: string) => void
  /** 行右侧的图标按钮 → 展开这本书的步骤清单（见 ADR-0008）。 */
  onOpenChapters: (bookId: string) => void
  onDelete: (bookId: string) => void
  onClose: () => void
}): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = React.useState(false)

  return React.createElement(
    'div',
    {
      style: { ...ROOT_BASE, ...regionStyle(region), padding: '24px 32px 32px' },
      'data-stealth-reader': 'list',
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault()
        setDragging(true)
      },
      onDragLeave: () => setDragging(false),
      onDrop: (event: React.DragEvent) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer?.files?.[0]
        if (file) onImport(file)
      },
    },

    React.createElement(
      'div',
      { style: { ...LIST_TEXT, opacity: 0.5, marginBottom: 10 } },
      'recent tasks',
    ),
    books.length === 0
      ? footnote(importing ? 'attaching…' : 'no tasks · drop a .txt / .epub file here')
      : books.map((book) =>
          React.createElement(
            'div',
            {
              key: book.id,
              style: {
                ...LIST_ROW,
                background: book.id === activeId ? 'rgba(128,128,150,0.14)' : 'transparent',
              },
              onClick: () => onOpen(book.id),
            },
            React.createElement(
              'span',
              { style: { opacity: 0.5 } },
              book.id === activeId ? '\u25B8' : '\u00B7',
            ),
            React.createElement(
              'span',
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              book.title,
            ),
            React.createElement(
              'span',
              { style: { opacity: 0.5, fontSize: 12.5 } },
              `${Math.min((progressMap[book.id]?.chapterIndex ?? 0) + 1, book.chapterCount)}/${book.chapterCount}` +
                ` · ${Math.round((progressMap[book.id]?.ratio ?? 0) * 100)}%` +
                (book.warning ? ' · !' : ''),
            ),
            React.createElement(
              'span',
              {
                title: '步骤',
                onClick: (event: React.MouseEvent) => {
                  event.stopPropagation()
                  onOpenChapters(book.id)
                },
                style: { opacity: 0.35, fontSize: 12.5, padding: '0 4px' },
              },
              '≡',
            ),
            React.createElement(
              'span',
              {
                title: '移除',
                onClick: (event: React.MouseEvent) => {
                  event.stopPropagation()
                  onDelete(book.id)
                },
                style: { opacity: 0.28, fontSize: 12.5, padding: '0 4px' },
              },
              '\u2715',
            ),
          ),
        ),

    React.createElement(
      'div',
      { style: { ...LIST_TEXT, opacity: 0.32, marginTop: 14, display: 'flex', gap: 14 } },
      React.createElement(
        'span',
        { style: { cursor: 'pointer' }, onClick: () => inputRef.current?.click() },
        importing ? 'attaching…' : '+ attach file',
      ),
      React.createElement('span', null, '≡ for steps · space page · l close'),
    ),
    React.createElement('input', {
      ref: inputRef,
      type: 'file',
      accept: '.txt,.epub,text/plain,application/epub+zip',
      style: { display: 'none' },
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (file) onImport(file)
        event.target.value = ''
      },
    }),
    error
      ? React.createElement(
          'div',
          { style: { ...LIST_TEXT, color: '#d98d8d', opacity: 0.9, marginTop: 10 } },
          `! ${error}`,
        )
      : null,
    dragging ? footnote('release to attach') : null,
  )
}

/**
 * 一本书的章节目录。
 *
 * 伪装形态：它是「recent tasks」里某个任务展开后的**步骤清单** —— 读过的打 ✓、
 * 当前这条用 ▸ 标出，右边的数字是步骤序号。屏幕上没有"章"这个字，也看不到正文。
 *
 * 打开时会把当前章滚到视野中间：长篇小说动辄几百章，落在第 1 章等于每次都要往下滚三百行。
 */
function ChapterList({
  book,
  chapters,
  currentIndex,
  region,
  onPick,
  onBack,
}: {
  book: BookRecord
  chapters: Array<{ index: number; title: string }> | undefined
  currentIndex: number
  region: Rect | null
  onPick: (index: number) => void
  onBack: () => void
}): React.ReactElement {
  const boxRef = React.useRef<HTMLDivElement | null>(null)
  const currentRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const box = boxRef.current
    const row = currentRef.current
    if (!box || !row) return
    // 手算滚动量而不用 scrollIntoView：后者会连带滚动祖先滚动容器（也就是 DSH 的会话区），
    // 关掉目录后真实界面会莫名其妙停在别处。
    const delta = row.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.scrollTop += delta - box.clientHeight / 2 + row.offsetHeight / 2
  }, [chapters])

  return React.createElement(
    'div',
    {
      ref: boxRef,
      style: { ...ROOT_BASE, ...regionStyle(region), padding: '24px 32px 32px' },
      'data-stealth-reader': 'chapters',
    },
    React.createElement(
      'div',
      { style: { ...LIST_TEXT, opacity: 0.5, marginBottom: 10, display: 'flex', gap: 12 } },
      React.createElement(
        'span',
        {
          style: {
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        book.title,
      ),
      React.createElement(
        'span',
        { style: { opacity: 0.7 } },
        `${Math.min(currentIndex + 1, book.chapterCount)}/${book.chapterCount}`,
      ),
    ),
    chapters === undefined
      ? footnote('loading steps…')
      : chapters.map((chapter) =>
          React.createElement(
            'div',
            {
              key: chapter.index,
              ref: chapter.index === currentIndex ? currentRef : undefined,
              style: {
                ...LIST_ROW,
                background:
                  chapter.index === currentIndex ? 'rgba(128,128,150,0.14)' : 'transparent',
              },
              onClick: () => onPick(chapter.index),
            },
            React.createElement(
              'span',
              { style: { opacity: 0.5 } },
              chapter.index < currentIndex ? '✓' : chapter.index === currentIndex ? '▸' : '·',
            ),
            React.createElement(
              'span',
              {
                style: {
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              chapter.title,
            ),
            React.createElement(
              'span',
              { style: { opacity: 0.4, fontSize: 12.5 } },
              `${chapter.index + 1}`,
            ),
          ),
        ),
    React.createElement(
      'div',
      { style: { ...LIST_TEXT, opacity: 0.32, marginTop: 14, display: 'flex', gap: 14 } },
      React.createElement('span', { style: { cursor: 'pointer' }, onClick: onBack }, '← back'),
      React.createElement('span', null, 'space page · l close'),
    ),
  )
}

/**
 * 书架上盖着哪一层列表；`null` = 没有列表，正在读正文。
 *
 * 用一个互斥的状态，而不是"书架开着吗 + 章节目录开着吗"两个布尔量：这两个界面不可能
 * 同时成立，用两个标志迟早会构造出"两个都开着"这种没有意义的状态。
 */
type ListView = { kind: 'books' } | { kind: 'chapters'; book: BookRecord } | null

// ------------------------------------------------------------------ 对外

export interface StreamViewProps {
  /** 真实会话行的来源（进入时快照一次）。 */
  dialogueSource: () => readonly DialogueLine[]
}

/**
 * 内容流的入口组件。
 *
 * 有书就直接续读上次那本（命令 `/stealth` 的语义），没书则显示任务列表。
 */
export function StreamView({ dialogueSource }: StreamViewProps): React.ReactElement {
  const app = useApp()
  const [books, setBooks] = React.useState<BookRecord[] | undefined>(undefined)
  const [progressMap, setProgressMap] = React.useState<Record<string, ProgressRecord | undefined>>({})
  const [open, setOpen] = React.useState<OpenState | null>(null)
  const [listView, setListView] = React.useState<ListView>(null)
  const [chapterTitles, setChapterTitles] = React.useState<
    Array<{ index: number; title: string }> | undefined
  >(undefined)
  const [importing, setImporting] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [forceTop, setForceTop] = React.useState(false)
  const region = useMainRegion()

  // 列表是否**在屏幕上**。没有打开的书时，下面的 `if (!open)` 让书架成为覆盖层的
  // 全部内容 —— 那同样是一个要用鼠标点的界面，所以必须算进来。
  const listVisible = isListSurface({ bookOpened: open !== null, listOpen: listView !== null })

  // 把它**发布**到 store：全局鼠标处理器（index.tsx 的 `onPointer`）读不到组件 state，
  // 却必须在列表在屏幕上时放过鼠标（ADR-0007）。
  //
  // 用 effect 而不是在每个 `setListView` 调用点手写同步：漏掉任何一处，
  // 就会出现"列表明明开着、鼠标一动却照样收场"的幽灵 bug。
  // 卸载时清掉 —— 覆盖层关闭会卸载本组件，不清的话下次进内容流会带着上次的列表状态。
  React.useEffect(() => {
    store.setListVisible(listVisible)
    return () => store.setListVisible(false)
  }, [listVisible])

  // 真实会话内容**进入时快照一次**。
  //
  // 用 ref 而不是 useMemo：useMemo 在依赖变化时会重算，而这里要的是"真的只取一次"。
  // 一旦重算，整股流会重建、逐字输出的进度会被重置 —— 表现出来就是"打字机效果没了，
  // 内容反复从头开始"。快照同时让伪装内容不跟着真实操作跳动。
  const dialogueRef = React.useRef<readonly DialogueLine[] | null>(null)
  if (dialogueRef.current === null) {
    try {
      dialogueRef.current = dialogueSource()
    } catch {
      dialogueRef.current = []
    }
  }
  const dialogue = dialogueRef.current

  const refresh = React.useCallback(async () => {
    try {
      const [rows, progress] = await Promise.all([app.listBooks(), app.listProgress()])
      setBooks(rows)
      setProgressMap(progress)
      return rows
    } catch (cause) {
      setError(`读取本地书库失败：${(cause as Error)?.message ?? cause}`)
      setBooks([])
      return []
    }
  }, [app])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const openBook = React.useCallback(
    async (
      bookId: string,
      rows?: BookRecord[],
      progress?: Record<string, ProgressRecord | undefined>,
    ) => {
      const all = rows ?? books ?? []
      const book = all.find((row) => row.id === bookId)
      if (!book) return

      const record = (progress ?? progressMap)[bookId]
      const chapterIndex = Math.min(Math.max(record?.chapterIndex ?? 0, 0), book.chapterCount - 1)
      // 续读**永远**从记录处继续，包括"整章已读完"的情况。
      //
      // 这里曾经是 `setForceTop(ratio >= 0.99)`，本意是"读完了别停在全文末尾"。
      // 但当时的 `ratio` 记的是滚动位置，而自动跟随让视口恒在底部 —— 于是只要读过
      // 一小段，`ratio` 就已经是 1，续读被判定成"读完了"，每次打开都被丢回本章开头。
      // 那就是用户报的"进度没留住"。现在 `ratio` 是真的阅读进度，读完了就是读完了：
      // 停在章末附近（往前退几行）正好是"在上次关闭的两三行前开始"，
      // 想接着读按 → 翻下一章即可。
      setForceTop(false)
      setListView(null)

      setOpen({ book, chapterIndex, chapter: undefined, loading: true })
      const chapter = await app.getChapter(book.id, chapterIndex)
      setOpen({ book, chapterIndex, chapter, loading: false })
    },
    [app, books, progressMap],
  )

  // 首次拿到书库后：有书就直接续读最近读的那本（命令入口的语义）。
  const autoOpenedRef = React.useRef(false)
  React.useEffect(() => {
    if (autoOpenedRef.current || books === undefined || books.length === 0) return
    autoOpenedRef.current = true

    const recent = [...books].sort(
      (left, right) =>
        (progressMap[right.id]?.updatedAt ?? 0) - (progressMap[left.id]?.updatedAt ?? 0),
    )[0]
    if (recent) void openBook(recent.id)
  }, [books, progressMap, openBook])

  const goToChapter = React.useCallback(
    async (book: BookRecord, chapterIndex: number) => {
      const clamped = Math.min(Math.max(chapterIndex, 0), book.chapterCount - 1)
      setForceTop(true)
      setOpen({ book, chapterIndex: clamped, chapter: undefined, loading: true })
      const chapter = await app.getChapter(book.id, clamped)
      setOpen({ book, chapterIndex: clamped, chapter, loading: false })
    },
    [app],
  )

  // 打开某本书的步骤清单。先清掉上一本的标题，否则切换书时会闪出别的书的章节。
  const openChapters = React.useCallback((book: BookRecord) => {
    setChapterTitles(undefined)
    setListView({ kind: 'chapters', book })
  }, [])

  const pickChapter = React.useCallback(
    (book: BookRecord, index: number) => {
      setListView(null)
      void goToChapter(book, index)
    },
    [goToChapter],
  )

  const chapterBook = listView?.kind === 'chapters' ? listView.book : undefined

  // 章节目录打开时才去读标题：几百章的书不该在打开书架时就被全量捞出来。
  React.useEffect(() => {
    if (!chapterBook) return
    let cancelled = false
    void app.listChapterTitles(chapterBook.id).then(
      (rows) => {
        if (!cancelled) setChapterTitles(rows)
      },
      () => {
        if (!cancelled) setChapterTitles([])
      },
    )
    return () => {
      cancelled = true
    }
  }, [app, chapterBook])

  const handleImport = React.useCallback(
    async (file: File) => {
      setImporting(true)
      setError(undefined)
      try {
        const result = await app.importFile(file)
        if (!result.ok) {
          setError(`${file.name}：${result.error ?? '导入失败'}`)
          return
        }
        const rows = await refresh()
        setListView({ kind: 'books' })
        const only = rows.length === 1 ? rows[0] : undefined
        if (only) void openBook(only.id, rows)
      } finally {
        setImporting(false)
      }
    },
    [app, openBook, refresh],
  )

  const handleDelete = React.useCallback(
    async (bookId: string) => {
      await app.deleteBook(bookId)
      setOpen((current) => (current?.book.id === bookId ? null : current))
      await refresh()
    },
    [app, refresh],
  )

  const bookShelf = React.createElement(TaskList, {
    books: books ?? [],
    progressMap,
    importing,
    error,
    activeId: open?.book.id,
    region,
    onImport: (file) => void handleImport(file),
    onOpen: (bookId) => void openBook(bookId),
    onOpenChapters: (bookId) => {
      const book = (books ?? []).find((row) => row.id === bookId)
      if (book) openChapters(book)
    },
    onDelete: (bookId) => void handleDelete(bookId),
    onClose: () => {
      // 没有正在读的书时，"关闭列表"只能是回到真实界面。
      if (open) setListView(null)
      else store.close()
    },
  })

  const chapterList = chapterBook
    ? React.createElement(ChapterList, {
        book: chapterBook,
        chapters: chapterTitles,
        // 正在读的那本以内存里的章节为准（进度是切章时才落库的），其余看落库的进度。
        currentIndex:
          open?.book.id === chapterBook.id
            ? open.chapterIndex
            : (progressMap[chapterBook.id]?.chapterIndex ?? 0),
        region,
        onPick: (index) => pickChapter(chapterBook, index),
        onBack: () => setListView({ kind: 'books' }),
      })
    : null

  // 没有打开的书：列表就是全部内容（书架，或某本书的步骤清单）。
  if (!open) return chapterList ?? bookShelf

  // 有打开的书：内容流**常驻**，列表盖在它上面。
  //
  // 关键在"常驻"。如果打开列表就卸载内容流，回来时组件会重新挂载、按 `progressMap`
  // 这个**挂载时的快照**重新定位 —— 刚刚读的进度会整体倒退回去。
  // 让内容流活着，续读定位就只发生一次（`locatedRef`），回来时也不会闪一下重新加载。
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(StreamBody, {
      book: open.book,
      chapterIndex: open.chapterIndex,
      chapter: open.chapter,
      loading: open.loading,
      forceTop,
      initialRatio:
        progressMap[open.book.id]?.chapterIndex === open.chapterIndex
          ? (progressMap[open.book.id]?.ratio ?? 0)
          : 0,
      covered: listView !== null,
      dialogue,
      region,
      app,
      onChapter: (index) => void goToChapter(open.book, index),
      onToggleList: () => {
        setListView((value) => (value ? null : { kind: 'books' }))
        // 书架要显示刚读到的进度，顺便把挂载时的旧快照刷新掉。
        void refresh()
      },
    }),
    listView === null ? null : (chapterList ?? bookShelf),
  )
}
