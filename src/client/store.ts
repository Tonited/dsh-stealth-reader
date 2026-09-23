// 界面状态仓库（两态机）。
//
// 两个互斥状态见 CONTEXT.md：`closed`（DSH 真实界面）/ `stream`（内容流）。
// 用极小的外部 store 而不是 React Context，是因为切换要能被**任何地方**触发：
// 全局快捷键、客户端命令、鼠标移动，都只调用 `toggle()` / `close()`。

export type Mode = 'closed' | 'stream'

type Listener = (mode: Mode) => void

/**
 * 状态槽位。
 *
 * 状态刻意放在 `globalThis` 的固定槽位上，而不是模块级变量 —— 客户端插件会被 HMR
 * **热替换**：替换后模块级变量是全新的一份，而 window 上的事件监听器（见 bindings.ts）
 * 可能仍属于旧实例。若状态是模块私有的，按快捷键只会改到"没人监听的那一份"，
 * 界面毫无反应。
 *
 * 这不是理论风险：实现阅读壳时就是这样丢掉快捷键的 —— 热替换后监听器还在、模式也在变，
 * 只是变在了另一个宇宙。
 */
const SLOT = '__STEALTH_READER_STORE__'

interface StoreState {
  mode: Mode
  /** 书单开合；见下方 `setListOpen` 的说明。 */
  listOpen: boolean
  listeners: Set<Listener>
}

function slot(): Record<string, StoreState | undefined> {
  return globalThis as unknown as Record<string, StoreState | undefined>
}

function state(): StoreState {
  return (slot()[SLOT] ??= { mode: 'closed', listOpen: false, listeners: new Set<Listener>() })
}

export function current(): Mode {
  return state().mode
}

function setMode(next: Mode): void {
  const store = state()
  if (next === store.mode) return
  store.mode = next
  // 复制一份再遍历：监听器可能在回调里退订。
  for (const listener of [...store.listeners]) listener(store.mode)
}

/**
 * 快速切换：**按一下就进内容流**。
 *
 * 早先的设计是"按一下先藏起来、再按一下才出正文"，实际用起来很别扭（而且中间那个
 * 状态并没有比"直接回真实界面"更安全）。现在只剩两态，退出交给鼠标 ——
 * 移动 1px 或点击就立刻回到 DSH 真实界面，那本身就是最好的掩护。
 */
export function toggle(): void {
  setMode(current() === 'stream' ? 'closed' : 'stream')
}

/** 进入内容流（命令面板入口用；命令要打字，不存在误触）。 */
export function openStream(): void {
  setMode('stream')
}

/** 回到 DSH 真实界面。 */
export function close(): void {
  setMode('closed')
}

/**
 * 切到指定模式。
 *
 * 给交互裁决层用：`resolveInteraction` 已经算好了目标模式（它要同时考虑"按了什么键"
 * 和"当前在哪个状态"），这里只负责落库，不再重复判断。
 */
export function goTo(next: Mode): void {
  setMode(next)
}

/**
 * 书单（伪装成「最近的任务」）是否盖在内容流上。
 *
 * 为什么这个标志住在 store，而不是只当 `StreamView` 的组件 state：判定"这个鼠标事件
 * 要不要收场"的是挂在 window 上的**全局**处理器（index.tsx 的 `onPointer`），
 * 它读不到 React 组件内部状态。放进 store 还顺带继承了热替换安全性 —— 槽位在
 * globalThis 上，热替换后新旧模块看到的是同一份（同 `SLOT` 的注释）。
 *
 * 刻意**不**接进 subscribe 通知链：只有交互裁决会读它，改它不该引起任何重渲染。
 * 书单本身的重渲染由 `StreamView` 自己的 state 驱动。
 */
export function setListOpen(open: boolean): void {
  state().listOpen = open === true
}

export function isListOpen(): boolean {
  return state().listOpen === true
}

/** 订阅模式变化；调用时立即用当前值回调一次。 */
export function subscribe(listener: Listener): () => void {
  const store = state()
  store.listeners.add(listener)
  listener(store.mode)
  return () => {
    store.listeners.delete(listener)
  }
}

/** 仅测试用：重置状态（避免用例之间互相影响）。 */
export function resetForTest(): void {
  slot()[SLOT] = { mode: 'closed', listOpen: false, listeners: new Set<Listener>() }
}
