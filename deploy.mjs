// 构建 + 同步到 DSH 的 web profile。
//
// 为什么需要同步这一步：profile 用 `file:` 依赖装上本包后，pnpm 复制的是**当时的产物**，
// 之后工作区里的 `lib/` 重建不会自动回流。而 DSH 的 client-hmr 是 stat-poll
// **profile 里那份** lib/client.js 的 mtime/size —— 不回流就不会热替换。
//
// 用法：node deploy.mjs   （或 pnpm run deploy）
import { execFile } from 'node:child_process'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = dirname(fileURLToPath(import.meta.url))

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILE = process.env.DSH_PROFILE ?? 'web'
const TARGET = join(DSH_HOME, 'profiles', PROFILE, 'node_modules', 'dsh-stealth-reader')

async function main() {
  console.log('[deploy] 构建…')
  await run(process.execPath, [resolve(ROOT, 'build.mjs')], { cwd: ROOT })

  await mkdir(join(TARGET, 'lib'), { recursive: true })
  const files = ['client.js', 'index.js']
  for (const file of files) {
    const from = resolve(ROOT, 'lib', file)
    const to = join(TARGET, 'lib', file)
    await copyFile(from, to)
    const info = await stat(to)
    console.log(`[deploy] ${file} → ${to}  (${info.size} bytes)`)
  }

  console.log('[deploy] 完成。DSH 的 client-hmr 会在 ~500ms 内热替换，无需刷新页面。')
  console.log('[deploy] 注意：新增/删除插件行仍需重启 dsh web。')
}

main().catch((error) => {
  console.error('[deploy] 失败:', error.stderr ?? error.message ?? error)
  process.exit(1)
})
