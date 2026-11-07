#!/usr/bin/env node
/**
 * 官网构建：把 site/ 的静态文件收进 site/dist，并写一份 build.json（提交号 + 时间）。
 *
 * 为什么要有这一步，而不是让 Pages 直接部署 site/：
 * 1. 页脚要显示「这一版是哪个提交」，只能在构建时知道；
 * 2. 以后要加压缩、指纹或 HTML 校验，都从这一处插；
 * 3. dist 是产物目录，和源文件分开，避免把临时文件一起发布出去。
 *
 * 用法：
 *   node scripts/build-site.mjs          构建
 *   node scripts/build-site.mjs --serve  构建后起本地预览（http://127.0.0.1:4321）
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = join(ROOT, 'site')
const OUT = join(SRC, 'dist')
const run = promisify(execFile)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

/** 体积统计要算上子目录（截图在 site/screenshots/ 下），否则日志会少报 1MB 多 */
async function treeSize(target) {
  const info = await stat(target)
  if (info.isFile()) return info.size
  let total = 0
  for (const entry of await readdir(target, { withFileTypes: true })) {
    total += await treeSize(join(target, entry.name))
  }
  return total
}

async function gitSha() {
  try {
    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT })
    return stdout.trim()
  } catch {
    return 'local'
  }
}

async function build() {
  const entries = await readdir(SRC, { withFileTypes: true })
  const sources = entries.filter((entry) => entry.name !== 'dist').map((entry) => entry.name)

  if (!sources.includes('index.html')) {
    throw new Error('site/index.html 不存在，官网没有入口页')
  }

  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  let bytes = 0
  for (const name of sources) {
    const from = join(SRC, name)
    await cp(from, join(OUT, name), { recursive: true })
    bytes += await treeSize(from)
  }

  const info = {
    sha: await gitSha(),
    builtAt: new Date().toISOString(),
    pages: process.env.GITHUB_PAGES_URL ?? '',
  }
  await writeFile(join(OUT, 'build.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8')

  const generated = (await readdir(OUT)).sort()
  console.log(`site/dist 已生成：${generated.length} 项，源文件合计 ${(bytes / 1024).toFixed(1)} KB`)
  console.log(`  提交 ${info.sha} · ${info.builtAt}`)
  console.log(`  文件 ${generated.join(', ')}`)
  return info
}

async function serve() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = join(OUT, relative)
    if (url.pathname.endsWith('/')) file = join(file, 'index.html')

    try {
      const info = await stat(file)
      if (info.isDirectory()) file = join(file, 'index.html')
      const body = await readFile(file)
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('404')
    }
  })

  const port = Number(process.env.PORT ?? 4321)
  server.listen(port, '127.0.0.1', () => {
    console.log(`预览：http://127.0.0.1:${port}/`)
  })
}

await build()
if (process.argv.includes('--serve')) await serve()
