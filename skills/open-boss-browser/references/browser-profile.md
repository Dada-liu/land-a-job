# 独立 profile + 扩展的几个硬事实

这份文档只讲「为什么这样做」和「怎么自己验」，操作步骤在 SKILL.md。

## 1. 为什么必须用独立 profile

- 用户日常那个 Chrome（`Default` / 「主」）里没有这个扩展，也不该往里装：
  扩展需要 `debugger` 权限、要读 BOSS 页面数据、还要连本地 4399，装在日常 profile 里等于
  把工作环境和私人浏览器混在一起。
- 独立 profile 的另一半价值是**登录态隔离**：BOSS 的登录态、`__zp_stoken__`（风控 token）
  跟着 profile 走。混用日常 profile 会让探测脚本读到一堆无关站点的数据，也更容易触发风控。
- profile 在 `~/.land-a-job/boss-probe-profile`，名字里的 probe 是历史原因（最早是 CDP 探针用的）。
  删掉它等于清空这台机器上的 BOSS 登录态与扩展配置，**不要主动删**。

## 2. 为什么只有「直调二进制」这条路

| 方式 | 结果 |
| --- | --- |
| 直调 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=...` | 正常新起实例，`SingletonLock` 出现，CDP 可用 |
| `open -na "Google Chrome" --args --user-data-dir=...` | **不生效**：Chrome 已在跑时 `open` 只把窗口唤到前台，`--args` 被忽略 |
| 沙箱进程里起 Chrome 且不带 `--no-sandbox --disable-gpu` | GPU 进程反复崩，最后 `GPU process isn't usable. Goodbye.`（exit 133） |

还有一个现实约束：这个 shell 里 `ps` 常被禁、`osascript` 无 Automation 权限、
`screencapture` 无屏幕录制权限（整屏截图只有壁纸）。**验证页面内容只能走 CDP**，
不要指望截图或 AppleScript。

## 3. 三件事的验证命令

```bash
# ① 实例起来了吗（有 Browser 字段即起来）
curl -s --max-time 2 http://127.0.0.1:9222/json/version

# ② 扩展加载了吗（应出现 .../dafidpppdefegiajeiochkgldabpibfm/background.js）
curl -s http://127.0.0.1:9222/json/list | grep -o 'chrome-extension://[a-z]*/background.js'

# ③ 服务端认这个扩展吗（期望 204，且响应头有 access-control-allow-origin）
curl -s -i -X OPTIONS \
  -H 'Origin: chrome-extension://dafidpppdefegiajeiochkgldabpibfm' \
  -H 'Access-Control-Request-Method: GET' \
  http://127.0.0.1:4399/api/health | head -12
```

`SingletonLock` 是个 symlink，内容形如 `hostname-pid`。它存在但 pid 已死（`kill -0 <pid>` 失败）
= 上次非正常退出，新实例会接手，**不要删 lock、不要删 profile**。

## 4. 用 CDP 读页面（Node 22 自带 WebSocket，零依赖）

```js
// node probe.mjs "<要执行的表达式>"
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes('zhipin.com'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }))
ws.onopen = () => send(1, 'Runtime.evaluate', {
  expression: process.argv[2], returnByValue: true, awaitPromise: true,
})
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id === 1) { console.log(JSON.stringify(msg.result?.result?.value ?? msg.result, null, 2)); ws.close() }
}
```

- 只认 `type === 'page'` 的 target；`service_worker` 和 `shared_worker` 都不是页面。
- 页面是 SPA：`Runtime.evaluate` 拿到空值多半是首屏没渲染完，等一会儿再读一次，
  不要把「读不到」当成「未登录」。
- 需要视觉确认时才 `Page.captureScreenshot`（返回 base64），不要用系统截图工具。

登录态判定就用 SKILL.md §4 那段表达式：`.nav-figure` 在未登录时显示「登录 / 注册」，
已登录时是用户昵称。`__zp_stoken__` 匿名访问也可能有，只作辅证。

## 5. 扩展这边要记住的约定

- **扩展 ID 由 manifest key 固定**为 `dafidpppdefegiajeiochkgldabpibfm`，换机器、重装、
  重新加载已解压目录都不变。ID 变了说明加载的不是这份产物。
- 产物目录固定 `extensions/boss-bridge/.output/chrome-mv3`（WXT 的默认输出），
  `npm run build` 覆盖写；改完扩展必须回到 `chrome://extensions` 点一次刷新。
- 骨架分三页：`popup.html`（监听 / 筛选出草稿 / 查缓存 / 检查新回复）、
  `staging.html`（暂存区：匹配度、定制简历、写入 land-a-job）、`options.html`
  （服务地址、API 令牌、招呼语模板、风控口径）。用户问「在哪儿看」时按这三页回答。
- 权限里有 `debugger` 与 `storage`，host 只放 `https://www.zhipin.com/*` 与
  `http://127.0.0.1:4399/*`。用户如果问「为什么装的时候提示权限」，照这两条解释，别夸大。
- 桥接链路的硬前提是服务端 CORS 白名单含该扩展 ID（`LAND_EXTENSION_ORIGINS`）。
  没有这一项，popup 的「保存并测试连接」一定失败，且失败信息看起来像服务没起。

## 6. 常见误判

| 现象 | 真实原因 |
| --- | --- |
| 「浏览器打开了，但扩展图标是灰的」 | 那个窗口是用户日常 profile，`open` 启动被忽略；按 SKILL.md §2.2 直调二进制重开 |
| 「popup 打不开 / 点了没反应」 | profile 里没装扩展，或装了但没启用（`/json/list` 无 service worker） |
| 「桥接连不上，服务明明在跑」 | 令牌没填对（只认 `data/.token`），或 CORS 白名单没含扩展 ID |
| 「昨日能用的，今天要重新登录」 | BOSS 登录态过期，属正常；让用户自己登，不要试图用 cookie 续期 |
| 「暂存页写着已写入，投递列表里是待投递」 | 设计如此：写入的是 queued，投递动作仍要用户自己完成 |
