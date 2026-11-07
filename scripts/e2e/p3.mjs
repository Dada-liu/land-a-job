/**
 * P3 端到端：投递流水线 Web。
 *
 * 覆盖：Dashboard 指标口径 → 公司库 UI 新建 → ⌘K 一句话建岗 → 岗位列表 fit 排序
 * → 看板拖拽推进（含非法跃迁拦截）→ 刷新后一致 → 时间线/备注 → WS 实时刷新
 * → 岗位库「进入待投」弹窗与「直接投递」入口。
 *
 * 跑法：npm run build && node scripts/e2e/p3.mjs
 */
import { count, dragTo, eq, launchBrowser, ok, openPage, section, startServer, summary, text } from './lib.mjs'

const JD = `高级前端工程师
1. 5-8 年经验，本科及以上学历
2. 精通 React / TypeScript，熟悉 Next.js 与 Tailwind CSS
3. 熟悉 Node.js，了解 Kubernetes 与 CI/CD
薪资：35-55K，工作地点：杭州`

const resumeData = {
  personalInfo: { name: '测试用户', jobTitle: '前端工程师', workYears: '6年', city: '杭州' },
  educations: [{ school: '某大学', degree: '本科', major: '计算机', period: '2014-2018' }],
  skills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Next.js' }],
  projects: [{ name: '数据看板', technologies: ['ECharts'], description: 'React + TypeScript 实现' }],
  experiences: [{ company: '某公司', role: '高级前端工程师', period: '2020-2024', description: '负责 Node.js BFF' }],
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

async function main() {
  const server = await startServer({ port: 4410 })
  const { browser, page, consoleErrors } = await launchBrowser()
  const { api, base } = server

  try {
    /* ---------------------------- 造数据 ---------------------------- */
    section('准备数据（API）')
    const company = await api.post('/companies', { name: '字节跳动', city: '杭州', priority: 1 })
    const job = await api.post('/jobs', {
      companyId: company.id,
      title: '高级前端工程师',
      city: '杭州',
      salaryMin: 35000,
      salaryMax: 55000,
      jdText: JD,
      keywords: ['react', 'typescript', 'node.js'],
    })
    const jobLow = await api.post('/jobs', {
      companyId: company.id,
      title: '前端实习生',
      city: '北京',
      jdText: '熟悉 jQuery 即可，1 年经验',
    })
    // P3 阶段还没有 /score 接口，先按 Agent 覆盖的方式写入 fit（P4 会由规则重算）
    await api.patch(`/jobs/${job.id}`, {
      fitScore: 72,
      fitReasons: ['技术匹配 62｜JD 技术词 8 个，命中 5 个', '年限 100｜6 年 vs 要求 5-8 年'],
      fitSource: 'agent',
    })
    const resume = await api.post('/resumes', { title: '前端母版', templateId: 'classic', data: resumeData })

    const appQueued = await api.post('/applications', {
      jobId: jobLow.id,
      resumeId: resume.id,
      status: 'queued',
      channel: 'official',
    })
    const appApplied = await api.post('/applications', {
      jobId: job.id,
      resumeId: resume.id,
      status: 'applied',
      appliedAt: new Date().toISOString(),
      channel: 'official',
    })
    ok(Boolean(company.id && job.id && appApplied.id), '公司/岗位/投递创建成功')

    /* ---------------------------- Dashboard ---------------------------- */
    section('Dashboard 指标口径')
    const dash = await api.get('/stats/dashboard')
    eq(dash.northStar.value, 1, '北极星：本周有效投递 = 1（已投 + 关联简历 + fit≥60）')
    eq(dash.funnel.find((s) => s.stage === 'applied').reached, 1, '漏斗已投递 = 1')
    eq(dash.week.submitted, 1, '本周已投 = 1')
    eq(dash.today.length, 0, '刚投的不会立刻出现在待办里')

    // 造一条 10 天前的投递，应触发「催一下」
    const jobOld = await api.post('/jobs', { companyId: company.id, title: '全栈工程师', city: '杭州', jdText: 'React Node' })
    await api.post('/applications', {
      jobId: jobOld.id,
      resumeId: resume.id,
      status: 'applied',
      appliedAt: daysAgo(10),
    })
    const dash2 = await api.get('/stats/dashboard')
    ok(dash2.today.some((task) => task.kind === 'no_reply'), '10 天无回音 → 生成催办任务', dash2.today.map((t) => t.kind))

    await openPage(page, `${base}/`, '[data-testid="north-star-value"]')
    eq(await text(page, '[data-testid="north-star-value"]'), '1', '总览页北极星显示 1')
    eq(await text(page, '[data-testid="funnel-applied"]'), '2', '总览页已投递显示 2（含 10 天前那条）')
    ok((await page.content()).includes('催一下'), '总览页出现「催一下」待办')

    /* --------------------------- 本周目标可调 --------------------------- */
    section('总览：本周目标可调（hover → 改数字）')
    const pencilIdle = await page.$eval('[data-testid="north-star-target"] svg', (el) => getComputedStyle(el).opacity)
    const targetBox = await (await page.$('[data-testid="north-star-target"]')).boundingBox()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
    await page
      .waitForFunction(
        () => getComputedStyle(document.querySelector('[data-testid="north-star-target"] svg')).opacity === '1',
        { timeout: 2000 },
      )
      .then(() => ok(pencilIdle === '0', '铅笔默认不显示，hover 到目标数上才出现'))
      .catch(() => ok(false, '铅笔默认不显示，hover 到目标数上才出现'))

    await page.click('[data-testid="north-star-target"]')
    await page.waitForSelector('[data-testid="north-star-target-input"]', { timeout: 3000 })
    // 输入框出现时是全选状态，直接敲数字即可替换原值
    await page.type('[data-testid="north-star-target-input"]', '12')
    await page.keyboard.press('Enter')
    await page
      .waitForFunction(() => document.querySelector('[data-testid="north-star-target"]')?.textContent?.includes('12'), {
        timeout: 4000,
      })
      .catch(() => null)
    eq((await text(page, '[data-testid="north-star-target"]')).replace(/\s/g, ''), '/目标12', '目标改为 12 并立即回显')
    eq((await api.get('/settings')).weeklyTarget, 12, '目标已落库')
    eq((await api.get('/stats/dashboard')).northStar.target, 12, 'dashboard 的 target 跟着变（不是只改了界面）')

    // Esc 取消：敲了 30 但不该落库
    await page.click('[data-testid="north-star-target"]')
    await page.waitForSelector('[data-testid="north-star-target-input"]', { timeout: 3000 })
    await page.type('[data-testid="north-star-target-input"]', '30')
    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.querySelector('[data-testid="north-star-target"]')?.textContent?.includes('12'),
      { timeout: 3000 },
    ).catch(() => null)
    eq((await text(page, '[data-testid="north-star-target"]')).replace(/\s/g, ''), '/目标12', 'Esc 取消后回显原值')
    eq((await api.get('/settings')).weeklyTarget, 12, 'Esc 取消不落库')

    /* --------------------------- WS 实时刷新 --------------------------- */
    section('WS 实时刷新（Agent 改动 → 页面自更新）')
    await api.post(`/applications/${appApplied.id}/status`, { to: 'screening' })
    await page
      .waitForFunction(() => document.querySelector('[data-testid="funnel-screening"]')?.textContent?.trim() === '1', {
        timeout: 4000,
      })
      .then(() => ok(true, 'MCP/HTTP 改状态后，页面 1 个轮询周期内自动刷新漏斗'))
      .catch(() => ok(false, 'WS 推送未能让漏斗自动刷新'))

    /* ---------------------------- 公司库 UI ---------------------------- */
    section('公司库：UI 新建 + 列表')
    await openPage(page, `${base}/companies`, 'table')
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '新建公司')
      button?.click()
    })
    await page.waitForSelector('[data-testid="company-name"]', { timeout: 5000 })
    await page.type('[data-testid="company-name"]', '美团')
    await page.click('[data-testid="company-save"]')
    await page.waitForFunction(() => document.body.textContent?.includes('美团'), { timeout: 6000 })
    const companies = await api.get('/companies?limit=50')
    ok(companies.some((item) => item.name === '美团'), 'UI 新建的公司已落库', companies.map((c) => c.name))

    /* ----------------------------- ⌘K 录入 ----------------------------- */
    section('⌘K 一句话建岗')
    await openPage(page, `${base}/`, '[data-testid="north-star-value"]')
    await page.keyboard.down('Meta')
    await page.keyboard.press('k')
    await page.keyboard.up('Meta')
    await page.waitForSelector('[data-testid="palette-input"]', { timeout: 5000 })
    await page.type('[data-testid="palette-input"]', '美团 后端工程师 30-50k https://example.com/jd/1')
    await page.waitForFunction(() => document.body.textContent?.includes('新建岗位：美团 · 后端工程师'), { timeout: 4000 })
    ok(true, '识别出公司/岗位/薪资/链接')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /\/jobs\/[^/]+$/.test(location.pathname), { timeout: 8000 })
    const jobs = await api.get('/jobs?limit=100')
    const created = jobs.find((item) => item.title === '后端工程师')
    ok(Boolean(created), '岗位已落库')
    eq(created?.salaryMin, 30000, '月薪下限解析为 30000')
    eq(created?.salaryMax, 50000, '月薪上限解析为 50000')
    eq(created?.companyId, companies.find((c) => c.name === '美团')?.id, '自动关联到已有公司「美团」')
    ok(created?.jdUrl === 'https://example.com/jd/1', 'JD 链接已保存')

    /* ---------------------------- 岗位列表排序 ---------------------------- */
    section('岗位库：fit 排序')
    // 等行而不是等 table：加载中也会渲染表头，等 table 会在空表上取到 undefined
    await openPage(page, `${base}/jobs`, '[data-testid="job-row-title"]')
    const firstRowTitle = await page.$eval('[data-testid="job-row-title"]', (element) => element.textContent?.trim() ?? '')
    eq(firstRowTitle, '高级前端工程师', '按 fit 排序时 72 分的岗位排在最前（未评分的在后）')

    /* ------------------------------ 看板拖拽 ------------------------------ */
    section('投递看板：拖拽推进')
    await page.setViewport({ width: 1920, height: 900 })
    await openPage(page, `${base}/pipeline`, '[data-column="applied"]')
    await page.waitForSelector(`[data-app-id="${appApplied.id}"]`, { timeout: 10_000 })

    const before = await api.get(`/applications/${appApplied.id}`)
    eq(before.status, 'screening', '（前置）该投递已被 WS 测试推进到筛选中')

    // 合法：screening → interview
    await dragTo(page, `[data-app-id="${appApplied.id}"]`, '[data-column="interview"]')
    await page.waitForFunction(
      (id) => document.querySelector(`[data-column="interview"] [data-app-id="${id}"]`) !== null,
      { timeout: 6000 },
      appApplied.id,
    )
    ok(true, '卡片已落到「面试中」列')
    const after = await api.get(`/applications/${appApplied.id}`)
    eq(after.status, 'interview', '状态已落库为 interview')

    const timeline = await api.get(`/applications/${appApplied.id}/timeline`)
    ok(timeline.some((event) => event.fromStatus === 'screening' && event.toStatus === 'interview'), '时间线写入 status_changed 事件')

    // 非法：applied → offer 应被拦截
    const appOld = (await api.get('/applications?limit=100')).find((item) => item.jobId === jobOld.id)
    await dragTo(page, `[data-app-id="${appOld.id}"]`, '[data-column="offer"]')
    await page.waitForFunction(() => document.body.textContent?.includes('不能从'), { timeout: 5000 }).catch(() => null)
    const blockedText = await page.evaluate(() => document.body.textContent ?? '')
    ok(blockedText.includes('不能从'), '非法跃迁被拦截并给出允许列表')
    const unchanged = await api.get(`/applications/${appOld.id}`)
    eq(unchanged.status, 'applied', '非法拖拽没有改动库里的状态')

    // 刷新后一致
    await page.reload({ waitUntil: 'domcontentloaded' })
    // 等卡片本身，而不是等列：加载中列就已经在 DOM 里了
    await page.waitForSelector(`[data-column="interview"] [data-app-id="${appApplied.id}"]`, { timeout: 10_000 })
    eq(await count(page, `[data-column="interview"] [data-app-id="${appApplied.id}"]`), 1, '刷新后卡片仍在「面试中」列')

    /* ------------------------------ 详情抽屉 ------------------------------ */
    section('投递详情抽屉：时间线 + 备注')
    await page.click(`[data-app-id="${appApplied.id}"]`)
    await page.waitForSelector('[data-testid="note-input"]', { timeout: 6000 })
    await page.type('[data-testid="note-input"]', 'HR 说下周安排二面')
    await page.click('[data-testid="note-submit"]')
    await page.waitForFunction(() => document.body.textContent?.includes('HR 说下周安排二面'), { timeout: 6000 })
    const withNote = await api.get(`/applications/${appApplied.id}/timeline`)
    ok(withNote.some((event) => event.type === 'note'), '备注已写入事件流')
    ok(
      withNote.some((event) => event.type === 'status_changed' && event.toStatus === 'interview'),
      '抽屉里的时间线包含刚才的推进事件',
    )

    /* -------------------------- 进入待投弹窗 -------------------------- */
    section('岗位库：进入待投弹窗 + 直接投递入口')
    await openPage(page, `${base}/jobs`, '[data-testid="job-row-title"]')
    await page.waitForSelector(`[data-testid="queue-apply-${created.id}"]`, { timeout: 8000 })
    eq(await text(page, `[data-testid="queue-apply-${created.id}"]`), '进入待投', '列表按钮文案改为「进入待投」')
    eq(await count(page, `[data-testid="direct-apply-${created.id}"]`), 1, '「进入待投」后还有「直接投递」按钮')
    await page.click(`[data-testid="queue-apply-${created.id}"]`)
    await page.waitForSelector('[data-testid="queue-dialog"]', { timeout: 5000 })
    ok((await text(page, '[data-testid="queue-dialog-title"]')).includes('进入待投'), '弹窗头部叫「进入待投」')
    eq(await text(page, '[data-testid="queue-confirm"]'), '进入待投', '右下角确认按钮叫「进入待投」')
    ok(
      !(await page.$eval('[data-testid="queue-dialog"]', (el) => el.textContent ?? '')).includes('初始状态'),
      '弹窗不再展示「初始状态」字段',
    )
    const dialogBox = await page.$eval('[data-testid="queue-dialog"]', (el) => {
      const rect = el.getBoundingClientRect()
      return { left: rect.left, right: rect.right, viewport: window.innerWidth }
    })
    ok(dialogBox.left > 0 && dialogBox.right < dialogBox.viewport, '是居中弹窗而不是贴右侧的抽屉', dialogBox)
    await page.click('[data-testid="queue-confirm"]')
    await page.waitForFunction(() => location.pathname === '/pipeline', { timeout: 8000 })
    const queued = (await api.get('/applications?limit=100')).find((item) => item.jobId === created.id)
    eq(queued?.status, 'queued', '进入待投只写 queued 状态')
    eq(queued?.appliedAt ?? null, null, '待投没有投递时间')

    eq(consoleErrors.length, 0, '页面无 JS 报错', consoleErrors.slice(0, 3))
  } finally {
    await browser.close()
    await server.stop()
  }
  return summary('P3 端到端')
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
