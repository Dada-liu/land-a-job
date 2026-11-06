/**
 * robots.txt 判定（只用于「403 要不要换浏览器请求头重试」这一个决定）。
 *
 * 规则来自 ai-job-search-cn 的 09-web-research.md：重试是为了绕过 WAF 的默认值，
 * 不是用来覆盖站点明确表达过的拒绝。因此这里一律 fail closed：
 * 读不到策略、策略看不懂、Allow/Disallow 最长匹配打平 —— 都不重试。
 *
 * 刻意不用 urllib.robotparser 那类实现：空行断组 + 按文件顺序匹配会在
 * 「Allow: / 写在 Disallow: /cs/ 前面」的真实文件上误判为全部允许。
 */

interface Rule {
  kind: 'allow' | 'disallow'
  path: string
}

interface Group {
  agents: string[]
  rules: Rule[]
}

export function robotsAllowsPath(text: string, targetPath: string, agent = 'land-a-job'): boolean {
  const groups: Group[] = []
  let current: Group | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (key === 'user-agent') {
      // 连续 User-agent 属于同一组；见过规则后再出现 User-agent 才是新组
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      continue
    }
    if (key !== 'allow' && key !== 'disallow') continue
    // 没有 User-agent 的裸规则按「对所有人生效」处理，保守一侧
    if (!current) {
      current = { agents: [], rules: [] }
      groups.push(current)
    }
    if (!value) continue // Disallow: 空值 = 不禁止任何路径
    // robots 通配符只取 * 之前的字面前缀，避免把 /private/* 误读成整条路径
    const rulePath = value.split('*')[0] || '/'
    current.rules.push({ kind: key === 'allow' ? 'allow' : 'disallow', path: rulePath })
  }

  const normalizedAgent = agent.toLowerCase()
  const applicable = groups.filter(
    (group) => group.agents.length === 0 || group.agents.includes('*') || group.agents.includes(normalizedAgent),
  )
  const matches = applicable.flatMap((group) => group.rules).filter((rule) => targetPath.startsWith(rule.path))
  if (matches.length === 0) return true

  let longest = 0
  for (const rule of matches) longest = Math.max(longest, rule.path.length)
  // 打平时 Disallow 优先
  return !matches.some((rule) => rule.kind === 'disallow' && rule.path.length === longest)
}
