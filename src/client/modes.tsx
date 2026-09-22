// 两态界面状态的渲染（内容流 / 真实界面）。
//
// `closed` 不由这里渲染 —— 那个状态就是"什么都不显示"，让 DSH 真实界面露出来。
// 内容流本身在 reading.tsx（它要量右侧主区、要流式输出、要处理阅读操作）。
import * as React from 'react'

import * as store from './store.ts'

export interface OverlayProps {
  /** 内容流（由 reading.tsx 提供）。 */
  stream: React.ReactNode
}

/**
 * 全帧浮动层：`closed` 时渲染 null，`stream` 时渲染内容流。
 *
 * 注意"全帧"指的是这个 slot 所在层级，不是覆盖范围 —— 内容流自己会用
 * `regionStyle` 把可视区域收到右侧主区上（见 region.ts）。
 */
export function Overlay({ stream }: OverlayProps): React.ReactElement | null {
  const [mode, setMode] = React.useState<store.Mode>(store.current)

  React.useEffect(() => store.subscribe(setMode), [])

  if (mode === 'closed') return null
  return React.createElement(React.Fragment, null, stream)
}
