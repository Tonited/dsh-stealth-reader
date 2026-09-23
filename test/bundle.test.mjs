// 产物契约测试：不依赖 DSH，直接模拟宿主侧的 ModuleLoader 环境执行 lib/client.js。
//
// 这层测试存在的理由：客户端 bundle 的失败模式是"加载成功但什么都没注册"
// （例如 require 取不到导致 React 为 undefined、或插件契约没挂上），
// 在浏览器里表现为"界面毫无变化"，极难定位。这里把它变成一条断言。
//
// 注意：本文件不 import src/client/index.tsx，因为它依赖浏览器/React 运行时；
// 这里只验证**构建产物**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/**
 * 在沙箱里 apply 一次插件，返回同一个沙箱（插件把状态挂在**沙箱的** globalThis 上，
 * 不是宿主的 Node globalThis）。
 */
function applyInSandbox(plugin, sandbox) {
  sandbox.__STEALTH_READER__STATE__ = {}
  const guarded = createGuardedContext(plugin)
  plugin.apply(guarded.ctx)
  return { sandbox, guarded }
}

async function loadClientBundle() {
  const source = await readFile(resolve(ROOT, 'lib/client.js'), 'utf8')

  let registered = null
  const pluginResolutions = []
  const moduleCache = new Map()

  // 模拟宿主的 require：只允许基线模块，其余记下来供断言。
  const hostRequire = (specifier) => {
    pluginResolutions.push(specifier)
    if (moduleCache.has(specifier)) return moduleCache.get(specifier)
    if (specifier === 'react') {
      const react = require('react')
      moduleCache.set(specifier, react)
      return react
    }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      // 复用 DSH 自己的组件（DisclosureRow / StateDot / MarkdownText）能让伪装层
      // 像素级一致；这里只提供最小替身，用于断言"产物确实会去 require 它"。
      const primitives = {
        DisclosureRow: () => null,
        StateDot: () => null,
        MarkdownText: () => null,
        IconChevronRightOutline14: () => null,
      }
      moduleCache.set(specifier, primitives)
      return primitives
    }
    throw new Error(`module table miss: ${specifier}`)
  }

  const sandbox = {
    window: { addEventListener() {}, removeEventListener() {} },
    globalThis: undefined,
    __ModuleLoader__: {
      load(entry) {
        assert.equal(entry.id, 'dsh-stealth-reader', '插件 id 必须与 cordis.patch.yml 一致')
        assert.equal(typeof entry.factory, 'function', 'factory 必须是函数')
        registered = entry.factory(hostRequire)
      },
    },
  }
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = sandbox.__ModuleLoader__

  const { runInNewContext } = await import('node:vm')
  runInNewContext(source, sandbox, { filename: 'lib/client.js' })

  // 注意：插件写在沙箱的 globalThis 上，不是宿主的 Node globalThis —— 必须把沙箱本身返回出去。
  return { plugin: registered, pluginResolutions, sandbox }
}

test('客户端产物注册到 ModuleLoader 并发布插件契约', async () => {
  const { plugin } = await loadClientBundle()

  assert.ok(plugin, 'bundle 必须调用 window.__ModuleLoader__.load')
  assert.equal(plugin.name, 'dsh-stealth-reader')
  assert.ok(Array.isArray(plugin.inject), 'inject 必须是数组')
  assert.equal(typeof plugin.apply, 'function', 'apply 必须是函数（宿主靠它挂载插件）')

  // 契约里声明的服务必须覆盖 apply 真正读的那几个。
  // 漏声明不会在这里报错，而是在 cordis 里抛
  // `cannot get property "slots" without inject` —— 插件整个加载失败。
  assert.ok(
    plugin.inject.includes('slots'),
    `apply 直接读 ctx.slots，inject 必须声明 'slots'，实际：${JSON.stringify(plugin.inject)}`,
  )
})

test('外部模块通过宿主的 require 解析（react 不是 undefined）', async () => {
  const { pluginResolutions } = await loadClientBundle()

  assert.ok(
    pluginResolutions.includes('react'),
    `bundle 必须向宿主 require("react")，实际请求：${JSON.stringify(pluginResolutions)}`,
  )
})

test('产物通过宿主的 require 取 primitives，而不是自己打包一份', async () => {
  const { pluginResolutions } = await loadClientBundle()
  const source = await readFile(resolve(ROOT, 'lib/client.js'), 'utf8')

  // 惰性加载：只有真去渲染时才会 require，所以这里看产物本身。
  assert.ok(
    source.includes('__require("@deepseek-ai/dsh-client-ui-primitives")'),
    '伪装层要用 DisclosureRow/StateDot/MarkdownText 做到像素级一致，必须走宿主的模块表',
  )
  assert.ok(
    !pluginResolutions.includes('fflate'),
    'fflate 必须打进 bundle（它不是基线模块）',
  )
})

test('primitives 缺失时只是退回自绘，不会把插件拖垮', async () => {
  const source = await readFile(resolve(ROOT, 'lib/client.js'), 'utf8')
  const { runInNewContext } = await import('node:vm')

  let registered = null
  const sandbox = {
    window: { addEventListener() {}, removeEventListener() {} },
    globalThis: undefined,
    __ModuleLoader__: {
      load(entry) {
        registered = entry.factory((specifier) => {
          if (specifier === 'react') return require('react')
          // 唯独 primitives 抛错：模拟宿主模块表里没有它。
          throw new Error(`module table miss: ${specifier}`)
        })
      },
    },
  }
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = sandbox.__ModuleLoader__
  runInNewContext(source, sandbox, { filename: 'lib/client.js' })

  const registrations = []
  const ctx = {
    slots: {
      inject(key, callback) {
        return callback()
      },
      register(options, render) {
        registrations.push({ options, render })
        return () => {}
      },
    },
  }

  assert.doesNotThrow(() => registered.apply(ctx), '缺 primitives 也必须能加载')
  assert.equal(registrations.length, 2, '覆盖层与探针照常注册')

  // 渲染一条工具行也不该炸（走自绘回退分支）。
  const overlay = registrations.find((row) => row.options.name === 'shell.overlay')
  assert.doesNotThrow(() => overlay.render())
})

test('apply 会在 shell.overlay 与定位探针上各注册一条', async () => {
  const { plugin } = await loadClientBundle()

  const registrations = []
  const injections = []
  const ctx = {
    slots: {
      inject(key, callback) {
        injections.push(key)
        return callback()
      },
      register(options, render) {
        registrations.push({ options, render })
        return () => {}
      },
    },
  }

  plugin.apply(ctx)

  assert.deepEqual(
    injections,
    ['shell.overlay', 'conversation.input.dock'],
    '覆盖层挂 shell.overlay；探针必须挂在**会话区内部**，否则量不出右侧主区',
  )
  assert.equal(registrations.length, 2, '应注册恰好两条：覆盖层 + 探针')

  const overlay = registrations.find((row) => row.options.name === 'shell.overlay')
  assert.ok(overlay, '缺少 shell.overlay 条目')
  assert.equal(typeof overlay.options.id, 'string')
  assert.ok(overlay.options.id.length > 0, 'list 型 slot 必须提供 id')
  assert.equal(typeof overlay.render, 'function', '必须提供渲染函数')

  const probe = registrations.find((row) => row.options.name === 'conversation.input.dock')
  assert.ok(probe, '缺少定位探针条目')
  assert.equal(typeof probe.options.id, 'string')
  assert.equal(typeof probe.render, 'function')

  // 探针必须能被测量代码按属性找到（reading.tsx 的 measureMainRegion 依赖它）。
  const probeElement = probe.render()
  assert.equal(probeElement.props['data-stealth-reader'], 'probe')
  assert.notEqual(
    probeElement.props.style.display,
    'none',
    '探针不能用 display:none —— 那样没有布局盒，祖先链量不出有效矩形',
  )
})

/**
 * 模拟 cordis 的服务闸，并校验它与插件契约一致。
 *
 * 为什么需要这层：真实故障里 `apply` 第一句就是 `ctx.slots.inject(...)`，而契约写成
 * `inject: []`，cordis 直接抛 `cannot get property "slots" without inject`
 * （@deepseek-ai/cordis/lib/index.js:675），整个插件加载失败。
 * 下面的"手搓 ctx"测试恰好绕过了这道闸，所以全绿也没拦住 —— 这里把它补回来。
 */
function createGuardedContext(plugin) {
  const declared = new Set(plugin.inject ?? [])
  const accessed = new Set()
  const commands = []

  const slots = {
    inject(key, callback) {
      return callback()
    },
    register() {
      return () => {}
    },
  }

  const commandUi = {
    register(contribution) {
      commands.push(contribution)
      return () => {}
    },
    decorate() {
      return () => {}
    },
  }

  // 只提供契约声明所需的最小面；apply 一旦用了别的服务就会撞上服务闸。
  const sessions = { list: { get: () => ({ ids: [], byId: {}, phase: 'ready' }) } }
  const services = { slots, commandUi, sessions }

  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop === 'then') return undefined
        accessed.add(prop)
        if (!declared.has(prop)) {
          const error = new Error(`cannot get property "${prop}" without inject`)
          error.code = 'DSH_MISSING_INJECT'
          throw error
        }
        return services[prop]
      },
    },
  )

  return { ctx, accessed, commands, services }
}

test('apply 只访问契约里声明的服务（cordis 服务闸）', async () => {
  const { plugin } = await loadClientBundle()

  const guarded = createGuardedContext(plugin)
  try {
    plugin.apply(guarded.ctx)
  } catch (error) {
    assert.fail(
      `apply 访问了未在 inject 里声明的服务：${error.message}\n` +
        `契约 inject = ${JSON.stringify(plugin.inject)}\n` +
        `修法：把该服务名加进客户端契约的 inject 数组（注意：package.json 的 dsh.client.inject ` +
        `填的是包名，两者语义不同）。`,
    )
  }
})

test('H1：apply 注册一条纯客户端 action 命令（兜底入口）', async () => {
  const { plugin, sandbox } = await loadClientBundle()
  const { guarded } = applyInSandbox(plugin, sandbox)

  assert.equal(guarded.commands.length, 1, '应恰好注册一条客户端命令')
  const [command] = guarded.commands
  assert.equal(typeof command.name, 'string')
  assert.ok(command.name.length > 0, '命令名不能为空')
  assert.ok(!command.name.startsWith('/'), '命令名不带前导斜杠（按契约要求）')
  assert.equal(typeof command.description, 'function', 'description 是"请求候选项时才求值"的函数')
  assert.equal(typeof command.available, 'function', 'available 是每次候选都重新调用的过滤器')
  assert.equal(command.ui?.kind, 'action', '切换阅读器不需要参数，用 action 而非 popupSelect')
  assert.equal(typeof command.ui.run, 'function', 'action 必须提供 run(session)')
})

test('服务闸本身有效（守卫不是摆设）', async () => {
  const { plugin } = await loadClientBundle()
  const { ctx } = createGuardedContext(plugin)

  assert.throws(
    () => ctx.cordisRun,
    (error) => error.code === 'DSH_MISSING_INJECT',
    '守卫 ctx 必须拒绝未声明的服务访问，否则本测试文件等于没测',
  )
})

test('H2：sessions 服务被保存下来（伪装壳的标题来源）', async () => {
  const { plugin, sandbox } = await loadClientBundle()
  const { guarded } = applyInSandbox(plugin, sandbox)

  const registry = sandbox.__STEALTH_READER__STATE__
  assert.ok(registry, 'apply 必须把注册表挂到全局，组件运行时才读得到')
  assert.equal(registry.sessions, guarded.services.sessions, 'H2：必须保存 ctx.sessions')
  assert.equal(registry.commandError, undefined, `H1：register 不应抛错，实际：${registry.commandError}`)
})

// -------------------------------------------------------------- 快捷键端到端
//
// 上面的用例都停在"注册成功"，而用户看到的是"按了没反应"。这一段把
// apply → window 监听 → 三态切换 整条链在沙箱里跑通，并专门覆盖热替换场景。

/** 可派发的 window 替身：记录绑定过的监听器。 */
function dispatchableWindow(sandbox) {
  const listeners = []
  sandbox.window.addEventListener = (type, handler, capture) => {
    listeners.push({ type, handler, capture })
  }
  sandbox.window.removeEventListener = () => {}
  return {
    listeners,
    /** 派发任意类型的事件给已绑定的监听器，返回命中数（0 表示监听器不在）。 */
    dispatch(type, event) {
      const hits = listeners.filter((entry) => entry.type === type)
      for (const entry of hits) entry.handler(event)
      return hits.length
    },
    /** 按真实键盘事件的形状派发一次快捷键。 */
    pressHotkey() {
      const event = {
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
        code: 'KeyZ',
        isComposing: false,
        repeat: false,
        preventDefault() {},
        stopPropagation() {},
      }
      const hits = listeners.filter((entry) => entry.type === 'keydown')
      for (const entry of hits) entry.handler(event)
      return hits.length
    },
  }
}

// store 的槽位是**懒创建**的（第一次读 current() 才落地），未创建等价于 closed。
const storeMode = (sandbox) => sandbox.__STEALTH_READER_STORE__?.mode ?? 'closed'

test('H3：按下快捷键真的切换状态（apply → window 监听 → store）', async () => {
  const { plugin, sandbox } = await loadClientBundle()
  const win = dispatchableWindow(sandbox)

  applyInSandbox(plugin, sandbox)
  assert.equal(storeMode(sandbox), 'closed', '初始应为真实界面')

  const hits = win.pressHotkey()
  assert.equal(hits, 1, '应恰好有一个 keydown 监听器')
  assert.equal(storeMode(sandbox), 'stream', '按一下 → 进内容流')

  win.pressHotkey()
  assert.equal(storeMode(sandbox), 'closed', '再按一下 → 回真实界面')
})

test('H1b：命令也能进内容流（不必记住快捷键）', async () => {
  const { plugin, sandbox } = await loadClientBundle()
  const { guarded } = applyInSandbox(plugin, sandbox)

  const [command] = guarded.commands
  command.ui.run({})
  assert.equal(storeMode(sandbox), 'stream', '命令面板的入口必须直达内容流')
})

test('H1c：鼠标一动就收场（内容流的主要退出方式）', async () => {
  const { plugin, sandbox } = await loadClientBundle()
  const win = dispatchableWindow(sandbox)
  applyInSandbox(plugin, sandbox)

  win.pressHotkey()
  assert.equal(storeMode(sandbox), 'stream')

  // 移动 1px —— 刻意不设阈值：被撞见时手总会先碰鼠标，那一下必须立刻见效。
  const hits = win.dispatch('mousemove', { type: 'mousemove' })
  assert.ok(hits >= 1, '必须监听到 mousemove')
  assert.equal(storeMode(sandbox), 'closed', '移动鼠标 → 立刻回到真实界面')
})

test('H1d：书单开着时鼠标不收场（ADR-0007 的接线）', async () => {
  const { plugin, sandbox } = await loadClientBundle()
  const win = dispatchableWindow(sandbox)
  applyInSandbox(plugin, sandbox)

  win.pressHotkey()
  assert.equal(storeMode(sandbox), 'stream')

  // 模拟 StreamView 把"书单在屏幕上"发布到 store。
  // 这里直接写槽位、而不是调用 setListVisible()：store 模块读的是**沙箱的** globalThis，
  // 测试进程里那份模块实例读不到它（见 loadClientBundle 的注释）。
  sandbox.__STEALTH_READER_STORE__.listVisible = true

  win.dispatch('mousemove', { type: 'mousemove' })
  assert.equal(storeMode(sandbox), 'stream', '书单开着时移动鼠标不该收场 —— 否则点不到书')

  win.dispatch('pointerdown', { type: 'pointerdown' })
  assert.equal(storeMode(sandbox), 'stream', '按下要原样留给书单（点书名 / 点 ✕ 删除）')

  win.pressHotkey()
  assert.equal(storeMode(sandbox), 'closed', '快捷键仍是书单开着时唯一的出口')
})

test('H3b：热替换（重复 apply）后按键仍然生效，且监听器不累积', async () => {
  const { plugin, sandbox } = await loadClientBundle()
  const win = dispatchableWindow(sandbox)

  applyInSandbox(plugin, sandbox)
  // 模拟热替换：插件被重新加载，apply 再跑一遍（globalThis 槽位在真实场景里会存活）。
  applyInSandbox(plugin, sandbox)

  assert.equal(
    win.listeners.filter((entry) => entry.type === 'keydown').length,
    1,
    '监听器必须只有一份，否则一次按键会切换好几轮',
  )
  assert.equal(
    win.listeners.length,
    5,
    `应恰好 5 个监听器（keydown/mousemove/pointerdown/wheel/touchstart），实际 ${win.listeners.length} 个 —— ` +
      `重复绑定说明热替换会不断累积监听器`,
  )

  win.pressHotkey()
  assert.equal(storeMode(sandbox), 'stream', '热替换后快捷键必须照样能用')
})
