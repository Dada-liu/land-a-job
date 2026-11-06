/**
 * P7 端到端：指标、打磨与联调。
 *
 * 覆盖：响应时长中位数（口径可手算）→ 版本胜率（样本不足不瞎给结论）→ 漏斗与手工统计一致
 * → 快捷键与 ⌘K → 设置分区二级 tab 的导航层级 → 移动端 390px（侧栏抽屉、无横向溢出）
 * → 快照保留 7 份 + 全库导出可解析
 * → Agent 交接组件（指令带 id、复制有反馈、Skill 未装给安装命令）→ Skill 状态条
 * → provenance 可见（AI/人工筛选 + 母版差异）。
 *
 * 跑法：npm run build && node scripts/e2e/p7.mjs
 *
 * 断言里的数字全部是手算的：这个阶段测的就是「指标算法」，用算法复算算法等于没测。
 */
import { count, eq, launchBrowser, ok, openPage, section, startServer, summary, text } from './lib.mjs'

const DAY = 86_400_000
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString()

const RESUME = {
  personalInfo: { name: '测试用户', jobTitle: '前端工程师', workYears: '6年', city: '杭州', summary: '六年 React 经验，做过 BFF 与性能优化。' },
  educations: [{ school: '某大学', degree: '本科', major: '计算机', period: '2014-2018' }],
  skills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Node.js' }],
  projects: [{ name: '性能优化', technologies: ['React'], description: '首屏从 3.2s 降到 1.1s' }],
  experiences: [{ company: '某公司', role: '高级前端工程师', period: '2020-2024', description: '负责 BFF' }],
}

/** AI 改过的变体：只改摘要 + 重排技能，用来测「差异肉眼可见」 */
const VARIANT = {
  ...RESUME,
  personalInfo: { ...RESUME.personalInfo, summary: '六年 React / TypeScript 经验；主导 BFF 重构，首屏 3.2s → 1.1s。' },
  skills: [{ name: 'React' }, { name: 'Node.js' }, { name: 'TypeScript' }],
}

async function waitFor(check, message, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) {
      ok(true, message)
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  ok(false, message)
  return false
}

async function main() {
  const server = await startServer({ port: 4418 })
  const { browser, page, consoleErrors } = await launchBrowser()
  const { api, base } = server

  // 剪贴板权限：overridePermissions 在 headless 下对 clipboard-write 不生效，
  // 必须走 CDP 的 Browser.grantPermissions（权限名也不一样）
  const cdp = await browser.target().createCDPSession()
  const grantClipboard = () =>
    cdp.send('Browser.grantPermissions', {
      origin: base,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
  await grantClipboard()

  try {
    /* ------------------------- 响应时长中位数 ------------------------- */
    section('响应时长：中位数手算对齐')
    const company = await api.post('/companies', { name: '丙公司', city: '杭州' })
    const job = await api.post('/jobs', { companyId: company.id, title: '高级前端工程师', city: '杭州', jdText: 'React TypeScript Node.js' })
    const resume = await api.post('/resumes', { title: '前端母版', templateId: 'classic', data: RESUME })

    const mk = async (title, appliedDays) => {
      const jobRow = await api.post('/jobs', { companyId: company.id, title, jdText: 'React' })
      return api.post('/applications', {
        jobId: jobRow.id,
        resumeId: resume.id,
        status: 'applied',
        appliedAt: daysAgo(appliedDays),
      })
    }

    // 三条有推进：12 天前投的今天筛过、6 天前投的今天筛过、20 天前投的今天直接约面
    const a12 = await mk('岗位 A', 12)
    const a6 = await mk('岗位 B', 6)
    const a20 = await mk('岗位 C', 20)
    await api.post(`/applications/${a12.id}/status`, { to: 'screening' })
    await api.post(`/applications/${a6.id}/status`, { to: 'screening' })
    await api.post(`/applications/${a20.id}/status`, { to: 'interview' })
    // 一条还在等：4 天前投的，没有任何推进
    await mk('岗位 D', 4)

    const dash = await api.get('/stats/dashboard')
    eq(dash.responseTime.sample, 3, '采样 3 条（推进过的才算样本）')
    eq(dash.responseTime.medianDays, 12, '中位数 12 天（6/12/20 的中间那个）')
    eq(dash.responseTime.p90Days, 18.4, '90 分位 18.4 天（12 + (20-12)×0.8）')
    eq(dash.responseTime.waiting, 1, '还在等 1 条（不计入中位数，也不当 0 天）')
    eq(dash.responseTime.invalid, 0, '没有时间倒挂的异常样本')

    await openPage(page, `${base}/`, '[data-testid="response-median"]')
    eq(await text(page, '[data-testid="response-median"]'), '12 天', '总览页显示响应中位数 12 天')

    /* --------------------------- 版本胜率 --------------------------- */
    section('版本胜率：样本不足不给结论')
    const variant = await api.post('/resumes', {
      title: '定制版 · 丙公司',
      templateId: 'classic',
      kind: 'variant',
      baseResumeId: resume.id,
      data: VARIANT,
      jobId: job.id,
    })
    // 变体投 3 家，其中 1 家进面；母版投 1 家且进面（样本不足）
    for (const offset of [0, 1, 2]) {
      const j = await api.post('/jobs', { companyId: company.id, title: `变体岗位 ${offset}`, jdText: 'React' })
      const app = await api.post('/applications', {
        jobId: j.id,
        resumeId: variant.id,
        status: 'applied',
        appliedAt: daysAgo(3),
      })
      if (offset === 0) await api.post(`/applications/${app.id}/status`, { to: 'interview' })
    }

    // 第三个版本只投 1 家：用来证明「样本不足就不给转化率」
    const single = await api.post('/resumes', { title: '单投简历', templateId: 'classic', data: RESUME })
    const singleJob = await api.post('/jobs', { companyId: company.id, title: '单投岗位', jdText: 'React' })
    await api.post('/applications', { jobId: singleJob.id, resumeId: single.id, status: 'applied', appliedAt: daysAgo(2) })

    const perf = await api.get('/stats/resume-performance')
    const variantPerf = perf.find((row) => row.resumeId === variant.id)
    eq(variantPerf?.applied, 3, '变体投了 3 家')
    eq(variantPerf?.interviewed, 1, '变体进面 1 家')
    ok(variantPerf?.enough === true, '3 份样本达到下限，可以给转化率')
    ok(Math.abs((variantPerf?.interviewRate ?? 0) - 1 / 3) < 0.001, '进面率 = 1/3')
    const masterPerf = perf.find((row) => row.resumeId === resume.id)
    eq(masterPerf?.applied, 4, '母版投了 4 家（响应时长那批）')
    ok(masterPerf?.enough === true && masterPerf?.interviewRate === 0.25, '母版进面率 = 1/4')
    const singlePerf = perf.find((row) => row.resumeId === single.id)
    ok(singlePerf?.enough === false && singlePerf?.interviewRate === null, '只有 1 份样本的简历不给转化率')

    await openPage(page, `${base}/`, '[data-testid="resume-performance"]')
    const perfText = await page.$eval('[data-testid="resume-performance"]', (element) => element.textContent ?? '')
    ok(perfText.includes('定制版 · 丙公司'), '胜率表出现 AI 改过的版本')
    ok(perfText.includes('样本不足'), '单投那行显示「样本不足」而不是 100%')

    /* ------------------------- 漏斗与手工统计 ------------------------- */
    section('漏斗与手工统计一致')
    const dash2 = await api.get('/stats/dashboard')
    const funnel = new Map(dash2.funnel.map((step) => [step.stage, step.reached]))
    // 8 条投递：4 条响应测试（a12/a6 筛过、a20 直跳面试、a4 只有投递）+ 3 条变体（1 条进面）+ 1 条单投
    eq(funnel.get('applied'), 8, '已投递 = 8（全部有 appliedAt）')
    eq(funnel.get('screening'), 4, '筛选中 = 4（a12 + a6 + a20（直跳面试也算过筛）+ 变体那条）')
    eq(funnel.get('interview'), 2, '面试 = 2（a20 直跳 + 变体 1 条）')
    eq(funnel.get('offer'), 0, 'Offer = 0（还没有人到这一步）')
    eq(funnel.get('accepted'), 0, '已接受 = 0')

    /* ---------------------------- 快捷键 ---------------------------- */
    section('快捷键：不需要鼠标也能跳')
    await openPage(page, `${base}/`, '[data-testid="north-star-value"]')
    await page.keyboard.press('g')
    await page.keyboard.press('o')
    await waitFor(async () => new URL(page.url()).pathname === '/offers', 'g → o 跳到 Offer 对比')
    await page.keyboard.press('g')
    await page.keyboard.press('s')
    await waitFor(async () => new URL(page.url()).pathname === '/settings', 'g → s 跳到设置')

    await page.keyboard.press('n')
    await page.waitForSelector('[data-testid="palette-input"]', { timeout: 4000 })
    ok(true, 'n 打开快捷录入面板')
    await page.keyboard.press('Escape')
    await waitFor(async () => (await count(page, '[data-testid="palette-input"]')) === 0, 'Esc 关闭面板')

    /* ------------------------- 导航层级 ------------------------- */
    section('导航层级：设置下的四个二级 tab')
    await openPage(page, `${base}/settings`, '[data-testid="settings-tabs"]')
    eq(await count(page, '[data-testid="settings-tabs"] a'), 4, '设置分区有 4 个二级 tab')
    eq(
      await page.$$eval('[data-testid="settings-tabs"] a', (els) => els.map((el) => el.textContent.trim()).join('/')),
      '简历/公司库/题库/数据和 Agent 连接',
      '二级 tab 顺序：三个资料库在前，数据和 Agent 连接排最后',
    )
    eq(await count(page, '[data-testid="sidebar"] nav a'), 6, '侧栏只留 6 个一级项（投递助手已下线）')
    eq(await count(page, '[data-testid="nav-companies"]'), 0, '公司库不再是一级项')
    eq(await count(page, '[data-testid="nav-resumes"]'), 0, '简历不再是一级项')
    eq(await count(page, '[data-testid="nav-bank"]'), 0, '题库不再是一级项')
    eq(await count(page, '[data-testid="nav-apply"]'), 0, '投递助手不再是一级项')
    eq(await text(page, 'h1'), '设置 · 数据和 Agent 连接', '设置页顶栏标出二级 tab（不再重复成「设置 · 设置」）')

    await openPage(page, `${base}/resumes`, '[data-testid="settings-tabs"]')
    eq(await text(page, 'h1'), '设置 · 简历', '简历页顶栏标出所属分区')
    await waitFor(
      async () =>
        (await page.$$eval('[data-testid="settings-tab-resumes"]', (els) => els[0]?.getAttribute('aria-current') ?? null)) ===
        'page',
      '简历页高亮「简历」tab',
    )
    ok(
      await page.$eval('[data-testid="nav-settings"]', (el) => el.className.includes('bg-stone-100')),
      '简历页里侧栏「设置」保持高亮',
    )
    await page.click('[data-testid="settings-tab-bank"]')
    await waitFor(async () => new URL(page.url()).pathname === '/bank', '点二级 tab 能切到题库')
    // SPA 导航：URL 先变、React 后重渲染，高亮要等状态落地而不是抢一帧
    await waitFor(
      async () =>
        (await page.$$eval('[data-testid="settings-tab-bank"]', (els) => els[0]?.getAttribute('aria-current') ?? null)) ===
        'page',
      '题库页高亮「题库」tab',
    )
    eq(await count(page, '[data-testid="settings-tabs"] a'), 4, '题库页同样带二级 tab')

    /* --------------------------- 移动端 --------------------------- */
    section('移动端 390px：侧栏变抽屉、不横向溢出')
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
    await openPage(page, `${base}/`, '[data-testid="north-star-value"]')
    const collapsed = await page.$eval('[data-testid="sidebar"]', (element) => element.getBoundingClientRect().right)
    ok(collapsed <= 0, '侧栏默认收起（右边缘在视口外）', collapsed)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(overflow <= 1, '总览页没有横向溢出', overflow)
    eq(await count(page, '[data-testid="nav-toggle"]'), 1, '出现汉堡按钮')
    await page.click('[data-testid="nav-toggle"]')
    await waitFor(
      async () => page.$eval('[data-testid="sidebar"]', (element) => element.getBoundingClientRect().left >= 0),
      '点开后侧栏进入视口',
    )
    // 抽屉展开后汉堡被侧栏盖住，收起要用侧栏自己的关闭按钮（顺带验证这个按钮存在）
    await page.click('[data-testid="nav-close"]')
    await waitFor(
      async () => page.$eval('[data-testid="sidebar"]', (element) => element.getBoundingClientRect().right <= 0),
      '侧栏里的关闭按钮能收起抽屉',
    )
    await openPage(page, `${base}/settings`, '[data-testid="settings-tabs"]')
    const settingsOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(settingsOverflow <= 1, '设置分区的二级 tab 在 390px 下不横向溢出', settingsOverflow)
    await openPage(page, `${base}/pipeline`, 'body')
    const pipelineOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(pipelineOverflow <= 1, '看板页也没有横向溢出（内部表格自己滚）', pipelineOverflow)
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })

    /* ----------------------- 快照与全库导出 ----------------------- */
    section('快照保留 7 份 + 全库导出')
    for (let index = 0; index < 9; index += 1) {
      await api.post('/data/snapshots')
    }
    const snapshots = await api.get('/data/snapshots')
    eq(snapshots.keep, 7, '保留上限 7 份')
    eq(snapshots.items.length, 7, '连续备份 9 次后只剩 7 份')
    ok(snapshots.items.every((item) => item.bytes > 0), '每份快照都不是空文件')

    const dump = await api.get('/data/export')
    const expectedTables = ['company', 'job', 'resume', 'application', 'application_event', 'interview', 'question', 'offer']
    ok(
      expectedTables.every((name) => Array.isArray(dump.tables[name])),
      '导出包含全部业务表',
      Object.keys(dump.tables),
    )
    eq(dump.counts.application, 8, '导出里的投递行数 = 8')
    eq(dump.tables.company.length, dump.counts.company, '计数与行数一致')
    ok(dump.app.schemaVersion >= 1 && dump.app.version, '导出带 schema 版本与应用版本')
    const raw = await fetch(`${base}/api/data/export?download=1`, { headers: { 'x-land-token': server.token } })
    ok(
      (raw.headers.get('content-disposition') ?? '').includes('attachment; filename="land-export-'),
      '下载模式带 attachment 头',
      raw.headers.get('content-disposition'),
    )
    const rawDump = await raw.json()
    eq(rawDump.counts.application, 8, '下载到的 JSON 与信封接口内容一致')

    await openPage(page, `${base}/settings`, '[data-testid="snapshot-list"] li')
    await waitFor(
      async () => (await count(page, '[data-testid="snapshot-list"] li')) === 7,
      '设置页列出 7 份快照',
    )
    await page.click('[data-testid="snapshot-now"]')
    await waitFor(async () => (await api.get('/data/snapshots')).items.length === 7, '再备份一次仍只有 7 份（老的被清理）')
    eq(await count(page, '[data-testid="export-json"]'), 1, '设置页有导出入口')

    /* ----------------------- Skill 状态条 ----------------------- */
    section('Skill 状态条')
    // 状态条在 /api/skills 返回前只显示「检测中」，所以要等它落地
    await waitFor(async () => (await count(page, '[data-testid="skill-bar"]')) === 1, '侧栏有 Skill 状态条')
    // 侧栏只给一句结论，九个 Skill 的明细在设置页（见下面 skill-row 的断言）
    eq(await count(page, '[data-testid="skill-bar"] li'), 0, '侧栏不再逐条列 Skill')
    await waitFor(
      async () => (await text(page, '[data-testid="skill-bar"]')).includes('Skill 已就绪'),
      '侧栏只说一句「Skill 已就绪」',
    )
    const broken = await page.$eval('[data-testid="skill-bar"]', (element) => element.getAttribute('data-broken'))
    eq(broken, '0', '仓库里的 Skill 版本与登记一致，全部就绪')
    await waitFor(
      async () => (await count(page, '[data-testid="skill-row"]')) === 9,
      '设置页列出每个 Skill 的版本与安装位置',
    )

    /* ------------------------ AI 交接组件 ------------------------ */
    section('AI 交接：指令自带 id，复制有反馈')
    await openPage(page, `${base}/jobs/${job.id}`, '[data-testid="job-tailor"]')
    await page.click('[data-testid="job-tailor"]')
    await page.waitForSelector('[data-testid="agent-handoff"]', { timeout: 6000 })
    const instruction = await text(page, '[data-testid="handoff-instruction"]')
    ok(instruction.includes(job.id), '指令里带了 jobId（Agent 不用再问上下文）', instruction.slice(0, 60))
    const skillBadge = await page.$eval('[data-testid="handoff-skill"]', (element) => ({
      skill: element.getAttribute('data-skill'),
      compatible: element.getAttribute('data-compatible'),
    }))
    eq(skillBadge.skill, 'resume-tailor', '交接组件标注了该用哪个 Skill')
    eq(skillBadge.compatible, 'true', 'Skill 已装好时不出现安装提示')
    await page.click('[data-testid="handoff-copy"]')
    await waitFor(
      async () => (await text(page, '[data-testid="handoff-copy"]')) === '已复制',
      '复制成功后按钮变成「已复制」',
    )
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    ok(clipboard.includes(job.id), '剪贴板里确实是指令原文')

    // 剪贴板不可用时不能假装成功：注入一个必定失败的 writeText 来验证降级分支
    // （用 resetPermissions 测不出来——有用户手势时 Chrome 允许写剪贴板）
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: () => Promise.reject(new Error('denied')),
      })
    })
    await page.click('[data-testid="handoff-copy"]')
    await waitFor(
      async () => (await page.evaluate(() => document.body.textContent ?? '')).includes('浏览器不允许自动复制'),
      '剪贴板不可用时明确提示手动选中（而不是静默失败）',
    )

    /* ---------------------- provenance 可见 ---------------------- */
    section('provenance：AI 版本可筛、可与母版对比')
    // 必须带一次内容写入：只提交 provenance 会被服务端拒绝（它不构成「实质修改」）
    await api.patch(`/resumes/${variant.id}`, {
      data: VARIANT,
      provenance: { skill: 'resume-tailor', skillVersion: '1.0.0', model: 'test-model' },
    })
    const savedVariant = await api.get(`/resumes/${variant.id}`)
    eq(savedVariant.provenance?.skill, 'resume-tailor', 'provenance 已落库')

    await openPage(page, `${base}/resumes`, '[data-testid="resume-grid"]')
    await page.click('[data-testid="resume-filter-ai"]')
    await waitFor(async () => (await count(page, '[data-testid="resume-grid"] article')) === 1, '筛「AI 改过」只剩 1 份')
    await page.click('[data-testid="resume-filter-manual"]')
    await waitFor(
      async () => (await count(page, '[data-testid="resume-grid"] article')) >= 1,
      '筛「人工」能看到母版',
    )
    await page.click('[data-testid="resume-filter-all"]')
    await waitFor(async () => (await count(page, '[data-testid="resume-grid"] article')) === 3, '回到全部 3 份')

    await page.click('[data-testid="resume-compare"]')
    await page.waitForSelector('[data-testid="resume-diff"]', { timeout: 6000 })
    const diffText = await page.$eval('[data-testid="resume-diff"]', (element) => element.textContent ?? '')
    ok(diffText.includes('personalInfo.summary'), '差异里能定位到摘要字段', diffText.slice(0, 80))
    ok(diffText.includes('resume-tailor'), '差异里标注了这一版由哪个 Skill 写入')
    ok(diffText.includes('处差异'), '给出了差异条数而不是「两版不同」')

    /* ---------------------------- 收尾 ---------------------------- */
    section('核对')
    eq(consoleErrors.length, 0, `浏览器控制台无错误（${consoleErrors.slice(0, 2).join(' | ')}）`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

main()
  .then(() => {
    process.exitCode = summary('P7')
  })
  .catch((error) => {
    console.error('\n执行中断：', error)
    process.exitCode = summary('P7')
  })
