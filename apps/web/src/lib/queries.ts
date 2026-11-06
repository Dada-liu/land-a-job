import { useQueryClient } from '@tanstack/react-query'
import type { JobListParams } from './api'

/**
 * 查询键集中定义。
 *
 * 服务端 WS 推来的 invalidate keys 是粗粒度的（'applications' / 'stats' …），
 * 这里把它们映射成具体的 query key 前缀，避免为了省事整库重取。
 */
export const qk = {
  dashboard: ['stats', 'dashboard'] as const,
  overview: ['stats', 'overview'] as const,
  companies: ['companies'] as const,
  company: (id: string) => ['company', id] as const,
  jobs: (params: JobListParams) => ['jobs', params] as const,
  job: (id: string) => ['job', id] as const,
  applications: ['applications'] as const,
  application: (id: string) => ['application', id] as const,
  timeline: (id: string) => ['timeline', id] as const,
  interviews: ['interviews'] as const,
  resumes: ['resumes'] as const,
  offers: ['offers'] as const,
  questions: ['questions'] as const,
  skills: ['skills'] as const,
  snapshots: ['snapshots'] as const,
  resumePerformance: ['stats', 'resume-performance'] as const,
} as const

/** WS 的粗粒度 key → 需要失效的 query 前缀 */
const KEY_MAP: Record<string, string[]> = {
  stats: ['stats'],
  companies: ['companies', 'company'],
  jobs: ['jobs', 'job', 'companies'],
  applications: ['applications', 'application', 'jobs', 'stats'],
  timeline: ['timeline', 'application'],
  interviews: ['interviews', 'stats'],
  resumes: ['resumes', 'applications'],
  offers: ['offers', 'stats'],
  questions: ['questions'],
}

export function useInvalidateFromWs() {
  const client = useQueryClient()
  return (keys: string[]) => {
    const prefixes = new Set<string>()
    for (const key of keys) {
      // 形如 application:abc → 走 application 前缀；未知 key 一律忽略，
      // 宁可少刷一次，也不要在 WS 消息异常时把整个页面打回加载态
      const base = key.split(':')[0] ?? key
      for (const prefix of KEY_MAP[base] ?? []) prefixes.add(prefix)
    }
    for (const prefix of prefixes) {
      void client.invalidateQueries({ queryKey: [prefix] })
    }
  }
}
