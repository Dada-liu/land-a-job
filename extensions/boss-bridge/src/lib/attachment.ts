import type { StagedJob } from './types.js'

/**
 * P3 上传与发送的**纯策略层**：能做什么、按什么顺序做、什么情况下必须停。
 *
 * 真正碰 DOM 的动作在内容脚本里（`entrypoints/content.ts`），这里只产出计划，
 * 这样「什么时候不该发」可以单测，不用起浏览器。
 */

/** Boss 上传弹窗实测写「文件大小不超过 20M」；超了本地先拦，别等接口报错 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/** 文件名里的非法字符按 Boss 侧行为保守处理：保留中文，去掉路径分隔与引号 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const withExt = cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`
  return withExt.slice(0, 120)
}

export interface UploadStep {
  key: string
  label: string
  /** 对应 selectors.ts 里的条目；miss 时整条流程停下转人工 */
  selectorKey: string
  optional: boolean
}

/**
 * 附件管理的动作序列（`https://www.zhipin.com/web/geek/recommend`）。
 *
 * 刻意拆成「打开页面 → 找到上传控件 → 注入文件 → 等回执」四步：
 * 任何一步失败都能定位到具体选择器，而不是一句「上传失败」。
 */
export const UPLOAD_STEPS: UploadStep[] = [
  { key: 'open', label: '打开附件管理页', selectorKey: 'attachmentPage', optional: false },
  { key: 'entry', label: '进入「附件简历」分区', selectorKey: 'attachmentEntry', optional: false },
  { key: 'input', label: '定位上传输入框', selectorKey: 'attachmentFileInput', optional: false },
  { key: 'upload', label: '注入 PDF 并等待上传回执', selectorKey: 'attachmentUploaded', optional: false },
]

/** 发送的动作序列（聊天页）；最后一下点击永远留给用户 */
export const SEND_STEPS: UploadStep[] = [
  { key: 'openChat', label: '打开消息页', selectorKey: 'chatPage', optional: false },
  { key: 'locate', label: '定位回复的那条会话', selectorKey: 'conversationItem', optional: false },
  { key: 'attach', label: '打开附件面板并选中刚上传的简历', selectorKey: 'chatAttachButton', optional: false },
  { key: 'confirm', label: '等用户点「发送」（扩展不代点）', selectorKey: 'chatSendButton', optional: false },
]

export interface Gate {
  ok: boolean
  reason: string
}

/** 上传前的闸门：没有落库结果、没有简历、超过体积上限都不许开始 */
export function canUpload(job: StagedJob, bytes?: number): Gate {
  if (job.manual) return { ok: false, reason: '用户已接手该会话，自动化停止' }
  if (!job.landSync?.applicationId) return { ok: false, reason: '岗位/投递还没落库，先跑 P2' }
  if (!job.resumeVariantId) return { ok: false, reason: '还没有定制版简历，先跑定制' }
  if (bytes !== undefined && bytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: `PDF ${Math.round(bytes / 1024)}KB 超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB 上限` }
  }
  return { ok: true, reason: '可以上传' }
}

/**
 * 发送前的闸门：附件必须先确认上传成功。
 *
 * 这是「没发出去绝不写 applied」的第一道保险——即使调用方顺序写错，
 * 这里也会拦住，而不是让投递记录凭空变成已投。
 */
export function canSend(job: StagedJob): Gate {
  if (job.manual) return { ok: false, reason: '用户已接手该会话，自动化停止' }
  if (!job.landSync?.applicationId) return { ok: false, reason: '投递记录不存在' }
  if (!job.uploadedAt || !job.attachmentName) return { ok: false, reason: '附件还没上传成功，不能发送' }
  if (job.sentAt) return { ok: false, reason: '这条已经发送过了' }
  return { ok: true, reason: '等你确认发送' }
}

/** 上传与发送都完成后才算「投递到达」——`applied` 的判定入口 */
export function isDelivered(job: StagedJob): boolean {
  return Boolean(job.sentAt && job.uploadedAt && job.landSync?.applicationId)
}
