import { checkSkill, stampProvenance, type Provenance } from '@land/core'
import { AppError } from './errors.js'

/**
 * provenance 闸门（P5 / D2 红线 #4）。
 *
 * 放在路由层而不是每个写接口各写一遍：漏一处就等于给 Agent 开了个匿名窗户。
 * 人工在 Web 上编辑不带 provenance —— 这是「人 vs AI」的唯一区分依据，
 * 也是后续算「AI 改的简历胜率」的分母。
 */
export function acceptProvenance(
  provenance: Provenance | null | undefined,
): Provenance | null | undefined {
  if (!provenance) return provenance
  const check = checkSkill(provenance.skill, provenance.skillVersion)
  if (!check.ok) {
    throw new AppError(check.code ?? 'SKILL_INVALID', check.message ?? 'provenance 不合法', 400, {
      skill: provenance.skill,
      skillVersion: provenance.skillVersion,
    })
  }
  return stampProvenance(provenance)
}
