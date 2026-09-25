// dsh-stealth-reader —— 浏览器半（两态机 + 快捷键 + 伪装壳）。
//
// 界面状态见 CONTEXT.md：`closed`（DSH 真实界面）与 `stream`（伪装内容流）两态。
// 不变式（SPEC §3）：
//   1. 任何状态下按快捷键都进入隐藏态
//   2. 隐藏态下任何交互都退回 DSH 真实界面
//   3. 阅读进度在状态切换中永不丢失（切换只改显示层）
//   4. 隐藏态永不白屏
import * as React from 'react'

import { bindHandlers, globalSlots } from './bindings.ts'
import { dialogueFromEntries, type DialogueLine } from './dialogue.ts'
import { resolveInteraction } from './keys.ts'
import { AppProvider, StreamView } from './reading.tsx'
import { Overlay } from './modes.tsx'
import { currentSessionEntries, noteSessionId, notedSessionId } from './readers.ts'
import * as storage from './storage.ts'
import { importFile as runImport } from './library.ts'
import * as store from './store.ts'

const NAME = 'dsh-stealth-reader'
const COMMAND_NAME = 'stealth'

/** 服务注册表：apply 时填入，组件运行时读取。 */
interface Registry {
  sessions?: any
  commandUi?: any
  commandError?: string
  /** 是否处理键盘事件（探测/调试时临时关闭）。 */
  handleKeys?: boolean
  /** 用于测试的事件分派记录。 */
  log?: string[]
}

function registry(): Registry {
  return ((globalThis as any).__STEALTH_READER__STATE__ ??= {})
}

function log(entry: string): void {
  const state = registry()
  ;(state.log ??= []).push(entry)
}

// ------------------------------------------------------------------ 事件判定

// ------------------------------------------------------------------ DOM 接线

function onKeyDown(event: KeyboardEvent): void {
  const mode = store.current()
  const next = resolveInteraction(mode, event)
  // null = 交给别人：closed 下不管，reading 下交给阅读操作（翻页/跳章）。
  if (next === null) return

  event.preventDefault()
  event.stopPropagation()
  log(`key:${next}`)
  store.goTo(next)
}

/**
 * 指针类事件（移动 / 按下 / 滚轮 / 触摸）。
 *
 * 刻意**不** preventDefault：那会破坏页面正常的滚动与选择，而这里唯一要做的事
 * 就是"在内容流里把界面收回去"。滚轮不触发收场 —— 它是用来滚动阅读的。
 *
 * 书单开着时整个收场逻辑短路（见 keys.ts 的 `InteractionOptions`）：书单要靠鼠标点，
 * 所以这些事件必须原样落到书单自己身上。
 */
function onPointer(event: Event): void {
  const mode = store.current()
  const next = resolveInteraction(mode, event, { listVisible: store.isListVisible() })
  if (next === null) return
  log(`pointer:${next}`)
  store.goTo(next)
}

function bindKeys(): void {
  const state = registry()
  const enabled = state.handleKeys !== false
  // 绑定细节与"为什么只是更新槽位而不是重新 addEventListener"见 bindings.ts。
  const bound = bindHandlers(window, globalSlots(), {
    keydown: enabled ? onKeyDown : null,
    pointer: enabled ? onPointer : null,
  })
  log(bound ? 'keys:bound' : 'keys:updated')
}

// ------------------------------------------------------------------ 会话数据
//
// 「当前会话是谁」这个问题在 0.1.7 里**没有现成答案**：
//   - 旧写法 `sessions.list.getSnapshot().current` 在 0.1.7 永远是 undefined
//     （`SessionListState` 只有 ids/byId/phase/projectionsBySession，
//      `dsh-api-session-controller/lib/types/client/sessions/service.d.ts:43-52`），
//     于是静默退化成"列表首行"——而首行未必是当前会话；
//   - 拿不到 binding 就取不到事件窗口，伪装内容会退化成硬编码模板（违反 ADR-0002）。
// 所以 id 由下面的 session 作用域探针提供，兜底顺序与实现全部在 readers.ts 里
// （`sessionCandidates` / `currentSessionEntries`，纯函数、可单测）。

// ------------------------------------------------------------------ 插件

function apply(ctx: any): void {
  const state = registry()
  state.sessions = ctx.sessions
  state.handleKeys = state.handleKeys ?? true

  // H1：客户端命令作为兜底入口（无宿主描述符，行为全在客户端）。
  //
  // 必须是 `openStream()` 而**不是** `toggle()`：命令的语义是"打开隐蔽阅读器"。
  // 用 toggle 会这样坏掉 —— 从内容流里唤出命令面板本身要先动键盘，而这一下
  // 恰恰会把阅读器关掉，于是"命令面板里能进入阅读器"这条验收项名存实亡。
  // 命令是"进入"的语义，开关是快捷键的语义。
  try {
    ctx.commandUi.register({
      name: COMMAND_NAME,
      description: () => '打开隐蔽阅读器',
      available: () => true,
      ui: { kind: 'action', run: () => store.openStream() },
    })
    state.commandUi = ctx.commandUi
    console.info(`[${NAME}] 已注册客户端命令 /${COMMAND_NAME}`)
  } catch (cause) {
    state.commandError = (cause as Error)?.message ?? String(cause)
    console.warn(`[${NAME}] 客户端命令注册失败`, cause)
  }

  bindKeys()

  const app = createApp()

  // 真实会话行的来源。引用必须**稳定**，否则 StreamView 里的 useMemo 每次渲染都会重算，
  // 而"进入内容流时快照一次"这条约定（ADR-0002）就废了 —— 更糟的是，那会让伪装内容
  // 跟着真实操作跳动，反而更容易露馅。
  const readDialogue = (): DialogueLine[] => {
    const real = dialogueFromEntries(currentSessionEntries(state.sessions, notedSessionId()))
    if (real.length > 0) return real

    // 没有真实会话可借用时退回通用模板：屏幕上绝不能空着（空比假更可疑）。
    return DEFAULT_TEMPLATES.map((text) => ({ role: 'assistant' as const, text }))
  }

  ctx.slots.inject('shell.overlay', () => {
    const dispose = ctx.slots.register(
      { name: 'shell.overlay', id: 'stealth-reader', order: 60, label: () => NAME },
      () =>
        React.createElement(Overlay, {
          stream: React.createElement(
            AppProvider,
            { api: app },
            React.createElement(StreamView, { dialogueSource: readDialogue }),
            null,
          ),
        }),
    )
    return typeof dispose === 'function' ? dispose : () => dispose?.dispose?.()
  })

  // 定位探针：伪装层只盖**右侧主区**，左侧栏要原样留着（那是"人在正常工作"最好的掩护）。
  // 而侧栏宽度在 DSH 里可拖拽，所以只能运行时测量 —— 这个零尺寸元素的作用就是提供
  // 一个"会话区内部"的 DOM 锚点，让 reading.tsx 从它向上量出主区矩形（见 region.ts）。
  //
  // 注意不能用 `display: none`：那样元素没有布局盒，祖先链虽在却量不出有效矩形。
  //
  // 它顺带承担第二件事：**报告当前会话 id**。这个槽位是 session 作用域
  // （`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:213-218` 的
  // `'conversation.input.dock': { kind: 'list'; scope: 'session' }`），
  // 而 session 作用域的组件会拿到框架合成的标准 prop `sessionId`
  // （赋值来源 `dsh-client-ui-session/lib/client.js:124,128`，展开点
  // `dsh-client-ui-renderer/lib/client.js:715-717,771-776`），
  // 就是 0.1.7 里唯一"框架亲口说的当前会话"（旧版靠 `state.current`，已不存在）。
  ctx.slots.inject('conversation.input.dock', () => {
    const dispose = ctx.slots.register(
      { name: 'conversation.input.dock', id: 'stealth-reader-probe', order: 100 },
      (props: any) => {
        // 渲染期写入：只有真正在屏幕上的那个会话会走到这里，换会话时 props 变、值跟着变。
        noteSessionId(props?.sessionId)
        return React.createElement('div', {
          'data-stealth-reader': 'probe',
          style: {
            position: 'absolute',
            width: 0,
            height: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
          },
        })
      },
    )
    return typeof dispose === 'function' ? dispose : () => dispose?.dispose?.()
  })
}

// ------------------------------------------------------------------ 应用层

let dbPromise: Promise<IDBDatabase> | undefined

/** 懒打开数据库：插件加载时不该做任何 IO。 */
function getDb(): Promise<IDBDatabase> {
  dbPromise ??= storage.openDatabase()
  return dbPromise
}

function createApp() {
  return {
    async listBooks() {
      return storage.listBooks(await getDb())
    },
    async listProgress() {
      const db = await getDb()
      const books = await storage.listBooks(db)
      const found = await Promise.all(
        books.map(async (book) => ({ id: book.id, record: await storage.getProgress(db, book.id) })),
      )
      const map: Record<string, storage.ProgressRecord> = {}
      for (const entry of found) {
        if (entry.record) map[entry.id] = entry.record
      }
      return map
    },
    async importFile(file: File) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const result = await runImport(await getDb(), file.name, bytes)
        if (result.ok) {
          console.info(
            `[${NAME}] 已导入《${result.book.title}》：${result.book.chapterCount} 章` +
              (result.book.warning ? `（${result.book.warning}）` : ''),
          )
          return { ok: true }
        }
        console.warn(`[${NAME}] 导入失败：${result.error}`)
        return { ok: false, error: result.error }
      } catch (cause) {
        const message = (cause as Error)?.message ?? String(cause)
        console.warn(`[${NAME}] 导入异常`, cause)
        return { ok: false, error: message }
      }
    },
    async deleteBook(bookId: string) {
      await storage.deleteBook(await getDb(), bookId)
    },
    async getChapter(bookId: string, index: number) {
      return storage.getChapter(await getDb(), bookId, index)
    },
    async listChapterTitles(bookId: string) {
      return storage.listChapterTitles(await getDb(), bookId)
    },
    async putProgress(progress: storage.ProgressRecord) {
      await storage.putProgress(await getDb(), progress)
    },
  }
}

/**
 * 没有真实会话可借用时的通用工作痕迹行。
 *
 * 退路存在的理由：屏幕上绝不能空着 —— 一片空白比一段假日志更可疑。
 * 这些文本是硬编码常量，没有设置项可以覆盖（见 src/index.ts 文件头）。
 */
const DEFAULT_TEMPLATES = [
  'Analyzing repository structure…',
  'Reading 42 files · 12,480 lines',
  'Running test suite…',
  'Applying patch to 3 files',
  'Generating diff…',
]

// 注意：这里刻意**不用** ESM `export`。
// 客户端产物由 esbuild 打进 ModuleLoader 工厂，而 esbuild 在 CJS 输出下会消除
// 未声明为入口导出的符号（实测 exports.apply 直接消失 → 插件加载成功但什么都没注册）。
// 因此把插件契约挂到显式全局对象上，由 build.mjs 的 wrapper 取出来返回。
;(globalThis as any).__STEALTH_READER__ = {
  name: NAME,
  inject: ['slots', 'commandUi', 'sessions'],
  apply,
}

// 让本文件成为模块（esbuild 打包时不会做跨文件全局消除），无需真实导出。
export {}
