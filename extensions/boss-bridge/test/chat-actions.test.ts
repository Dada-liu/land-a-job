import { describe, expect, it } from 'vitest'
import { hasUploadedFile, parseResumeButton, pickConversation } from '../src/lib/chat-actions.js'

describe('会话匹配（发错人不可撤销，所以只认能确认的）', () => {
  const list = [
    { label: '拓保软件（深圳）有限公司' },
    { label: '拓保软件' },
    { label: '陈思思 拓保软件 招聘主管' },
  ]

  it('精确匹配优先于包含匹配', () => {
    expect(pickConversation(list, '拓保软件')?.label).toBe('拓保软件')
  })

  it('忽略空格与零宽字符', () => {
    expect(pickConversation([{ label: '拓 保 软 件' }], '拓保软件')?.label).toBe('拓 保 软 件')
  })

  it('只能包含匹配时取最短的一条，避免命中长公司名', () => {
    const items = [{ label: '拓保软件（深圳）有限公司' }, { label: '深圳拓保软件科技' }]
    expect(pickConversation(items, '拓保软件')?.label).toBe('深圳拓保软件科技')
  })

  it('匹配不到就返回 null，绝不猜一个发出去', () => {
    expect(pickConversation(list, '字节跳动')).toBeNull()
    expect(pickConversation(list, '   ')).toBeNull()
  })
})

describe('「发简历」按钮状态（实测：对方没回复时带 unable）', () => {
  it('没有 unable 时可以发', () => {
    expect(parseResumeButton('toolbar-btn tooltip')).toEqual({ available: true, reason: '可以发简历' })
  })

  it('带 unable 且 aria-label 说明原因时原样回报', () => {
    const state = parseResumeButton('toolbar-btn tooltip unable', '正在请求中，等待对方回复')
    expect(state.available).toBe(false)
    expect(state.reason).toBe('正在请求中，等待对方回复')
  })

  it('带 unable 但没有说明时给默认原因，而不是静默失败', () => {
    const state = parseResumeButton('toolbar-btn unable')
    expect(state.available).toBe(false)
    expect(state.reason).toContain('对方尚未回复')
  })
})

describe('上传回执判定', () => {
  it('附件列表里出现同名文件即视为上传成功', () => {
    const list = ['刘钰_全栈开发工程师_20261112.pdf 633.0KB 更新于 2026.11.12 12:49']
    expect(hasUploadedFile(list, '刘钰_全栈开发工程师_20261112.pdf')).toBe(true)
  })

  it('只比对文件名主干也认（列表里可能省略后缀）', () => {
    expect(hasUploadedFile(['刘钰_全栈开发工程师_20261112 633KB'], '刘钰_全栈开发工程师_20261112.pdf')).toBe(true)
  })

  it('列表里没有就返回 false', () => {
    expect(hasUploadedFile(['别的简历.pdf'], '刘钰_全栈开发工程师.pdf')).toBe(false)
    expect(hasUploadedFile([], 'a.pdf')).toBe(false)
  })
})
