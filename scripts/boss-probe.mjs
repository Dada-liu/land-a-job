#!/usr/bin/env node
/**
 * P0 探针：被动旁听 BOSS 直聘页面自身发出的 API 响应，产出脱敏 fixture。
 *
 * 目的（见 docs/proposals/2026-11-12-boss-zhipin-bridge.md 的 P0 验收）：
 *   1. 实测 `activeTimeDesc` 的完整标签集合与所在 JSON 路径，确定 HR 活跃度白名单；
 *   2. 判断 `activeTime` 的单位与归属（HR 还是公司）；
 *   3. 观察 `bossFreezeStatus` / `bossPreFreezeStatus` 的取值语义；
 *   4. 记录**顶层**业务响应码（code 9 / 31 / 37）与「操作过于频繁」「环境存在异常」等提示；
 *   5. 记录回复巡检所需的会话字段路径（`lastTS` / `msgId` / `fromId` / `status` …）
 *      与页面实际调用的 API 端点清单；
 *   6. 统计「最后一条消息是谁发的」：fromId === result[].uid && status===0 ⇒ 对方发的。
 *      实测 unreadMsgCount 在页面打开后恒为 0，不能作为回复判据。
 *
 * 严格只读：
 *   - 只通过 CDP 的 Network 域旁听页面自己发出的请求响应，不注入 fetch / XHR、不重放请求；
 *   - 不导航、不点击、不填写、不上传；请自己在这个 Chrome 窗口里手动浏览；
 *   - 不连 land-a-job 服务、不写 SQLite、不写业务库；
 *   - 输出落在 data/（已 gitignore），响应体按字段名脱敏后保存。
 *
 * 用法：
 *   1) 用独立 profile 启动 Chrome（Chrome 136+ 不允许对默认 profile 开远程调试）：
 *      /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *        --remote-debugging-port=9222 \
 *        --user-data-dir="$HOME/.land-a-job/boss-probe-profile"
 *   2) 在该窗口登录 zhipin.com，然后运行：
 *      npm run probe:boss -- --seconds 180
 *   3) 手动浏览：搜索列表 → 打开 2~3 个岗位详情 → 打开消息页。Ctrl+C 可提前结束。
 *
 * summary.md 从启动那一刻就存在，并随每次捕获 / 每 5 秒实时刷新；
 * 输出根目录另有 LATEST.md 指向最近一次运行目录。
 * 已有 fixture 可离线重建汇总（并按当前脱敏规则清洗旧明文）：
 *   npm run probe:boss -- --summarize data/boss-probe/fixtures/<runId>
 *
 * 仅个人自用；遇到验证码、登录墙或「环境存在异常」请立即停止，不要重试或绕过。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `BOSS 直聘 P0 探针（只读被动旁听）

  npm run probe:boss -- [options]

  --cdp <url>        CDP 地址，默认 http://127.0.0.1:9222（仅允许 loopback）
  --seconds <n>      旁听时长（秒），默认 180；0 = 一直跑到 Ctrl+C
  --out <dir>        输出目录，默认 data/boss-probe/fixtures
  --max <n>          每类响应最多保存几份，默认 3
  --items <n>        响应里数组最多保留几条，默认 30
  --summarize <dir>  不连 CDP，离线重建 summary.*，并按当前脱敏规则清洗旧 fixture
  --help             显示本帮助

summary.md 启动即生成并实时刷新；输出根目录的 LATEST.md 指向最近一次运行。
运行前请先用 --remote-debugging-port 启动独立 profile 的 Chrome 并登录 zhipin.com。
`

function parseArgs(argv) {
  const opts = {
    cdp: 'http://127.0.0.1:9222',
    seconds: 180,
    out: 'data/boss-probe/fixtures',
    max: 3,
    items: 30,
    summarize: null,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--help' || key === '-h') opts.help = true
    else if (key === '--cdp' && value) { opts.cdp = value; i += 1 }
    else if (key === '--seconds' && value) { opts.seconds = Number(value); i += 1 }
    else if (key === '--out' && value) { opts.out = value; i += 1 }
    else if (key === '--max' && value) { opts.max = Number(value); i += 1 }
    else if (key === '--items' && value) { opts.items = Number(value); i += 1 }
    else if (key === '--summarize' && value) { opts.summarize = value; i += 1 }
    else {
      console.error(`未知参数：${key}`)
      process.exit(2)
    }
  }
  if (!Number.isFinite(opts.seconds) || opts.seconds < 0) {
    console.error('--seconds 必须是 ≥ 0 的数字')
    process.exit(2)
  }
  if (![opts.max, opts.items].every((n) => Number.isFinite(n) && n > 0)) {
    console.error('--max / --items 必须是正数')
    process.exit(2)
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(HELP)
  process.exit(0)
}

const summarizeDir = opts.summarize
  ? (path.isAbsolute(opts.summarize) ? opts.summarize : path.join(ROOT, opts.summarize))
  : null

let cdpBase = '(offline)'
let runId = summarizeDir ? path.basename(summarizeDir) : ''
let runDir = summarizeDir ?? ''
let outDir = ''

if (!summarizeDir) {
  const cdp = new URL(opts.cdp)
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(cdp.hostname) || cdp.protocol !== 'http:') {
    console.error('CDP 地址必须是本机 loopback 的 http:// 地址')
    process.exit(2)
  }
  cdpBase = cdp.toString().replace(/\/$/, '')
  outDir = path.isAbsolute(opts.out) ? opts.out : path.join(ROOT, opts.out)
  runId = new Date().toISOString().replace(/[:.]/g, '-')
  runDir = path.join(outDir, runId)
  mkdirSync(runDir, { recursive: true })
}

const PATTERNS = [
  { kind: 'joblist', re: /\/wapi\/zpgeek\/search\/joblist\.json/, limit: opts.max },
  { kind: 'detail', re: /\/wapi\/zpgeek\/job\/detail\.json/, limit: opts.max },
  { kind: 'friendlist', re: /\/wapi\/zprelation\/friend\/getGeekFriendList\.json/, limit: opts.max },
  { kind: 'bossdata', re: /\/wapi\/zpchat\/geek\/getBossData/, limit: opts.max },
  /** 打招呼接口单独归类，避免把 misc 的兜底名额占满（P0 实测会真实出现） */
  { kind: 'greet', re: /\/wapi\/zpgeek\/friend\/add\.json/, limit: opts.max },
  /** 兜底：会话列表接口可能改名， misc 用来发现真实端点，别让 P0 白跑一趟 */
  { kind: 'misc', re: /\/wapi\/zp(?:geek|chat|relation|user)\//, limit: 6 },
]

const KEEP_KEYS = new Set([
  'code', 'message', 'activeTimeDesc', 'activeTime', 'bossOnline', 'lastModifyTime',
  'salaryDesc', 'jobName', 'brandName', 'city', 'experienceName', 'degreeName',
  'bossFreezeStatus', 'bossPreFreezeStatus', 'jobType', 'source', 'hasMore',
])

/**
 * 这些字段一律不落盘（JD 正文、聊天内容可能含个人联系方式）。
 * P0 实测：friendlist 的会话正文在 `lastMsg` / `lastMessageInfo.showText`，
 * 早期版本只挡了 `content` / `text`，把聊天原文写进了 fixture，故补上。
 */
const DROP_TEXT_KEYS = /^(jdText|description|content|html|text|detail|jobDescription|postDescription|positionDescription|resume|chatRemindDialog|lastMsg|showText|lastText|msgContent)$/i
/** 这些字段保留键名但抹掉值，避免把账号 / 会话 / 头像 / 真实姓名 / IP 带进 fixture */
const REDACT_KEYS = /(token|cookie|secret|phone|mobile|email|wechat|wxNo|avatar|encrypt|securityId|userId|bossId|geekId|friendId|idCard|bossName|geekName|hrName|contactName|showName|displayName|nickName|realName|clientIP|clientIp|ipAddress|^lid$|^name$|^ip$|^address$|^url$|^link$|^tiny$|^large$|^logo$|^brandLogo$|^icon$|Url$|Link$|Logo$|Icon$)/i
const PATH_KEYS = new Set([
  'activeTimeDesc', 'activeTime', 'bossOnline', 'bossFreezeStatus', 'bossPreFreezeStatus',
])
/** 回复巡检（P2）关心的会话字段，单独在汇总里列出实际路径 */
const REPLY_KEYS = new Set([
  'unreadMsgCount', 'lastTS', 'lastTime', 'lastMsg', 'msgId', 'encryptMsgId',
  'msgTime', 'fromId', 'toId', 'status', 'chatStatus', 'friendSource', 'relationType',
  'encryptBossId', 'encryptJobId', 'jobId', 'brandName', 'uid', 'encryptUid',
])

const counts = Object.fromEntries(PATTERNS.map((p) => [p.kind, 0]))
const seen = new Map()
const sockets = new Set()
const stats = {
  activeTimeDesc: new Set(),
  activeTimeSamples: [],
  activeTimeUnit: 'unknown',
  bossOnline: { true: 0, false: 0 },
  bossFreezeStatus: new Set(),
  bossPreFreezeStatus: new Set(),
  /** 只收顶层 body.code；嵌套的 code（职位/城市/会话自带）不是业务响应码 */
  codes: new Set(),
  riskMessages: new Set(),
  endpoints: new Set(),
  replyPaths: new Set(),
  conversations: {
    seenMsgIds: new Set(),
    total: 0,
    fromPeer: 0,
    fromSelf: 0,
    unreadNonZero: 0,
    maxUnread: 0,
    fromIdCounts: new Map(),
    peerReplies: [],
  },
  fields: {},
  paths: {},
}

function redact(value, depth = 0) {
  if (depth > 24) return '<max depth>'
  if (Array.isArray(value)) {
    const kept = value.slice(0, opts.items).map((item) => redact(item, depth + 1))
    if (value.length > opts.items) kept.push(`<truncated ${value.length - opts.items} items>`)
    return kept
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (DROP_TEXT_KEYS.test(key)) {
        // 保留占位值本身，保证离线重复清洗幂等
        out[key] = /^<omitted \d+ chars>$/.test(String(item))
          ? item
          : `<omitted ${typeof item === 'string' ? item.length : 0} chars>`
      } else if (!KEEP_KEYS.has(key) && REDACT_KEYS.test(key)) {
        out[key] = typeof item === 'number' ? 0 : '<redacted>'
      } else {
        out[key] = redact(item, depth + 1)
      }
    }
    return out
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…<truncated>`
  return value
}

function endpointOf(url) {
  try { return new URL(url).pathname } catch { return String(url).split('?')[0] }
}

/**
 * P0 第三轮实测：判断「最后一条消息是谁发的」。
 * 结论：fromId === result[].uid 且 status===0 ⇒ 对方发的；
 *       status 1/2 ⇒ 自己发的（已送达/已读）。unreadMsgCount 在已读后恒为 0，不能用。
 */
function analyzeConversations(body) {
  const list = body?.zpData?.result
  if (!Array.isArray(list)) return
  const c = stats.conversations
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const m = item.lastMessageInfo ?? {}
    if (m.msgId === undefined || c.seenMsgIds.has(m.msgId)) continue
    c.seenMsgIds.add(m.msgId)
    c.total += 1
    const unread = Number(item.unreadMsgCount ?? 0) || 0
    if (unread > 0) c.unreadNonZero += 1
    c.maxUnread = Math.max(c.maxUnread, unread)
    if (typeof m.fromId === 'number') {
      c.fromIdCounts.set(m.fromId, (c.fromIdCounts.get(m.fromId) ?? 0) + 1)
    }
    const fromPeer = typeof item.uid === 'number' && m.fromId === item.uid && m.status === 0
    if (fromPeer) {
      c.fromPeer += 1
      if (c.peerReplies.length < 6) {
        c.peerReplies.push({
          brandName: item.brandName, uid: item.uid, jobId: item.jobId,
          msgId: m.msgId, lastTS: item.lastTS, lastTime: item.lastTime,
        })
      }
    } else if (m.fromId !== undefined) c.fromSelf += 1
  }
}

function inferredSelfUid() {
  const entries = [...stats.conversations.fromIdCounts.entries()].sort((a, b) => b[1] - a[1])
  return entries.length ? entries[0][0] : null
}

function collect(value, kind, depth = 0, trail = '') {
  if (!value || typeof value !== 'object' || depth > 24) return
  if (Array.isArray(value)) {
    for (const item of value.slice(0, opts.items)) collect(item, kind, depth + 1, `${trail}[]`)
    return
  }
  const isRoot = trail === ''
  stats.fields[kind] ??= new Set()
  stats.paths[kind] ??= new Set()
  for (const [key, item] of Object.entries(value)) {
    stats.fields[kind].add(key)
    const p = trail ? `${trail}.${key}` : key
    if (PATH_KEYS.has(key)) stats.paths[kind].add(p)
    if (REPLY_KEYS.has(key)) stats.replyPaths.add(p)
    if (key === 'activeTimeDesc' && typeof item === 'string' && item) stats.activeTimeDesc.add(item)
    if (key === 'activeTime' && typeof item === 'number' && item > 0) {
      if (stats.activeTimeSamples.length < 20) stats.activeTimeSamples.push(item)
    }
    if (key === 'bossOnline' && typeof item === 'boolean') stats.bossOnline[String(item)] += 1
    if (key === 'bossFreezeStatus') stats.bossFreezeStatus.add(String(item))
    if (key === 'bossPreFreezeStatus') stats.bossPreFreezeStatus.add(String(item))
    // 风控码与风控文案只认顶层：列表项里也有同名的 code / message，混进来会污染熔断依据
    if (isRoot && key === 'code' && item !== undefined) stats.codes.add(String(item))
    if (isRoot && key === 'message' && typeof item === 'string' && /频繁|异常|限制|验证|环境/.test(item)) {
      stats.riskMessages.add(item.slice(0, 120))
    }
    if (item && typeof item === 'object') collect(item, kind, depth + 1, p)
  }
}

function buildSummary(reason, status) {
  if (stats.activeTimeSamples.length) {
    const max = Math.max(...stats.activeTimeSamples)
    stats.activeTimeUnit = max > 1e11 ? 'milliseconds (epoch ms)' : max > 1e9 ? 'seconds (epoch s)' : 'unknown'
  }
  const summary = {
    runId,
    status,
    reason,
    cdp: cdpBase,
    captured: counts,
    activeTimeDescLabels: [...stats.activeTimeDesc].sort(),
    activeTimeSamples: stats.activeTimeSamples,
    activeTimeUnit: stats.activeTimeUnit,
    bossOnline: stats.bossOnline,
    bossFreezeStatusValues: [...stats.bossFreezeStatus],
    bossPreFreezeStatusValues: [...stats.bossPreFreezeStatus],
    /** 顶层 body.code 才是业务响应码，嵌套 code 不参与风控判定 */
    responseCodes: [...stats.codes].sort(),
    riskMessages: [...stats.riskMessages],
    endpoints: [...stats.endpoints].sort(),
    replyPaths: [...stats.replyPaths].sort(),
    conversations: {
      total: stats.conversations.total,
      fromPeer: stats.conversations.fromPeer,
      fromSelf: stats.conversations.fromSelf,
      unreadNonZero: stats.conversations.unreadNonZero,
      maxUnread: stats.conversations.maxUnread,
      selfUid: inferredSelfUid(),
      peerReplies: stats.conversations.peerReplies,
    },
    observedPaths: Object.fromEntries(
      Object.entries(stats.paths).map(([kind, paths]) => [kind, [...paths].filter((p) => PATH_KEYS.has(p.split('.').pop())).sort()]),
    ),
    observedFields: Object.fromEntries(
      Object.entries(stats.fields).map(([kind, keys]) => [kind, [...keys].sort()]),
    ),
  }
  const md = [
    `# P0 探针结果 ${runId}`,
    '',
    `- 状态：${status}`,
    `- 结束原因：${reason}`,
    `- 捕获数量：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' / ')}`,
    `- activeTimeDesc 标签集合：${summary.activeTimeDescLabels.join('、') || '（未观察到）'}`,
    `- activeTime 样本：${summary.activeTimeSamples.join(', ') || '（未观察到）'}`,
    `- activeTime 单位推断：${stats.activeTimeUnit}`,
    `- bossOnline：true ${stats.bossOnline.true} / false ${stats.bossOnline.false}`,
    `- bossFreezeStatus：${summary.bossFreezeStatusValues.join(', ') || '（未观察到）'}`,
    `- 顶层业务响应码：${summary.responseCodes.join(', ') || '（未观察到）'}`,
    `- 风控提示：${summary.riskMessages.join(' / ') || '（无）'}`,
    '',
    '## 关注字段的实际 JSON 路径',
    '',
    ...Object.entries(summary.observedPaths).flatMap(([kind, paths]) =>
      paths.length ? [`- ${kind}：${paths.map((p) => `\`${p}\``).join('、')}`] : []),
    '',
    '## 回复巡检字段路径（P2）',
    '',
    ...(summary.replyPaths.length
      ? summary.replyPaths.map((p) => `- \`${p}\``)
      : ['- （未观察到会话列表字段）']),
    '',
    '## 会话方向实测（P2 回复判据依据）',
    '',
    `- 去重会话：${summary.conversations.total} 条；最后一条来自**对方**：${summary.conversations.fromPeer} 条；来自**自己**：${summary.conversations.fromSelf} 条`,
    `- 自身 uid（由 fromId 众数推断）：${summary.conversations.selfUid ?? '（样本不足）'}`,
    `- \`unreadMsgCount > 0\` 的会话：${summary.conversations.unreadNonZero} 条（最大值 ${summary.conversations.maxUnread}）`,
    '- 判据：`lastMessageInfo.fromId === result[].uid && status === 0` ⇒ 对方发的；`status` 1/2 ⇒ 自己发的（已送达/已读）',
    '- `unreadMsgCount` 在页面打开后归零，实测恒为 0，**不能作为回复判据**，只作提示',
    ...(summary.conversations.peerReplies.length
      ? ['- 对方回复样本：', ...summary.conversations.peerReplies.map((r) =>
        `  - ${r.brandName ?? '?'} uid=${r.uid} jobId=${r.jobId} msgId=${r.msgId} lastTime=${r.lastTime}`)]
      : []),
    '',
    '## 捕获到的 API 端点',
    '',
    ...(summary.endpoints.length
      ? summary.endpoints.map((e) => `- \`${e}\``)
      : ['- （无）']),
    '',
    '> 注意：`activeTime` 若只出现在 `brandComInfo` 下，那是**公司活跃时间**，不能当 HR 活跃度的数值兜底。',
    '> 依此确定提案 §6.3 的活跃度白名单；未观察到的标签一律按「不活跃」处理。',
    '> 会话正文、头像 URL 等字段已在写盘前抹掉；`--summarize` 会顺带清洗旧 fixture。',
    '',
    `输出目录：${runDir}`,
    '',
  ].join('\n')
  return { summary, md }
}

/** 汇总随时可写：启动、每次捕获、每 5 秒、收到信号、异常退出都会落盘 */
function writeSummary(dir, reason, status) {
  const { summary, md } = buildSummary(reason, status)
  writeFileSync(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(path.join(dir, 'summary.md'), md)
  return md
}

function call(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ws._nextId++
    ws._pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (ws._pending.has(id)) {
        ws._pending.delete(id)
        reject(new Error(`${method} 超时`))
      }
    }, 5000).unref?.()
  })
}

function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  ws._nextId = 1
  ws._pending = new Map()
  ws._label = target.url.slice(0, 100)
  ws._targetId = target.id
  sockets.add(ws)

  ws.addEventListener('open', () => {
    call(ws, 'Network.enable').catch(() => {})
    console.log(`· 已附着：${ws._label}`)
  })

  ws.addEventListener('message', (event) => {
    let msg
    try { msg = JSON.parse(String(event.data)) } catch { return }
    if (msg.id && ws._pending.has(msg.id)) {
      const { resolve, reject } = ws._pending.get(msg.id)
      ws._pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message ?? 'CDP error'))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params?.response?.url ?? ''
      const hit = PATTERNS.find((p) => p.re.test(url))
      if (!hit || counts[hit.kind] >= hit.limit) return
      stats.endpoints.add(endpointOf(url))
      if (seen.size > 500) seen.clear()
      seen.set(msg.params.requestId, {
        kind: hit.kind, url, status: msg.params.response.status, limit: hit.limit,
      })
      return
    }
    if (msg.method === 'Network.loadingFinished') {
      const meta = seen.get(msg.params?.requestId)
      if (!meta) return
      seen.delete(msg.params.requestId)
      if (counts[meta.kind] >= meta.limit) return
      counts[meta.kind] += 1
      const index = counts[meta.kind]
      void (async () => {
        try {
          const result = await call(ws, 'Network.getResponseBody', { requestId: msg.params.requestId })
          const raw = result.base64Encoded
            ? Buffer.from(result.body, 'base64').toString('utf8')
            : result.body
          const parsed = JSON.parse(raw)
          collect(parsed, meta.kind)
          if (meta.kind === 'friendlist') analyzeConversations(parsed)
          const file = path.join(runDir, `${meta.kind}-${index}.json`)
          writeFileSync(file, `${JSON.stringify({
            capturedAt: new Date().toISOString(),
            url: meta.url.replace(/([?&])(securityId|lid|_|token)=[^&]+/g, '$1$2=<redacted>'),
            status: meta.status,
            body: redact(parsed),
          }, null, 2)}\n`)
          console.log(`✓ ${meta.kind} #${index} → ${path.relative(ROOT, file)}`)
          writeSummary(runDir, '采集中', '采集中')
        } catch (error) {
          console.log(`· ${meta.kind} #${index} 响应体不可用：${error.message}`)
        }
      })()
    }
  })

  ws.addEventListener('close', () => sockets.delete(ws))
  ws.addEventListener('error', () => sockets.delete(ws))
  return ws
}

async function pollTargets() {
  try {
    const response = await fetch(`${cdpBase}/json/list`, { signal: AbortSignal.timeout(3000) })
    const targets = await response.json()
    for (const target of targets) {
      if (target.type !== 'page' || !target.url.includes('zhipin.com')) continue
      if (!target.webSocketDebuggerUrl) continue
      if ([...sockets].some((ws) => ws._targetId === target.id)) continue
      attach(target)
    }
  } catch (error) {
    console.log(`· 探测 CDP 失败：${error.message}`)
  }
}

/** 离线模式：已有 fixture 也能重建汇总，不必重跑浏览器 */
if (summarizeDir) {
  const files = readdirSync(summarizeDir)
    .filter((f) => f.endsWith('.json') && f !== 'summary.json')
    .sort()
  for (const file of files) {
    const kind = file.split('-')[0]
    if (!(kind in counts)) continue
    try {
      const target = path.join(summarizeDir, file)
      const parsed = JSON.parse(readFileSync(target, 'utf8'))
      if (parsed.url) stats.endpoints.add(endpointOf(parsed.url))
      const wrapped = Object.prototype.hasOwnProperty.call(parsed, 'body')
      const body = wrapped ? parsed.body : parsed
      collect(body, kind)
      if (kind === 'friendlist') analyzeConversations(body)
      // 顺带用当前脱敏规则清洗早期版本写下的明文（聊天正文、头像 URL），重复执行幂等
      const next = wrapped ? { ...parsed, body: redact(body) } : redact(body)
      writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`)
      counts[kind] += 1
    } catch (error) {
      console.log(`· 跳过 ${file}：${error.message}`)
    }
  }
  // 离线重建只刷新统计，尽量保留原运行的状态与结束原因
  let offlineStatus = '离线汇总'
  let offlineReason = '离线汇总（从已有 fixture 重建）'
  try {
    const prev = JSON.parse(readFileSync(path.join(summarizeDir, 'summary.json'), 'utf8'))
    if (prev.status && prev.status !== '采集中') offlineStatus = prev.status
    if (prev.reason && prev.reason !== '采集中') offlineReason = `${prev.reason}（统计已离线重建）`
  } catch { /* 首次汇总，没有旧状态可读 */ }
  const md = writeSummary(summarizeDir, offlineReason, offlineStatus)
  console.log(md)
  console.log(`已重建：${path.join(summarizeDir, 'summary.md')}`)
  process.exit(0)
}

let finished = false
let timer
let flushTimer
let deadline
function finish(reason) {
  if (finished) return
  finished = true
  clearInterval(timer)
  clearInterval(flushTimer)
  clearTimeout(deadline)
  for (const ws of sockets) ws.close()

  const md = writeSummary(runDir, reason, '已结束')
  console.log('\n=== P0 探针汇总 ===')
  console.log(md)
  process.exit(0)
}

writeSummary(runDir, '采集中', '采集中')
writeFileSync(
  path.join(outDir, 'LATEST.md'),
  `# 最近一次 P0 探针\n\n- 运行目录：\`${runDir}\`\n- 汇总：\`${path.join(runDir, 'summary.md')}\`\n- 启动时间：${new Date().toISOString()}\n`,
)

console.log('BOSS 直聘 P0 探针（只读被动旁听，--help 查看完整说明）')
console.log(`CDP：${cdpBase}　时长：${opts.seconds === 0 ? '直到 Ctrl+C' : `${opts.seconds}s`}　输出：${runDir}`)
console.log(`汇总实时刷新：${path.join(runDir, 'summary.md')}（另有 ${path.join(outDir, 'LATEST.md')}）`)
console.log('请在这个 Chrome 窗口里手动浏览：搜索列表 → 岗位详情 → 消息页。探针不会发任何请求。\n')

pollTargets()
timer = setInterval(pollTargets, 3000)
flushTimer = setInterval(() => writeSummary(runDir, '采集中', '采集中'), 5000)
if (opts.seconds > 0) deadline = setTimeout(() => finish('时间到'), opts.seconds * 1000)

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => finish(`收到 ${signal}`))
}
process.on('uncaughtException', (error) => {
  try { writeSummary(runDir, `异常：${error.message}`, '异常终止') } catch { /* 落盘失败也要退出 */ }
  console.error(error)
  process.exit(1)
})
process.on('exit', () => {
  if (!finished) {
    try { writeSummary(runDir, '进程退出', '异常终止') } catch { /* ignore */ }
  }
})
