import { defineConfig } from 'wxt'

/**
 * BOSS 桥接扩展（提案 §4 / §4.1.1）。
 *
 * 刻意不引入 Tailwind：Shadow DOM 下的 rem 基准会受宿主页面 <html> 字号影响，
 * P1 骨架用纯 CSS + 固定 px，等侧栏 UI 真正落地再评估是否引入。
 */
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: () => ({
    name: 'land-a-job · BOSS 桥接',
    short_name: 'BOSS 桥接',
    description: '本地自用的 BOSS 直聘半自动投递桥接：只读 JD、暂存、批次确认，不自动海投',
    version: '0.1.0',
    permissions: ['storage', 'alarms', 'debugger', 'tabs'],
    host_permissions: [
      'https://www.zhipin.com/*',
      'http://127.0.0.1:4399/*',
    ],
    // 固定扩展 ID 才能让服务端 CORS 白名单稳定。
    // npm run key:gen 生成公钥后写进 .env 的 WXT_EXTENSION_KEY；未配置时由 Chrome 随机分配。
    ...(process.env.WXT_EXTENSION_KEY ? { key: process.env.WXT_EXTENSION_KEY } : {}),
  }),
})
