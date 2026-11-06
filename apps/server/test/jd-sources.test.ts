import { describe, expect, it } from 'vitest'
import {
  canonicalJdUrl,
  classifyUrl,
  pasteHint,
  safeCanonicalJdUrl,
  sourceWarnings,
} from '../src/jd/index.js'

describe('JD 来源分类', () => {
  it('官方 ATS / 平台 / 官网 / 本机 / 未验证域名各有归属', () => {
    expect(classifyUrl('https://boards.greenhouse.io/acme/jobs/123').kind).toBe('ats')
    expect(classifyUrl('https://jobs.lever.co/acme/abc12345').kind).toBe('ats')
    expect(classifyUrl('https://www.zhipin.com/job_detail/abc.html').kind).toBe('aggregator')
    expect(classifyUrl('https://join.qq.com/post.html', ['join.qq.com']).kind).toBe('official')
    expect(classifyUrl('https://careers.acme.com/jobs/1').kind).toBe('unknown')
    expect(classifyUrl('http://127.0.0.1:4399/jd/1').kind).toBe('local')
  })

  it('公司官网用完整 URL 登记时也能识别子域，且不误收相似域名', () => {
    const official = classifyUrl('https://jobs.bytedance.com/experienced/position/1/detail', [
      'https://www.bytedance.com/careers',
    ])
    expect(official.kind).toBe('official')
    expect(official.trusted).toBe(true)
    expect(classifyUrl('https://bytedance.com.evil.test/job/1', ['bytedance.com']).kind).toBe('unknown')
  })

  it('伪装域名一律不可信', () => {
    expect(classifyUrl('https://greenhouse.io@evil.test/jobs/1').trusted).toBe(false)
    expect(classifyUrl('https://evil-greenhouse.io/jobs/1').kind).toBe('unknown')
    expect(classifyUrl('https://greenhouse.io.evil.test/jobs/1').kind).toBe('unknown')
  })

  it('未验证域名与平台站的降级提示是具体可执行的', () => {
    expect(pasteHint(classifyUrl('https://www.zhipin.com/job_detail/a.html'))).toContain('粘贴')
    expect(pasteHint(classifyUrl('https://www.zhipin.com/job_detail/a.html'))).toContain('官网')
    expect(pasteHint(classifyUrl('https://unknown.example.com/job/1'))).toContain('核对')
  })

  it('来源提醒覆盖平台、未验证域名和列表页锚点', () => {
    expect(sourceWarnings(classifyUrl('https://www.zhipin.com/job_detail/a.html'), new URL('https://www.zhipin.com/job_detail/a.html')))
      .toEqual(expect.arrayContaining([expect.stringContaining('第三方平台')]))
    expect(sourceWarnings(classifyUrl('https://careers.acme.com/j/1'), new URL('https://careers.acme.com/j/1')))
      .toEqual(expect.arrayContaining([expect.stringContaining('不可信')]))
    const anchor = new URL('https://boards.greenhouse.io/acme/jobs#list')
    expect(sourceWarnings(classifyUrl(anchor), anchor)).toEqual(expect.arrayContaining([expect.stringContaining('列表页')]))
  })
})

describe('JD 链接归一化（去重键）', () => {
  it('去追踪参数、锚点、尾斜杠，参数排序', () => {
    expect(
      canonicalJdUrl('https://CAREERS.example.com/jobs/123/?utm_source=wechat&from=group&b=2&a=1#apply'),
    ).toBe('https://careers.example.com/jobs/123?a=1&b=2')
  })

  it('带推广参数的同一个岗位与干净链接等价', () => {
    const clean = 'https://join.qq.com/post/123.html'
    const tracked = 'https://join.qq.com/post/123.html?utm_source=boss&spm=abc#top'
    expect(safeCanonicalJdUrl(tracked)).toBe(safeCanonicalJdUrl(clean))
  })

  it('解析失败时原样返回，不让归一化把录入卡住', () => {
    expect(safeCanonicalJdUrl('不是链接')).toBe('不是链接')
  })

  it('Moka 的 #/job/<uuid> 必须保留，否则同一门户的不同岗位会互相判重', () => {
    const a = 'https://app.mokahr.com/social-recruitment/zphz/148983?locale=zh-CN#/job/bb83a1f1-7110-4e5f-ab53-de6fb9bb883a'
    const b = 'https://app.mokahr.com/social-recruitment/zphz/148983?locale=zh-CN#/job/450888e2-7284-4957-8e79-1f0e06803222'
    expect(safeCanonicalJdUrl(a)).not.toBe(safeCanonicalJdUrl(b))
    expect(safeCanonicalJdUrl(a)).toContain('#/job/bb83a1f1')
  })

  it('列表页与投递详情页的 hash 仍然丢弃', () => {
    expect(safeCanonicalJdUrl('https://app.mokahr.com/social-recruitment/zphz/148983#/jobs')).toBe(
      'https://app.mokahr.com/social-recruitment/zphz/148983',
    )
    expect(safeCanonicalJdUrl('https://app.mokahr.com/social-recruitment/zphz/148983#/apply/detail/869291588/zphz')).toBe(
      'https://app.mokahr.com/social-recruitment/zphz/148983',
    )
  })

  it('快手的 #/official/social/job-info/<id> 必须保留，否则整批岗位互相判重', () => {
    const a = 'https://zhaopin.kuaishou.cn/recruit/e/#/official/social/job-info/30878'
    const b = 'https://zhaopin.kuaishou.cn/recruit/e/#/official/social/job-info/32843'
    expect(safeCanonicalJdUrl(a)).not.toBe(safeCanonicalJdUrl(b))
    // 尾斜杠照旧归一（/recruit/e 与 /recruit/e/ 都能打开），岗位号必须留着
    expect(safeCanonicalJdUrl(a)).toBe('https://zhaopin.kuaishou.cn/recruit/e#/official/social/job-info/30878')
    expect(safeCanonicalJdUrl('https://zhaopin.kuaishou.cn/recruit/e/#/official/social/?name=Agent')).toBe(
      'https://zhaopin.kuaishou.cn/recruit/e',
    )
  })
})
