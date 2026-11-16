/**
 * 组装桌面端 resources/app：
 *   apps/server/dist + apps/mcp/dist + apps/web/dist + skills/ + packages/core
 *   + 生产 node_modules（合成最小 package.json 后 npm install --omit=dev）
 *
 * 目录刻意保持仓库布局（apps/...、packages/core），因为 server/mcp 用
 * `../../../` 从 dist 反推仓库根，WEB_ROOT/SERVER_ENTRY/skills 全靠它。
 */
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(here, '..')
const repoRoot = path.resolve(desktopDir, '../..')
const outDir = path.join(desktopDir, 'resources', 'app')

const VERSION = '0.2.2'

async function mustExist(dir, hint) {
  try {
    await access(dir)
  } catch {
    console.error(`[stage] 缺少 ${hint}：${dir}\n请先运行 npm run build`)
    process.exit(1)
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function main() {
  const serverDist = path.join(repoRoot, 'apps/server/dist')
  const mcpDist = path.join(repoRoot, 'apps/mcp/dist')
  const webDist = path.join(repoRoot, 'apps/web/dist')
  await mustExist(serverDist, '@land/server 构建产物')
  await mustExist(mcpDist, '@land/mcp 构建产物')
  await mustExist(webDist, '@land/web 构建产物')

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  await cp(serverDist, path.join(outDir, 'apps/server/dist'), { recursive: true })
  await cp(mcpDist, path.join(outDir, 'apps/mcp/dist'), { recursive: true })
  await cp(webDist, path.join(outDir, 'apps/web/dist'), { recursive: true })
  await cp(path.join(repoRoot, 'skills'), path.join(outDir, 'skills'), { recursive: true })

  // @land/core 以 file: 依赖装入，dist 与 package.json 必须带齐
  const coreOut = path.join(outDir, 'packages/core')
  await mkdir(coreOut, { recursive: true })
  await cp(path.join(repoRoot, 'packages/core/package.json'), path.join(coreOut, 'package.json'))
  await cp(path.join(repoRoot, 'packages/core/dist'), path.join(coreOut, 'dist'), { recursive: true })

  // 生产依赖 = server + mcp + core 的 runtime deps 并集；workspace 包只留 @land/core
  const serverPkg = await readJson(path.join(repoRoot, 'apps/server/package.json'))
  const mcpPkg = await readJson(path.join(repoRoot, 'apps/mcp/package.json'))
  const corePkg = await readJson(path.join(repoRoot, 'packages/core/package.json'))
  const deps = {
    ...(corePkg.dependencies ?? {}),
    ...(serverPkg.dependencies ?? {}),
    ...(mcpPkg.dependencies ?? {}),
  }
  for (const name of Object.keys(deps)) {
    if (name.startsWith('@land/') && name !== '@land/core') delete deps[name]
  }
  deps['@land/core'] = 'file:packages/core'

  await writeFile(
    path.join(outDir, 'package.json'),
    JSON.stringify({ name: 'land-app', private: true, version: VERSION, dependencies: deps }, null, 2),
  )

  console.log('[stage] 安装生产依赖…')
  // Windows 上 npm 是 npm.cmd，必须经 shell 启动；macOS/Linux 直接执行
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const npm = spawnSync(npmCmd, ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: outDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (npm.status !== 0) {
    console.error('[stage] 生产依赖安装失败')
    process.exit(npm.status ?? 1)
  }

  // @land/core 用 file: 依赖装进来的是符号链接（../../packages/core），
  // Tauri 打包 resources 时会静默丢弃符号链接 → 安装后的应用缺包、sidecar 起不来。
  // 这里把符号链接换成实体目录，确保 bundle 自包含。
  const coreNmDir = path.join(outDir, 'node_modules', '@land', 'core')
  await rm(coreNmDir, { force: true })
  await mkdir(path.dirname(coreNmDir), { recursive: true })
  await cp(coreOut, coreNmDir, { recursive: true })

  // 原生模块必须在当前平台可用，否则服务端起来即崩
  const sqliteNative = [
    path.join(outDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    path.join(outDir, 'node_modules/better-sqlite3/prebuilds'),
  ]
  const hasNative = await Promise.all(sqliteNative.map((p) => access(p).then(() => true, () => false)))
  if (!hasNative.some(Boolean)) {
    console.error('[stage] better-sqlite3 原生绑定缺失，服务端将无法启动')
    process.exit(1)
  }

  // 自检：服务端入口必须能解析 @land/core，否则打包出来的应用必然「打不开」。
  // 探针文件放进 node_modules 里运行（不在 -e 字符串里拼路径，Windows 转义易碎）。
  const probeFile = path.join(outDir, 'node_modules', '.selfcheck.cjs')
  await writeFile(probeFile, `try { require.resolve('@land/core') } catch (e) { console.error(e.code || e.message); process.exit(1) }`)
  const probe = spawnSync(process.execPath, [probeFile], { encoding: 'utf8', timeout: 15000 })
  await rm(probeFile, { force: true })
  if (probe.status !== 0) {
    console.error(`[stage] 自检失败：解析不到 @land/core：${probe.stderr?.trim() || `exit ${probe.status}`}`)
    process.exit(1)
  }

  console.log(`[stage] 完成 → ${outDir}`)
}

main()
