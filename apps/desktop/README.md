# Land a Job 桌面端

把 web 端封装成 Tauri 桌面应用：应用启动时自动拉起内嵌的本地服务端（SQLite + API），
主窗口直接加载 `http://127.0.0.1:<port>`，因此与纯 web 用法共用同一套前端代码与 API。

## 结构

```
apps/desktop/
  src-tauri/            Tauri v2 壳（Rust）
    src/main.rs         sidecar 启停 + 授权命令 + Agent 连接信息
    src/config.rs       商城授权服务地址（SHOP_API_BASE_URL / SHOP_PRODUCT_URL）
    binaries/           Node 运行时 sidecar（fetch-sidecar.sh 下载，git 忽略）
  scripts/
    stage-desktop.mjs   组装 resources/app（server/mcp/web 产物 + skills + 生产依赖）
    fetch-sidecar.sh    下载对应平台的 Node 二进制（nodejs.org，失败回退 npmmirror）
  resources/app/        staging 产物（git 忽略）
```

`resources/app` 刻意保持仓库目录布局（`apps/...`、`packages/core`），因为 server/mcp
用 `../../../` 从 dist 反推根目录，`WEB_ROOT`、`SERVER_ENTRY`、`skills` 全靠它。

## 常用命令（仓库根）

```bash
npm run desktop:build   # 构建全部 workspace → staging → tauri build（产出 dmg/exe）
npm run desktop:dev     # 同上，但跑 tauri dev
npm run desktop:stage   # 只重新 staging（改了 server/web 后）
npm run sidecar         # 只下载本机平台的 Node sidecar
```

## 授权

对接软件商城（见根 `.kimi-code/skills/integrate-shop-license` 的契约）：

- `POST {SHOP_API_BASE_URL}/license/verify` 即激活并绑定设备（一机一码）；
- 本地只存授权码（tauri-plugin-store 的 `license.dat`），每次启动联网校验，无离线宽限；
- 前端 `apps/web/src/components/LicenseGate.tsx` 控制：激活成功即直达应用，无常驻授权 UI；
  临期（≤7 天）显示可关闭提醒条；失效回激活页。

## 发布

打 `v*` tag 推送后，GitHub Actions（`.github/workflows/release-desktop.yml`）在
macOS（aarch64 dmg）与 Windows（x64 NSIS）上并行构建并发布 Release。
发版后把安装包接入商城：`ssh sell_system 'bash ~/hotpot-shop/shop-deploy/scripts/update-app-release.sh --repo Dada-liu/land-a-job --tag <tag> --product-id <id>'`。
