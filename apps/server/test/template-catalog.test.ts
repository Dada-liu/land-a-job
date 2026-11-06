import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RESUME_TEMPLATES } from '@land/core'

/**
 * 模板清单的契约测试。
 *
 * core 手写 RESUME_TEMPLATES 枚举（服务端写库前校验），resume-kit 用 catalog.json
 * （编辑器读名字与描述）。两处一旦不一致，用户点开简历才会看到「模板不存在」——
 * 这里提前把它变成一条失败的测试。
 */
const catalogPath = fileURLToPath(
  new URL('../../../packages/resume-kit/src/templates/catalog.json', import.meta.url),
)

interface CatalogEntry {
  id: string
  name: string
  description: string
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogEntry[]

describe('模板清单一致性', () => {
  it('catalog.json 的 id 与 core 的枚举完全一致（顺序也一致）', () => {
    expect(catalog.map((entry) => entry.id)).toEqual([...RESUME_TEMPLATES])
  })

  it('每个模板都有名字与描述：Agent 选模板时读的就是这两项', () => {
    for (const entry of catalog) {
      expect(entry.name.trim().length).toBeGreaterThan(0)
      expect(entry.description.trim().length).toBeGreaterThan(10)
    }
  })
})
