import type { BridgeSettings, PdfPayload, ResumeRow, TailorPlanPayload } from './types.js'

/** 服务端统一信封：成功 `{ data, meta? }`，失败 `{ error: { code, message, details? } }`。 */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

interface IdRow {
  id: string
  name?: string
  status?: string
  fitScore?: number | null
}

export interface JobCreateInput {
  companyId: string
  title: string
  jdUrl: string
  city?: string
  /**
   * 月薪区间（元）。BOSS 列表上的 `12-18K` 在这里换算成 12000/18000。
   * 不传就留空——服务端只能从 JD 正文猜，而 BOSS 正文基本不带薪资。
   */
  salaryMin?: number
  salaryMax?: number
  /** 发薪月数：`23-45K·13薪` 的 13；没写就留空，别默认 12 */
  salaryMonths?: number
}

export interface ApplicationCreateInput {
  jobId: string
  notes?: string
}

/** 与 land-a-job 本地服务的边界：跨域白名单 + 强制 x-land-token（服务端已实现）。 */
export class LandBridge {
  constructor(private readonly settings: Pick<BridgeSettings, 'apiBase' | 'token'>) {}

  private get base(): string {
    return this.settings.apiBase.replace(/\/$/, '')
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-land-token': this.settings.token,
    }
  }

  /** 自动拆 `{ data }` 信封；错误带 code / details，供幂等与可重试判断。 */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
    })
    const text = await response.text()
    let payload: unknown
    try { payload = text ? JSON.parse(text) : undefined } catch { payload = text }

    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
      throw new BridgeError(
        error?.message ?? `land-a-job ${response.status}：${text.slice(0, 160)}`,
        response.status,
        error?.code ?? 'HTTP_ERROR',
        error?.details,
      )
    }
    if (payload && typeof payload === 'object' && 'data' in payload) {
      return (payload as { data: T }).data
    }
    return payload as T
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) })
  }

  /**
   * 二进制响应（PDF）：不能用 `request()`，那条路会把 body 当 JSON 解。
   * 文件名优先取 `content-disposition`，服务端的口径是「姓名_岗位_标题_日期.pdf」。
   */
  async requestBinary(path: string, init: RequestInit = {}): Promise<{ bytes: Uint8Array; fileName: string }> {
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
    })
    if (!response.ok) {
      const text = await response.text()
      let payload: unknown
      try { payload = text ? JSON.parse(text) : undefined } catch { payload = text }
      const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
      throw new BridgeError(
        error?.message ?? `land-a-job ${response.status}：${text.slice(0, 160)}`,
        response.status,
        error?.code ?? 'HTTP_ERROR',
        error?.details,
      )
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const disposition = response.headers.get('content-disposition') ?? ''
    const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
    const fileName = match?.[1] ? decodeURIComponent(match[1]) : `resume-${Date.now()}.pdf`
    return { bytes, fileName }
  }

  /** 会话健康探测：服务没起或令牌错，整轮停机。 */
  async health(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.request<unknown>('/api/health')
      return { ok: true, message: '本地服务可达' }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  }

  /** `q` 由 zListQuery 声明；模糊查询后还要精确比对，避免「腾讯科技」命中「腾讯科技（深圳）」。 */
  async findCompanyByName(name: string): Promise<IdRow | null> {
    const rows = await this.request<IdRow[]>(`/api/companies?q=${encodeURIComponent(name)}&limit=50`)
    return rows.find((row) => row.name?.trim() === name.trim()) ?? null
  }

  async createCompany(name: string, city?: string): Promise<string> {
    const row = await this.post<IdRow>('/api/companies', {
      name,
      ...(city ? { city } : {}),
    })
    return row.id
  }

  /** `jdUrl` 由 jobs 路由的 listQuery 显式声明（漏声明会被 zod 静默丢掉）。 */
  async findJobByUrl(url: string): Promise<IdRow | null> {
    const rows = await this.request<IdRow[]>(`/api/jobs?jdUrl=${encodeURIComponent(url)}&limit=10`)
    return rows[0] ?? null
  }

  /** 刻意不传 jdText：正文由 import-jd 统一清洗、抽信号、留快照并回写。 */
  async createJob(input: JobCreateInput): Promise<string> {
    const row = await this.post<IdRow>('/api/jobs', {
      companyId: input.companyId,
      title: input.title,
      jdUrl: input.jdUrl,
      channel: 'boss',
      ...(input.city ? { city: input.city } : {}),
      ...(input.salaryMin != null ? { salaryMin: input.salaryMin } : {}),
      ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
      /** 声明来源：这是招聘平台列表卡片上的价格，比从 JD 正文抽的准 */
      ...(input.salaryMin != null || input.salaryMax != null ? { salarySource: 'listing' } : {}),
      ...(input.salaryMonths != null ? { salaryMonths: input.salaryMonths } : {}),
    })
    return row.id
  }

  async importJd(jobId: string, text: string, url: string): Promise<void> {
    await this.post(`/api/jobs/${encodeURIComponent(jobId)}/import-jd`, {
      text, url, capturedBy: 'browser',
    })
  }

  /**
   * 服务端不传 `resumeId` 时取 `listResumes({limit:1})` 的第一份——那是按 `updated_at`
   * 排序的，通常正好是某个投递变体，不是母版。打分必须显式带默认简历。
   */
  async findDefaultResumeId(): Promise<string | null> {
    const rows = await this.request<(IdRow & { isDefault?: boolean })[]>('/api/resumes?limit=200')
    return rows.find((row) => row.isDefault)?.id ?? null
  }

  async scoreJob(jobId: string): Promise<number | null> {
    let resumeId: string | null = null
    try {
      resumeId = await this.findDefaultResumeId()
    } catch {
      // 拿不到默认简历就退回服务端兜底，不因打分失败中断落库
      resumeId = null
    }
    const result = await this.post<{ job?: IdRow }>(
      `/api/jobs/${encodeURIComponent(jobId)}/score`,
      resumeId ? { resumeId } : {},
    )
    return result?.job?.fitScore ?? null
  }

  /**
   * `active=true` 只返回进行中的投递：同一个岗位可能存在已撤回的旧记录，
   * 不能拿它当幂等命中，否则这次的回复永远不会产生新的 queued 投递。
   */
  async findApplicationByJob(jobId: string): Promise<IdRow | null> {
    const rows = await this.request<IdRow[]>(
      `/api/applications?jobId=${encodeURIComponent(jobId)}&active=true&limit=50`,
    )
    return rows[0] ?? null
  }

  /**
   * P2 只建 `queued`：**不传 appliedAt、不写 applied**。
   * 服务端对同岗位重复投递回 409 + details.applicationId，这里当作幂等命中复用。
   */
  async createApplication(input: ApplicationCreateInput): Promise<string> {
    try {
      const row = await this.post<IdRow>('/api/applications', {
        jobId: input.jobId,
        status: 'queued',
        channel: 'boss',
        actor: 'rule',
        source: 'rule',
        ...(input.notes ? { notes: input.notes } : {}),
      })
      return row.id
    } catch (error) {
      const details = (error as BridgeError).details as { applicationId?: string } | undefined
      if (error instanceof BridgeError && error.status === 409 && details?.applicationId) {
        return details.applicationId
      }
      throw error
    }
  }

  async appendNote(applicationId: string, note: string): Promise<void> {
    await this.post(`/api/applications/${encodeURIComponent(applicationId)}/notes`, {
      note, actor: 'rule', source: 'rule',
    })
  }

  /** P3 发送简历成功后调用：queued → applied 是合法转移，且必须显式带 appliedAt。 */
  async markApplied(applicationId: string, appliedAt: string, note?: string): Promise<void> {
    await this.post(`/api/applications/${encodeURIComponent(applicationId)}/status`, {
      to: 'applied',
      appliedAt,
      actor: 'rule',
      source: 'rule',
      ...(note ? { note } : {}),
    })
  }

  /** 取岗位详情：建 variant 标题、备注存证都要用 `title`。 */
  async getJob(jobId: string): Promise<{ id: string; title: string; companyId: string; fitScore?: number | null }> {
    return this.request(`/api/jobs/${encodeURIComponent(jobId)}`)
  }

  /**
   * 定制计划：不传 `resumeId` 时由服务端决定母版
   * （该岗位投递绑定的简历 → 默认母版 → 列表第一份），Web / MCP / 扩展口径一致。
   */
  async tailorPlan(jobId: string, resumeId?: string): Promise<TailorPlanPayload> {
    const suffix = resumeId ? `?resumeId=${encodeURIComponent(resumeId)}` : ''
    return this.request(`/api/jobs/${encodeURIComponent(jobId)}/tailor-plan${suffix}`)
  }

  /** 复制母版成 variant；服务端记录 `baseResumeId` 与 `jobId`，用于「哪版带来面试」统计。 */
  async duplicateResume(resumeId: string, input: { jobId?: string; title?: string }): Promise<ResumeRow> {
    return this.post(`/api/resumes/${encodeURIComponent(resumeId)}/duplicate`, input)
  }

  /** 落库前的编造校验：只判断是否新增条目 / 改动公司时间，不判断文采。 */
  async validateTailor(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<{ ok: boolean; violations: unknown[]; message: string }> {
    return this.post('/api/tailor/validate', { before, after })
  }

  /**
   * 落库定制正文。
   *
   * 刻意**不带 provenance**：provenance 的语义是「哪个 Agent Skill 产出的」，
   * 扩展是本地确定性代码（0 token），登记一个假 Skill 会污染「AI 改的简历」统计，
   * 也会让 Agent 的技能列表里多出一个不可调用的条目。取舍见提案 §13 未决项。
   */
  async patchResume(resumeId: string, data: Record<string, unknown>): Promise<ResumeRow> {
    return this.request(`/api/resumes/${encodeURIComponent(resumeId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ data }),
    })
  }

  /** 导出 PDF 字节：上传 BOSS 附件管理要用的就是这份字节，不是文件路径。 */
  async exportResumePdf(resumeId: string): Promise<PdfPayload> {
    return this.requestBinary(`/api/resumes/${encodeURIComponent(resumeId)}/export?download=true`, {
      method: 'POST',
      body: '{}',
    })
  }
}
