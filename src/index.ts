// dsh-stealth-reader —— 宿主半（Node 侧）。
//
// 职责边界（见 docs/adr/0001-client-only-plugin.md）：本插件是**纯客户端插件**。
// 宿主半什么都不做 —— 它存在的唯一理由是 DSH 需要一个可加载的入口，
// 而客户端 bundle 与它同包分发。
//
// 这里曾经注册过一组 settings（hotkey / fontSize / lineHeight / theme /
// useExcerpts / disguiseLines），但客户端从来没有读过其中任何一个：它们是
// ADR-0005（只保留伪装阅读）之后残留下来的空壳。**一个没人读的设置面板比没有更糟** ——
// 它会让改过它的人以为生效了。
//
// 真正的手感旋钮都是源码常量，各自的位置：
//   - 逐字输出的节奏 → src/client/typing.ts 的 `DEFAULT_TEMPO`
//   - 快捷键         → src/client/keys.ts 的 `DEFAULT_SHORTCUT`
//   - 上下键滚几行   → src/client/scroll.ts 的 `LINES_PER_ARROW`
//   - 工作痕迹占比   → src/client/stream.ts 的 `DEFAULT_TOOL_OUTPUT_RATIO`

export const name = 'dsh-stealth-reader'
export const inject: string[] = []

export function apply(): void {
  // 有意为空：纯客户端插件，宿主侧没有要做的事。见文件头。
}
