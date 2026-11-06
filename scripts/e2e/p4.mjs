/**
 * P4 端到端：JD 定制与投递助手。
 *
 * 覆盖：JD 抓取（真实 HTTP + Readability）→ 规则 fit 打分 → 定制计划与编造校验
 * → 投递会话（单开 / 字段扫描 / 逐字段填充 / 必须确认才提交 / 截图存证 / 自动建投递）
 * → 验证码拦截 → Web 端从岗位库「直接投递」弹窗完整走一遍。
 *
 * 跑法：npm run build && node scripts/e2e/p4.mjs
 */
import { createServer } from 'node:http'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { count, eq, fill, launchBrowser, ok, openPage, pick, pickValue, section, sleep, startServer, summary, text } from './lib.mjs'

const RESUME = {
  personalInfo: { name: '张三', jobTitle: '前端工程师', workYears: '6年', city: '杭州' },
  selfIntroduction: '6 年前端经验，做过日活千万级产品的性能治理。',
  contacts: [
    { id: 'c1', platform: '邮箱', value: 'zhangsan@example.com' },
    { id: 'c2', platform: '电话', value: '13800138000' },
    { id: 'c3', platform: 'GitHub', value: 'github.com/zhangsan', url: 'https://github.com/zhangsan' },
  ],
  experiences: [
    {
      id: 'e1',
      period: '2021.03 - 至今',
      company: '某互联网公司',
      position: '高级前端工程师',
      responsibilities: ['用 React + TypeScript 重构增长链路', 'Node.js BFF 层维护'],
    },
    { id: 'e2', period: '2018.07 - 2021.02', company: '某创业公司', position: '前端工程师', responsibilities: ['从 0 搭建后台'] },
  ],
  educations: [{ id: 'ed1', school: '某大学', degree: '本科', major: '计算机', period: '2014-2018' }],
  skills: [
    { id: 's1', name: 'React', description: '熟练' },
    { id: 's2', name: 'TypeScript', description: '熟练' },
    { id: 's3', name: 'Node.js', description: '熟悉' },
  ],
  projects: [
    { id: 'p1', name: '数据看板', technologies: ['React', 'ECharts'], description: '可视化平台', details: '服务内部 200 人' },
  ],
}

/** 一个结构接近真实招聘站点的 JD 页，供抓取用（不依赖外网） */
const JD_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>高级前端工程师 - 招聘</title></head><body>
<header><nav>首页 职位 关于我们</nav></header>
<main>
  <h1>高级前端工程师</h1>
  <div class="meta">杭州 · 25-40K · 3-5 年 · 本科及以上</div>
  <article>
    <h2>职位描述</h2>
    <p>负责增长业务的前端架构设计与实现，主导 React / TypeScript 技术栈的工程化建设。</p>
    <p>岗位要求：</p>
    <ul>
      <li>5 年以上前端开发经验，本科及以上学历</li>
      <li>精通 React、TypeScript，熟悉 Next.js、Tailwind CSS</li>
      <li>熟悉 Node.js，了解 GraphQL 与 Kubernetes</li>
      <li>有数据可视化经验（ECharts、D3）优先</li>
      <li>具备良好的性能优化与工程化意识，熟悉 CI/CD 流程</li>
    </ul>
    <h2>团队介绍</h2>
    <p>我们是一个重视工程质量与用户体验的团队，正在搭建统一的前端基础设施，欢迎对性能与体验有执念的工程师加入。</p>
    <h2>面试流程</h2>
    <p>简历筛选 → 技术一面 → 技术二面 → HR 面，全程线上，约 2 周。</p>
  </article>
</main>
<footer>© 2026 示例公司</footer>
</body></html>`

/** 粘贴 / 浏览器兜底共用的完整 JD 原文 */
const PASTED_JD = '高级前端工程师（杭州）\n薪资 25-40K，3-5 年经验，本科及以上。\n负责 React / TypeScript 工程化建设，熟悉 Node.js 与 Kubernetes。\n'.repeat(3)

async function startFixtureServer() {
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/jd')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(JD_HTML)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}` }
}

function fieldKeyByLabel(fields, pattern) {
  return fields.find((field) => pattern.test(`${field.label} ${field.name ?? ''} ${field.id ?? ''}`))?.key
}

async function main() {
  const fixture = await startFixtureServer()
  const server = await startServer({ port: 4411, env: { LAND_APPLY_HEADLESS: '1' } })
  const { browser, page, consoleErrors } = await launchBrowser()
  const { api, base, dataDir } = server

  try {
    /* ---------------------------- 准备 ---------------------------- */
    section('准备数据')
    const company = await api.post('/companies', { name: '示例公司', city: '杭州', applyEntry: `${base}/apply-demo` })
    const job = await api.post('/jobs', {
      companyId: company.id,
      title: '高级前端工程师',
      city: '杭州',
      jdUrl: `${fixture.base}/jd/1`,
      salaryMin: 25000,
      salaryMax: 40000,
    })
    const resume = await api.post('/resumes', { title: '前端母版', templateId: 'classic', data: RESUME, isDefault: true })
    ok(Boolean(job.id && resume.id), '公司/岗位/简历就绪')

    /* --------------------------- JD 抓取 --------------------------- */
    section('JD 抓取（Readability）')
    const fetched = await api.post(`/jobs/${job.id}/fetch-jd`)
    ok((fetched.job.jdText ?? '').length > 120, '抓到正文（>120 字）', (fetched.job.jdText ?? '').slice(0, 60))
    ok((fetched.job.jdText ?? '').includes('React'), '正文内容正确')
    ok(!(fetched.job.jdText ?? '').includes('首页 职位 关于我们'), 'Readability 去掉了导航噪声')
    ok((fetched.job.keywords ?? []).includes('react'), '关键词已抽出入库', fetched.job.keywords)
    ok(Boolean(fetched.job.jdSnapshot) && existsSync(fetched.job.jdSnapshot), 'JD 快照已落盘')
    eq(fetched.provider, 'http', '通用 HTTP 采集兜底生效')
    ok(Boolean(fetched.canonicalUrl) && fetched.canonicalUrl.includes('/jd/1'), '返回归一化后的 JD 链接')
    ok(fetched.source?.trusted === true, '本机 fixture 来源被判定为可确认')
    eq(fetched.job.salaryMin, 25000, '页头元信息里的薪资下限已回写')

    /* --------------------------- 粘贴降级 --------------------------- */
    section('JD 粘贴降级（import-jd）')
    const pastedJob = await api.post('/jobs', { companyId: company.id, title: '前端工程师（粘贴录入）' })
    const pasted = await api.post(`/jobs/${pastedJob.id}/import-jd`, {
      text: PASTED_JD,
      url: `${fixture.base}/jd/pasted`,
    })
    eq(pasted.source.kind, 'manual', '来源标记为人工粘贴')
    ok((pasted.job.keywords ?? []).includes('react'), '粘贴正文同样抽出关键词')
    eq(pasted.job.city, '杭州', '粘贴正文同样补出城市')
    eq(pasted.job.salaryMin, 25000, '粘贴正文同样补出薪资')
    eq(pasted.job.jdSource, 'paste', '采集来源已落库')
    ok(existsSync(pasted.job.jdSnapshot), '粘贴正文也留了快照')

    const browserJob = await api.post('/jobs', { companyId: company.id, title: '前端工程师（浏览器兜底）' })
    const browser = await api.post(`/jobs/${browserJob.id}/import-jd`, {
      text: PASTED_JD,
      capturedBy: 'browser',
      url: `${fixture.base}/jd/browser`,
    })
    eq(browser.source.kind, 'browser', '浏览器兜底来源可识别')
    eq(browser.job.jdSource, 'browser', '浏览器采集来源已落库')
    const browserReload = await api.get(`/jobs/${browserJob.id}`)
    eq(browserReload.jdSource, 'browser', 'Web 端刷新后仍能看到采集来源')
    ok((browserReload.jdText ?? '').includes('React'), '浏览器读回的正文可在 Web 查看')

    /* --------------------------- fit 打分 --------------------------- */
    section('fit 打分（确定性规则）')
    const scored = await api.post(`/jobs/${job.id}/score`)
    ok(scored.fit.score >= 60, `fit = ${scored.fit.score}（应 ≥60：技术栈高度重合）`)
    eq(scored.fit.capped, false, '硬性条件满足，未被封顶')
    ok((scored.fit.factors ?? []).length >= 4, '产出多个可解释因子', scored.fit.factors?.map((f) => f.key))
    ok((scored.job.fitReasons ?? []).length >= 4, '因子已格式化为 fit_reasons')
    eq(scored.job.fitSource, 'rule', 'fit_source 标记为 rule')
    const again = await api.post(`/jobs/${job.id}/score`)
    eq(again.fit.score, scored.fit.score, '同输入同输出（可复算）')

    /* ------------------------- 定制计划与校验 ------------------------- */
    section('定制计划 + 编造校验')
    const plan = await api.get(`/jobs/${job.id}/tailor-plan?resumeId=${resume.id}`)
    ok(plan.plan.summaryHints.length > 0, '给出摘要建议词')
    // 证据面是简历全文（技能名、项目技术栈、经历描述都算），不是只有 skills 一栏
    const resumeText = JSON.stringify(RESUME).toLowerCase()
    ok(
      plan.plan.summaryHints.every((hint) => resumeText.includes(hint)),
      '建议词都能在简历全文里找到证据（不许凭空造词）',
      plan.plan.summaryHints,
    )
    ok(plan.plan.gap.some((gap) => gap.keyword === 'graphql'), '识别出 JD 提到但简历没有的 GraphQL')
    ok(plan.instruction.includes('patch_resume'), '指令里写明落库方式')

    const goodAfter = {
      ...RESUME,
      projects: [...RESUME.projects],
      experiences: RESUME.experiences.map((exp) => ({ ...exp, responsibilities: [...exp.responsibilities, '用 React 重构了首页'] })),
    }
    const pass = await api.post('/tailor/validate', { before: RESUME, after: goodAfter })
    eq(pass.ok, true, '只重述不新增 → 通过')

    const fabricated = {
      ...RESUME,
      experiences: [...RESUME.experiences, { id: 'e3', period: '2024-2025', company: '某大厂', position: '架构师' }],
    }
    const rejected = await api.post('/tailor/validate', { before: RESUME, after: fabricated })
    eq(rejected.ok, false, '新增经历 → 拒绝')
    eq(rejected.violations[0]?.kind, 'experience_added', '拒绝原因明确')

    /* -------------------------- 投递会话 -------------------------- */
    section('投递会话：扫描 / 填充 / 提交')
    const session = await api.post('/apply/sessions', { jobId: job.id, resumeId: resume.id, url: `${base}/apply-demo` })
    eq(session.status, 'open', '会话已打开')
    ok(session.fields.length >= 7, `扫描到 ${session.fields.length} 个字段`)
    const nameKey = fieldKeyByLabel(session.fields, /姓名|fullname/i)
    const mailKey = fieldKeyByLabel(session.fields, /邮箱|email/i)
    const phoneKey = fieldKeyByLabel(session.fields, /手机|phone|tel/i)
    const cityKey = fieldKeyByLabel(session.fields, /城市|city/i)
    const agreeKey = fieldKeyByLabel(session.fields, /同意|agree|隐私/i)
    ok(Boolean(nameKey && mailKey && phoneKey && cityKey && agreeKey), '关键字段都识别出来了', {
      nameKey,
      mailKey,
      phoneKey,
      cityKey,
      agreeKey,
    })
    ok(session.manualFields.some((label) => /附件|file/i.test(label)), '文件上传被标记为需人工')

    const conflict = await api.expectFail('POST', '/apply/sessions', { jobId: job.id, url: `${base}/apply-demo` })
    eq(conflict.status, 409, '同时开第二个会话被拒')
    eq(conflict.code, 'CONFLICT', '错误码 CONFLICT')

    const filled = await api.post(`/apply/sessions/${session.id}/fill`, {
      values: {
        [nameKey]: '张三',
        [mailKey]: 'zhangsan@example.com',
        [phoneKey]: '13800138000',
        [cityKey]: '杭州',
        [agreeKey]: 'true',
      },
    })
    const failed = (filled.fillResults ?? []).filter((item) => !item.ok)
    eq(failed.length, 0, '所有给定字段都填成功', failed)
    eq(filled.status, 'filled', '会话状态变为已填充')

    // 部分失败不影响其余：故意给一个不存在的选项
    const partial = await api.post(`/apply/sessions/${session.id}/fill`, {
      values: { [cityKey]: '不存在的城市', [nameKey]: '张三丰' },
    })
    ok(
      partial.fillResults.some((item) => item.key === cityKey && !item.ok) &&
        partial.fillResults.some((item) => item.key === nameKey && item.ok),
      '单字段失败不影响其他字段',
      partial.fillResults,
    )
    await api.post(`/apply/sessions/${session.id}/fill`, { values: { [cityKey]: '杭州' } })

    const noConfirm = await api.expectFail('POST', `/apply/sessions/${session.id}/submit`, { confirm: false })
    eq(noConfirm.status, 400, '未确认不允许提交')
    eq(noConfirm.code, 'CONFIRM_REQUIRED', '错误码 CONFIRM_REQUIRED')

    const submitted = await api.post(`/apply/sessions/${session.id}/submit`, { confirm: true })
    ok(Boolean(submitted.screenshotPath), '提交后截图落盘')
    const shotFile = path.join(dataDir, submitted.application.evidence.screenshot)
    ok(existsSync(shotFile) && statSync(shotFile).size > 5000, '截图文件存在且非空', shotFile)
    eq(submitted.application.status, 'applied', '自动登记的投递状态为已投递')
    eq(submitted.application.resumeId, resume.id, '关联了本次使用的简历')
    eq(submitted.application.confidence, 'screenshot', '置信度标记为截图')
    ok(Boolean(submitted.application.evidence.finalUrl), '证据里记录了最终地址')

    const timeline = await api.get(`/applications/${submitted.application.id}/timeline`)
    ok(timeline.some((event) => event.type === 'note' && /证据/.test(event.payload?.note ?? '')), '时间线留下存证备注')

    const closed = await api.expectFail('GET', `/apply/sessions/${session.id}`)
    eq(closed.status, 404, '提交后会话自动结束')

    /* -------------------------- 验证码拦截 -------------------------- */
    section('验证码拦截')
    const blocked = await api.post('/apply/sessions', {
      jobId: job.id,
      url: `${base}/apply-demo?captcha=1`,
    })
    eq(blocked.status, 'blocked', '打开即被标记为拦截')
    eq(blocked.blocker.kind, 'captcha', '识别为验证码', blocked.blocker)
    const blockedFill = await api.expectFail('POST', `/apply/sessions/${blocked.id}/fill`, { values: {} })
    eq(blockedFill.code, 'APPLY_BLOCKED', '拦截状态下拒绝填充')
    const blockedSubmit = await api.expectFail('POST', `/apply/sessions/${blocked.id}/submit`, { confirm: true })
    eq(blockedSubmit.code, 'APPLY_BLOCKED', '拦截状态下拒绝提交')
    await api.delete(`/apply/sessions/${blocked.id}`)

    /* ---------------------------- Web 端 ---------------------------- */
    // 上一个岗位已经有投递，另建一个干净岗位走 UI
    const job2 = await api.post('/jobs', {
      companyId: company.id,
      title: '前端工程师（UI 走查）',
      city: '杭州',
      jdUrl: `${fixture.base}/jd/2`,
    })
    const fetched2 = await api.post(`/jobs/${job2.id}/fetch-jd`)
    eq(fetched2.job.salaryMin, 25000, '未填薪资的岗位从 JD 元信息补齐')
    await api.post(`/jobs/${job2.id}/score`)

    /* --------------------- 详情页的两个投递入口 --------------------- */
    section('岗位详情：进入待投 / 直接投递 与列表统一')
    await openPage(page, `${base}/jobs/${job2.id}`, '[data-testid="job-detail-direct"]')
    eq(await text(page, '[data-testid="job-detail-queue"]'), '进入待投', '详情页也有「进入待投」按钮')
    eq(await text(page, '[data-testid="job-detail-direct"]'), '直接投递', '详情页也有「直接投递」按钮')
    ok(
      !(await page.$$eval('button', (els) => els.map((el) => el.textContent?.trim() ?? '').join('|'))).includes('登记投递'),
      '详情页按钮里不再出现旧的「登记投递」文案',
    )
    await page.click('[data-testid="job-detail-queue"]')
    await page.waitForSelector('[data-testid="queue-dialog"]', { timeout: 5000 })
    ok((await text(page, '[data-testid="queue-dialog-title"]')).includes('进入待投'), '详情页弹窗头部也叫「进入待投」')
    eq(await text(page, '[data-testid="queue-confirm"]'), '进入待投', '详情页确认按钮也叫「进入待投」')
    ok(
      !(await page.$eval('[data-testid="queue-dialog"]', (el) => el.textContent ?? '')).includes('初始状态'),
      '详情页弹窗也没有「初始状态」字段',
    )
    eq(await count(page, '[data-testid="queue-dialog"] textarea'), 1, '与列表弹窗一样带「备注」字段')
    await page.click('[data-testid="queue-cancel"]')
    await page.waitForFunction(() => !document.querySelector('[data-testid="queue-dialog"]'), { timeout: 5000 })

    await page.click('[data-testid="job-detail-direct"]')
    await page.waitForSelector('[data-testid="apply-dialog"]', { timeout: 5000 })
    eq(await pickValue(page, '[data-testid="apply-job"]'), job2.id, '详情页直接投递弹窗默认带入该岗位')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-testid="apply-dialog"]'), { timeout: 5000 })

    section('Web：岗位库「直接投递」弹窗完整流程')
    await openPage(page, `${base}/jobs`, '[data-testid="job-row-title"]')
    await page.waitForSelector(`[data-testid="direct-apply-${job2.id}"]`, { timeout: 8000 })
    await page.click(`[data-testid="direct-apply-${job2.id}"]`)
    await page.waitForSelector('[data-testid="apply-dialog"]', { timeout: 5000 })
    eq(await pickValue(page, '[data-testid="apply-job"]'), job2.id, '弹窗默认带入这一行的岗位')
    ok(
      (await page.$eval('[data-testid="apply-url"]', (el) => el.value)).includes('/jd/2'),
      '起始地址默认带入岗位 JD 链接',
    )
    eq(await count(page, '[data-testid="apply-resume"]'), 1, '弹窗有「使用的简历」字段')
    eq(await count(page, '[data-testid="apply-channel"]'), 1, '弹窗有「渠道」字段')
    // 选内推：验证渠道不是摆设，会写进这次自动登记的投递记录
    await pick(page, '[data-testid="apply-channel"]', 'referral')
    // 起始地址手动填成服务端的演示表单（界面上没有「用本地演示页」捷径，只能填地址）
    await fill(page, '[data-testid="apply-url"]', `${base}/apply-demo`)
    eq(await page.$eval('[data-testid="apply-url"]', (el) => el.value), `${base}/apply-demo`, '起始地址可手填')
    await page.click('[data-testid="apply-open"]')
    await page.waitForSelector('[data-testid="apply-fill"]', { timeout: 20_000 })
    ok(true, '弹窗里打开页面并渲染出字段表单')

    await page.click('[data-testid="apply-fill"]')
    await page.waitForFunction(() => document.body.textContent?.includes('全部字段已填入'), { timeout: 10_000 })
    ok(true, '一键填充成功')

    const checkbox = await page.$('input[type="checkbox"]')
    await checkbox?.click()
    await page.click('[data-testid="apply-submit"]')
    await page.waitForFunction(() => document.body.textContent?.includes('存证截图'), { timeout: 20_000 })
    ok(true, '提交后页面显示存证结果')

    const apps = await api.get('/applications?limit=100')
    const uiApp = apps.find((item) => item.jobId === job2.id)
    ok(Boolean(uiApp), 'UI 提交也自动登记了投递')
    eq(uiApp?.status, 'applied', 'UI 提交的投递状态正确')
    eq(uiApp?.channel, 'referral', '弹窗选的「内推」渠道写进了投递记录')
    ok(Boolean(uiApp?.evidence?.screenshot), 'UI 提交也存了截图')
    eq(consoleErrors.length, 0, '页面无 JS 报错', consoleErrors.slice(0, 3))
  } finally {
    await browser.close()
    await server.stop()
    fixture.server.close()
  }
  return summary('P4 端到端')
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
