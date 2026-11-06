import { AppErrorBody, LandError } from './errors.js'
import { REQUEST_TIMEOUT_MS, readToken } from './config.js'
import { ensureServer, forgetServer, type SupervisorState } from './supervisor.js'

/**
 * server 的 HTTP 客户端（P5-1）。
 *
 * 三件事必须收在这里做，否则 42 个工具里会散落 42 份错误处理：
 * 1. 自动拉起：`ensureServer()` 保证 base url 一定可用
 * 2. 令牌：只从 data/.token 读，不从环境变量读
 * 3. 错误归一：把 `{ error: { code, message, details } }` 变成带 code 的 LandError，
 *    让 Agent 能按 code 自我纠正（INVALID_TRANSITION / CONFLICT / SKILL_OUTDATED）
 */

export interface ClientOptions {
  base?: string
  token?: string
  timeoutMs?: number
}

interface Envelope<T> {
  data: T
  meta?: Record<string, unknown>
}

export class LandClient {
  private state: SupervisorState | null
  private readonly explicitBase?: string
  private readonly explicitToken?: string
  private readonly timeoutMs: number

  constructor(options: ClientOptions = {}) {
    this.explicitBase = options.base
    this.explicitToken = options.token
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
    this.state = null
  }

  private async resolve(): Promise<{ base: string; token: string }> {
    if (!this.state) {
      this.state = this.explicitBase
        ? { base: this.explicitBase, port: 0, started: false }
        : await ensureServer()
    }
    const token = this.explicitToken ?? readToken()
    if (!token) {
      throw new LandError({
        code: 'TOKEN_MISSING',
        message: '读不到本机 API 令牌（data/.token）。请先启动一次服务端以生成令牌',
        status: 0,
      })
    }
    return { base: this.state.base, token }
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const { base, token } = await this.resolve()
    /**
     * 路径一律以 `/api` 开头拼**在 client 内部**完成。
     *
     * 这条规则是踩出来的：少了 `/api` 时，服务端会把请求交给前端 SPA 兜底，
     * 返回 200 + 一段 HTML。客户端拿不到 `data` 信封，只看到 null，
     * 于是表现为「工具成功了但什么都没返回」——比 4xx 难查得多。
     */
    const url = `${base}/api${path.startsWith('/') ? path : `/${path}`}`
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          /**
           * 只在真有 body 时才声明 json。
           * DELETE 带上 content-type 却没有 body 时，Fastify 会抛
           * FST_ERR_CTP_EMPTY_JSON_BODY（400），表现为「关闭会话失败」这种莫名其妙的错。
           */
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          'x-land-token': token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      // 服务可能在两次调用之间被关掉，清掉缓存让下次重新探测
      forgetServer()
      this.state = null
      const message = error instanceof Error ? error.message : String(error)
      throw new LandError({
        code: 'SERVER_UNREACHABLE',
        message: `连不上 land-a-job 服务（${base}）：${message}。可先运行 npm start 再重试`,
        status: 0,
      })
    }

    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }

    if (!response.ok) {
      const body = (parsed as { error?: AppErrorBody } | null)?.error
      throw new LandError({
        code: body?.code ?? `HTTP_${response.status}`,
        message: body?.message ?? `${method} ${path} 失败（HTTP ${response.status}）`,
        status: response.status,
        details: body?.details,
      })
    }

    // 统一信封 { data, meta }；没有信封时原样返回（health 等）
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as Envelope<T>).data
    }
    return parsed as T
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  /** 给 get_app_status 用：不抛错地探一次连通性与版本 */
  async status(): Promise<{ ok: boolean; base?: string; version?: string; error?: string }> {
    try {
      const { base } = await this.resolve()
      const health = await this.get<{ service?: string; version?: string; db?: string }>('/health')
      return { ok: true, base, version: health.version }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

export const client = new LandClient()
