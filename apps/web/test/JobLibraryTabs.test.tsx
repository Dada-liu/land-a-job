import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { JobLibraryTabs } from '../src/components/JobLibraryTabs'

describe('岗位库子 Tab', () => {
  it('把当前库暴露为可访问的选中 Tab，另一个库可通过按钮激活', () => {
    const html = renderToStaticMarkup(
      <JobLibraryTabs value="private" labels={{ private: '私有库', public: '公开库' }} onChange={vi.fn()} />,
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('id="job-library-tab-private"')
    expect(html).toContain('id="job-library-tab-public"')
    expect(html).toMatch(/id="job-library-tab-private"[^>]*aria-selected="true"/)
    expect(html).toMatch(/id="job-library-tab-public"[^>]*aria-selected="false"/)
    expect(html).toMatch(/id="job-library-tab-public"[^>]*tabindex="-1"/i)
  })
})
