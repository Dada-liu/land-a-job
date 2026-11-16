import { describe, expect, it } from 'vitest'
import {
  canSend,
  canUpload,
  isDelivered,
  MAX_ATTACHMENT_BYTES,
  sanitizeFileName,
  SEND_STEPS,
  UPLOAD_STEPS,
} from '../src/lib/attachment.js'
import type { StagedJob } from '../src/lib/types.js'

function staged(patch: Partial<StagedJob> = {}): StagedJob {
  return {
    key: 'sec-1',
    url: 'https://www.zhipin.com/job_detail/sec-1.html',
    jobName: '前端开发',
    brandName: '拓保软件',
    bossActive: { online: true, capturedAt: 1794454000000, source: 'detail' },
    state: 'tailored',
    isNew: true,
    capturedAt: 1794454000000,
    landSync: {
      companyId: 'c-1', jobId: 'j-1', applicationId: 'a-1', syncedAt: 1794454310204,
      reused: { company: false, job: false, application: false },
    },
    resumeVariantId: 'r-variant',
    ...patch,
  }
}

describe('上传闸门', () => {
  it('落库 + 定制都就绪才允许上传', () => {
    expect(canUpload(staged()).ok).toBe(true)
  })

  it('没有 P2 落库结果时拒绝', () => {
    const gate = canUpload(staged({ landSync: undefined }))
    expect(gate.ok).toBe(false)
    expect(gate.reason).toContain('P2')
  })

  it('没有定制版时拒绝', () => {
    expect(canUpload(staged({ resumeVariantId: undefined })).reason).toContain('定制')
  })

  it('超过 10MB 在本地就拦下', () => {
    const gate = canUpload(staged(), MAX_ATTACHMENT_BYTES + 1)
    expect(gate.ok).toBe(false)
    expect(gate.reason).toContain('MB')
  })

  it('用户接手后一律停', () => {
    expect(canUpload(staged({ manual: true })).ok).toBe(false)
  })
})

describe('发送闸门（没上传成功绝不发）', () => {
  it('附件没上传成功时拒绝发送', () => {
    const gate = canSend(staged())
    expect(gate.ok).toBe(false)
    expect(gate.reason).toContain('附件还没上传')
  })

  it('上传成功后进入等用户确认状态', () => {
    const gate = canSend(staged({ uploadedAt: 1794454400000, attachmentName: '张三_前端开发.pdf' }))
    expect(gate.ok).toBe(true)
    expect(gate.reason).toContain('确认发送')
  })

  it('已经发送过的记录不再重复发', () => {
    const gate = canSend(staged({
      uploadedAt: 1794454400000, attachmentName: 'a.pdf', sentAt: 1794454500000,
    }))
    expect(gate.ok).toBe(false)
    expect(gate.reason).toContain('已经发送')
  })
})

describe('投递到达判定与文件名', () => {
  it('只有真正发出去才算到达（P3 推进 applied 的依据）', () => {
    expect(isDelivered(staged({ uploadedAt: 1, attachmentName: 'a.pdf' }))).toBe(false)
    expect(isDelivered(staged({ uploadedAt: 1, attachmentName: 'a.pdf', sentAt: 2 }))).toBe(true)
  })

  it('文件名去掉路径与引号，自动补 .pdf 并限长', () => {
    expect(sanitizeFileName('张三/前端:定制"版"')).toBe('张三_前端_定制_版_.pdf')
    expect(sanitizeFileName('张三_前端.pdf')).toBe('张三_前端.pdf')
    expect(sanitizeFileName('a'.repeat(300)).length).toBeLessThanOrEqual(120)
  })

  it('上传/发送的步骤键唯一，便于定位失败点', () => {
    const keys = [...UPLOAD_STEPS, ...SEND_STEPS].map((step) => step.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
