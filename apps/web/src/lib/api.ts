export interface HealthPayload {
  ok: boolean
  service: string
  version: string
  uptimeSec: number
  port: number
  db: { version: number; tables: number }
  ws: { clients: number }
  skills: string[]
}

export interface OverviewPayload {
  companies: number
  jobs: number
  resumes: number
  applications: number
  active: number
  byStatus: Record<string, number>
}

export interface ListMeta {
  limit: number
  nextCursor: string | null
}

interface Envelope<T> {
  data: T
  meta?: ListMeta
}

/**
 * 服务端错误统一抛这个类型。
 * 页面需要区分「参数错了」「状态机不许」「被人先改了」三种情况，所以带上 code 与 details。
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = 'UNKNOWN',
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let tokenPromise: Promise<string> | null = null

/**
 * 单次自举的超时。
 * 代理层在「连不上上游」时偶尔会把连接挂住不回包；没有超时，页面会永远停在
 * 「读取中」，连错误都看不到（比报错难查得多）。5s 足够本地服务启动应答。
 */
const BOOTSTRAP_TIMEOUT_MS = 5000

async function fetchBootstrapToken(): Promise<string> {
  const res = await fetch('/api/bootstrap', { cache: 'no-store', signal: AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS) })
  if (!res.ok) {
    throw new ApiError(
      `无法获取本机令牌（HTTP ${res.status}）：本地服务未就绪，确认 npm run dev 的 server 已启动（日志 data/logs/server.log）`,
      res.status,
      'BOOTSTRAP_FAILED',
    )
  }
  const body = (await res.json()) as { token?: string }
  if (!body.token) throw new ApiError('bootstrap 未返回令牌', res.status, 'BOOTSTRAP_EMPTY')
  return body.token
}

/**
 * 令牌只向本地服务要一次，之后所有请求复用。
 * 页面与 API 同源，所以这里不需要任何 CORS 配置，也就没有把令牌暴露给第三方站点的途径。
 *
 * 两条必须守住的约定：
 * - **失败不缓存**：把 rejected promise 存起来，会让整个页面直到硬刷新都报同一个错；
 * - **单次尝试、必须结算**：这里不做重试。重试交给 react-query（它限次数、有退避），
 *   恢复交给 App 里的「健康检查回到正常 → 作废重取」。在自举里套重试会与轮询叠乘，
 *   既把失败反馈拖到半分钟，又让页面看起来像卡死。
 */
export function getToken(): Promise<string> {
  tokenPromise ??= fetchBootstrapToken().catch((error: unknown) => {
    tokenPromise = null
    throw error
  })
  return tokenPromise
}

/** 令牌文件被换掉（重装 / 换了数据目录）后，401 应当让下一次请求重新自举 */
function invalidateToken(): void {
  tokenPromise = null
}

async function readError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }
    return new ApiError(body.error?.message ?? `HTTP ${res.status}`, res.status, body.error?.code, body.error?.details)
  } catch {
    return new ApiError(`HTTP ${res.status}`, res.status)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken()
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'x-land-token': token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })
  if (res.status === 401) invalidateToken()
  if (!res.ok) throw await readError(res)
  const payload = (await res.json()) as Envelope<T>
  return payload.data
}

export const apiGet = <T>(path: string): Promise<T> => request<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body)
export const apiPatch = <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body)
export const apiDelete = <T>(path: string, body?: unknown): Promise<T> => request<T>('DELETE', path, body)

export const getHealth = (): Promise<HealthPayload> => apiGet<HealthPayload>('/health')
export const getOverview = (): Promise<OverviewPayload> => apiGet<OverviewPayload>('/stats/overview')

/* ------------------------------- 简历 ------------------------------- */

export interface ResumeDto {
  id: string
  title: string
  kind: string
  templateId: string
  /** 正文结构由 resume-kit 定义，这里不重复声明字段 */
  data: Record<string, unknown>
  baseResumeId: string | null
  jobId: string | null
  isDefault: boolean
  provenance: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ResumeCreateInput {
  title: string
  templateId?: string
  /** 正文结构由 resume-kit 定义，服务端只按「对象 + 体积上限」校验 */
  data?: object
  kind?: 'master' | 'variant'
  baseResumeId?: string | null
  jobId?: string | null
  isDefault?: boolean
}

export interface ResumePatchInput {
  title?: string
  templateId?: string
  data?: object
  isDefault?: boolean
  /** 乐观锁：带上读到的 updatedAt，过期则服务端 409 VERSION_CONFLICT */
  expectedUpdatedAt?: string
}

export const listResumes = async (): Promise<ResumeDto[]> =>
  apiGet<ResumeDto[]>('/resumes?limit=200')
export const getResume = (id: string): Promise<ResumeDto> => apiGet<ResumeDto>(`/resumes/${id}`)
export const createResume = (body: ResumeCreateInput): Promise<ResumeDto> =>
  apiPost<ResumeDto>('/resumes', body)
export const patchResume = (id: string, body: ResumePatchInput): Promise<ResumeDto> =>
  apiPatch<ResumeDto>(`/resumes/${id}`, body)
export const duplicateResume = (id: string, body: { title?: string } = {}): Promise<ResumeDto> =>
  apiPost<ResumeDto>(`/resumes/${id}/duplicate`, body)
export const deleteResume = (id: string): Promise<{ id: string; deleted: boolean }> =>
  apiDelete<{ id: string; deleted: boolean }>(`/resumes/${id}`)

/* ------------------------------- 公司 ------------------------------- */

export interface CompanyDto {
  id: string
  name: string
  website: string | null
  industry: string | null
  size: string | null
  city: string | null
  priority: number
  applyEntry: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  jobCount?: number
}

export interface CompanyInput {
  name: string
  website?: string | null
  industry?: string | null
  size?: string | null
  city?: string | null
  priority?: number
  applyEntry?: string | null
  notes?: string | null
}

export const listCompanies = (params: { q?: string; limit?: number } = {}): Promise<CompanyDto[]> => {
  const search = new URLSearchParams({ limit: String(params.limit ?? 100) })
  if (params.q) search.set('q', params.q)
  return apiGet<CompanyDto[]>(`/companies?${search.toString()}`)
}
export const getCompany = (id: string): Promise<CompanyDto & { jobs: JobSummaryDto[] }> =>
  apiGet<CompanyDto & { jobs: JobSummaryDto[] }>(`/companies/${id}`)
export const createCompany = (body: CompanyInput): Promise<CompanyDto> => apiPost<CompanyDto>('/companies', body)
export const patchCompany = (id: string, body: Partial<CompanyInput>): Promise<CompanyDto> =>
  apiPatch<CompanyDto>(`/companies/${id}`, body)
export const deleteCompany = (id: string, cascade = false): Promise<{ id: string }> =>
  apiDelete<{ id: string }>(`/companies/${id}${cascade ? '?cascade=true' : ''}`)

/* ------------------------------- 岗位 ------------------------------- */

export interface JobSummaryDto {
  id: string
  companyId: string
  title: string
  jdUrl: string | null
  jdSource: string | null
  channel: string
  city: string | null
  salaryMin: number | null
  salaryMax: number | null
  level: string | null
  keywords: string[] | null
  fitScore: number | null
  fitReasons: string[] | null
  fitSource: string
  status: string
  priority: number
  notes: string | null
  createdAt: string
  updatedAt: string
  companyName?: string
  applicationId?: string | null
}

export interface JobDto extends JobSummaryDto {
  jdText: string | null
  jdSnapshot: string | null
}

export interface JobInput {
  companyId: string
  title: string
  jdUrl?: string | null
  channel?: string
  city?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  level?: string | null
  keywords?: string[] | null
  status?: string
  priority?: number
  notes?: string | null
  jdText?: string | null
}

export interface JobListParams {
  q?: string
  companyId?: string
  status?: string
  minFit?: number
  sort?: 'fit' | 'priority' | 'updated'
  withApplication?: boolean
  limit?: number
}

export const listJobs = async (params: JobListParams = {}): Promise<JobSummaryDto[]> => {
  const search = new URLSearchParams({ limit: String(params.limit ?? 100) })
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || key === 'limit') continue
    search.set(key, String(value))
  }
  return apiGet<JobSummaryDto[]>(`/jobs?${search.toString()}`)
}
export const getJob = (id: string): Promise<JobDto> => apiGet<JobDto>(`/jobs/${id}`)
export const createJob = (body: JobInput): Promise<JobDto> => apiPost<JobDto>('/jobs', body)
export const patchJob = (id: string, body: Partial<JobInput> & Record<string, unknown>): Promise<JobDto> =>
  apiPatch<JobDto>(`/jobs/${id}`, body)
export const deleteJob = (id: string): Promise<{ id: string; deleted: boolean }> =>
  apiDelete<{ id: string; deleted: boolean }>(`/jobs/${id}`)

/* ------------------------------- 投递 ------------------------------- */

export interface ApplicationDto {
  id: string
  jobId: string
  resumeId: string | null
  status: string
  channel: string
  appliedAt: string | null
  statusAt: string
  contact: string | null
  nextActionAt: string | null
  confidence: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface ApplicationListItemDto extends ApplicationDto {
  jobTitle?: string
  companyName?: string
  companyId?: string
  daysInStatus?: number
  nextStatuses?: string[]
}

export interface ApplicationEventDto {
  id: string
  applicationId: string
  type: string
  fromStatus: string | null
  toStatus: string | null
  payload: unknown
  actor: string
  source: string
  at: string
}

export interface ApplicationInput {
  jobId: string
  resumeId?: string | null
  status?: string
  channel?: string
  appliedAt?: string | null
  contact?: string | null
  nextActionAt?: string | null
  notes?: string | null
  actor?: string
  source?: string
}

export const listApplications = (params: { active?: boolean; limit?: number } = {}): Promise<ApplicationListItemDto[]> => {
  const search = new URLSearchParams({ limit: String(params.limit ?? 200) })
  if (params.active) search.set('active', 'true')
  return apiGet<ApplicationListItemDto[]>(`/applications?${search.toString()}`)
}
export const getApplication = (id: string): Promise<ApplicationListItemDto> =>
  apiGet<ApplicationListItemDto>(`/applications/${id}`)
export const createApplication = (body: ApplicationInput): Promise<ApplicationDto> =>
  apiPost<ApplicationDto>('/applications', body)
export const patchApplication = (id: string, body: Record<string, unknown>): Promise<ApplicationDto> =>
  apiPatch<ApplicationDto>(`/applications/${id}`, body)
export const changeStatus = (
  id: string,
  body: { to: string; note?: string; force?: boolean; reason?: string; appliedAt?: string },
): Promise<{ id: string; from: string; to: string; forced: boolean; application: ApplicationDto }> =>
  apiPost(`/applications/${id}/status`, body)
export const appendNote = (id: string, note: string): Promise<ApplicationEventDto> =>
  apiPost<ApplicationEventDto>(`/applications/${id}/notes`, { note })
export const getTimeline = (id: string): Promise<ApplicationEventDto[]> =>
  apiGet<ApplicationEventDto[]>(`/applications/${id}/timeline`)
export const deleteApplication = (id: string): Promise<{ id: string; deleted: boolean }> =>
  apiDelete<{ id: string; deleted: boolean }>(`/applications/${id}`)

/* ------------------------------- 面试 ------------------------------- */

export interface InterviewDto {
  id: string
  applicationId: string
  round: number
  kind: string
  scheduledAt: string | null
  durationMin: number | null
  format: string | null
  interviewer: string | null
  location: string | null
  prepStatus: string
  feedback: string | null
  selfRating: number | null
  result: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface InterviewInput {
  applicationId: string
  round?: number
  kind?: string
  scheduledAt?: string | null
  durationMin?: number | null
  format?: string | null
  interviewer?: string | null
  location?: string | null
  prepStatus?: string
  notes?: string | null
}

export const listInterviews = (params: { upcoming?: boolean } = {}): Promise<InterviewDto[]> => {
  const search = new URLSearchParams()
  if (params.upcoming) search.set('upcoming', 'true')
  const suffix = search.toString()
  return apiGet<InterviewDto[]>(`/interviews${suffix ? `?${suffix}` : ''}`)
}
export const createInterview = (body: InterviewInput): Promise<InterviewDto> =>
  apiPost<InterviewDto>('/interviews', body)
export const patchInterview = (id: string, body: Record<string, unknown>): Promise<InterviewDto> =>
  apiPatch<InterviewDto>(`/interviews/${id}`, body)
export const deleteInterview = (id: string): Promise<{ id: string; deleted: boolean }> =>
  apiDelete<{ id: string; deleted: boolean }>(`/interviews/${id}`)

/* ------------------------------- Offer ------------------------------- */

/**
 * Offer 的口径参数（风险折扣、定性评分、专项附加扣除）存在 `assumptions` 这个 JSON 列里。
 * 不为它们各开一列的理由：这些是「用户当下的假设」，不是事实数据，改口径不该改表结构。
 * 读写都走 `lib/offer.ts` 里的 `readOfferSettings`，避免各处自己拼 key。
 */
export interface OfferDto {
  id: string
  applicationId: string
  companyName: string
  level: string | null
  city: string | null
  baseMonthly: number
  monthsPerYear: number
  perfMonths: number
  signon: number
  equityShares: number
  equityStrike: number
  equityFmv: number
  vestYears: number
  cliffMonths: number
  housingFund: number
  subsidyMonthly: number
  deadline: string | null
  status: string
  assumptions: Record<string, unknown> | null
  decisionNote: string | null
  createdAt: string
  updatedAt: string
}

export interface OfferInput {
  applicationId: string
  companyName: string
  level?: string | null
  city?: string | null
  baseMonthly: number
  monthsPerYear?: number
  perfMonths?: number
  signon?: number
  equityShares?: number
  equityStrike?: number
  equityFmv?: number
  vestYears?: number
  cliffMonths?: number
  housingFund?: number
  subsidyMonthly?: number
  deadline?: string | null
  status?: string
  assumptions?: Record<string, unknown> | null
  decisionNote?: string | null
}

export const listOffers = async (params: { status?: string; limit?: number } = {}): Promise<OfferDto[]> => {
  const search = new URLSearchParams({ limit: String(params.limit ?? 50) })
  if (params.status) search.set('status', params.status)
  return apiGet<OfferDto[]>(`/offers?${search.toString()}`)
}
export const getOffer = (id: string): Promise<OfferDto> => apiGet<OfferDto>(`/offers/${id}`)
export const createOffer = (body: OfferInput): Promise<OfferDto> => apiPost<OfferDto>('/offers', body)
export const patchOffer = (id: string, body: Partial<OfferInput>): Promise<OfferDto> =>
  apiPatch<OfferDto>(`/offers/${id}`, body)

/* ------------------------------- 题库 ------------------------------- */

/** 三维评分：内容 / 结构 / 表达，各 1–5。缺项表示「这一维还没评」，不按 0 算 */
export interface AnswerScoreDto {
  content?: number
  structure?: number
  delivery?: number
}

export interface ProvenanceDto {
  skill: string
  skillVersion: string
  model?: string | null
  at?: string | null
}

export interface QuestionDto {
  id: string
  interviewId: string | null
  jobId: string | null
  category: string
  question: string
  intent: string | null
  linkedItem: string | null
  myAnswer: string | null
  score: AnswerScoreDto | null
  improvement: string | null
  origin: string
  provenance: ProvenanceDto | null
  createdAt: string
}

export interface QuestionInput {
  interviewId?: string | null
  jobId?: string | null
  category?: string
  question: string
  intent?: string | null
  linkedItem?: string | null
  myAnswer?: string | null
  score?: AnswerScoreDto | null
  improvement?: string | null
  origin?: string
}

export const listQuestions = (params: { jobId?: string; interviewId?: string; category?: string; limit?: number } = {}): Promise<
  QuestionDto[]
> => {
  const search = new URLSearchParams({ limit: String(params.limit ?? 200) })
  if (params.jobId) search.set('jobId', params.jobId)
  if (params.interviewId) search.set('interviewId', params.interviewId)
  if (params.category) search.set('category', params.category)
  return apiGet<QuestionDto[]>(`/questions?${search.toString()}`)
}
export const createQuestion = (body: QuestionInput): Promise<QuestionDto> => apiPost<QuestionDto>('/questions', body)
export const patchQuestion = (id: string, body: Omit<QuestionInput, 'question'> & { question?: string }): Promise<QuestionDto> =>
  apiPatch<QuestionDto>(`/questions/${id}`, body)
export const deleteQuestion = (id: string): Promise<{ id: string; deleted: boolean }> =>
  apiDelete<{ id: string; deleted: boolean }>(`/questions/${id}`)

/* ------------------------------- 统计 ------------------------------- */

export interface FunnelStepDto {
  stage: string
  label: string
  reached: number
  conversion: number | null
  dropRate: number | null
  retention: number | null
}

export interface FollowupTaskDto {
  id: string
  kind: 'no_reply' | 'thanks_letter' | 'offer_deadline' | 'stale'
  priority: 'high' | 'normal'
  title: string
  detail: string
  since: string
  days: number
  targetType: 'application' | 'interview' | 'offer'
  targetId: string
  applicationId: string
  companyName: string | null
  jobTitle: string | null
}

export interface ResponseTimeDto {
  medianDays: number | null
  p90Days: number | null
  sample: number
  /** 有投递时间但还没有任何推进的条数（不能当 0 天算） */
  waiting: number
  invalid: number
  assumptions: string[]
}

export interface DashboardPayload {
  northStar: { label: string; value: number; target: number; hint: string }
  funnel: FunnelStepDto[]
  today: FollowupTaskDto[]
  week: { start: string; newJobs: number; newApplications: number; submitted: number; effective: number }
  totals: OverviewPayload & { resumes?: number }
  upcoming: { interviews: number; offersPending: number }
  responseTime: ResponseTimeDto
}

export const getDashboard = (): Promise<DashboardPayload> => apiGet<DashboardPayload>('/stats/dashboard')

export interface ResumePerformanceDto {
  resumeId: string
  resumeTitle: string
  applied: number
  interviewed: number
  offered: number
  /** 样本 < 3 时为 null，页面显示「样本不足」 */
  interviewRate: number | null
  offerRate: number | null
  enough: boolean
}

export const getResumePerformance = (): Promise<ResumePerformanceDto[]> =>
  apiGet<ResumePerformanceDto[]>('/stats/resume-performance')

/* ------------------------------ 本机偏好 ------------------------------ */

export interface SettingsDto {
  /** 本周有效投递目标（北极星的分母），默认 8，总览页可改 */
  weeklyTarget: number
}

export const getSettings = (): Promise<SettingsDto> => apiGet<SettingsDto>('/settings')

export const patchSettings = (body: { weeklyTarget: number }): Promise<SettingsDto> =>
  apiPatch<SettingsDto>('/settings', body)

/* ------------------------------ JD 与 fit ------------------------------ */

export interface JdSignalsDto {
  tech: string[]
  years: { min: number; max: number } | null
  education: string | null
  cities: string[]
  salary: { min: number | null; max: number | null } | null
}

export interface JdSourceDto {
  kind: string
  host: string
  adapter: string | null
  trusted: boolean
  label: string
}

export interface JdStructuredDto {
  title?: string | null
  company?: string | null
  city?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  level?: string | null
  postedAt?: string | null
  applyUrl?: string | null
}

/** 抓取与粘贴两条入口返回同一形状，页面与 Agent 不必各学一套 */
export interface JdCollectionDto {
  job: JobDto
  signals: JdSignalsDto
  snapshot: string
  source: JdSourceDto
  canonicalUrl: string | null
  warnings: string[]
  structured: JdStructuredDto
  provider: string
}

export const fetchJd = (jobId: string, url?: string): Promise<JdCollectionDto> =>
  apiPost(`/jobs/${jobId}/fetch-jd`, url ? { url } : {})

export const importJd = (
  jobId: string,
  text: string,
  url?: string,
  capturedBy: 'paste' | 'browser' = 'paste',
): Promise<JdCollectionDto> =>
  apiPost(`/jobs/${jobId}/import-jd`, { text, capturedBy, ...(url ? { url } : {}) })

export interface FitFactorDto {
  key: string
  weight: number
  score: number
  evidence: string
}

export const scoreJob = (
  jobId: string,
  body: { resumeId?: string; expectedSalary?: number; mustHave?: string[] } = {},
): Promise<{ job: JobDto; fit: { score: number; factors: FitFactorDto[]; capped: boolean }; resumeId: string | null }> =>
  apiPost(`/jobs/${jobId}/score`, body)

/* ------------------------------ 定制简历 ------------------------------ */

export interface TailorPlanDto {
  summaryHints: string[]
  reorderProjects: string[]
  reorderSkills: string[]
  gap: { keyword: string; severity: 'blocking' | 'important' | 'nice'; suggestion: string }[]
  mustNotInvent: true
  constraints: string[]
  match: { jdTech: number; matched: number; ratio: number }
}

export const getTailorPlan = (
  jobId: string,
  resumeId?: string,
): Promise<{ jobId: string; resumeId: string; resumeTitle: string; plan: TailorPlanDto; instruction: string }> =>
  apiGet(`/jobs/${jobId}/tailor-plan${resumeId ? `?resumeId=${resumeId}` : ''}`)

export const validateTailor = (
  before: object,
  after: object,
): Promise<{ ok: boolean; violations: { kind: string; message: string }[]; message: string }> =>
  apiPost('/tailor/validate', { before, after })

/* ------------------------------ 投递助手 ------------------------------ */

export interface ApplyFieldDto {
  key: string
  tag: string
  type: string | null
  name: string | null
  id: string | null
  label: string
  placeholder: string | null
  options: string[] | null
  required: boolean
}

export interface ApplySessionDto {
  id: string
  jobId: string
  resumeId: string | null
  url: string
  status: 'open' | 'filled' | 'blocked' | 'submitted' | 'closed'
  step: number
  fields: ApplyFieldDto[]
  manualFields: string[]
  createdAt: string
  updatedAt: string
  blocker?: { blocked: boolean; kind?: string; reason?: string }
  fillResults?: { key: string; ok: boolean; reason?: string }[]
  headless: boolean
}

export const openApplySession = (body: {
  jobId: string
  resumeId?: string | null
  url?: string
  headless?: boolean
}): Promise<ApplySessionDto> => apiPost('/apply/sessions', body)

export const getApplySession = (id: string): Promise<ApplySessionDto> => apiGet(`/apply/sessions/${id}`)

export const inspectApplySession = (id: string): Promise<ApplySessionDto> => apiPost(`/apply/sessions/${id}/inspect`)

export const fillApplySession = (id: string, values: Record<string, string>): Promise<ApplySessionDto> =>
  apiPost(`/apply/sessions/${id}/fill`, { values })

export const submitApplySession = (
  id: string,
  confirm: boolean,
  /** 「直接投递」弹窗里选的渠道；不传时服务端沿用 official（旧调用/MCP 不受影响） */
  channel?: string,
): Promise<{
  finalUrl: string
  screenshotPath: string | null
  buttonText: string | null
  emptyRequired: string[]
  application: ApplicationDto
}> => apiPost(`/apply/sessions/${id}/submit`, { confirm, channel })

export const closeApplySession = (id: string): Promise<{ id: string; closed: boolean }> =>
  apiDelete(`/apply/sessions/${id}`)

export const getCurrentApplySession = (): Promise<{ session: ApplySessionDto | null }> =>
  apiGet('/apply/sessions/current')

/* ------------------------------ Skill 状态 ------------------------------ */

/** 与 core 的 SkillStatus 对齐：compatible=false 时 note 里写着原因与升级命令 */
export interface SkillStatusDto {
  name: string
  version: string
  minVersion: string
  title: string
  purpose: string
  writeTools: string[]
  compatible: boolean
  note?: string
}

export interface SkillScanDto {
  dir: string | null
  versions: Record<string, string>
  targets: { dir: string; path: string; installed: string[] }[]
  skills: SkillStatusDto[]
}

export const getSkills = (): Promise<SkillScanDto> => apiGet<SkillScanDto>('/skills')

/* ------------------------------ 备份与导出 ------------------------------ */

export interface SnapshotDto {
  file: string
  createdAt: string
  bytes: number
}

export const listSnapshots = (): Promise<{ dir: string; keep: number; items: SnapshotDto[] }> =>
  apiGet('/data/snapshots')

export const createSnapshot = (): Promise<SnapshotDto & { kept: number; removed: string[] }> =>
  apiPost('/data/snapshots')

export interface ExportDumpDto {
  exportedAt: string
  app: { service: string; version: string; schemaVersion: number }
  counts: Record<string, number>
  tables: Record<string, unknown[]>
}

export const getExportDump = (): Promise<ExportDumpDto> => apiGet('/data/export')

/**
 * 导出下载：必须自己 fetch 再存 blob。
 * 直接 `window.open('/api/data/export?download=1')` 不会带上 X-Land-Token，
 * 结果是一张 401 的 JSON 而不是文件——这种「看起来点得动但下不来」最难解释。
 */
export async function downloadExport(): Promise<{ filename: string; bytes: number }> {
  const token = await getToken()
  const res = await fetch('/api/data/export?download=1', {
    headers: { 'x-land-token': token },
    cache: 'no-store',
  })
  if (!res.ok) throw await readError(res)
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'land-export.json'
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // 立刻 revoke 会让某些浏览器来不及读完 blob，下一轮再收
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { filename, bytes: blob.size }
}
