---
name: open-boss-browser
version: 1.0.0
description: 打开「装了 BOSS 桥接扩展」的独立 profile 浏览器：profile 不在就建一个并给出扩展安装步骤，已在就直接开；打开后落到 BOSS 直聘首页，按登录态分别处理（未登录请用户自己登，已登录讲清插件怎么用）。当用户说「打开插件」「打开 BOSS 浏览器」「打开桥接」「插件装了没反应」时使用。
---

# 打开插件浏览器（BOSS 桥接）

**这是全仓唯一「只开浏览器、不读写求职库」的 Skill。** 不 `list_resumes`、不 `list_jobs`、
不 `create_application`，一次写接口都不调（所以也没有 provenance 可写）。

分三件事，顺序别换：**① profile 在不在 → ② 扩展装没装 → ③ 登录态如何**。
少判一步就会出现「浏览器开了但插件没起作用」这种最难查的假成功。

## 0. 固定参数（先记住，后面全靠它）

| 项 | 值 |
| --- | --- |
| profile 目录 | `~/.land-a-job/boss-probe-profile` |
| 扩展 ID | `dafidpppdefegiajeiochkgldabpibfm` |
| 扩展构建产物 | `extensions/boss-bridge/.output/chrome-mv3` |
| 本地服务 | `http://127.0.0.1:4399` |
| 调试端口 | `9222` |

- 旧文档里写的 `boss-profile` 是这个目录的**错名**，不存在，以本表为准。
- **profile 目录存在 ≠ 插件装好**；目录在、扩展没启用时 popup 根本点不出来。
  两件事必须分开验证（§2 / §3）。

## 1. 先分流

| 用户说 | 从哪开始 |
| --- | --- |
| 打开插件 / 打开 BOSS 浏览器 | §2 全流程 |
| 插件怎么装 / 装了没反应 | 直接 §3 |
| 桥接连不上 / 令牌不对 | §3.3，再回 §5 第 6 条 |

只有用户说「打开」，才需要真正拉起浏览器；单纯问怎么装，讲清步骤即可。

## 2. profile 与浏览器实例

### 2.1 判断

```bash
ls -d ~/.land-a-job/boss-probe-profile 2>/dev/null || echo MISSING
```

- **MISSING** → `mkdir -p ~/.land-a-job/boss-probe-profile`，按 §2.2 启动（Chrome 会自己把目录写满），
  并且本次**必定**走 §3 的安装指引（新目录里没有任何扩展）。
- **存在** → 先看是不是已经有实例在跑（§2.3），没有再启动。

### 2.2 启动（必须直接调二进制）

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.land-a-job/boss-probe-profile" \
  --remote-debugging-port=9222 --no-sandbox --disable-gpu \
  --window-size=1440,900 "https://www.zhipin.com/" \
  > /tmp/boss-browser.log 2>&1
```

- 后台跑（`run_in_background`），否则会一直占住会话。
- **不要用 `open -na "Google Chrome" --args --user-data-dir=...`**：Chrome 已在运行时
  `open` 不会新起实例，参数被直接忽略，你会以为开了、其实是用户日常那个 profile。
- `--no-sandbox --disable-gpu` 不是可选项：从 Agent shell 起 Chrome 不加这两条会
  `sandbox initialization failed` → GPU 进程反复重启 → `GPU process isn't usable. Goodbye.`（exit 133）。
- 同一 profile 只允许一个实例。用户已经开着就别再起第二个（会抢 profile 或静默复用旧窗口）。

### 2.3 验证「真起来了」

```bash
curl -s --max-time 2 http://127.0.0.1:9222/json/version | head -3
```

有 `Browser` 字段才算起来。`SingletonLock` 残留（指向一个已经死掉的 pid）是正常现象，
上次没退干净而已，新实例会自动接手，**不要手动删 lock 文件**。

## 3. 扩展装了没

```bash
curl -s http://127.0.0.1:9222/json/list | grep -o 'chrome-extension://[a-z]*/background.js' | sort -u
```

看到 `chrome-extension://dafidpppdefegiajeiochkgldabpibfm/background.js`
（`type` 是 `service_worker`）即已加载。看不到就是没装 / 装了没启用 → 走 §3.1，
**不要自己去点 `chrome://extensions`**（那是用户机器上的页面，也让用户自己确认 ID）。

### 3.1 安装步骤（原文交给用户，别压缩成「去设置里开一下」）

1. 先确认产物在：`extensions/boss-bridge/.output/chrome-mv3/manifest.json`。
   不在就先构建（WXT，产物固定落 `.output/chrome-mv3`）：
   `cd extensions/boss-bridge && npm install && npm run build`
2. `chrome://extensions` → 右上角打开「开发者模式」→「加载已解压的扩展程序」→
   选 **`extensions/boss-bridge/.output/chrome-mv3`**（选目录，不是选里面的 manifest.json）。
3. 装完核对 ID 必须是 `dafidpppdefegiajeiochkgldabpibfm`（manifest 里 key 固定，换机器也一样）。
   ID 不是这个 → 加载的不是这份产物，服务端 CORS 白名单一定拒，先纠正再往下走。
4. 点扩展图标 →「设置」：服务地址填 `http://127.0.0.1:4399`；令牌从 `data/.token` 读
   （或 Web 端 `/api/bootstrap` 里取）；点「保存并测试连接」，要看到「已保存，本地服务可达」。

### 3.2 本次没装时的收尾

告诉用户：装完后点扩展图标能看到「桥接」状态那一块。**装完回我一句**，我再跑一遍
`/json/list` 复核 service worker 是否出现，不凭用户一句「装好了」就宣称就绪。

### 3.3 装了但桥接连不上

- 服务没起：`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4399/api/health` 不是 200 →
  按仓库根 `npm start` 起服务，再让用户点「保存并测试连接」。
- 服务在、扩展报被拒 → 服务端 `LAND_EXTENSION_ORIGINS` 没含这个扩展 ID
  （可用 `OPTIONS /api/health` 带 `Origin: chrome-extension://dafidpppdefegiajeiochkgldabpibfm` 验证，
  期望 204 + `access-control-allow-origin`）。
- 令牌不对 → 令牌只存在 `data/.token`，别猜；改完必须重新点「保存」。

## 4. 落到首页，判断登录态

导航到 **`https://www.zhipin.com/`**（用户说的「首页」就是这里，不是 `/web/geek/jobs`）。
页面加载完在页面上下文里求值（CDP `Runtime.evaluate`，`references/browser-profile.md` 有现成脚本）：

```js
(() => {
  const el = document.querySelector('.nav-figure')
  const text = (el?.innerText || '').trim()
  return { loggedIn: Boolean(el) && !/登录|注册/.test(text), who: text }
})()
```

- `loggedIn: true`（`who` 是用户昵称）→ 进 §5。
- `loggedIn: false` / `who` 含「登录 / 注册」→ 告诉用户：
  「窗口已经打开了，请你在这个窗口里自己登录（手机号或扫码），登完回我一句。」
  **停下来等**；不代填账号密码、不点登录、不碰验证码。
- `.nav-figure` 读不到（首屏还没渲染）→ 等首屏出来重试一次；仍读不到就用
  `document.body.innerText` 兜底判断，别硬下结论。

`__zp_stoken__` 这类 cookie 匿名访问时也可能存在，**只能当辅证，不能单独用来判定已登录**。

## 5. 已登录：讲清插件怎么用（照实讲，别扩写）

按 popup → 暂存页的顺序说，一次讲完六条：

1. **开始监听**：点扩展图标 →「开始监听页面」→ 然后正常浏览 BOSS 岗位列表。
   扩展只旁听页面自己已经加载的数据，不会主动打 BOSS 的接口。
2. **先打招呼，再出草稿**：先在 BOSS 岗位上点「立即沟通」发出默认招呼语，扩展会把它记成
   「已打招呼」并写上时间；之后 popup「筛选并生成招呼语」才为**这些公司**用本地模板生成定制
   招呼语（模板在 options 里，0 token，不调任何模型）。没打过招呼的不生成。
3. **发消息仍然是你点**：「复制全部草稿」→ 到聊天页自己粘贴发送。扩展不会替你点发送。
4. **进库**：popup「查看缓存岗位」打开暂存页 → 看匹配度、按 JD 定制简历、
   把选中的写进 land-a-job。**写进去的是「待投递」，不是已投递。**
5. **看回复**：popup「检查新回复」会让会话页重新拉一次消息列表
   （BOSS 是单页应用，页面一直挂着不会自己刷新）。
6. **风控**：单批条数/间隔有抖动，每日沟通 120/150 硬上限，单轮 500 次请求预算；
   遇到 code 9/31/37 或「频繁 / 环境异常」会自动熔断停机，popup 里点「解除保护」才恢复。
   **不要教用户绕过熔断。**

## 6. 禁止

- 不读库、不建岗、不投递：本 Skill 不产生任何写接口调用。
- 不替用户登录，不填手机号 / 密码 / 验证码。
- 不点 BOSS 的「发送 / 立即沟通 / 投递」按钮，也不替用户点扩展里的「解除保护」。
- 不为了「看起来成功」编造扩展状态：`/json/list` 里没有那个 service worker 就是没装。

## 7. 交付给用户的一句话（按情况选一句）

- 全新：profile 建好了、浏览器已开在 BOSS 首页，**但插件还没装** → 给 §3.1 四步，装完回我。
- 已装未登录：浏览器已开在 BOSS 首页，**请先自己登录**，登完回我。
- 已装已登录：浏览器已开在 BOSS 首页，插件已在线 → 给 §5 六条。
- 已装、登录着、用户只想确认：直接说结论（在线 / 未在线 + 判定依据），不重复讲操作。
