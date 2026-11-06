import { describe, expect, it } from 'vitest'
import { DATA_LAYOUT, SERVICE_NAME, VERSION } from '../src/index.js'

describe('core 骨架', () => {
  it('导出语义化版本', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('服务标识稳定，供端口探测使用', () => {
    expect(SERVICE_NAME).toBe('land-a-job')
  })

  it('数据目录布局不含绝对路径', () => {
    for (const value of Object.values(DATA_LAYOUT)) {
      expect(value.startsWith('/')).toBe(false)
    }
  })
})
