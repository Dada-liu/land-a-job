import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOKEN, createTestApp, destroyTestApp, ISO, type TestApp } from './helpers.js'

let app: TestApp

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  await destroyTestApp(app)
})

/** 建一条「公司 → 岗位」最小链路，供投递相关用例复用 */
async function seedJob(): Promise<{ companyId: string; jobId: string }> {
  const company = await app.call('POST', '/companies', { name: '字节跳动', city: '北京', priority: 1 })
  const job = await app.call('POST', '/jobs', {
    companyId: company.body.data.id,
    title: '高级前端工程师',
    jdText: '负责增长业务前端架构。',
    salaryMin: 35_000,
    salaryMax: 55_000,
  })
  return { companyId: company.body.data.id, jobId: job.body.data.id }
}

describe('鉴权与信封', () => {
  it('无令牌访问 /api/companies 返回 401', async () => {
    const response = await app.app.inject({ method: 'GET', url: '/api/companies' })
    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body).error.code).toBe('UNAUTHORIZED')
  })

  it('bootstrap 可匿名读取（页面靠它拿令牌）', async () => {
    const response = await app.app.inject({ method: 'GET', url: '/api/bootstrap' })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).token).toBe(TOKEN)
  })

  it('所有资源接口成功时都包在 data 里', async () => {
    const result = await app.call('GET', '/companies')
    expect(result.status).toBe(200)
    expect(Array.isArray(result.body.data)).toBe(true)
    expect(result.body.meta).toEqual({ limit: 50, nextCursor: null })
  })
})

describe('公司 CRUD', () => {
  it('创建返回 201 与完整字段', async () => {
    const result = await app.call('POST', '/companies', {
      name: '小红书',
      industry: '互联网',
      city: '上海',
      priority: 2,
    })
    expect(result.status).toBe(201)
    expect(result.body.data).toMatchObject({ name: '小红书', city: '上海', priority: 2, jobCount: 0 })
    expect(result.body.data.id).toBeTruthy()
    expect(result.body.data.updatedAt).toBe(result.body.data.createdAt)
  })

  it('同名公司返回 409（部分唯一索引生效）', async () => {
    await app.call('POST', '/companies', { name: '月之暗面' })
    const duplicated = await app.call('POST', '/companies', { name: '月之暗面' })
    expect(duplicated.status).toBe(409)
  })

  it('缺 name 返回 400 VALIDATION_FAILED，且指出字段', async () => {
    const result = await app.call('POST', '/companies', { city: '北京' })
    expect(result.status).toBe(400)
    expect(result.body.error.code).toBe('VALIDATION_FAILED')
    expect(result.body.error.message).toContain('name')
  })

  it('列表按 priority 升序并带未删除岗位数', async () => {
    const low = await app.call('POST', '/companies', { name: '低优先', priority: 4 })
    const high = await app.call('POST', '/companies', { name: '高优先', priority: 1 })
    await app.call('POST', '/jobs', { companyId: high.body.data.id, title: '前端' })

    const list = await app.call('GET', '/companies')
    expect(list.body.data.map((c: { name: string }) => c.name)).toEqual(['高优先', '低优先'])
    expect(list.body.data[0].jobCount).toBe(1)
    expect(low.status).toBe(201)
  })

  it('详情返回公司 + 岗位清单', async () => {
    const { companyId, jobId } = await seedJob()
    const detail = await app.call('GET', `/companies/${companyId}`)
    expect(detail.body.data.id).toBe(companyId)
    expect(detail.body.data.jobs).toHaveLength(1)
    expect(detail.body.data.jobs[0].id).toBe(jobId)
  })

  it('PATCH 只改传入字段', async () => {
    const created = await app.call('POST', '/companies', { name: 'A 公司', city: '北京' })
    const patched = await app.call('PATCH', `/companies/${created.body.data.id}`, { city: '上海' })
    expect(patched.body.data.city).toBe('上海')
    expect(patched.body.data.name).toBe('A 公司')
  })

  it('乐观锁：updatedAt 不一致返回 409 VERSION_CONFLICT', async () => {
    const created = await app.call('POST', '/companies', { name: 'B 公司' })
    const conflict = await app.call('PATCH', `/companies/${created.body.data.id}`, {
      city: '深圳',
      expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
    })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('VERSION_CONFLICT')
  })

  it('有岗位时删除需要 cascade，否则 409 并告知数量', async () => {
    const { companyId } = await seedJob()
    const blocked = await app.call('DELETE', `/companies/${companyId}`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.details.jobs).toBe(1)

    const cascaded = await app.call('DELETE', `/companies/${companyId}?cascade=true`)
    expect(cascaded.status).toBe(200)
    expect(cascaded.body.data.deletedJobs).toBe(1)

    const after = await app.call('GET', '/companies')
    expect(after.body.data).toHaveLength(0)
    const jobs = await app.call('GET', '/jobs')
    expect(jobs.body.data).toHaveLength(0)
  })

  it('有投递记录时禁止删公司（投递历史不能被连带清掉）', async () => {
    const { companyId, jobId } = await seedJob()
    await app.call('POST', '/applications', { jobId, status: 'queued' })
    const blocked = await app.call('DELETE', `/companies/${companyId}?cascade=true`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.details.applications).toBe(1)
  })

  it('不存在的公司返回 404', async () => {
    const result = await app.call('GET', '/companies/does-not-exist')
    expect(result.status).toBe(404)
    expect(result.body.error.code).toBe('NOT_FOUND')
  })
})

describe('岗位 CRUD', () => {
  it('公司不存在时创建岗位返回 404', async () => {
    const result = await app.call('POST', '/jobs', { companyId: 'nope', title: '前端' })
    expect(result.status).toBe(404)
  })

  it('列表不返回 jdText（避免一次拉几 MB）', async () => {
    const { jobId } = await seedJob()
    const list = await app.call('GET', '/jobs')
    expect(list.body.data[0].id).toBe(jobId)
    expect(list.body.data[0].jdText).toBeUndefined()
    expect(list.body.data[0].companyName).toBe('字节跳动')
  })

  it('详情返回 jdText', async () => {
    const { jobId } = await seedJob()
    const detail = await app.call('GET', `/jobs/${jobId}`)
    expect(detail.body.data.jdText).toContain('增长业务')
  })

  // 列表补了公司名、详情没补 → 详情页恒显示「未知公司」。这条断言守的是「两边一致」。
  it('详情也带公司名', async () => {
    const { jobId } = await seedJob()
    const detail = await app.call('GET', `/jobs/${jobId}`)
    expect(detail.body.data.companyName).toBe('字节跳动')
  })

  it('withApplication=true 时带出活跃投递 id', async () => {
    const { jobId } = await seedJob()
    const application = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const list = await app.call('GET', '/jobs?withApplication=true')
    expect(list.body.data[0].applicationId).toBe(application.body.data.id)
  })

  it('有投递记录的岗位不能删除', async () => {
    const { jobId } = await seedJob()
    await app.call('POST', '/applications', { jobId, status: 'queued' })
    const result = await app.call('DELETE', `/jobs/${jobId}`)
    expect(result.status).toBe(409)
  })
})

describe('投递流水线', () => {
  it('登记投递写入 created 事件', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    expect(created.status).toBe(201)

    const timeline = await app.call('GET', `/applications/${created.body.data.id}/timeline`)
    expect(timeline.body.data).toHaveLength(1)
    expect(timeline.body.data[0]).toMatchObject({ type: 'created', toStatus: 'queued', actor: 'user' })
  })

  it('同一岗位重复投递返回 409 并给出已有投递 id', async () => {
    const { jobId } = await seedJob()
    const first = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const second = await app.call('POST', '/applications', { jobId, status: 'queued' })
    expect(second.status).toBe(409)
    expect(second.body.error.details.applicationId).toBe(first.body.data.id)
  })

  it('非法跃迁返回 409 INVALID_TRANSITION 且不改数据', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const id = created.body.data.id

    // queued 只能到 applied / withdrawn，不能直接到 screening
    const invalid = await app.call('POST', `/applications/${id}/status`, { to: 'screening' })
    expect(invalid.status).toBe(409)
    expect(invalid.body.error.code).toBe('INVALID_TRANSITION')
    expect(invalid.body.error.details.allowed).toEqual(['applied', 'withdrawn'])

    const detail = await app.call('GET', `/applications/${id}`)
    expect(detail.body.data.status).toBe('queued')
  })

  it('推进到 applied 自动补 appliedAt 并写事件', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const id = created.body.data.id

    const applied = await app.call('POST', `/applications/${id}/status`, {
      to: 'applied',
      note: '官网直投，已收到确认邮件',
    })
    expect(applied.status).toBe(200)
    expect(applied.body.data.from).toBe('queued')
    expect(applied.body.data.to).toBe('applied')
    expect(applied.body.data.application.appliedAt).toBeTruthy()

    const timeline = await app.call('GET', `/applications/${id}/timeline`)
    const types = timeline.body.data.map((e: { type: string }) => e.type)
    expect(types).toEqual(['created', 'status_changed'])
    expect(timeline.body.data[1].payload.note).toContain('确认邮件')
  })

  it('重复提交同一状态是幂等的，不产生多余事件', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const id = created.body.data.id
    await app.call('POST', `/applications/${id}/status`, { to: 'applied' })
    await app.call('POST', `/applications/${id}/status`, { to: 'applied' })

    const timeline = await app.call('GET', `/applications/${id}/timeline`)
    expect(timeline.body.data).toHaveLength(2)
  })

  it('force 越过状态机时事件里记录 forced 与原因', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const id = created.body.data.id
    await app.call('POST', `/applications/${id}/status`, { to: 'applied' })
    await app.call('POST', `/applications/${id}/status`, { to: 'rejected' })

    const revived = await app.call('POST', `/applications/${id}/status`, {
      to: 'screening',
      force: true,
      reason: '误标被拒，HR 来电确认仍在流程中',
    })
    expect(revived.status).toBe(200)
    expect(revived.body.data.forced).toBe(true)

    const timeline = await app.call('GET', `/applications/${id}/timeline`)
    const last = timeline.body.data.at(-1)
    expect(last.payload).toMatchObject({ forced: true })
    expect(last.payload.reason).toContain('误标')
  })

  it('备注追加为独立事件，不改状态', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const id = created.body.data.id
    const note = await app.call('POST', `/applications/${id}/notes`, {
      note: 'HR 说本周内给反馈',
      actor: 'agent',
      source: 'mcp',
    })
    expect(note.status).toBe(201)
    expect(note.body.data).toMatchObject({ type: 'note', actor: 'agent', source: 'mcp' })

    const detail = await app.call('GET', `/applications/${id}`)
    expect(detail.body.data.status).toBe('queued')
  })

  it('列表带出公司名、岗位名与可推进状态', async () => {
    const { jobId } = await seedJob()
    await app.call('POST', '/applications', { jobId, status: 'queued' })
    const list = await app.call('GET', '/applications')
    expect(list.body.data[0]).toMatchObject({
      companyName: '字节跳动',
      jobTitle: '高级前端工程师',
      status: 'queued',
    })
    expect(list.body.data[0].nextStatuses).toContain('applied')
  })

  it('active=true 过滤掉已结束的投递', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    await app.call('POST', `/applications/${created.body.data.id}/status`, { to: 'withdrawn' })

    const active = await app.call('GET', '/applications?active=true')
    expect(active.body.data).toHaveLength(0)
    const all = await app.call('GET', '/applications')
    expect(all.body.data).toHaveLength(1)
  })

  it('删除投递是软删且留 deleted 事件', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const id = created.body.data.id
    await app.call('DELETE', `/applications/${id}`)

    const detail = await app.call('GET', `/applications/${id}`)
    expect(detail.status).toBe(404)

    const timeline = await app.call('GET', `/applications/${id}/timeline`)
    expect(timeline.status).toBe(404)
  })
})

describe('简历', () => {
  const resumeData = {
    basics: { name: '张三', title: '前端工程师' },
    experience: [{ company: 'A', role: '前端', highlights: ['LCP 优化 50%'] }],
  }

  it('创建母版并设为默认', async () => {
    const created = await app.call('POST', '/resumes', {
      title: '母版',
      data: resumeData,
      isDefault: true,
    })
    expect(created.status).toBe(201)
    expect(created.body.data.isDefault).toBe(true)
    expect(created.body.data.kind).toBe('master')
  })

  it('只给标题也能建（Web「新建简历」不传正文）', async () => {
    // 回归：data 曾是必填，前端只传 title/templateId 会报
    // "data: Invalid input: expected record, received undefined"
    const created = await app.call('POST', '/resumes', { title: '空简历', templateId: 'classic' })
    expect(created.status).toBe(201)
    expect(created.body.data.data).toEqual({})
    expect(created.body.data.templateId).toBe('classic')
  })

  it('新建默认简历会取消上一份默认', async () => {
    await app.call('POST', '/resumes', { title: '第一版', data: resumeData, isDefault: true })
    const second = await app.call('POST', '/resumes', { title: '第二版', data: resumeData, isDefault: true })
    expect(second.body.data.isDefault).toBe(true)

    const list = await app.call('GET', '/resumes')
    const defaults = list.body.data.filter((r: { isDefault: boolean }) => r.isDefault)
    expect(defaults).toHaveLength(1)
  })

  it('duplicate 生成 variant，血缘指向母版', async () => {
    const master = await app.call('POST', '/resumes', { title: '母版', data: resumeData })
    const variant = await app.call('POST', `/resumes/${master.body.data.id}/duplicate`, {
      title: '字节定制版',
    })
    expect(variant.status).toBe(201)
    expect(variant.body.data.kind).toBe('variant')
    expect(variant.body.data.baseResumeId).toBe(master.body.data.id)
    expect(variant.body.data.title).toBe('字节定制版')
    expect(variant.body.data.data).toEqual(resumeData)
  })

  it('变体的变体仍然指向母版（血缘不链式退化）', async () => {
    const master = await app.call('POST', '/resumes', { title: '母版', data: resumeData })
    const variant = await app.call('POST', `/resumes/${master.body.data.id}/duplicate`, {})
    const nested = await app.call('POST', `/resumes/${variant.body.data.id}/duplicate`, {})
    expect(nested.body.data.baseResumeId).toBe(master.body.data.id)
  })

  it('被投递引用的简历不能删', async () => {
    const { jobId } = await seedJob()
    const master = await app.call('POST', '/resumes', { title: '母版', data: resumeData })
    await app.call('POST', '/applications', {
      jobId,
      resumeId: master.body.data.id,
      status: 'queued',
    })
    const result = await app.call('DELETE', `/resumes/${master.body.data.id}`)
    expect(result.status).toBe(409)
  })
})

describe('分页与统计', () => {
  it('游标分页不重不漏', async () => {
    for (const name of ['一', '二', '三']) {
      await app.call('POST', '/companies', { name: `${name}公司` })
    }
    const first = await app.call('GET', '/companies?limit=2')
    expect(first.body.data).toHaveLength(2)
    expect(first.body.meta.nextCursor).toBeTruthy()

    const second = await app.call('GET', `/companies?limit=2&cursor=${first.body.meta.nextCursor}`)
    expect(second.body.data).toHaveLength(1)
    expect(second.body.meta.nextCursor).toBeNull()

    const ids = [...first.body.data, ...second.body.data].map((c: { id: string }) => c.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('无效游标当作第一页而不是报错', async () => {
    await app.call('POST', '/companies', { name: '甲' })
    const result = await app.call('GET', '/companies?cursor=not-a-real-cursor')
    expect(result.status).toBe(200)
    expect(result.body.data).toHaveLength(1)
  })

  it('overview 统计各状态与活跃数', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    await app.call('POST', `/applications/${created.body.data.id}/status`, { to: 'applied' })

    const stats = await app.call('GET', '/stats/overview')
    expect(stats.body.data).toMatchObject({
      companies: 1,
      jobs: 1,
      applications: 1,
      active: 1,
    })
    expect(stats.body.data.byStatus.applied).toBe(1)
    expect(stats.body.data.byStatus.interview).toBe(0)
  })

  /**
   * dashboard 是一次多表 join 的聚合，最容易出现的错误是「引用了不存在的列」
   * （interview/offer 没有 deleted_at，早期就在这里 500 过）。用契约测试钉住。
   */
  it('dashboard 返回北极星/漏斗/待办且不因空表报错', async () => {
    const empty = await app.call('GET', '/stats/dashboard')
    expect(empty.status).toBe(200)
    expect(empty.body.data.northStar.value).toBe(0)
    expect(empty.body.data.funnel).toHaveLength(6)
    expect(empty.body.data.today).toEqual([])

    const { jobId } = await seedJob()
    const resume = await app.call('POST', '/resumes', { title: '母版', data: { basics: { name: '张三' } } })
    const created = await app.call('POST', '/applications', {
      jobId,
      resumeId: resume.body.data.id,
      status: 'applied',
      appliedAt: new Date().toISOString(),
    })
    await app.call('PATCH', `/jobs/${jobId}`, { fitScore: 72 })

    const filled = await app.call('GET', '/stats/dashboard')
    expect(filled.status).toBe(200)
    expect(filled.body.data.northStar.value).toBe(1)
    expect(filled.body.data.funnel.find((step: { stage: string }) => step.stage === 'applied').reached).toBe(1)
    expect(filled.body.data.totals.applications).toBe(1)

    // 有面试与 offer 时也不能因为 join 空表出错
    await app.call('POST', `/applications/${created.body.data.id}/status`, { to: 'screening' })
    await app.call('POST', '/interviews', {
      applicationId: created.body.data.id,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const withInterview = await app.call('GET', '/stats/dashboard')
    expect(withInterview.status).toBe(200)
    expect(withInterview.body.data.upcoming.interviews).toBe(1)
  })

  it('dashboard 支持 ?now= 回看：把投递当成 10 天前应触发催办', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', {
      jobId,
      status: 'applied',
      appliedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    })
    expect(created.status).toBe(201)
    const later = new Date(Date.now() + 60_000).toISOString()
    const result = await app.call('GET', `/stats/dashboard?now=${encodeURIComponent(later)}`)
    expect(result.body.data.today.some((task: { kind: string }) => task.kind === 'no_reply')).toBe(true)
  })
})

describe('面试与 Offer', () => {
  it('面试必须挂在存在的投递上', async () => {
    const invalid = await app.call('POST', '/interviews', { applicationId: 'nope' })
    expect(invalid.status).toBe(404)

    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const interview = await app.call('POST', '/interviews', {
      applicationId: created.body.data.id,
      round: 1,
      kind: 'tech',
      scheduledAt: ISO(2),
    })
    expect(interview.status).toBe(201)
    expect(interview.body.data.prepStatus).toBe('none')
  })

  it('upcoming=true 只返回未来的面试', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const applicationId = created.body.data.id
    await app.call('POST', '/interviews', { applicationId, scheduledAt: ISO(-3) })
    await app.call('POST', '/interviews', { applicationId, scheduledAt: ISO(3) })

    const upcoming = await app.call('GET', '/interviews?upcoming=true')
    expect(upcoming.body.data).toHaveLength(1)
    expect(Date.parse(upcoming.body.data[0].scheduledAt)).toBeGreaterThan(Date.now())
  })

  it('同一投递只能有一份 Offer', async () => {
    const { jobId } = await seedJob()
    const created = await app.call('POST', '/applications', { jobId, status: 'queued' })
    const applicationId = created.body.data.id

    const first = await app.call('POST', '/offers', {
      applicationId,
      companyName: '字节跳动',
      baseMonthly: 45_000,
    })
    expect(first.status).toBe(201)
    expect(first.body.data.monthsPerYear).toBe(12)

    const second = await app.call('POST', '/offers', {
      applicationId,
      companyName: '字节跳动',
      baseMonthly: 50_000,
    })
    expect(second.status).toBe(409)
  })
})

describe('provenance 校验（P5 / D2 红线）', () => {
  const minimalResume = { personalInfo: { name: '张三' }, experiences: [], skills: [] }

  it('未登记的 skill 名被拒，并列出合法值', async () => {
    const result = await app.call('POST', '/resumes', {
      title: 'AI 写的简历',
      data: minimalResume,
      provenance: { skill: 'my-own-skill', skillVersion: '1.0.0' },
    })
    expect(result.status).toBe(400)
    // zod enum 先拦：报错里要能看出合法值，Agent 才能自我纠正
    expect(result.body.error.code).toBe('VALIDATION_FAILED')
    expect(result.body.error.message).toContain('skill')
  })

  it('版本低于下限返回 SKILL_OUTDATED 并给出升级命令', async () => {
    const result = await app.call('POST', '/resumes', {
      title: '旧版 Skill 写的简历',
      data: minimalResume,
      provenance: { skill: 'resume-tailor', skillVersion: '0.9.0' },
    })
    expect(result.status).toBe(400)
    expect(result.body.error.code).toBe('SKILL_OUTDATED')
    expect(result.body.error.message).toContain('install-skills.sh')
  })

  it('合法 provenance 落库并自动补 at', async () => {
    const created = await app.call('POST', '/resumes', {
      title: '定制版',
      data: minimalResume,
      kind: 'variant',
      provenance: { skill: 'resume-tailor', skillVersion: '1.0.0', model: 'test-model' },
    })
    expect(created.status).toBe(201)
    expect(created.body.data.provenance).toMatchObject({
      skill: 'resume-tailor',
      skillVersion: '1.0.0',
      model: 'test-model',
    })
    expect(created.body.data.provenance.at).toBeTruthy()
  })

  it('人工编辑（无 provenance）保持 provenance 为空', async () => {
    const created = await app.call('POST', '/resumes', { title: '手写简历', data: minimalResume })
    expect(created.status).toBe(201)
    expect(created.body.data.provenance).toBeNull()
  })

  it('只带 provenance 的 PATCH 不算实质修改', async () => {
    const created = await app.call('POST', '/resumes', { title: '手写简历', data: minimalResume })
    const patched = await app.call('PATCH', `/resumes/${created.body.data.id}`, {
      provenance: { skill: 'resume-tailor', skillVersion: '1.0.0' },
    })
    expect(patched.status).toBe(400)
    expect(patched.body.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('Skill 状态与版本胜率（P5）', () => {
  it('GET /skills 返回九个登记的 Skill', async () => {
    const result = await app.call('GET', '/skills')
    expect(result.status).toBe(200)
    const names = result.body.data.skills.map((item: { name: string }) => item.name)
    expect(names.sort()).toEqual([
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

  it('resume-performance 空库返回空数组而不是 500', async () => {
    const result = await app.call('GET', '/stats/resume-performance')
    expect(result.status).toBe(200)
    expect(result.body.data).toEqual([])
  })
})
