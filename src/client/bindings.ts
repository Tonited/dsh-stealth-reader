// 全局事件绑定（纯逻辑 + 依赖注入，可单测）。
//
// 为什么需要单独一层：DSH 客户端插件会被 HMR **热替换**，而 window 上的监听器
// **无法被新模块移除**（旧函数引用在新实例里根本拿不到）。于是只有两种朴素做法，且都是错的：
//
//   a. 每次 apply 都 `addEventListener` → 监听器越积越多，同一次按键切换好几轮；
//   b. 用 `keysBound` 标志跳过重复绑定 → 热替换后留在 window 上的仍是**旧**处理逻辑，
//      旧逻辑读的是旧模块的 store 实例，表现为"快捷键彻底没反应"。
//
// 做法：window 上只绑一次，绑的是**稳定的转发器**；转发器不持有任何业务状态，
// 每次调用都从 globalThis 槽位里取"最新的"处理函数。新代码只需覆盖槽位，
// 判定逻辑（包括以后从设置里读出的自定义快捷键）立即生效：既不累积监听器，
// 也不存在新旧状态分叉。

/** 最新键盘处理函数所在的全局槽位。 */
export const KEY_SLOT = '__STEALTH_READER_KEY_HANDLER__'
/** 最新指针/滚轮处理函数所在的全局槽位。 */
export const POINTER_SLOT = '__STEALTH_READER_POINTER_HANDLER__'
/** "转发器已绑到 target" 的标记槽位。 */
export const BOUND_SLOT = '__STEALTH_READER_LISTENERS_BOUND__'

/** 槽位视图。参数化是为了让测试传入自己的对象，而不是污染真实 globalThis。 */
export type Slots = Record<string, any>

/** 事件目标的最小接口（window 满足，测试里用假对象）。 */
export interface BindingTarget {
  addEventListener(type: string, handler: any, capture?: boolean): void
}

export interface Handlers {
  /** 传 null/undefined 表示"暂时不处理键盘"（调试开关），转发器仍在但不做事。 */
  keydown?: ((event: any) => void) | null
  /** 指针类事件（移动/按下/滚轮/触摸）。收场判定需要 `event.type`，所以必须把事件传进去。 */
  pointer?: ((event: any) => void) | null
}

/** 真实 globalThis 的槽位视图。 */
export function globalSlots(): Slots {
  return globalThis as unknown as Slots
}

/** 稳定的键盘转发器：永远转发到槽位里最新的处理函数。 */
export function forwardKey(slots: Slots, event: any): void {
  slots[KEY_SLOT]?.(event)
}

/** 稳定的指针转发器。 */
export function forwardPointer(slots: Slots, event: any): void {
  slots[POINTER_SLOT]?.(event)
}

/**
 * 更新处理函数，并（仅首次）把转发器绑到 target。
 *
 * @returns 本次是否真的执行了绑定。`false` 表示转发器早已就位，只更新了槽位 ——
 *          这正是热替换后期望的结果。
 */
export function bindHandlers(target: BindingTarget, slots: Slots, handlers: Handlers): boolean {
  slots[KEY_SLOT] = handlers.keydown ?? undefined
  slots[POINTER_SLOT] = handlers.pointer ?? undefined

  if (slots[BOUND_SLOT]) return false
  slots[BOUND_SLOT] = true

  // capture 阶段：避免被组件级 stopPropagation 截断（DSH 自带的客户端插件也是这么做的）。
  target.addEventListener('keydown', (event: any) => forwardKey(slots, event), true)
  const pointer = (event: any) => forwardPointer(slots, event)
  // mousemove 也在列：内容流下"鼠标一动就恢复"是本项目的主要退出方式。
  // 它触发得极其频繁，所以处理器第一件事就是读模式并早退（见 index.tsx 的 onPointer）。
  target.addEventListener('mousemove', pointer, true)
  target.addEventListener('pointerdown', pointer, true)
  target.addEventListener('wheel', pointer, true)
  target.addEventListener('touchstart', pointer, true)
  return true
}

/** 仅测试用：清除"已绑定"标记（真实解绑需要持有当初绑定的函数引用，故意不提供）。 */
export function resetBindingForTest(slots: Slots): void {
  delete slots[BOUND_SLOT]
  delete slots[KEY_SLOT]
  delete slots[POINTER_SLOT]
}
