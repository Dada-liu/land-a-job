import { describe, expect, it } from 'vitest'
import {
  canonicalJdUrl,
  matchEndpoint,
  parseResponse,
  sanitizeUntrustedText,
} from '../src/lib/parsers.js'

const LIST_URL = 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=前端'
const DETAIL_URL = 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=abc'
const FRIEND_URL = 'https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json'

describe('被动响应解析（P0 实测 JSON 路径）', () => {
  it('端点归类覆盖五类读响应', () => {
    expect(matchEndpoint(LIST_URL)).toBe('joblist')
    expect(matchEndpoint(DETAIL_URL)).toBe('detail')
    expect(matchEndpoint(FRIEND_URL)).toBe('friendlist')
    expect(matchEndpoint('https://www.zhipin.com/wapi/zpchat/geek/getBossData?x=1')).toBe('bossdata')
    expect(matchEndpoint('https://www.zhipin.com/wapi/zpgeek/friend/add.json?x=1')).toBe('greet')
  })

  it('joblist 读 zpData.jobList[]，列表项没有 activeTimeDesc', () => {
    const body = {
      code: 0,
      zpData: {
        jobList: [{
          securityId: 'sec-1', jobName: '前端开发', brandName: '拓保软件',
          salaryDesc: '15-25K', cityName: '上海·浦东', bossOnline: true,
          encryptJobId: 'enc-job', encryptBossId: 'enc-boss',
        }],
      },
    }
    const parsed = parseResponse(LIST_URL, body)
    expect(parsed?.kind).toBe('joblist')
    if (parsed?.kind !== 'joblist') return
    expect(parsed.jobs[0]).toMatchObject({
      securityId: 'sec-1', salaryDesc: '15-25K', city: '上海·浦东', bossOnline: true,
    })
    expect('activeTimeDesc' in parsed.jobs[0]).toBe(false)
  })

  it('detail 只读 zpData.bossInfo，不拿 brandComInfo.activeTime 当 HR 时间', () => {
    const body = {
      code: 0,
      zpData: {
        securityId: 'sec-1',
        jobInfo: { jobName: '前端开发', brandName: '拓保软件', postDescription: '职责：\n1. 前端开发' },
        bossInfo: { activeTimeDesc: '刚刚活跃', bossOnline: true, brandName: '拓保软件' },
        brandComInfo: { activeTime: 1794454066363 },
      },
    }
    const parsed = parseResponse(DETAIL_URL, body, 1794454300000)
    expect(parsed?.kind).toBe('detail')
    if (parsed?.kind !== 'detail') return
    expect(parsed.detail.bossActive.desc).toBe('刚刚活跃')
    expect(parsed.detail.bossActive.online).toBe(true)
    expect(parsed.detail.bossActive.activeTime).toBeUndefined()
    expect(parsed.detail.jdText).toContain('前端开发')
  })

  it('登录墙 / 空正文判截断，不采用', () => {
    const body = { code: 0, zpData: { jobInfo: { postDescription: '登录查看完整内容' }, bossInfo: {} } }
    const parsed = parseResponse(DETAIL_URL, body)
    expect(parsed?.kind === 'detail' && parsed.detail.jdTruncated).toBe(true)
  })

  it('friendlist 读 zpData.result[]，保留方向判据字段', () => {
    const body = {
      code: 0,
      zpData: {
        result: [{
          uid: 12648805, jobId: 587458235, brandName: '拓保软件',
          lastTS: 1794454310204, lastMsg: '方便发一份简历吗', unreadMsgCount: 0,
          lastMessageInfo: {
            msgId: 406794691391746, msgTime: 1794454310204,
            fromId: 12648805, toId: 504921610, status: 0,
          },
        }],
      },
    }
    const parsed = parseResponse(FRIEND_URL, body)
    expect(parsed?.kind).toBe('friendlist')
    if (parsed?.kind !== 'friendlist') return
    expect(parsed.conversations[0]).toMatchObject({ fromId: 12648805, status: 0, uid: 12648805 })
  })

  it('顶层 code 非 0 才是风控信号；嵌套 code 不算', () => {
    const nested = {
      code: 0,
      zpData: { jobList: [{ jobName: 'A', brandName: 'B', code: 101094, bossOnline: false }] },
    }
    expect(parseResponse(LIST_URL, nested)?.kind).toBe('joblist')
    const risk = parseResponse(LIST_URL, { code: 9, message: '操作过于频繁' })
    expect(risk).toEqual({ kind: 'risk', code: 9, message: '操作过于频繁' })
  })

  it('code=0 但文案是硬限额，同样当风控信号（实测这类提示会挂正常响应里）', () => {
    const risk = parseResponse(LIST_URL, { code: 0, message: '今天已与 120 位 BOSS 沟通', zpData: {} })
    expect(risk).toEqual({ kind: 'risk', code: 0, message: '今天已与 120 位 BOSS 沟通' })
    // 普通成功响应不受影响
    const ok = parseResponse(LIST_URL, { code: 0, message: 'ok', zpData: { jobList: [] } })
    expect(ok?.kind).toBe('joblist')
  })

  it('JD 是第三方文本：剔除零宽字符与控制字符', () => {
    expect(sanitizeUntrustedText('前端\u200B开发\u0000\uFEFF')).toBe('前端开发')
  })

  it('规范化链接去追踪参数，但保留带岗位号的 SPA hash', () => {
    expect(canonicalJdUrl('https://www.zhipin.com/job_detail/a.html?utm_source=x&_=1')).toBe(
      'https://www.zhipin.com/job_detail/a.html',
    )
    expect(canonicalJdUrl('https://www.zhipin.com/campus/#/postDetail?postId=123')).toContain('postId=123')
  })
})
