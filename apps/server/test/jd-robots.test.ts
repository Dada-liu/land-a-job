import { describe, expect, it } from 'vitest'
import { robotsAllowsPath } from '../src/jd/index.js'

describe('robots.txt 判定（403 重试的唯一闸门）', () => {
  it('没有规则或空 Disallow 视为允许', () => {
    expect(robotsAllowsPath('User-agent: *\nAllow: /', '/jobs/1')).toBe(true)
    expect(robotsAllowsPath('User-agent: *\nDisallow:', '/jobs/1')).toBe(true)
  })

  it('站点明确禁止就不重试', () => {
    expect(robotsAllowsPath('User-agent: *\nDisallow: /', '/jobs/1')).toBe(false)
    expect(robotsAllowsPath('User-agent: *\nDisallow: /jobs/', '/jobs/1')).toBe(false)
  })

  it('最长匹配优先；打平时 Disallow 赢，不看规则先后顺序', () => {
    expect(robotsAllowsPath('User-agent: *\nDisallow: /jobs/\nAllow: /jobs/public/', '/jobs/public/1')).toBe(true)
    expect(robotsAllowsPath('User-agent: *\nAllow: /jobs/\nDisallow: /jobs/', '/jobs/1')).toBe(false)
  })

  it('空行不切断规则组，注释不参与匹配', () => {
    const text = 'User-agent: *\n\nAllow: /\n# comment\nDisallow: /private/\n\nDisallow: /admin/'
    expect(robotsAllowsPath(text, '/private/job')).toBe(false)
    expect(robotsAllowsPath(text, '/jobs/1')).toBe(true)
  })

  it('只采用适用于自己的规则组', () => {
    const text = 'User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /'
    expect(robotsAllowsPath(text, '/jobs/1', 'land-a-job')).toBe(true)
    expect(robotsAllowsPath(text, '/jobs/1', 'badbot')).toBe(false)
  })

  it('通配符按字面前缀保守处理', () => {
    expect(robotsAllowsPath('User-agent: *\nDisallow: /private/*', '/private/job/1')).toBe(false)
  })
})
