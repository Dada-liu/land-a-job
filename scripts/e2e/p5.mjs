/**
 * P5 端到端：MCP 与 Skill。
 *
 * 用真正的 MCP 客户端（stdio JSON-RPC）驱动整个产品，而不是直接打 HTTP：
 * 这一阶段要验证的正是「Agent 看到的那一层」——工具签名、错误可读性、provenance 闸门、
 * 资源渲染，以及「服务没起时能不能自己拉起来」。
 *
 * 跑法：npm run build && node scripts/e2e/p5.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ROOT, eq, ok, section, summary } from './lib.mjs'

const PORT = 4413
const BASE = `http://127.0.0.1:${PORT}`
const SKILLS_DIR = path.join(ROOT, 'skills')

const RESUME = {
  personalInfo: { name: '张三', jobTitle: '前端工程师', workYears: '6年', city: '杭州' },
  selfIntroduction: '6 年前端经验。',
  contacts: [{ id: 'c1', platform: '邮箱', value: 'zhangsan@example.com' }],
  experiences: [
    { id: 'e1', period: '2021.03 - 至今', company: '某互联网公司', position: '高级前端工程师', responsibilities: ['用 React + TypeScript 重构增长链路'] },
  ],
  educations: [{ id: 'ed1', school: '某大学', degree: '本科', major: '计算机', period: '2014-2018' }],
  skills: [{ id: 's1', name: 'React', description: '熟练' }],
  projects: [{ id: 'p1', name: '数据看板', technologies: ['React', 'ECharts'], description: '可视化平台' }],
}

const JD = `职位描述：负责增长业务前端架构，主导 React / TypeScript 工程化建设。
要求：5 年以上经验，精通 React、TypeScript，熟悉 Node.js 与数据可视化（ECharts）。
有性能优化经验者优先。React 生态熟练是硬要求，React 相关经验需 3 年以上。`

/** 调工具并把 JSON 文本解析回来；isError 时返回 { error } 而不是抛 */
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content ?? []).map((item) => item.text ?? '').join('')
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text }
  }
  return { isError: Boolean(result.isError), payload: parsed, data: parsed?.data, error: parsed?.error }
}

/**
 * 清掉端口区间上的残留监听者。
 *
 * 为什么要清一段而不是一个：server 的 resolvePort 会在 4413 被占时顺延到 4414、4415…
 * 上一次跑残留的服务可能正好停在顺延后的端口上，于是「自动拉起」这段会连到旧库上，
 * 测出来的东西全是假的。
 */
function killRange(from, to) {
  for (let port = from; port <= to; port += 1) killByPort(port)
}

function killByPort(port) {
  try {
    // 必须限定 LISTEN：`lsof -i tcp:PORT` 会把「连过去的客户端」也列出来，
    // 于是脚本会把自己（正在打 HTTP 的那个进程）一并 SIGTERM——表现为跑完但没输出汇总。
    // 注意 `-i` 的参数必须紧贴（`-i tcp:4413`），否则 lsof 会把 tcp:4413 当成文件名去 stat。
    const output = execFileSync('lsof', ['-nP', '-t', '-i', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    }).trim()
    for (const pid of output.split('\n').filter(Boolean)) {
      if (Number(pid) === process.pid) continue
      try {
        process.kill(Number(pid), 'SIGTERM')
      } catch {
        // 已经退出
      }
    }
  } catch {
    // 没有进程监听，正常
  }
}

async function main() {
  // 上一次跑残留的 detached 服务会占住端口，让「自动拉起」这段测不出真东西
  killRange(PORT, PORT + 9)
  await new Promise((resolve) => setTimeout(resolve, 500))

  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'land-e2e-p5-'))
  let stderr = ''

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'apps/mcp/dist/index.js')],
    env: {
      ...process.env,
      LAND_DATA_DIR: dataDir,
      LAND_PORT: String(PORT),
      // 无人值守跑投递助手；真实使用应当有头，方便用户登录
      LAND_APPLY_HEADLESS: '1',
    },
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })

  const client = new Client({ name: 'land-e2e', version: '1.0.0' })
  await client.connect(transport)

  let token = ''

  try {
    /* ------------------------- 工具与资源清单 ------------------------- */
    section('MCP 清单：工具与资源')
    const tools = await client.listTools()
    const names = tools.tools.map((tool) => tool.name)
    ok(names.length >= 40, `注册了 ${names.length} 个工具（≥40）`)
    ok(
      ['get_app_status', 'get_dashboard', 'fetch_jd', 'import_jd', 'tailor_resume', 'submit_application', 'compare_offers'].every(
        (name) => names.includes(name),
      ),
      '关键工具都在（洞察 / JD 采集 / 简历 / 投递助手 / Offer）',
    )
    eq(names.filter((name) => name.startsWith('generate_')).length, 0, '没有 generate_* 工具（D2 红线）')
    ok(
      tools.tools.every((tool) => Boolean(tool.description) && tool.description.length > 10),
      '每个工具都有可读的描述（Agent 靠它选工具）',
    )
    ok(
      tools.tools.every((tool) => tool.inputSchema && tool.inputSchema.type === 'object'),
      '每个工具都有 object 入参 schema',
    )

    const resources = await client.listResources()
    const uris = resources.resources.map((item) => item.uri).sort()
    ok(uris.includes('land://today') && uris.includes('land://pipeline'), '固定资源可枚举', uris)
    eq(uris.length, 3, '三个固定资源（其余两个是模板）')

    const templates = await client.listResourceTemplates()
    const templateUris = templates.resourceTemplates.map((item) => item.uriTemplate).sort()
    eq(templateUris.length, 2, '两个模板资源（job / resume）')
    ok(
      templateUris.includes('land://job/{id}') && templateUris.includes('land://resume/{id}'),
      '模板 URI 正确',
      templateUris,
    )

    /* --------------------------- 自动拉起 --------------------------- */
    section('自动拉起 server（未预先启动）')
    eq(existsSync(path.join(dataDir, '.port')), false, '启动前没有端口文件')
    const status = await call(client, 'get_app_status')
    eq(status.data?.service, 'up', '首次工具调用把服务拉起来了')
    eq(status.data?.registeredSkills?.length, 9, '返回九个已登记 Skill')
    ok(existsSync(path.join(dataDir, '.port')), '端口文件已写入')
    eq(readFileSync(path.join(dataDir, '.port'), 'utf8').trim(), String(PORT), '端口与预期一致')

    token = readFileSync(path.join(dataDir, '.token'), 'utf8').trim()
    ok(token.length >= 32, '令牌已生成（MCP 从文件读，不走环境变量）')

    const skillsPayload = status.data?.skills
    eq(skillsPayload?.skills?.length, 9, '本机 skill 扫描到九个')
    ok(
      skillsPayload.skills.every((item) => item.compatible === true),
      '九个 Skill 版本与注册表兼容',
      skillsPayload.skills.map((item) => `${item.name}@${item.version}`),
    )

    /* ---------------------------- 写路径 ---------------------------- */
    section('写路径：公司 / 岗位 / 简历 / 投递')
    const company = await call(client, 'create_company', { name: '示例公司', city: '杭州' })
    ok(Boolean(company.data?.id), 'create_company 返回 id')
    const companyId = company.data.id

    const listedCompanies = await call(client, 'list_companies', { q: '示例' })
    ok(
      listedCompanies.data.companies.some((item) => item.id === companyId),
      'list_companies 能查回刚建的公司（真的落库了）',
    )
    ok(
      listedCompanies.data.companies[0].website === undefined,
      '列表只回摘要字段（不带长文本，控制上下文体积）',
    )

    const job = await call(client, 'add_job', {
      company: '示例公司',
      title: '高级前端工程师',
      jdText: JD,
      city: '杭州',
      salaryMin: 25000,
      salaryMax: 40000,
    })
    ok(Boolean(job.data?.job?.id), 'add_job 用公司名自动解析公司并建岗')
    const jobId = job.data.job.id

    const master = await call(client, 'create_resume', {
      title: '前端母版',
      data: RESUME,
      provenance: { skill: 'resume-tailor', skillVersion: '1.0.0' },
    })
    ok(Boolean(master.data?.id), 'create_resume 成功')
    const masterId = master.data.id

    // 打分要有简历做分母，所以放在建完简历之后（真实使用顺序也是先有简历再评估岗位）
    const scored = await call(client, 'score_job', { id: jobId, resumeId: masterId })
    ok(typeof scored.data?.score === 'number', `score_job 返回分数 ${scored.data?.score}`)
    ok((scored.data?.reasons ?? []).length >= 3, '给出可解释的理由而不只是数字', scored.data?.reasons)

    const gotResume = await call(client, 'get_resume', { id: masterId })
    ok(gotResume.data.itemIds.experiences.includes('e1'), 'get_resume 单列条目 id（便于精确改写）')

    const patched = await call(client, 'update_resume', {
      id: masterId,
      data: { projects: [...RESUME.projects, { id: 'p2', name: '增长中台', technologies: ['Node.js'] }] },
      provenance: { skill: 'resume-tailor', skillVersion: '1.0.0' },
    })
    eq(patched.isError, false, 'update_resume 成功')
    const afterPatch = await call(client, 'get_resume', { id: masterId })
    eq(afterPatch.data.resume.data.projects.length, 2, '深合并生效（项目从 1 个变 2 个）')
    ok(
      afterPatch.data.resume.data.personalInfo?.name === '张三',
      '深合并不会丢掉未提及的字段（personalInfo 还在）',
    )
    eq(
      afterPatch.data.resume.provenance?.skill,
      'resume-tailor',
      'provenance 已落库（能查出是谁写的）',
    )

    const tailored = await call(client, 'tailor_resume', { baseId: masterId, jobId })
    ok(Boolean(tailored.data?.variantId), 'tailor_resume 复制出 variant 骨架')
    ok(tailored.data?.plan?.gap?.some((item) => item.keyword === 'graphql' || item.keyword === 'echarts') !== undefined, '返回缺口清单')
    ok(tailored.data?.mustNotInvent === true, '返回值里写明「不许编造」')
    eq(tailored.payload.nextActions.length > 0, true, '给出下一步建议')

    const application = await call(client, 'create_application', {
      jobId,
      resumeId: tailored.data.variantId,
      status: 'applied',
      appliedAt: new Date().toISOString(),
    })
    eq(application.data?.status, 'applied', 'create_application 成功')
    const applicationId = application.data.id

    const advanced = await call(client, 'update_application_status', { id: applicationId, to: 'screening' })
    eq(advanced.data?.to, 'screening', '状态推进到 screening')

    const invalid = await call(client, 'update_application_status', { id: applicationId, to: 'queued' })
    eq(invalid.isError, true, '非法跃迁被拒')
    eq(invalid.error?.code, 'INVALID_TRANSITION', '错误码 INVALID_TRANSITION')
    ok(
      Array.isArray(invalid.error?.details?.allowed) && invalid.error.details.allowed.length > 0,
      '错误里带 allowed 列表（Agent 能自我纠正）',
      invalid.error,
    )
    ok(Boolean(invalid.error?.hint), '错误里带恢复建议')

    await call(client, 'add_application_note', { id: applicationId, note: 'HR 说本周内给反馈' })
    const timeline = await call(client, 'get_timeline', { id: applicationId })
    ok(
      timeline.data.events.some((event) => event.type === 'note'),
      '备注进入时间线',
    )

    /* ------------------------- provenance 闸门 ------------------------- */
    section('provenance 闸门（D2 红线）')
    const outdated = await call(client, 'update_resume', {
      id: masterId,
      data: { selfIntroduction: '新版' },
      provenance: { skill: 'resume-tailor', skillVersion: '0.9.0' },
    })
    eq(outdated.isError, true, 'Skill 版本过旧被拒')
    eq(outdated.error?.code, 'SKILL_OUTDATED', '错误码 SKILL_OUTDATED')
    ok(/install-skills\.sh/.test(outdated.error?.message ?? ''), '错误信息给出升级命令', outdated.error?.message)

    const unknownSkill = await call(client, 'update_resume', {
      id: masterId,
      data: { selfIntroduction: '新版' },
      provenance: { skill: 'invented-skill', skillVersion: '1.0.0' },
    })
    eq(unknownSkill.isError, true, '未登记的 skill 名被拒（挡住 Agent 自造 skill）')

    const question = await call(client, 'save_question', {
      jobId,
      category: 'tech',
      question: 'React 的并发渲染在你们的增长页面上解决了什么问题？',
      linkedItem: 'JD: 精通 React',
      provenance: { skill: 'job-prep', skillVersion: '1.0.0' },
    })
    ok(Boolean(question.data?.id), 'save_question 用 job-prep 落库成功')

    const scoredAnswer = await call(client, 'score_answer', {
      id: question.data.id,
      myAnswer: '说了一堆概念没有具体案例。',
      score: { content: 2, structure: 3, delivery: 3 },
      improvement: '应该补一个具体的页面与指标。',
      provenance: { skill: 'job-prep', skillVersion: '1.0.0' },
    })
    eq(scoredAnswer.data?.id, question.data.id, 'score_answer 落库')

    /* --------------------------- 投递助手 --------------------------- */
    section('投递助手：扫描 / 校验 / 填充 / 提交')
    const job2 = await call(client, 'add_job', { company: '示例公司', title: '前端工程师（助手走查）', jdText: JD })
    const applySession = await call(client, 'start_apply_session', {
      jobId: job2.data.job.id,
      resumeId: masterId,
      url: `${BASE}/apply-demo`,
    })
    eq(applySession.data?.status, 'open', '会话打开')
    ok(applySession.data.fields.length >= 7, `扫描到 ${applySession.data.fields.length} 个字段`)
    ok(
      applySession.data.manualFields.some((label) => /附件|file/i.test(label)),
      '文件上传被标记为「需人工」',
    )

    const byLabel = (pattern) =>
      applySession.data.fields.find((field) => pattern.test(`${field.label} ${field.name ?? ''}`))?.key
    const nameKey = byLabel(/姓名|name/i)
    const mailKey = byLabel(/邮箱|email/i)
    const phoneKey = byLabel(/手机|phone|tel/i)
    const cityKey = byLabel(/城市|city/i)
    const agreeKey = byLabel(/同意|agree|隐私/i)
    ok(Boolean(nameKey && mailKey && phoneKey && cityKey && agreeKey), '关键字段都识别到了', {
      nameKey,
      mailKey,
      phoneKey,
      cityKey,
      agreeKey,
    })

    const badPlan = await call(client, 'plan_form_fill', {
      sessionId: applySession.data.sessionId,
      mapping: { 'not-a-field': 'x', [cityKey]: '不存在的城市' },
    })
    eq(badPlan.data?.ready, false, '错误的映射计划被判为未就绪')
    ok(badPlan.data.rejected.length >= 2, '两个错误都被指出（key 不存在 + 选项不存在）', badPlan.data.rejected)

    const goodPlan = await call(client, 'plan_form_fill', {
      sessionId: applySession.data.sessionId,
      mapping: {
        [nameKey]: '张三',
        [mailKey]: 'zhangsan@example.com',
        [phoneKey]: '13800138000',
        [cityKey]: '杭州',
        [agreeKey]: 'true',
      },
    })
    eq(goodPlan.data?.ready, true, '正确的映射计划通过校验')

    const filled = await call(client, 'fill_form', {
      sessionId: applySession.data.sessionId,
      values: {
        [nameKey]: '张三',
        [mailKey]: 'zhangsan@example.com',
        [phoneKey]: '13800138000',
        [cityKey]: '杭州',
        [agreeKey]: 'true',
      },
    })
    eq(filled.data?.failedCount, 0, '逐字段填充全部成功')

    const noConfirm = await call(client, 'submit_application', {
      sessionId: applySession.data.sessionId,
      confirm: false,
    })
    eq(noConfirm.isError, true, '未确认不允许提交')
    eq(noConfirm.error?.code, 'CONFIRM_REQUIRED', '错误码 CONFIRM_REQUIRED')

    const submitted = await call(client, 'submit_application', {
      sessionId: applySession.data.sessionId,
      confirm: true,
    })
    ok(Boolean(submitted.data?.applicationId), '确认后提交成功并自动登记投递')
    eq(submitted.data?.status, 'applied', '投递状态为已投递')
    ok(Boolean(submitted.data?.screenshot), '留下了存证截图')

    // 会话已随提交结束；再开一个会话验证「主动关闭」这条路
    const job3 = await call(client, 'add_job', { company: '示例公司', title: '前端工程师（关闭走查）', jdText: JD })
    const closable = await call(client, 'start_apply_session', {
      jobId: job3.data.job.id,
      url: `${BASE}/apply-demo`,
    })
    const conflict = await call(client, 'start_apply_session', { jobId: job3.data.job.id, url: `${BASE}/apply-demo` })
    eq(conflict.isError, true, '同时开第二个会话被拒')
    eq(conflict.error?.code, 'CONFLICT', '错误码 CONFLICT')
    const closed = await call(client, 'close_apply_session', { sessionId: closable.data.sessionId })
    eq(closed.data?.closed, true, '主动关闭会话成功')

    /* ---------------------------- Offer ---------------------------- */
    section('Offer 对比与谈判素材')
    // 前面两个岗位都已经有投递了，offer 要挂到干净岗位上（一岗一活跃投递）
    const job4 = await call(client, 'add_job', { company: '示例公司', title: '前端工程师（Offer A）', jdText: JD })
    const job5 = await call(client, 'add_job', { company: '示例公司', title: '前端工程师（Offer B）', jdText: JD })
    const offerApp = await call(client, 'create_application', {
      jobId: job4.data.job.id,
      resumeId: masterId,
      status: 'queued',
    })
    ok(Boolean(offerApp.data?.id), '为 offer 建立投递记录')
    const offerA = await call(client, 'create_offer', {
      applicationId: offerApp.data.id,
      companyName: '示例公司',
      baseMonthly: 40000,
      monthsPerYear: 15,
      perfMonths: 3,
      signon: 30000,
      equityShares: 10000,
      equityStrike: 1,
      equityFmv: 20,
      vestYears: 4,
      housingFund: 0.07,
    })
    ok(Boolean(offerA.data?.id), 'create_offer 成功')
    ok(offerA.data.fourYearTotal > 0, `4 年总包 ${offerA.data.fourYearTotalText}`)

    const offerApp2 = await call(client, 'create_application', {
      jobId: job5.data.job.id,
      resumeId: masterId,
      status: 'queued',
    })
    const offerB = await call(client, 'create_offer', {
      applicationId: offerApp2.data.id,
      companyName: '另一家公司',
      baseMonthly: 45000,
      monthsPerYear: 12,
      perfMonths: 2,
      signon: 0,
    })

    const compared = await call(client, 'compare_offers', {})
    eq(compared.data?.ranked?.length >= 2, true, 'compare_offers 返回两份以上的排序')
    ok(
      compared.data.ranked.every((row) => typeof row.totalScore === 'number' && row.fourYearTotal > 0),
      '每行都有归一化分数与总包',
    )
    ok((compared.data.assumptions ?? []).length >= 3, '口径假设一并返回（未计涨薪/期权折扣/定性缺失）')
    ok(
      compared.data.ranked.some((row) => row.notes.some((note) => /未评分/.test(note))),
      '定性维度未评分时明确标注而不是给 0 分',
    )

    const brief = await call(client, 'get_negotiation_brief', { offerId: offerB.data.id, targetTotal: 3_000_000 })
    eq(brief.data?.levers?.length, 4, '给出四个谈判杠杆')
    ok(brief.data.gap?.gap > 0, '给出与目标总包的缺口')
    ok((brief.data.mustState ?? []).length >= 2, '必须转述的口径也在返回值里')

    /* ---------------------------- 资源 ---------------------------- */
    section('资源读取')
    const today = await client.readResource({ uri: 'land://today' })
    ok(today.contents?.[0]?.text?.includes('今日速览'), 'land://today 可读')
    const pipeline = await client.readResource({ uri: 'land://pipeline' })
    ok(pipeline.contents?.[0]?.text?.includes('投递看板'), 'land://pipeline 可读')
    const jobResource = await client.readResource({ uri: `land://job/${jobId}` })
    ok(jobResource.contents?.[0]?.text?.includes('React'), 'land://job/{id} 渲染出 JD 正文')
    const resumeResource = await client.readResource({ uri: `land://resume/${masterId}` })
    ok(resumeResource.contents?.[0]?.text?.includes('工作经历'), 'land://resume/{id} 渲染成 Markdown')
    const offerResource = await client.readResource({ uri: 'land://offer/compare' })
    ok(offerResource.contents?.[0]?.text?.includes('口径'), 'land://offer/compare 带口径说明')

    /* -------------------- HTTP 侧核对（真的落库了） -------------------- */
    section('HTTP 侧核对：MCP 写的确实进了库')
    const http = async (endpoint) => {
      const response = await fetch(`${BASE}/api${endpoint}`, { headers: { 'x-land-token': token } })
      const payload = await response.json()
      return payload.data
    }
    const httpCompanies = await http('/companies')
    ok(
      httpCompanies.some((item) => item.id === companyId),
      '公司能从 HTTP 查到（同一个库）',
    )
    const httpResumes = await http('/resumes')
    const variant = httpResumes.find((item) => item.id === tailored.data.variantId)
    eq(variant?.kind, 'variant', '定制版在 HTTP 侧也是 variant')
    eq(variant?.provenance?.skill, undefined, 'variant 是复制出来的，provenance 不继承母版（母版才有）')
    const masterRow = httpResumes.find((item) => item.id === masterId)
    eq(masterRow?.provenance?.skill, 'resume-tailor', '母版保留 provenance（能归因到 resume-tailor）')

    const httpQuestions = await http('/questions')
    eq(httpQuestions[0]?.provenance?.skill, 'job-prep', '面试题落库时带 job-prep 归因')

    /* --------------------------- 日志与清理 --------------------------- */
    section('stdout 协议通道保持干净')
    ok(stderr.includes('[land-mcp]'), 'MCP 日志走 stderr（stdout 只走协议帧）', stderr.slice(0, 200))
    ok(!stderr.includes('Error:'), 'stderr 里没有未处理错误', stderr.slice(0, 400))

    /* --------------------------- Skill 文件 --------------------------- */
    section('Skill 包结构')
    const skillNames = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    eq(skillNames.length, 9, '九个 Skill 目录')
    ok(skillNames.includes('jd-collect'), '新增的 JD 采集 Skill 已随包分发')
    for (const name of ['job-search-batch', 'resume-tailor-batch', 'browser-apply', 'application-status-sync']) {
      ok(skillNames.includes(name), `${name} 已随包分发`)
      const doc = readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')
      ok(/## 0\. 前置检查/.test(doc), `${name} 带统一前置检查`)
      ok(/workbuddy-browser-use/.test(doc), `${name} 说明本机浏览器前置动作`)
    }
    const collectText = readFileSync(path.join(SKILLS_DIR, 'jd-collect', 'SKILL.md'), 'utf8')
    const collectRef = readFileSync(path.join(SKILLS_DIR, 'jd-collect', 'references', 'browser-fallback.md'), 'utf8')
    ok(/import_jd/.test(collectText), 'JD 采集产物必须经 MCP 落库')
    ok(
      /workbuddy-browser-use/.test(collectRef) && /Kimi 浏览器扩展/.test(collectRef),
      'WorkBuddy 与 Kimi 两家浏览器兜底都有具体步骤',
    )
    ok(
      skillNames.every((name) => existsSync(path.join(SKILLS_DIR, name, 'SKILL.md'))),
      '每个都有 SKILL.md',
    )
    ok(
      skillNames.every((name) => existsSync(path.join(SKILLS_DIR, name, 'references'))),
      '每个都有 references',
    )
    const huntText = readFileSync(path.join(SKILLS_DIR, 'job-hunt', 'SKILL.md'), 'utf8')
    ok(/## 0\. 前置检查/.test(huntText) && /## 5\. 禁止/.test(huntText), 'SKILL.md 是六段式结构')
    ok(/别问我/.test(huntText), '写明「别问我」也不许直接提交（反例写进禁止段）')
  } finally {
    await client.close().catch(() => undefined)
    killRange(PORT, PORT + 9)
    rmSync(dataDir, { recursive: true, force: true })
  }

  return summary('P5 端到端')
}

main()
  // 用 exitCode 而不是 process.exit()：stdout 接管道时 exit 会把未 flush 的汇总行吞掉
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    process.stderr.write(`\nE2E 异常：${error?.stack ?? error}\n`)
    process.exit(1)
  })
