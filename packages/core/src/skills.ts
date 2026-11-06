/**
 * Skill 注册表与 provenance 契约（ARCHITECTURE 7.3 / 9.5，P5）。
 *
 * 为什么这件事必须在 core 而不是在 MCP 应用里：Web、MCP、server 三方都要认同
 * 「哪些 skill 是合法的、哪些版本还算兼容」。放在各自进程里，三份清单一定会漂移。
 *
 * 校验 skill 名的意义不只是防脏数据：它让「AI 产出」可归因——
 * 哪版简历是 resume-tailor@1.2 改的、哪批面试题质量高，做「版本胜率」统计才有意义。
 */

import { z } from 'zod'

/** Registry 里登记的最小单元。`minVersion` 是「低于此版本拒绝写入」的下限 */
export interface SkillMeta {
  name: string
  /** 当前随仓库发布的版本，必须与 skills/<name>/SKILL.md 的 frontmatter 一致 */
  version: string
  /** 低于此版本调用写接口会被拒（SKILL_OUTDATED），要求用户先更新 Skill */
  minVersion: string
  title: string
  purpose: string
  /** 该 Skill 允许调用的写接口工具，供 Web 展示与静态检查使用 */
  writeTools: readonly string[]
}

export const SKILL_REGISTRY: readonly SkillMeta[] = [
  {
    name: 'jd-collect',
    version: '1.0.0',
    minVersion: '1.0.0',
    title: 'JD 采集与补录',
    purpose: '官方渠道抓取 JD；失败时用 Agent 浏览器读回正文并导入，Web 可查看',
    writeTools: ['add_job', 'fetch_jd', 'import_jd'],
  },
  {
    name: 'job-hunt',
    version: '1.0.0',
    minVersion: '1.0.0',
    title: '求职推进',
    purpose: '看今天该做什么、处置待跟进、按确认投递',
    writeTools: ['add_job', 'create_application', 'update_application_status', 'add_application_note'],
  },
  {
    name: 'resume-tailor',
    version: '1.0.0',
    minVersion: '1.0.0',
    title: '简历定制',
    purpose: '按 JD 重排重述简历，产出 variant，绝不编造',
    writeTools: ['tailor_resume', 'update_resume'],
  },
  {
    name: 'job-prep',
    version: '1.0.0',
    minVersion: '1.0.0',
    title: '面试准备',
    purpose: '一题一证据地出题、评分、留复盘',
    writeTools: ['save_question', 'score_answer', 'update_interview'],
  },
  {
    name: 'offer-decide',
    version: '1.0.0',
    minVersion: '1.0.0',
    title: 'Offer 决策',
    purpose: '先算数字与假设，再给倾向与谈判素材',
    writeTools: ['create_offer', 'update_offer'],
  },
  {
    name: 'job-search-batch',
    version: '1.2.0',
    minVersion: '1.0.0',
    title: '批量搜岗',
    purpose: '按城市用 WebSearch 找 10 家本地公司的岗位并入库，可翻倍继续搜',
    writeTools: ['add_job', 'fetch_jd', 'import_jd'],
  },
  {
    name: 'resume-tailor-batch',
    version: '1.0.0',
    minVersion: '1.0.0',
    title: '批量定制并进入待投',
    purpose: '给未进待投的岗位逐个定制 variant 简历、绑定岗位、建 queued 投递',
    writeTools: ['tailor_resume', 'update_resume', 'create_application'],
  },
  {
    name: 'browser-apply',
    version: '1.0.0',
    minVersion: '1.0.0',
    title: '浏览器辅助投递',
    purpose: '用本机浏览器预填表单，最后一次提交由用户点击，投完写回已投递记录',
    writeTools: ['export_resume_pdf', 'create_application', 'update_application_status', 'add_application_note'],
  },
  {
    name: 'application-status-sync',
    version: '1.0.1',
    minVersion: '1.0.0',
    title: '投递状态巡检',
    purpose: '创建定时任务 / 手动巡检，凭站点证据推进投递状态并留痕',
    writeTools: ['update_application_status', 'add_application_note'],
  },
] as const

export const SKILL_NAMES = SKILL_REGISTRY.map((item) => item.name) as [string, ...string[]]

export type SkillName = (typeof SKILL_REGISTRY)[number]['name']

/** 供 z.enum 用：z.enum 需要非空元组，这里显式断言而不是靠 as any */
export const zSkillName = z.enum(SKILL_NAMES)

/**
 * provenance：AI 产出的必填标签。
 *
 * `.strict()` 是刻意的：Agent 常会顺手多塞 `agentName`、`timestamp` 之类字段，
 * 放行它们等于默许契约漂移。多出来的信息应写进 remark，而不是散在 provenance 里。
 */
export const zProvenance = z
  .object({
    skill: zSkillName,
    skillVersion: z.string().trim().min(1).max(32),
    model: z.string().trim().max(120).optional(),
    at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()

export type Provenance = z.infer<typeof zProvenance>

export interface SkillCheck {
  ok: boolean
  code?: 'SKILL_UNKNOWN' | 'SKILL_OUTDATED' | 'SKILL_AHEAD'
  message?: string
}

/** 极简 semver 比较：只认 x.y.z（或 x.y），够用且不引依赖 */
export function compareVersion(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .split('.')
      .map((part) => Number.parseInt(part.replace(/\D/g, ''), 10))
      .map((num) => (Number.isFinite(num) ? num : 0))
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export function findSkill(name: string): SkillMeta | undefined {
  return SKILL_REGISTRY.find((item) => item.name === name)
}

/**
 * 校验一次写入的 provenance 是否可信。
 *
 * - 未登记的 skill 名 → 拒绝（挡住 Agent 自造 skill 污染统计）
 * - 版本低于 minVersion → 拒绝，并给出升级命令而不是「版本不对」这种废话
 * - 版本高于当前发布 → 放行但提示（用户可能装了更新的 skill，不该因此投不了简历）
 */
export function checkSkill(name: string, version: string): SkillCheck {
  const meta = findSkill(name)
  if (!meta) {
    return {
      ok: false,
      code: 'SKILL_UNKNOWN',
      message: `未登记的 skill「${name}」；合法值：${SKILL_NAMES.join(' / ')}`,
    }
  }
  if (compareVersion(version, meta.minVersion) < 0) {
    return {
      ok: false,
      code: 'SKILL_OUTDATED',
      message: `skill「${name}」版本 ${version} 低于最低要求 ${meta.minVersion}；请更新后重试：bash scripts/install-skills.sh`,
    }
  }
  if (compareVersion(version, meta.version) > 0) {
    return {
      ok: true,
      code: 'SKILL_AHEAD',
      message: `skill「${name}」版本 ${version} 高于本机登记版本 ${meta.version}，已按兼容处理`,
    }
  }
  return { ok: true }
}

/** 写入前补时间戳：让「什么时候由谁产出」不需要靠猜 */
export function stampProvenance(provenance: Provenance): Provenance & { at: string } {
  return { ...provenance, at: provenance.at ?? new Date().toISOString() }
}

export interface SkillStatus extends SkillMeta {
  compatible: boolean
  note?: string
}

/**
 * 给 Web 的「Skill 状态条」与 MCP 的 get_app_status 共用。
 * `installed` 传当前机器上读到的版本（读不到就不传，表示未安装）。
 */
export function skillStatuses(installed: Record<string, string> = {}): SkillStatus[] {
  return SKILL_REGISTRY.map((meta) => {
    const version = installed[meta.name]
    if (!version) return { ...meta, compatible: false, note: '未检测到安装' }
    const check = checkSkill(meta.name, version)
    return { ...meta, compatible: check.ok, note: check.message }
  })
}
