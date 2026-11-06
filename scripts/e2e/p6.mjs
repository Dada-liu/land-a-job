/**
 * P6 端到端：面试与 Offer。
 *
 * 覆盖：总包口径与页面同源 → 4 年总包/税后月均显示 → 权重滑块实时重排 → 定性评分影响排序
 * → 口径可展开 → Offer 状态与待答复数联动 → 题库筛选（公司/轮次）→ 三维评分雷达
 * → 答案录入落库 → 面试复盘（反馈 + 自评）→ 复盘任务消失 → 待办「完成」两条规则各自生效。
 *
 * 跑法：npm run build && node scripts/e2e/p6.mjs
 *
 * 说明：断言的是「页面显示的数字 === 口径算出来的数字」，也就是「页面没有另起一套算法」。
 * 期望值基本来自手算（写在断言的括号里），只有万元格式由页面的 formatMoney 决定。
 */
import { count, eq, launchBrowser, ok, openPage, pick, section, startServer, summary, text } from './lib.mjs'

const DAY = 86_400_000
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString()

const JD_A = `高级前端工程师
1. 5-8 年经验，本科及以上
2. 精通 React / TypeScript，熟悉性能优化
3. 有 Node.js BFF 经验优先
薪资：30-45K`

const resumeData = {
  personalInfo: { name: '测试用户', jobTitle: '前端工程师', workYears: '6年', city: '杭州' },
  educations: [{ school: '某大学', degree: '本科', major: '计算机', period: '2014-2018' }],
  skills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Node.js' }],
  projects: [{ name: '性能优化', technologies: ['React'], description: '首屏从 3.2s 降到 1.1s' }],
  experiences: [{ company: '某公司', role: '高级前端工程师', period: '2020-2024', description: '负责 BFF' }],
}

/** 轮询等待：UI 写入是异步的，直接 sleep 容易变成 flaky；成功也算一条断言，避免「这段没输出」 */
async function waitFor(check, message, timeout = 6000) {
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

/** 受控 range/input：React 记录着 value，必须走原生 setter 再派发 input 事件 */
async function setRange(page, selector, value) {
  await page.$eval(
    selector,
    (element, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(element, String(next))
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    },
    value,
  )
}

/** 读表格里每行的「公司 + 加权分」，用来断言排序 */
async function readScores(page) {
  return page.$$eval('[data-testid="offer-row"]', (rows) =>
    rows.map((row) => ({
      id: row.getAttribute('data-offer-id'),
      company: row.querySelector('td:nth-child(2) div')?.textContent?.trim() ?? '',
      score: row.querySelector('[data-testid="offer-total-score"]')?.textContent?.trim() ?? '',
    })),
  )
}

async function main() {
  const server = await startServer({ port: 4415 })
  const { browser, page, consoleErrors } = await launchBrowser()
  const { api, base } = server

  try {
    /* ---------------------------- 造数据 ---------------------------- */
    section('准备数据（API）')
    const companyA = await api.post('/companies', { name: '甲公司', city: '杭州', priority: 1 })
    const companyB = await api.post('/companies', { name: '乙公司', city: '上海', priority: 1 })
    const jobA = await api.post('/jobs', {
      companyId: companyA.id,
      title: '高级前端工程师',
      city: '杭州',
      salaryMin: 30000,
      salaryMax: 45000,
      jdText: JD_A,
      keywords: ['react', 'typescript', 'node.js'],
    })
    const jobB = await api.post('/jobs', { companyId: companyB.id, title: '前端专家', city: '上海', jdText: 'React TypeScript' })
    const resume = await api.post('/resumes', { title: '前端母版', templateId: 'classic', data: resumeData })

    const appA = await api.post('/applications', {
      jobId: jobA.id,
      resumeId: resume.id,
      status: 'applied',
      appliedAt: daysAgo(10),
      channel: 'official',
    })
    const appB = await api.post('/applications', {
      jobId: jobB.id,
      resumeId: resume.id,
      status: 'applied',
      appliedAt: new Date().toISOString(),
      channel: 'referral',
    })
    ok(Boolean(appA.id && appB.id), '两家公司各有一条投递')

    const offerA = await api.post('/offers', {
      applicationId: appA.id,
      companyName: '甲公司',
      city: '杭州',
      level: 'P7',
      baseMonthly: 30_000,
      monthsPerYear: 15,
      perfMonths: 0,
      signon: 20_000,
      housingFund: 0.12,
      deadline: new Date(Date.now() + 3 * DAY).toISOString(),
    })
    const offerB = await api.post('/offers', {
      applicationId: appB.id,
      companyName: '乙公司',
      city: '上海',
      level: 'P7+',
      baseMonthly: 25_000,
      monthsPerYear: 13,
      equityShares: 200_000,
      equityStrike: 1,
      equityFmv: 30,
      vestYears: 4,
      housingFund: 0.05,
      deadline: new Date(Date.now() + 6 * DAY).toISOString(),
    })
    ok(Boolean(offerA.id && offerB.id), '两份 Offer 已记录')

    const dashOffers = await api.get('/stats/dashboard')
    eq(dashOffers.upcoming.offersPending, 2, '总览「待答复的 Offer」= 2')

    /* ------------------------ Offer 页：口径与显示 ------------------------ */
    section('Offer 页：总包口径与页面同源')
    await openPage(page, `${base}/offers`, '[data-testid="offer-row"]')
    const rows = await readScores(page)
    eq(rows.length, 2, '对比表两行')
    // 甲：现金为王（15 个月 + 签字费 + 12% 公积金）；乙：现金弱但期权重
    eq(rows[0]?.company.split('\n')[0], '甲公司', '默认权重（现金 45% + 福利 10%）下甲排第一')
    eq(rows[0]?.score, '79', '甲的加权分 = 79（手算：(.45×1 + .15×0 + .1×1)/.7）')
    eq(rows[1]?.score, '72', '乙的加权分 = 72（手算：(.321 + .15 + .035)/.7）')

    const rowA = await page.$eval(`[data-offer-id="${offerA.id}"]`, (row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim() ?? ''),
    )
    // 甲 4 年 = 450000×4 + 20000 = 1,820,000 → "182 万"；首年 470000 → "47 万"
    eq(rowA[2], '182 万', '甲 4 年总包 182 万（未计涨薪）')
    eq(rowA[3], '45 万', '甲年现金 45 万（15 个月）')
    eq(rowA[4], '47 万', '甲首年现金 47 万（含签字费 2 万）')

    // 税后（手算）：450000 税前 − 31411.8（五险 10.5%×24930×12）− 35899.2（公积金 12%）
    // − 48752.25（个税：应纳税所得额 322689 落在 25% 档，322689×0.25−31920）= 333936.75
    // netMonthly = 333936.75 / 15 = 22262.45 → "2.2 万"
    const netText = await text(page, `[data-offer-id="${offerA.id}"] [data-testid="offer-net-monthly"]`)
    eq(netText, '2.2 万', '甲税后月均 = 2.2 万（手算 22,262.45，万元保留一位小数）')

    /* ------------------------ 权重滑块实时重排 ------------------------ */
    section('权重滑块：只认期权时排序翻转')
    for (const dimension of ['cash', 'welfare', 'growth', 'wlb', 'stability']) {
      await setRange(page, `[data-testid="weight-${dimension}"]`, 0)
    }
    await setRange(page, '[data-testid="weight-equity"]', 100)
    await waitFor(async () => (await readScores(page))[0]?.company.split('\n')[0] === '乙公司', '滑块调整后表格实时重排')
    const equityOnly = await readScores(page)
    eq(equityOnly[0]?.company.split('\n')[0], '乙公司', '只认期权时乙排第一')
    eq(equityOnly[0]?.score, '100', '乙期权维度拿满分')
    eq(equityOnly[1]?.score, '0', '甲没有期权，该维度 0 分')

    // 恢复默认：按钮是「视角」的唯一来源，不能靠刷新页面
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '恢复默认权重')
      button?.click()
    })
    await waitFor(async () => (await readScores(page))[0]?.company.split('\n')[0] === '甲公司', '恢复默认权重后回到甲的排序')

    /* ------------------------ 定性评分影响排序 ------------------------ */
    section('定性评分：未评分不计入，评了才参与加权')
    const unrated = await count(page, `[data-offer-id="${offerA.id}"] [data-testid="rate-growth-1"]`)
    eq(unrated, 1, '定性维度提供 1–5 评分入口')
    for (const dimension of ['growth', 'wlb', 'stability']) {
      const selector = `[data-offer-id="${offerA.id}"] [data-testid="rate-${dimension}-1"]`
      await page.click(selector)
      await waitFor(
        async () => {
          const offer = await api.get(`/offers/${offerA.id}`)
          return offer.assumptions?.qualitativeScores?.[dimension] === 1
        },
        `${dimension} 评分已落库`,
      )
      // 等按钮变选中态：这说明页面已经用新数据重绘，再点下一维才不会拿着旧 assumptions 覆盖
      await waitFor(
        async () => page.$eval(selector, (element) => element.className.includes('bg-stone-900')),
        `${dimension} 按钮变为选中态`,
      )
    }
    await waitFor(async () => (await readScores(page))[0]?.company.split('\n')[0] === '乙公司', '三项都给 1 分后乙反超')
    const rated = await readScores(page)
    eq(rated[1]?.score, '61', '甲三项 1 分后加权分 61（手算：.45+.1+.2×(.15+.1+.05)）')

    /* -------------------------- 口径可展开 -------------------------- */
    section('口径说明必须可查')
    await page.$$eval('details[data-testid="offer-assumptions"]', (items) => {
      for (const item of items) item.open = true
    })
    const assumptionText = await page.$eval('details[data-testid="offer-assumptions"]', (item) => item.textContent ?? '')
    ok(assumptionText.includes('未计涨薪'), '总包口径写明「未计涨薪」', assumptionText.slice(0, 80))
    ok(assumptionText.includes('公积金仅展示'), '总包口径写明公积金不计入总包')
    await page.$eval('details[data-testid="offer-tax-assumptions"]', (item) => {
      item.open = true
    })
    const taxText = await page.$eval('details[data-testid="offer-tax-assumptions"]', (item) => item.textContent ?? '')
    ok(taxText.includes('七级累进'), '税后口径写明「年度综合所得七级累进」')
    ok(taxText.includes('公积金个人部分'), '税后口径写明公积金不算到手现金')

    /* -------------------------- Offer 状态 -------------------------- */
    section('Offer 状态联动总览')
    await page.click(`[data-offer-id="${offerA.id}"] [data-testid="offer-accept"]`)
    await waitFor(async () => (await api.get(`/offers/${offerA.id}`)).status === 'accepted', '接受后状态落库为 accepted')
    await waitFor(async () => (await api.get('/stats/dashboard')).upcoming.offersPending === 1, '待答复 Offer 数降为 1')

    /* ---------------------------- 题库 ---------------------------- */
    section('题库：筛选与三维评分')
    // 面试挂在乙公司那条投递上：这样「按公司筛选」才真的能分出两家
    const interview = await api.post('/interviews', {
      applicationId: appB.id,
      round: 2,
      kind: 'tech',
      scheduledAt: daysAgo(4),
      durationMin: 60,
      format: 'video',
    })
    const q1 = await api.post('/questions', {
      jobId: jobA.id,
      category: 'tech',
      question: '首屏从 3.2s 压到 1.1s，具体做了哪几件事？哪一件最关键？',
      intent: '验证性能优化是真的做过还是听说',
      linkedItem: '项目：性能优化',
      origin: 'manual',
    })
    const q2 = await api.post('/questions', {
      interviewId: interview.id,
      category: 'risk',
      question: '如果给你一个你没做过的高并发场景，你前两周怎么开始？',
      intent: '看有没有方法论而不是硬扛',
      linkedItem: 'JD：Node.js BFF 经验优先',
      origin: 'generated',
      provenance: { skill: 'job-prep', skillVersion: '1.0.0' },
    })
    ok(Boolean(q1.id && q2.id), '两题已入题库（一道人工、一道 AI 生成）')
    ok(Boolean(q2.provenance?.skill === 'job-prep'), 'AI 生成题带 provenance=job-prep')

    await openPage(page, `${base}/bank`, '[data-testid="bank-item"]')
    eq(await count(page, '[data-testid="bank-item"]'), 2, '题库显示两题')
    eq(await text(page, '[data-testid="bank-avg-score"]'), '—', '都还没评分，平均分显示 —')

    await pick(page, '[data-testid="bank-filter-company"]', '甲公司')
    await waitFor(async () => (await count(page, '[data-testid="bank-item"]')) === 1, '按公司筛选甲只剩一条（乙的那题被筛掉）')
    await pick(page, '[data-testid="bank-filter-company"]', '乙公司')
    await waitFor(async () => (await count(page, '[data-testid="bank-item"]')) === 1, '按公司筛选乙只剩一条')
    await pick(page, '[data-testid="bank-filter-company"]', '')
    await pick(page, '[data-testid="bank-filter-round"]', '2')
    await waitFor(async () => (await count(page, '[data-testid="bank-item"]')) === 1, '按轮次筛选：只有第 2 轮那题')
    await pick(page, '[data-testid="bank-filter-round"]', '')
    await waitFor(async () => (await count(page, '[data-testid="bank-item"]')) === 2, '清掉筛选项后回到两题')

    // 录答案 + 三维评分
    const clickEditFor = async (questionId) => {
      await page.$eval(`[data-question-id="${questionId}"] [data-testid="bank-edit"]`, (button) => button.click())
    }
    await clickEditFor(q1.id)
    await page.waitForSelector('[data-testid="bank-answer"]', { timeout: 5000 })
    await page.type('[data-testid="bank-answer"]', 'CDN 静态化、路由级代码分割、图片转 WebP；最关键的是砍掉首屏的同步请求。')
    await pick(page, '[data-testid="bank-score-content"]', '5')
    await pick(page, '[data-testid="bank-score-structure"]', '3')
    await pick(page, '[data-testid="bank-score-delivery"]', '2')
    await page.type('[data-testid="bank-improvement"]', '结论先说：把「最关键」那句提到最前面。')
    await page.click('[data-testid="bank-save"]')
    await waitFor(async () => {
      const list = await api.get('/questions?limit=50')
      const saved = list.find((item) => item.id === q1.id)
      return saved?.score?.content === 5 && Boolean(saved?.myAnswer)
    }, '答案与三维评分已落库')
    const savedQ1 = (await api.get('/questions?limit=50')).find((item) => item.id === q1.id)
    eq(savedQ1?.score?.content, 5, '内容维度 5 分')
    eq(savedQ1?.score?.structure, 3, '结构维度 3 分')
    eq(savedQ1?.provenance ?? null, null, '人工录入的题不带 provenance')

    await waitFor(async () => {
      const radarValues = await page.$eval(
        `[data-question-id="${q1.id}"] [data-testid="answer-radar"]`,
        (element) => element.getAttribute('data-values'),
      )
      return radarValues === '5,3,2'
    }, '评分后雷达图重绘为 5/3/2')
    const radar = await page.$eval(`[data-question-id="${q1.id}"] [data-testid="answer-radar"]`, (element) =>
      element.getAttribute('data-values'),
    )
    eq(radar, '5,3,2', '雷达图取到三维分数 5/3/2')
    await waitFor(async () => (await text(page, '[data-testid="bank-avg-score"]')) === '3.3', '平均分 3.3')

    // 手动加题（走 UI）
    await page.click('[data-testid="bank-new"]')
    await page.waitForSelector('[data-testid="bank-question"]', { timeout: 5000 })
    await page.type('[data-testid="bank-question"]', '你最近一次和别人争执技术方案，最后怎么定的？')
    await pick(page, '[data-testid="bank-category"]', 'behavior')
    await page.click('[data-testid="bank-save"]')
    await waitFor(async () => (await api.get('/questions?limit=50')).length === 3, 'UI 手动加题已落库')
    const manual = (await api.get('/questions?limit=50')).find((item) => item.question.includes('争执技术方案'))
    ok(manual?.origin === 'manual', 'UI 加的题 origin=manual', manual?.origin)

    /* -------------------------- 面试复盘 -------------------------- */
    section('面试复盘：反馈 + 自评 → 复盘待办消失')
    const beforeFeedback = await api.get('/stats/dashboard')
    ok(
      beforeFeedback.today.some((task) => task.kind === 'thanks_letter'),
      '4 天前面完没写反馈 → 生成「补一次面试复盘」',
      beforeFeedback.today.map((task) => task.kind),
    )
    await openPage(page, `${base}/interviews?interview=${interview.id}`, '[data-testid="interview-feedback"]')
    await page.type('[data-testid="interview-feedback"]', '追问了三轮性能指标；被问「为什么不是 SSR」时答得发散。')
    await page.click('[data-testid="interview-rating-4"]')
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '保存')
      button?.click()
    })
    await waitFor(async () => {
      const list = await api.get('/interviews')
      const saved = list.find((item) => item.id === interview.id)
      return Boolean(saved?.feedback) && saved?.selfRating === 4
    }, '回复内容与自评已落库')
    const savedInterview = (await api.get('/interviews')).find((item) => item.id === interview.id)
    eq(savedInterview?.selfRating, 4, '自评 4 分')
    ok((savedInterview?.feedback ?? '').includes('答得发散'), '反馈原文已保存')
    await waitFor(
      async () => !(await api.get('/stats/dashboard')).today.some((task) => task.kind === 'thanks_letter'),
      '写了反馈后复盘待办自动消失',
    )

    /* ------------------------ 待办「完成」 ------------------------ */
    section('待办完成：写一件让规则不再命中事')
    const beforeDone = await api.get('/stats/dashboard')
    ok(
      beforeDone.today.some((task) => task.kind === 'no_reply' && task.applicationId === appA.id),
      '已投 10 天无回音 → 生成催办',
    )
    await openPage(page, `${base}/`, '[data-testid="task-no_reply"]')
    await page.click('[data-testid="task-no_reply"]')
    await waitFor(async () => {
      const app = await api.get(`/applications/${appA.id}`)
      return Boolean(app.nextActionAt) && Date.parse(app.nextActionAt) > Date.now()
    }, '点「完成」后排了下次动作（nextActionAt 在未来）')
    await waitFor(
      async () => !(await api.get('/stats/dashboard')).today.some((task) => task.kind === 'no_reply'),
      '催办待办从总览消失',
    )
    const timeline = await api.get(`/applications/${appA.id}/timeline`)
    ok(
      timeline.some((event) => String(event.payload?.note ?? '').includes('已催办')),
      '时间线留下「已催办」事件（不是静默消失）',
      timeline.map((event) => event.type),
    )

    // 停滞规则：40 天没推进 → 点「完成」= 标记无回音（终态不再产生待办）
    const jobC = await api.post('/jobs', { companyId: companyA.id, title: '全栈工程师', city: '杭州', jdText: 'React Node' })
    const appC = await api.post('/applications', {
      jobId: jobC.id,
      resumeId: resume.id,
      status: 'applied',
      appliedAt: daysAgo(40),
    })
    await waitFor(async () => (await api.get('/stats/dashboard')).today.some((task) => task.kind === 'stale'), '40 天停滞 → 生成清理待办')
    await openPage(page, `${base}/`, '[data-testid="task-stale"]')
    await page.click('[data-testid="task-stale"]')
    await waitFor(async () => (await api.get(`/applications/${appC.id}`)).status === 'ghosted', '点「完成」后投递标记为无回音')
    await waitFor(
      async () => !(await api.get('/stats/dashboard')).today.some((task) => task.kind === 'stale'),
      '停滞待办从总览消失',
    )

    /* ---------------------------- 收尾核对 ---------------------------- */
    section('核对：没有前端报错、没有留下占位页')
    const pageText = await page.content()
    ok(!pageText.includes('P6 未完成'), '列表页不再出现占位卡')
    eq(consoleErrors.length, 0, `浏览器控制台无错误（${consoleErrors.slice(0, 2).join(' | ')}）`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

main()
  .then(() => {
    process.exitCode = summary('P6')
  })
  .catch((error) => {
    console.error('\n执行中断：', error)
    process.exitCode = summary('P6')
  })
