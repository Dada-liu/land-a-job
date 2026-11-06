import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 测试直接跑 @land/core 的源码，而不是 dist：
 * 否则每次改状态机都要先 build，反馈慢且容易出现「测的是旧产物」。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@land/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // html.ts 动态 import jsdom（约 3MB）在并行 worker 里首次转译可到 10s+；
    // 20s 会在 CI 并发时把「慢但正确」的用例误判成超时。
    testTimeout: 45_000,
  },
})
