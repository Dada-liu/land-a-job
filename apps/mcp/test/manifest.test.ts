import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { SKILL_REGISTRY, type Provenance } from '@land/core'
import { TOOL_MANIFEST, registerTools } from '../src/tools/index.js'
import { registerResources } from '../src/resources.js'
import { appliedAtForCreate, stamp } from '../src/tools/shared.js'

/**
 * MCP 契约与 Skill 的一致性检查（P5 的质量门禁）。
 *
 * 这里守的是三条最容易悄悄坏掉的东西：
 * 1. TOOL_MANIFEST 与真实注册的工具不一致 → 静态检查本身失效
 * 2. SKILL.md 里写了不存在的工具 → Agent 运行时才发现「工具不存在」
 * 3. 出现了 generate_* 工具 → 违反 D2（应用零 LLM）
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../..')
const SKILLS_DIR = path.join(REPO_ROOT, 'skills')

/** 反引号里出现但不是工具名的词（字段名、参数名）。只允许这几个，新增要写清理由 */
const NON_TOOL_BACKTICKS = new Set([
  'appliedAt',
  'nextActionAt',
  'nextStatuses',
  'prepStatus',
  'linkedItem',
  'manualScores',
  'baseResumeId',
  'fitSource',
  'fitReasons',
  'applied',
  'screening',
  'assessment',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'ghosted',
  'withdrawn',
  'lead',
  'queued',
  'pending',
  'blocking',
  'important',
  'nice',
  'done',
  'content',
  'structure',
  'delivery',
  // jd-collect/references/browser-fallback.md：Kimi 浏览器扩展的命令名，
  // 属于 Agent 侧工具而非本应用的 MCP 工具，不能当成 MCP 工具名校验。
  'find_tab',
  'close_tab',
  'close_session',
  'list_tabs',
  'save_as_pdf',
  // application-status-sync：Agent 侧的定时任务工具，不是本应用注册的 MCP 工具。
  // 它必须出现在 SKILL.md 里（不然 Agent 不知道怎么建任务），但不能按 MCP 工具名校验。
  'automation_update',
  // job-search-batch §3.1：浏览器兜底补正文用的 WorkBuddy Browser 工具，
  // 属于 Agent 侧的浏览器能力（workbuddy-browser-use），不是本应用的 MCP 工具。
  // 这些名字必须写进 SKILL.md/参考文档，Agent 才知道抓不到正文时按哪套动作走。
  'browsers_list',
  'tabs_new',
  'tab_goto',
  'tab_screenshot',
  'dom_cua_get_visible_dom',
  'dom_cua_scroll',
  'cua_execute',
])

function captureRegistrations(): { tools: string[]; resources: string[] } {
  const tools: string[] = []
  const resources: string[] = []
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  const patch = server as unknown as {
    registerTool: (name: string, ...rest: never[]) => unknown
    registerResource: (name: string, ...rest: never[]) => unknown
  }

  const originalTool = patch.registerTool.bind(server)
  const originalResource = patch.registerResource.bind(server)
  patch.registerTool = ((name: string, ...rest: never[]) => {
    tools.push(name)
    return originalTool(name, ...rest)
  }) as typeof patch.registerTool
  patch.registerResource = ((name: string, ...rest: never[]) => {
    resources.push(name)
    return originalResource(name, ...rest)
  }) as typeof patch.registerResource

  registerTools(server)
  registerResources(server)
  return { tools, resources }
}

describe('MCP 工具清单', () => {
  const { tools, resources } = captureRegistrations()

  it('TOOL_MANIFEST 与实际注册的工具完全一致', () => {
    expect([...tools].sort()).toEqual([...TOOL_MANIFEST].sort())
  })

  it('工具名不重复', () => {
    expect(new Set(tools).size).toBe(tools.length)
  })

  it('不出现 generate_* 工具（D2：应用零 LLM）', () => {
    const offenders = tools.filter((name) => name.startsWith('generate_'))
    expect(offenders).toEqual([])
  })

  it('五个资源都已注册', () => {
    expect([...resources].sort()).toEqual(['job', 'offer-compare', 'pipeline', 'resume', 'today'])
  })
})

/**
 * 路径前缀的回归门禁。
 *
 * `client.request()` 内部统一拼 `/api`，所以工具里再写一次 `/api/xxx` 就会变成
 * `/api/api/xxx`：服务端把请求交给前端 SPA 兜底，返回的是 index.html 而不是 JSON，
 * 表现为「工具报 NOT_FOUND 未知接口」，极易被当成业务 bug 排查半天。
 * 这条测试只扫 client 调用，`supervisor.ts` 用裸 fetch 探 `/api/health` 不算。
 */
describe('工具不重复拼 /api 前缀', () => {
  it('客户端调用路径里不出现 /api/', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts') && entry.name !== 'client.ts') {
          const text = readFileSync(full, 'utf8')
          // 只认 client.get/post/patch/delete 后面紧跟的字符串字面量
          for (const match of text.matchAll(/client\.(?:get|post|patch|delete)\b[^(]*\(\s*[`'"]([^`'"]+)[`'"]/g)) {
            if (match[1]!.startsWith('/api')) {
              offenders.push(`${path.relative(REPO_ROOT, full)}: ${match[1]}`)
            }
          }
        }
      }
    }
    walk(path.join(REPO_ROOT, 'apps/mcp/src'))
    expect(offenders).toEqual([])
  })
})

describe('Skill 与工具的一致性', () => {
  const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  it('九个 Skill 目录都在', () => {
    expect(skillDirs.sort()).toEqual([
      'application-status-sync',
      'browser-apply',
      'jd-collect',
      'job-hunt',
      'job-prep',
      'job-search-batch',
      'offer-decide',
      'resume-tailor',
      'resume-tailor-batch',
    ])
  })

  for (const name of SKILL_REGISTRY.map((item) => item.name)) {
    it(`${name}：SKILL.md 的 name 与 version 与注册表一致`, () => {
      const text = readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')
      const meta = SKILL_REGISTRY.find((item) => item.name === name)!
      expect(text).toContain(`name: ${name}`)
      expect(text).toContain(`version: ${meta.version}`)
    })
  }

  it('SKILL.md 引用的每个工具名都真实存在', () => {
    const known = new Set<string>(TOOL_MANIFEST as readonly string[])
    const missing: string[] = []

    for (const name of SKILL_REGISTRY.map((item) => item.name)) {
      const files: string[] = []
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else if (entry.name.endsWith('.md')) files.push(full)
        }
      }
      walk(path.join(SKILLS_DIR, name))

      for (const file of files) {
        const text = readFileSync(file, 'utf8')
        // 反引号内的 snake_case 片段一律当作工具名候选
        for (const match of text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) {
          const token = match[1]!
          if (known.has(token) || NON_TOOL_BACKTICKS.has(token)) continue
          missing.push(`${name}/${path.basename(file)}: ${token}`)
        }
      }
    }

    expect(missing).toEqual([])
  })

  it('每个 Skill 在 references 里至少有一份参考文档', () => {
    for (const name of SKILL_REGISTRY.map((item) => item.name)) {
      const refDir = path.join(SKILLS_DIR, name, 'references')
      const files = readdirSync(refDir).filter((file) => file.endsWith('.md'))
      expect(files.length, `${name} 缺 references`).toBeGreaterThan(0)
    }
  })
})

describe('create_application 的投递时间口径', () => {
  it('queued / lead 不写 appliedAt：否则待投会被漏斗算成已投', () => {
    expect(appliedAtForCreate('queued')).toBeUndefined()
    expect(appliedAtForCreate('lead')).toBeUndefined()
  })

  it('默认状态与「已投及以后」自动补时间', () => {
    for (const status of [undefined, 'applied', 'screening', 'assessment', 'interview', 'offer']) {
      const value = appliedAtForCreate(status)
      expect(value).toBeTruthy()
      expect(Number.isNaN(Date.parse(value!))).toBe(false)
    }
  })

  it('显式传的时间优先，终态不强塞投递时间', () => {
    const iso = '2026-11-05T09:00:00.000Z'
    expect(appliedAtForCreate('applied', iso)).toBe(iso)
    expect(appliedAtForCreate('rejected')).toBeUndefined()
  })
})

describe('provenance 在 MCP 侧就被拦下', () => {
  it('未登记的 skill 名被拒', () => {
    expect(() => stamp({ skill: 'made-up', skillVersion: '1.0.0' } as unknown as Provenance)).toThrowError(
      /未登记/,
    )
  })

  it('版本低于下限被拒，并给出升级命令而不是「版本不对」', () => {
    try {
      stamp({ skill: 'job-hunt', skillVersion: '0.0.1' } as unknown as Provenance)
      throw new Error('应当抛错')
    } catch (error) {
      const typed = error as { code?: string; message?: string }
      expect(typed.code).toBe('SKILL_OUTDATED')
      expect(typed.message).toContain('install-skills.sh')
    }
  })

  it('合法 provenance 自动补时间戳', () => {
    const result = stamp({ skill: 'job-hunt', skillVersion: '1.0.0' } as unknown as Provenance)
    expect(result.at).toBeTruthy()
    expect(Number.isNaN(Date.parse(result.at!))).toBe(false)
  })
})
