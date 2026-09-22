// dsh-stealth-reader 构建脚本。
//
// 产出两半：
//   lib/index.js  —— 宿主半（ESM，Node 侧；只注册 settings 命名空间）
//   lib/client.js —— 浏览器半，必须是 window.__ModuleLoader__.load({id, factory}) 形态的
//                    lazy-CJS 单文件（见 docs/dsh-client-plugin-notes.md §2）
//
// 关键约束：react / react-dom / @deepseek-ai/* 一律 external（基线模块，由宿主 require 提供）；
// 其余第三方库（fflate 等）必须打进 bundle。
import { build, context } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PKG_ID = 'dsh-stealth-reader'
const watch = process.argv.includes('--watch')

/** 基线模块：宿主已提供，构建时一律 external。 */
const CLIENT_EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * esbuild 生成的 require shim 里那句 `typeof require !== "undefined" ? require : ...`
 * 是整条链路的要害：它在**子 IIFE 作用域内**求值，而 ModuleLoader 工厂的 `require`
 * 是子 IIFE 之外的参数，永远取不到 —— 外部模块（react）会是 undefined。
 */
const REQUIRE_SLOT_NAME = '__DSH_STEALTH_REQUIRE__'
const REQUIRE_SLOT = `globalThis.${REQUIRE_SLOT_NAME}`

const clientOptions = {
  entryPoints: [resolve(ROOT, 'src/client/index.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: CLIENT_EXTERNALS,
  outfile: resolve(ROOT, 'lib/client.bundle.js'),
  logLevel: 'info',
  legalComments: 'none',
}

const hostOptions = {
  entryPoints: [resolve(ROOT, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['@deepseek-ai/schemastery', '@deepseek-ai/cordis'],
  outfile: resolve(ROOT, 'lib/index.js'),
  logLevel: 'info',
  legalComments: 'none',
}

/**
 * esbuild 生成的 require shim 模板；`id` 是它给回调挑的参数名。
 *
 * esbuild 原始形态（在子 IIFE 作用域内求值，取不到工厂的 `require` 参数）：
 *
 *   var __require = ((x) => typeof require !== "undefined" ? require : (Proxy 回退))(fn)
 */
const requireShimTemplate = (id) => `var __require = /* @__PURE__ */ ((${id}) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(${id}, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : ${id})(function(${id}) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + ${id} + '" is not supported');
  });`

/**
 * 找出 bundle 里那段 shim 原文。
 *
 * 参数名**不是固定的**：bundle 里一旦出现别处已占用 `x` 的辅助函数（例如打进一个 CJS
 * 依赖，fflate 就是），esbuild 会把它重命名成 `x2`。所以先探出参数名，再用模板逐字核对
 * 其余部分 —— 形态真的变了照样在构建期失败，而不是产出"加载成功但 react 是 undefined"
 * 的坏 bundle。
 */
function findRequireShim(source) {
  const probe = /var __require = \/\* @__PURE__ \*\/ \(\((\w+)\) =>/.exec(source)
  if (!probe) return null
  const shim = requireShimTemplate(probe[1])
  return source.includes(shim) ? shim : null
}

function bindRequireSlot(bundleSource) {
  const shim = findRequireShim(bundleSource)
  if (!shim) {
    throw new Error(
      'require shim not found (esbuild output shape changed); ' +
        'inspect `var __require = /* @__PURE__ */` in the built bundle and update requireShimTemplate()',
    )
  }
  const patched = bundleSource.replace(
    shim,
    `var __require = (x) => ${REQUIRE_SLOT}(x);`,
  )
  try {
    new Function(patched)
  } catch (error) {
    throw new Error(`rewritten bundle is not valid JS: ${error.message}`)
  }
  return patched
}

/**
 * 把 esbuild 的 bundle 包成 DSH 要求的 ModuleLoader 形态。
 * 宿主只接受 `window.__ModuleLoader__.load({id, factory})`，且 factory 返回值即插件 exports。
 */
function wrapClientBundle(bundleSource) {
  return `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG_ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    // bundle 内的 require shim 从这里取值（见 bindRequireSlot）
    ${REQUIRE_SLOT} = require;
${indent(bundleSource, 4)}
    var plugin = globalThis.__STEALTH_READER__;
    if (!plugin || typeof plugin.apply !== "function") {
      throw new Error(${JSON.stringify(PKG_ID)} + ": client bundle did not publish its plugin contract");
    }
    return plugin;
  }
});
`
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n')
}

async function emitClient() {
  const result = await build({ ...clientOptions, write: false })
  const [output] = result.outputFiles
  const source = bindRequireSlot(output.text)
  await mkdir(resolve(ROOT, 'lib'), { recursive: true })
  await writeFile(resolve(ROOT, 'lib/client.js'), wrapClientBundle(source), 'utf8')
  console.log(`[build] lib/client.js  ${source.length} bytes (bundled)`)
}

async function main() {
  await mkdir(resolve(ROOT, 'lib'), { recursive: true })

  if (!watch) {
    await build(hostOptions)
    await emitClient()
    console.log('[build] done')
    return
  }

  // watch 模式：宿主半一次性构建，客户端半每次改动重建 lib/client.js，
  // DSH 的 client-hmr 会 stat-poll 到 mtime/size 变化并热替换（无需刷新页面）。
  await build(hostOptions)
  const ctx = await context(clientOptions)
  await ctx.watch()
  console.log('[build] watching src/client/** …')
}

main().catch((error) => {
  console.error('[build] failed:', error)
  process.exit(1)
})
