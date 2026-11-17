/** 提案 §5 的暂存区模型；所有字段只来自被动旁听，不落的业务库。 */
export type StageState =
  | 'discovered'
  | 'filtered_out'
  | 'needs_detail'
  | 'ready'
  | 'greeted'
  | 'replied'
  | 'tailored'
  | 'uploaded'
  | 'sent'
  | 'archived'

export interface BossActive {
  online?: boolean
  desc?: string
  /** 仅当将来在 zpData.bossInfo 下观察到 HR 自己的时间戳才启用；公司活跃时间不写这里 */
  activeTime?: number
  capturedAt: number
  source: 'list' | 'detail'
}

export interface StagedJob {
  /**
   * 主键：**优先 `encryptJobId`**（同一岗位在所有入口都是同一个值），
   * 没有时才退到 `securityId`，再没有才用「公司::岗位」。
   *
   * 为什么不用 securityId：BOSS 对同一个岗位在不同列表页会返回不同的 securityId
   * （实测见过 332/380 两种长度），拿它当主键会在每次换列表页时多出一条重复记录。
   */
  key: string
  /** 岗位的 securityId：不再当主键，但详情页响应只带它，命中靠它反查 */
  securityId?: string
  /** 记录来源：joblist 是正常抓到岗位卡片，conversation 是从会话列表反向补建的 */
  origin?: 'joblist' | 'conversation'
  url: string
  jobName: string
  brandName: string
  salaryDesc?: string
  city?: string
  encryptJobId?: string
  encryptBossId?: string
  lid?: string
  /** 回复前 JD 正文只存这里，绝不写 land-a-job 岗位库 */
  jdText?: string
  bossActive: BossActive
  bossFreezeStatus?: number
  bossPreFreezeStatus?: number
  greetDraft?: string
  conversationId?: string
  /** 触发落库的那条回复 msgId：落库幂等与备注存证都用它 */
  replyMsgId?: number
  /** P2 延迟落库的结果；存在即表示已同步，不再重复建数据 */
  landSync?: LandSyncRecord
  /** P3：定制版简历 id（variant），发出去的就是这一版 */
  resumeVariantId?: string
  /** P3：导出的 PDF 元信息（字节不落 storage，只留证据） */
  resumeExport?: ResumeExportRecord
  /** P3：附件已上传到 Boss 附件管理的时间 */
  uploadedAt?: number
  /** P3：附件在 Boss 侧的名字，发送时用它定位 */
  attachmentName?: string
  /** P3：确认发送成功的时间与消息 id */
  sentAt?: number
  sentMsgId?: number
  /** 已确认发出、但还没落库（缺 JD）时的暂存证据；landSync 出现后自动补推 applied */
  pendingApplied?: { at: number; msgId?: number; evidence?: string }
  state: StageState
  isNew: boolean
  capturedAt: number
  greetedAt?: number
  /** 定制招呼语已发出的时间；默认招呼语的时间记在 greetedAt */
  greetSentAt?: number
  repliedAt?: number
  /** 用户自己接手了会话时置 true，自动化立即停止（ai-job 原则） */
  manual?: boolean
  notes?: string
}

export interface LandSyncRecord {
  companyId: string
  jobId: string
  applicationId: string
  replyMsgId?: number
  syncedAt: number
  reused: { company: boolean; job: boolean; application: boolean }
  fitScore?: number | null
}

/** 服务端 tailor-plan 的纯规则产物（packages/core/src/tailor.ts 的镜像，只取扩展要用的字段）。 */
export interface TailorGap {
  keyword: string
  severity: 'blocking' | 'important' | 'nice'
  suggestion: string
}

export interface TailorPlan {
  summaryHints: string[]
  reorderProjects: string[]
  reorderSkills: string[]
  gap: TailorGap[]
  mustNotInvent: true
  constraints: string[]
  match: { jdTech: number; matched: number; ratio: number }
}

export interface TailorPlanPayload {
  jobId: string
  resumeId: string
  resumeTitle: string
  resumeSource: 'explicit' | 'application' | 'master'
  plan: TailorPlan
  instruction: string
}

export interface ResumeRow {
  id: string
  title: string
  kind: string
  data: Record<string, unknown>
  isDefault?: boolean
}

export interface ResumeExportRecord {
  fileName: string
  bytes: number
  exportedAt: number
}

export interface PdfPayload {
  bytes: Uint8Array
  fileName: string
}

export interface ConversationSnapshot {  msgId: number
  lastTS: number
  fromId: number
  toId: number
  status: number
  lastMsg: string
  uid: number
  brandName?: string
  jobId?: number
  encryptBossId?: string
  encryptJobId?: string
}

export interface BridgeSettings {
  /** 默认 127.0.0.1:4399；dev 下真实端口由 LAND_API_PORT 决定，可手改 */
  apiBase: string
  /** 本机 API 令牌，GET /api/bootstrap 同源可读，扩展需用户手动粘贴一次 */
  token: string
  /** 默认 true：只产出草稿与预览，绝不点击发送 */
  dryRun: boolean
  /** 是否允许扩展自动打开候选详情页（仍走页面导航，不调用写接口） */
  autoOpenDetail: boolean
  greetingTemplate: string
  /** 招呼语里允许出现、且简历里确实有的关键词，默认空＝不编造 */
  highlights: string[]
}

export interface StagingData {
  jobs: Record<string, StagedJob>
  /** 上一轮会话快照，用于 msgId 游标去重 */
  conversations: Record<string, ConversationSnapshot>
  /** 同一天多轮折叠为一轮 */
  runDay: string
  dailyCount: number
  dailyDay: string
  requestBudgetUsed: number
  lastUpdated: number
}

export type ResponseKind = 'joblist' | 'detail' | 'friendlist' | 'bossdata' | 'greet' | 'misc'

export interface RateLimitSnapshot {
  actionsToday: number
  actionsInBatch: number
  requestsInRun: number
  tripped: boolean
  tripReason?: string
  backoffStep: number
  lastActionAt: number
}
