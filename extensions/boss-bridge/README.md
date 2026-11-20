# BOSS 桥接扩展（P1 骨架 + P2 延迟落库 + P3 定制简历）

本地自用的 MV3 扩展，把 BOSS 直聘与 land-a-job 串起来。设计与实测依据见
`docs/proposals/2026-11-12-boss-zhipin-bridge.md`（在 `local-proposals` 分支）。

**本扩展不引入任何 LLM 依赖**（D2 红线），不存 API Key，不逆向私有协议，不主动调用
`/wapi/*` 写接口。打招呼与发简历的最终点击永远留给用户。

## 已实现

**P1 骨架**

- WXT + React 19 骨架：popup 状态面板、options 配置页、background service worker。
- `chrome.debugger` **被动旁听**页面自身响应：`joblist` / `detail` / `friendlist` /
  `bossdata` / `greet`，不注入 fetch、不重放请求、不导航写接口。
- 暂存区（`chrome.storage.local`）：**`encryptJobId` 主键**（早期用 securityId，实测同岗位在不同
  列表页会返回不同 securityId，每换入口就多一条，所以换掉了；旧数据在下次读状态时自动归并+改键）、
  `is_new`、TTL 60 天 / 500 条上限，**回复前 JD 只存这里，0 落库**。
- HR 活跃度两段闸门、回复方向判据、0-token 模板招呼语、
  `filter → generate → delivery` 三段流水线（默认 dry-run）、限速熔断。

**P2 回复后延迟落库**

公司回复后按固定顺序写进 land-a-job，任一步失败都保留 `replied` 供下轮重试：

1. 健康探测 `/api/health` → 服务不可达就整轮停机，不写任何数据；
2. 公司按名称精确查重（`q` 模糊查后还要精确比对，避免「腾讯科技（深圳）」被当成「腾讯科技」）；
3. 建岗位**不传 `jdText`**，`channel='boss'`；
4. `import-jd`（`capturedBy=browser`）→ 再 `score`（顺序不能反，import 会重算 fit）；
5. 查重只匹配**进行中**的投递（`active=true`，已撤回的旧记录不算命中）；
6. 建 `queued` 投递（**不传 `appliedAt`、不写 `applied`**）+ 写一条时间线存证。

幂等由 `staged.landSync` 与 `replyMsgId` 双重保证：同一条回复重复轮询不会建出第二条岗位或投递，
落库失败的记录下一次巡检会自动重试。打分显式带**默认简历**——服务端不传 `resumeId` 时取的是
`listResumes({limit:1})` 的第一份（按 `updated_at` 排，常是某个变体）。

### 回复检测不要求 `greeted`（2026-11-13 修）

扩展从不代发招呼语，所以岗位通常停在 `ready / needs_detail`，**永远进不了 `greeted`**。
早期判据里那条 `state !== 'greeted' → 跳过` 等于把所有回复都挡在门外（实测 104 个会话、
12 条对方回复，落库 0 条）。现在：

- 只要还没进 `replied / tailored / uploaded / sent` 这些「回复之后」的状态，就允许判回复；
- 时间下限用 `greetedAt ?? (capturedAt - 24 小时)`：**不能用「首次抓到岗位的时间」当下限**——
  用户往往是先手动打完招呼、收到回复，之后才回头刷岗位列表，回复早于 `capturedAt` 是常态。
  窗口最初设 7 天，实测把 11-12 的历史回执（拒信、「附件简历已发送」）全判成本轮回复，
  一次灌进 9 条 `queued` 投递；收窄到 24 小时后只保留当天真正发生的对话；
- 「最后一条是我自己发的」只当作「还在等对方」，**不再置 `manual`**——否则你手动打招呼那一刻
  就把这个岗位永久踢出检查范围，对方之后回了也看不到；
- 快照里早就存在、但岗位还停在回复之前的会话会**补判一次**（当作第一次读到），
  修判据之前攒下的回复不会永久漏掉。

### 响应体必须等 `loadingFinished` 再读（2026-11-13 最大的坑）

早期在 `Network.responseReceived` 里立刻调 `Network.getResponseBody`，Chrome 会回
`-32000 No data found for resource with given identifier`——响应体还没下载完。
实测症状：100 条的会话列表、岗位详情等**大响应全部读不到**，只有少数小响应侥幸成功，
于是「暂存 120 个岗位、会话只累计到 104 条、JD 全空、回复永远检测不到」。

现在 `responseReceived` 只记 `tabId + requestId → URL`，等 `Network.loadingFinished`
再取响应体并解析（失败 120ms 后重试一次）。修完一次刷新就读到 100 + 8 + 15 条、
会话累计到 123 条。

### 会话页要刷新，但 JD 只从已打开的页面读

`/web/geek/chat` 是单页应用，标签一直挂着就不会再请求 `getGeekFriendList`，新消息只走长连接——
而扩展只旁听 HTTP 响应。所以 45 分钟没读到 friend-list 就让页面重新加载一次（纯导航，
不调写接口）；前台标签跳过，避免打断输入；popup 第一行「检查新回复」可立刻触发。

内容脚本 `CONTENT_SCROLL_CONVERSATIONS` 只会把会话列表滚到底，**实测滚动不产生任何新请求**，
它主要是为了兼容将来 BOSS 改成懒加载。运行日志写「读到会话列表：本批 N 条、新会话 M 条、累计 K 条」，
可直接和页面上的总数核对。

### 会话 ↔ 岗位匹配（2026-11-13 真实响应实测）

`src/lib/match.ts` 是唯一匹配入口。抓到真实 `getGeekFriendList` 响应后确认：会话里的
`encryptBossId` / `encryptJobId` 与 joblist **同源**（独创时代两边完全一致）。早期存档
104 会话 / 120 岗位只对上 4 条，是因为其余会话对应的岗位压根没被列表页抓到，不是两套 ID 不通。

- 加密 ID 相等 / `securityId` 命中暂存记录 → 200 分，直接命中；
- 两边都有 ID 却不相等 → 只认公司名**完全相同**（60 分），避免把「博彦科技」的回复
  连到「博彦科技承德有限公司」的另一个岗位；
- 缺 ID 时才用公司名前缀 40 / 包含 20 兜底；≥40 才算同一个岗位；
- 同公司多个岗位取最高分，同分优先未落库、再比抓取时间。

「对方回了但岗位列表没这条」时，从会话**反向补建**最小记录（`origin='conversation'`）：
不带 JD、不带岗位名，因此 `syncRepliedJob` 拒绝落库，不会往岗位库灌脏数据。
**链接必须逐条唯一**——早期用 `/web/geek/chat#chat:...`，`canonicalJdUrl` 把 hash 去掉后
4 家公司规范化成同一个 URL，服务端查重让它们共用一个岗位和一条投递（已修为
`/job_detail/<encryptJobId>.html`）。反向补建前还会先查所有状态，避免给已 `sent` 的会话再建一条。

### JD 来源、反爬边界（重要）

新版详情页 `/job_detail/<encryptJobId>.html?securityId=...` 是 **SSR**，JD 直接渲染在
`.job-sec-text`，**不再请求 `/wapi/zpgeek/job/detail.json`**（抓包确认）。所以新增
`CONTENT_READ_JD`：只读 DOM 文本，不点击、不输入、不调用任何接口。

读 DOM 本身**不产生任何网络请求，服务端完全不可见**。真正有反爬风险的是「为了读 DOM 而
打开新标签」：`chrome.tabs.create()` 是一次真实导航，会带出一串 HTML/JS/wapi 请求，
短时间批量开、后台、停留几秒就关，这种序列才像自动化。因此：

- `ensureJdForReplies()` **只从用户已经打开的详情页标签读 JD，绝不主动新建标签**；
- `openDetailTab()` 仍保留给 `autoOpenDetail`，但该开关默认 `false`，只有用户显式勾选才开；
- 扩展从始至终不自己发 `/wapi/*` 请求：所有请求都由页面自己发，UA / Cookie / 签名 /
  加密参数全是页面原生的；不注入 fetch、不重放、不代点发送；
- `chrome.debugger` 只 `Network.enable` + 读响应体，附着会在浏览器顶部显示调试横幅（本地 UI，
  服务端看不到）；要彻底避免这一项只能不用 debugger 方案；
- 巡检刷新会话页每 45 分钟最多一次、前台跳过；限速器 ≥1.5s + 抖动、≤30/日、风控码熔断。

## 本期明确未实现（别误以为能发消息）

- **代点「发送」**：不会做，也建议永远别做——发错简历不可撤销，最后一击必须是人。
- 招呼语批量 LLM 改写：默认模板 0 token；Agent 通道后续由 Skill 提供。

## P3 已实现（定制 → 导出 → 上传 → 打开会话）

popup 上四个按钮对应四段，按使用顺序分四行排（括号里是改动前的叫法）：

| 按钮 | 做什么 | 停在哪 |
| --- | --- | --- |
| 按 JD 定制简历（原「定制简历」） | plan → duplicate → 规则重排 → validate → PATCH → 导出 PDF | validate 不通过就不落库 |
| 上传简历到 BOSS（原「上传附件」） | 把 PDF 字节注入 `/web/geek/recommend` 的上传弹窗，**页面自己上传** | 20 秒内附件列表没变化就报失败 |
| 打开聊天窗口（原「打开会话」） | 打开 `/web/geek/chat`，按公司名定位**回复你的那个会话**，读「发简历」是否可点 | 按钮 `unable` 时原样回报原因，不点 |
| （人工）发送 | 你选中附件、点发送 | 扩展始终不代点 |
| 自动推进 applied（P3c） | 被动读到「附件简历已发送给对方」的**系统回执**，调 `POST /applications/:id/status` 推 `applied`，`appliedAt` 用回执的 `msgTime` | 服务端失败就保留 `uploaded`，下一轮巡检原样重试 |

实测到的两个关键事实：

- 附件上传走**隐藏弹窗** `.upload-resume__old`，里面 `input[ka="user-resume-upload-file"]` 注入后，
  页面自己调 `zpupload/resume/uploadFile.json` → `resume/attachment/save.json`。扩展不碰任何写接口。
- 「发简历」按钮在**对方还没回复**时带 `unable`，`aria-label` 写「正在请求中，等待对方回复」——
  这正好是 P3 的准入条件：公司真回你了才允许发。

### P3c 的判据与取舍

`src/lib/outgoing.ts` 的 `detectSent()` 只做判定，写服务端在 `sync.ts` 的 `pushApplied()`：

2026-11-13 13:37 用户手动给「独创时代」发完附件简历后，抓到的 `friendlist` 原始字段：

```json
{ "brandName": "独创时代", "lastMsg": "对方已同意，您的附件简历已发送给对方",
  "lastMessageInfo": { "msgId": 407179415634689, "fromId": 519553116,
    "toId": 504921610, "status": 0, "msgTime": 1794548237020 } }
```

**关键：`fromId === uid && status === 0`**，按消息方向判据看起来像「对方发的」，其实是 BOSS
在附件简历发送成功后追加的系统回执；原先等的「我自己发的消息（`fromId !== uid`、status 1/2）」
会被这条回执覆盖，根本不会出现。所以判据改为：

- `isResumeSentReceipt()` 优先匹配回执文本（`lastMsg` 与 `showText` 都看），这是主证据；
- 兜底仍保留「我自己发的普通消息」路径；
- 时间下限用 `>=`：回执往往就是触发 `replied` 的那同一条消息，用严格大于会把自己挡掉；
- 只对 `replied / tailored / uploaded` 生效，`manual` 直接跳过；
- **不做 msgId 去重**：失败要能原样重试，幂等由服务端状态机（`from === to` 直接 no-op）兜住，
  成功后本地 `state === 'sent'` 保证不再重复推；
- 已确认发出但缺 JD、暂时没落库的，记 `pendingApplied`；JD 补齐后自动补推 applied；
- 时间取 `lastMessageInfo.msgTime`，不是本地点「发送」的时间，备注里写明证据类型。

实测结果：`appliedAt = 2026-11-13T05:37:17.020Z`（即 13:37:17），
服务端同时写入 `status_changed` 时间线事件。

## 缓存岗位页（`staging.html`）

popup 标题栏最左边的列表图标可以打开一个整页视图，用来复盘抓到了什么——数据仍全部来自
`chrome.storage.local`，页面只读，不发消息、不改线上数据。

- **两个视图**：「缓存岗位」与「已读到的消息」。消息视图按最后一条消息时间倒序列出所有已旁听的会话，
  标出最后发言是对方还是我方，用来核对 BOSS 页面上的会话总数有没有被读全；
- **筛选**：一行下拉，选中即生效，描边加深表示这项在起作用——阶段（按流程排序并带计数）、
  活跃度（在线 / 有活跃描述 / 未知）、薪资（10-20K / 20-30K / 30-40K / 40-50K，与岗位薪资区间
  **有交集**才命中，所以 15-25K 在 10-20K 和 20-30K 两档都能看到；`面议`、日薪这类取不到区间的
  不进任何档位）、标记（可多选叠加：已读到 JD / 已有招呼语 / 已写入 land-a-job）；
- **搜索**：关键词覆盖公司 / 岗位 / 城市 / 薪资 / 备注，薪资的其他写法在这里搜；
- **排序**：最近动作（不含列表刷新时间，避免一滚动就重排）/ 公司名 / 流程阶段；
- **点开一行**看详情：备注、各阶段时间、land-a-job 的 `jobId`/`applicationId`、定制简历 PDF 名字、
  招呼语草稿、JD 正文（可复制），以及「打开 BOSS 岗位页」；
- 标签页切回来会自动刷新一次。

判定逻辑在 `src/lib/filter.ts`（纯函数，`test/filter.test.ts` 覆盖），UI 只做渲染。

## 快速开始

1. **固定扩展 ID**（服务端 CORS 白名单需要稳定值）：

   ```bash
   cd extensions/boss-bridge
   npm install
   npm run key:gen        # 生成 .env 里的 WXT_EXTENSION_KEY，并打印 32 位扩展 ID
   ```

   > 已经按「加载已解压的扩展程序」在用了？**先别急着生成 key**。换 key 等于换扩展 ID，
   > Chrome 会把它当成另一个扩展，`chrome.storage.local` 里的暂存区（已收集的岗位、会话快照、
   > 哪条已落库）不会跟过去。不换目录/不换机器时，按路径派生的 ID 一直是稳定的；
   > 真要固定，趁暂存区是空的时候做，或者在 `chrome://extensions` 里先记下当前 ID 再重装。

2. **启动 land-a-job 服务端，带上白名单**：

   ```bash
   LAND_EXTENSION_ORIGINS=<上一步打印的 ID> npm run dev -w @land/server
   ```

   不带该环境变量时 CORS 白名单关闭，扩展仍可旁听，但调本地 API 会被预检拦截。

3. **构建并加载扩展**：

   ```bash
   npm run build          # 产物 .output/chrome-mv3/
   ```

   在 `chrome://extensions` 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `.output/chrome-mv3/`。
   自用不建议上架商店。

4. **用独立 Chrome profile 登录一次**（登录态只留在该 profile，不复制主 Chrome Cookie）：

   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --user-data-dir="$HOME/.land-a-job/boss-profile"
   ```

   扩展的 `chrome.debugger` 走扩展 API，**不需要** `--remote-debugging-port`（那是 P0 探针用的 CDP）。

5. **options 页填令牌**：本机服务首次启动会生成 `data/token`（也可在 land-a-job 页面打开
   `/api/bootstrap` 复制）。填进「API 令牌」后点「保存并测试连接」。
   保持 `dry-run` 勾选。

6. 打开 zhipin.com 岗位列表 → popup 点「开始监听页面」（原「开始旁听」）→ 正常浏览列表与
   2~3 个岗位详情（HR 活跃度靠详情页的「刚刚活跃」这类标签判定）。
7. **先在 BOSS 上打招呼**：对想投的岗位点「立即沟通」发出默认招呼语。扩展从页面自己的
   `friend/add.json` 响应里读到这条记录，把它标成「已打招呼」并记下时间——缓存岗位的
   「进度」里能看到「打招呼 11-17 17:18」。这一步是后续所有产出的前提。
8. **再点「筛选并生成招呼语」**：只为**已打招呼**的公司按当前模板生成定制招呼语（0 token），
   每条都有「复制」按钮；没打过招呼的岗位即使 HR 再活跃也不生成——先有第一次触达，第二条文案才有地方可发。
9. 复制定制招呼语 → 到该会话粘贴发送。扩展不会替你点发送，最后一击永远是你。
   发完回 popup 点一次「检查新回复」：会话列表里读到「打过招呼之后你又发了一条自己的消息」时，
   暂存区的进度会补上「定制版发出」时间（文案改动过也认，只标「文案与草稿不同」）。
10. 保持聊天页开着（或让巡检定时打开）：收到公司回复时，background 会自动
   **延迟落库**，popup 的「招聘方已回复」列表会显示 `jobId` / `applicationId`。
   落库记录是 `queued`，投递时间留白——那是 P3 发完定制简历才填的。

## P3 探针（选择器已实测，改版后要重跑）

```bash
# 独立 profile + 调试端口，登录一次
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.land-a-job/boss-probe-profile"

npm run probe:p3 -- --page both --seconds 0    # 只快照结构，不动手
```

产物在 `data/boss-p3-probe/<runId>/report.md`：每个 `input[type=file]` 的祖先链、
输入控件、工具条按钮、结构树根节点、接口清单。`selectors.ts` 里 `verified: true`
的条目就是照它填的；Boss 改版后先跑这个，再决定改选择器还是降级。

探针只读：不点击、不上传、不发消息、不调用任何写接口。

## 实测结论（P0 三轮 53 份 fixture）

| 项 | 结论 |
| --- | --- |
| HR 活跃度 | `detail.json` 的 `zpData.bossInfo.activeTimeDesc` / `bossOnline`；`brandComInfo.activeTime` 是**公司**活跃时间，不能当 HR 数值兜底 |
| 回复方向 | `lastMessageInfo.fromId === result[].uid && status === 0` ⇒ 对方发的；`status` 1/2 是自己发的 |
| 未读数 | `unreadMsgCount` 页面打开后归零，实测恒为 0，**不能作判据** |
| 响应码 | 只读顶层 `body.code`；嵌套的业务编码不是风控码 |
| 打招呼接口 | `friend/add.json` 实测是 GET 且带回默认招呼语模板；扩展只观测，绝不主动调用 |

## 风控口径

两条动作间隔 ≥1.5s + Gaussian 抖动（σ=400ms）、单批 ≤10、每日 ≤30、单轮请求预算 500；
code 9 / 31 / 37、「操作过于频繁」「环境存在异常」立即熔断停机，不自动重试。
「今天已与 120/150 位 BOSS 沟通」由 `platformHardLimitCount()` 从文案里**读数字**再停机
（这类提示实测有时挂在 `code: 0` 的正常响应里，只看 code 会漏）；
熔断后需在 popup 手工「解除保护」。
遇到验证码、登录墙、调试连接被 DevTools 抢占时停止并提示，不绕过。

## 与前期调研的对照（2026-11-13 复核）

四个参考项目的借鉴点逐条落地情况。**只有两条没有落地**（`manifest key`、桌面通知），
它们都不是代码缺失，而是需要改动安装/权限环境；其余「不做」的都是提案里写明的取舍。

| 来源 | 借鉴点 | 现状 | 说明 |
| --- | --- | --- | --- |
| boss-zhipin-scraper | Network 域被动读 | 已落地 | `chrome.debugger` + 等 `loadingFinished` 再取体 |
| boss-zhipin-scraper | 独立持久 profile | 已落地 | 快速开始第 4 步；登录态只留在独立 profile，不复制主 Chrome Cookie |
| boss-zhipin-scraper | 熔断 / 单轮预算 | 已落地 | code 9·31·37、500 次/轮、退避 10→60s |
| boss-zhipin-scraper | 增量去重 + `is_new` | 部分 | 去重靠 `key`（encryptJobId）生效；`isNew` 字段没有 UI 消费，只作数据 |
| boss-zhipin-scraper | Skill 打包 | 已落地 | `jd-collect` / `browser-apply` 作选择器失效时的兜底 |
| boss-helper | WXT + MV3 骨架 | 已落地 | React 19，不复用其 Vue 组件 |
| boss-helper | 流水线分阶段 + 逐任务超时 | 已落地 | filter → generate → delivery；120/70/90/30s |
| boss-helper | 结果缓存 / 可中断 / dry-run | 已落地 | 暂存区即缓存；`dryRun` 默认 true |
| boss-helper | manifest `key` 固定扩展 ID | **未启用** | 机制已就绪（`npm run key:gen`），但 `.env` 未生成，当前 ID 按加载路径派生 |
| boss-helper | 120/150 硬限额 | 已落地（本次补） | 之前 `notePlatformHardLimit()` 没有生产调用方，只靠文案正则兜底 |
| boss-helper | 不主动调写接口 | 已落地 | 扩展对 zhipin 的 `fetch` 调用数为 0 |
| yangfeng20/ai-job | 高意向门槛 | 刻意不做 | 本期门槛＝任意回复（提案 §3），高意向留作后续排序 |
| yangfeng20/ai-job | 可打断 | 已落地 | 用户接手即 `manual`；「停止监听」随时可停 |
| yangfeng20/ai-job | 通知 | **未做** | 未申请 `notifications` 权限，靠 popup 计数与日志 |
| jackwener/boss-cli | 限速常数 | 已落地 | 1.5s + 400ms Gaussian；code 9 指数退避 |
| jackwener/boss-cli | `{ok, schema_version, data}` | 已落地（本次补） | `RuntimeResponse.schemaVersion`，新旧 popup/SW 混用时给明确提示 |
| jackwener/boss-cli | 每轮健康探测 | 已落地 | `LandBridge.health()`，服务不可达整轮跳过 |
| jackwener/boss-cli | 429/5xx 重试 | 不适用 | 数据源是 127.0.0.1；写接口靠 409 幂等 + 下轮巡检重试 |

## 目录

```
entrypoints/background.ts        service worker：旁听、巡检、暂存、消息路由
entrypoints/popup/               React 状态面板与批次预览
entrypoints/options/             React 配置页
src/lib/parsers.ts               被动响应解析（纯函数，含 JD 清洗）
src/lib/activity.ts              HR 活跃度闸门（纯函数）
src/lib/reply.ts                 回复方向判据（纯函数）
src/lib/match.ts                 会话 ↔ 岗位加权匹配（加密 ID 只加分不否决）
src/lib/outgoing.ts              P3c 自己发出消息的判定
src/lib/rate-limit.ts            限速熔断（可序列化状态）
src/lib/pipeline.ts              filter → generate → delivery
src/lib/storage.ts               暂存区（chrome.storage.local）
src/lib/bridge.ts                land-a-job REST（x-land-token、拆信封、409 幂等、PDF 字节）
src/lib/sync.ts                  回复后延迟落库编排（可注入 bridge，便于回放测试）
src/lib/resume.ts                P3 定制编排：计划 → 复制 → 重排 → 校验 → 落库 → 导出
src/lib/attachment.ts            P3 上传/发送闸门与文件名规则（纯策略）
test/                            纯逻辑单测，不加载 chrome API
scripts/gen-extension-key.mjs    固定扩展 ID
```

## 测试

```bash
npm test          # vitest，纯逻辑，无需浏览器
npm run typecheck # 先 npm run prepare 生成 .wxt 类型
npm run build     # WXT 产出 MV3 扩展
```

## 许可

AGPL-3.0-or-later，与主仓库一致。仅个人自用；BOSS 直聘用户协议与账号风险由使用者承担。
