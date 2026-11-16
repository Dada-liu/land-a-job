import { defineConfig } from 'vitest/config'
import type { UserConfig } from 'vite'

/**
 * 只跑纯逻辑单测：不加载 chrome API，不启浏览器，可在 CI 里秒级反馈。
 *
 * 两个缓存开关都必须显式关掉/改道：Vitest 5 的 fs 模块缓存会解析到
 * **仓库根** 的 `node_modules/.vitest-cache.tmp-*`（npm workspaces 共享 node_modules），
 * 每次启动都去清理残留目录——在带批量删除保护的沙箱里会直接让测试起不来。
 * `fsModuleCache` 是 vitest 自己的配置项，Vite 的类型里没有，所以整体断言一次。
 */
export default defineConfig({
  fsModuleCache: false,
  fsModuleCachePath: new URL('.vitest-cache/', import.meta.url).pathname,
  cacheDir: new URL('.vitest-cache/', import.meta.url).pathname,
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    cache: false,
  },
} as unknown as UserConfig)
