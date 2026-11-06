import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

/**
 * 单例查询客户端。
 *
 * staleTime 5s：本地库读写都在毫秒级，真正的更新靠 WS 推送，
 * 因此不需要「每次聚焦都重取」——那只会让切标签页时闪一下加载态。
 *
 * networkMode 必须是 always：默认的 'online' 会按 `navigator.onLine` 把查询挂起，
 * 而这个应用的数据源是 127.0.0.1——机器没外网、浏览器report 离线时，
 * 页面会卡在「读取中」并且**永不恢复**（fetchStatus 一直是 paused，连错误都不报）。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      // 4xx 是确定性答案，重试只会让「岗位不存在」白等十几秒才显示；
      // 只有网络抖动与 5xx 值得再试一次。
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 1
      },
    },
    mutations: {
      // 同理：localhost 的写请求不该因为「浏览器离线」被挂起
      networkMode: 'always',
    },
  },
})
