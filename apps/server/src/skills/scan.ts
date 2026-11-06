import { existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { skillStatuses, type SkillStatus } from '@land/core'

/**
 * 扫描本机安装的 Skill 版本（P5）。
 *
 * 只做一件容易被忽略的事：**以仓库里的 SKILL.md 为准去核对版本**，而不是信任
 * 某个缓存的清单。用户改了 SKILL.md 却没跑安装脚本、或装了旧版软链，
 * 状态条必须能看出来——这正是「AI 产出来自哪个版本」可信的前提。
 */

const SKILL_TARGETS = ['.claude/skills', '.workbuddy/skills'] as const

export interface SkillScan {
  /** 仓库内 skills/ 目录的绝对路径；找不到为 null */
  dir: string | null
  /** skill 名 → SKILL.md 里声明的版本 */
  versions: Record<string, string>
  /** 每类 Agent 目录里实际存在的软链/目录 */
  targets: { dir: string; path: string; installed: string[] }[]
  skills: SkillStatus[]
}

/** 从当前文件向上找带 workspaces 的 package.json —— 比硬编码 ../../.. 抗搬运 */
function findRepoRoot(start: string): string | null {
  let current = start
  for (let depth = 0; depth < 8; depth += 1) {
    const pkgPath = path.join(current, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown }
        if (pkg.workspaces) return current
      } catch {
        // 不是合法 JSON，继续往上找
      }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/** 只解析 frontmatter 里的简单 `key: value`，不为了两个字段引一个 YAML 库 */
export function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match?.[1]) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.+)$/.exec(line.trim())
    if (kv?.[1] && kv[2]) result[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
  }
  return result
}

export function scanSkills(options: { dir?: string; home?: string } = {}): SkillScan {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dir = options.dir ?? path.join(findRepoRoot(here) ?? path.resolve(here, '../../../..'), 'skills')
  const home = options.home ?? os.homedir()

  const versions: Record<string, string> = {}
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillFile = path.join(dir, entry.name, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      const meta = parseFrontmatter(readFileSync(skillFile, 'utf8'))
      const name = meta.name ?? entry.name
      versions[name] = meta.version ?? '0.0.0'
    }
  }

  const targets = SKILL_TARGETS.map((relative) => {
    const targetPath = path.join(home, relative)
    const installed = existsSync(targetPath)
      ? readdirSync(targetPath, { withFileTypes: true })
          .filter((item) => item.isDirectory() || item.isSymbolicLink())
          .map((item) => item.name)
      : []
    return { dir: relative, path: targetPath, installed }
  })

  return { dir, versions, targets, skills: skillStatuses(versions) }
}
