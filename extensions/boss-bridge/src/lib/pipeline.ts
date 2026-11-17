import { TASK_TIMEOUT_MS } from './constants.js'
import { detailGate } from './activity.js'
import { buildGreeting } from './greeting.js'
import type { RateLimiter } from './rate-limit.js'
import { pruneStaging } from './storage.js'
import type { BridgeSettings, StagedJob, StagingData } from './types.js'

export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface ActionResult {
  ok: boolean
  message?: string
  code?: number
}

export interface PipelineDeps {
  load: () => Promise<StagingData>
  save: (data: StagingData) => Promise<void>
  limiter: RateLimiter
  settings: BridgeSettings
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
  /** 批次人工确认：返回用户勾选的子集；默认全不选（最后一击留给用户） */
  confirmBatch?: (items: StagedJob[]) => Promise<StagedJob[]>
  /** 页面原生 UI 交互；P1 默认 no-op，绝不在 dry-run 里触发 */
  sendGreeting?: (job: StagedJob) => Promise<ActionResult>
  openDetail?: (job: StagedJob) => Promise<ActionResult>
}

export interface PipelineResult {
  filtered: number
  filteredOut: number
  drafted: number
  delivered: number
  preview: StagedJob[]
  reasons: string[]
  tripped: boolean
}

/**
 * filter → generate → delivery（提案 §7 / §8）。
 * 每一步都以暂存区 state 为断点，可重试、可中断；默认 dry-run 零发送。
 */
export async function runPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const log = deps.log ?? (() => {})
  const result: PipelineResult = {
    filtered: 0, filteredOut: 0, drafted: 0, delivered: 0,
    preview: [], reasons: [], tripped: false,
  }

  const data = await deps.load()
  deps.limiter.startRun()
  const jobs = Object.values(data.jobs)

  // ① filter：活跃度两段复核；未拿到的详情保持 needs_detail，等用户浏览时被动补齐
  for (const job of jobs) {
    if (job.state !== 'needs_detail' || !job.bossActive) continue
    /**
     * 列表里没有 `bossOnline`（undefined）＝**还没证据**，不等于不活跃。
     * 早期这里直接进 detailGate，被判成「详情里也没有活跃信号」→ filtered_out，
     * 自动复核永远轮不到它。留成 needs_detail 才有机会补详情。
     */
    if (job.bossActive.source === 'list' && job.bossActive.online === undefined) continue
    const decision = detailGate(job.bossActive, job.bossFreezeStatus, job.bossPreFreezeStatus, { now: now() })
    job.state = decision.state
    job.notes = decision.reason
    result.filtered += 1
    if (decision.unknownDesc) log(`未纳入白名单的活跃度标签：${decision.unknownDesc}`)
    if (decision.state === 'filtered_out') result.filteredOut += 1
  }

  const needsDetail = jobs.filter((j) => j.state === 'needs_detail')
  if (deps.settings.autoOpenDetail && deps.openDetail) {
    for (const job of needsDetail.slice(0, 10)) {
      const check = deps.limiter.canAct()
      if (!check.ok) { result.reasons.push(check.reason); break }
      try {
        const res = await withTimeout(deps.openDetail(job), TASK_TIMEOUT_MS.detail, '详情复核')
        deps.limiter.noteRequest()
        if (res.code !== undefined || res.message) deps.limiter.noteRiskSignal(res.code, res.message)
        if (!res.ok) {
          result.reasons.push(`${job.jobName}：${res.message ?? '详情打开失败'}`)
        } else {
          /** openDetail 的写入走的是另一条 store 路径，读回来才能在本轮直接产出草稿 */
          const fresh = (await deps.load()).jobs[job.key]
          if (fresh) {
            job.bossActive = fresh.bossActive
            job.jdText = fresh.jdText ?? job.jdText
            job.state = fresh.state
            job.notes = fresh.notes
            result.filtered += 1
            if (fresh.state === 'filtered_out') result.filteredOut += 1
          }
        }
      } catch (error) {
        result.reasons.push(`${job.jobName}：${(error as Error).message}`)
      }
      await sleep(deps.limiter.nextDelayMs())
    }
  } else if (needsDetail.length) {
    log(`${needsDetail.length} 条候选等待详情页响应（没点开详情，或详情页标签未被附着）`)
    result.reasons.push(`${needsDetail.length} 条仍在等待详情复核，暂不产出招呼语`)
  }

  // ② generate：0-token 模板招呼语，只为通过闸门的记录产出草稿
  const ready = jobs.filter((j) => j.state === 'ready')
  for (const job of ready) {
    if (result.drafted >= 10) break
    if (!job.greetDraft) {
      job.greetDraft = buildGreeting(deps.settings.greetingTemplate, job, deps.settings.highlights)
      result.drafted += 1
    }
    result.preview.push(job)
  }

  // ③ delivery：dry-run 只出预览；非 dry-run 也要用户逐批确认，最后一次点击留给人
  if (deps.settings.dryRun) {
    result.reasons.push(`dry-run：${result.preview.length} 条草稿未发送`)
  } else if (deps.confirmBatch && deps.sendGreeting) {
    const confirmed = await deps.confirmBatch(result.preview)
    for (const job of confirmed) {
      const check = deps.limiter.canAct()
      if (!check.ok) {
        result.reasons.push(check.reason)
        if (deps.limiter.snapshot.tripped) result.tripped = true
        break
      }
      if (check.waitMs > 0) await sleep(check.waitMs)
      try {
        const res = await withTimeout(deps.sendGreeting(job), TASK_TIMEOUT_MS.delivery, '发送招呼语')
        if (res.code !== undefined || res.message) {
          const tripped = deps.limiter.noteRiskSignal(res.code, res.message)
          if (tripped) {
            result.tripped = true
            result.reasons.push(`熔断：${res.message ?? `code ${res.code}`}`)
            break
          }
        }
        if (!res.ok) {
          result.reasons.push(`${job.jobName}：${res.message ?? '发送失败'}`)
          continue
        }
        const target = data.jobs[job.key]
        if (target) {
          target.state = 'greeted'
          target.greetedAt = now()
          target.notes = `${target.notes ?? ''}；已发送招呼语`.trim()
        }
        deps.limiter.recordAction()
        result.delivered += 1
      } catch (error) {
        result.reasons.push(`${job.jobName}：${(error as Error).message}`)
      }
      await sleep(deps.limiter.nextDelayMs())
    }
  }

  pruneStaging(data, now())
  /**
   * 旁听详情、回复落库都是并发的另一条写入路径（都是 load → 改 → save）。
   * 直接把本轮开头的快照存回去，会冲掉它们刚写进来的 `bossActive` / `jdText` / `landSync`，
   * 症状就是「自动复核明明成功了，一保存又变回待复核」。所以落盘前重读一次做合并。
   */
  const latest = await deps.load()
  for (const key of Object.keys(data.jobs)) {
    const mine = data.jobs[key]
    const fresh = latest.jobs[key]
    if (!mine || !fresh) continue
    /** 本轮期间旁听到了详情：它的判定比本轮基于列表的粗筛更新，听它的 */
    const detailIsNewer = fresh.bossActive.source === 'detail' && mine.bossActive.source !== 'detail'
    data.jobs[key] = {
      ...fresh,
      ...mine,
      bossActive: detailIsNewer ? fresh.bossActive : mine.bossActive,
      jdText: fresh.jdText ?? mine.jdText,
      state: detailIsNewer ? fresh.state : mine.state,
      notes: detailIsNewer ? fresh.notes : mine.notes,
    }
  }
  await deps.save(data)
  return result
}
