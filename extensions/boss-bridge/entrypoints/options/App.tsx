import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS } from '../../src/lib/constants.js'
import { buildGreeting, GREETING_MAX_LENGTH } from '../../src/lib/greeting.js'
import { CATEGORY_LABELS, JOB_CATEGORIES, type JobCategory } from '../../src/lib/job-category.js'
import { sendToBackground } from '../../src/lib/messages.js'
import type { RuntimeResponse } from '../../src/lib/messages.js'
import type { BridgeSettings } from '../../src/lib/types.js'

/** 每个类型的判据举例：光说"外包"没人知道指什么，给个真实标题最省事 */
const CATEGORY_EXAMPLES: Record<JobCategory, string> = {
  experienced: '如「AI Agent 全栈开发工程师」',
  campus: '如「【校招】Web 前端开发工程师」',
  intern: '如「前端开发实习生（Intern）」',
  outsourced: '如「前端开发（驻场）」',
}

/** 预览用的假岗位，只为看清模板效果，不落库、不发送 */
const SAMPLE_JOB = { jobName: 'AI Agent 开发工程师', brandName: '示例科技', salaryDesc: '25-40K' }

function normalize(settings: BridgeSettings, highlights: string): BridgeSettings {
  return {
    ...settings,
    highlights: highlights.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean),
  }
}

export function OptionsApp() {
  const [settings, setSettings] = useState<BridgeSettings>(DEFAULT_SETTINGS)
  const [highlights, setHighlights] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [savedJson, setSavedJson] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void sendToBackground<RuntimeResponse>({ type: 'GET_SETTINGS' }).then((res) => {
      if (res.ok && res.settings) {
        const next = {
          ...res.settings,
          captureCategories: res.settings.captureCategories ?? DEFAULT_SETTINGS.captureCategories,
        }
        setSettings(next)
        setHighlights(res.settings.highlights.join('、'))
        setSavedJson(JSON.stringify(normalize(next, res.settings.highlights.join('、'))))
        setLoaded(true)
      }
    })
  }, [])

  function patch(next: Partial<BridgeSettings>) {
    setSettings((prev) => ({ ...prev, ...next }))
    setNotice('')
  }

  /** 一类都不留就等于什么都抓不到，直接拦住（比"空集＝不过滤"更容易理解） */
  function toggleCategory(id: JobCategory) {
    const cur = settings.captureCategories
    const on = !cur.includes(id)
    const next = on
      ? JOB_CATEGORIES.filter((c) => c === id || cur.includes(c))
      : cur.filter((c) => c !== id)
    if (next.length === 0) {
      setNotice('')
      setError('至少要保留一类，否则一个岗位都抓不到')
      return
    }
    setError('')
    patch({ captureCategories: next })
  }

  const current = useMemo(() => normalize(settings, highlights), [settings, highlights])
  const dirty = loaded && savedJson !== '' && JSON.stringify(current) !== savedJson

  /** 直接调生产代码的生成函数，预览和真正发出去的文案保证一致 */
  const preview = useMemo(
    () => buildGreeting(settings.greetingTemplate, SAMPLE_JOB, current.highlights),
    [settings.greetingTemplate, current.highlights],
  )

  async function save(): Promise<boolean> {
    setNotice('')
    setError('')
    if (current.captureCategories.length === 0) {
      setError('至少要保留一类岗位类型')
      return false
    }
    const res = await sendToBackground<RuntimeResponse>({ type: 'SET_SETTINGS', settings: current })
    if (res.ok) {
      setSavedJson(JSON.stringify(current))
      setNotice('已保存，下次抓取就按新设置走')
      return true
    }
    setError(res.error)
    return false
  }

  async function test() {
    setNotice('')
    setError('')
    if (!(await save())) return
    const res = await sendToBackground<RuntimeResponse>({ type: 'TEST_BRIDGE' })
    if (res.ok) setNotice('已保存，本地服务可达')
    else setError(res.error)
  }

  const kept = current.captureCategories.map((id) => CATEGORY_LABELS[id])

  return (
    <div className="wrap opt-wrap">
      <header className="opt-head">
        <h1>BOSS 桥接 · 设置</h1>
        <p className="opt-desc">
          所有配置只存本机浏览器，不上传。扩展不存任何模型 Key，也不会替你发送消息。
        </p>
      </header>

      <section className="opt-card">
        <div className="opt-card-head">
          <span className="opt-step">1</span>
          <div>
            <h2>连接本地服务</h2>
            <p className="opt-desc">
              land-a-job 跑在你自己的电脑上。这两项填错，投递记录和时间线都推不过去，但抓岗位仍然正常。
            </p>
          </div>
        </div>

        <label className="opt-field">
          <span className="opt-label">服务地址</span>
          <input type="text" value={settings.apiBase} onChange={(e) => patch({ apiBase: e.target.value })} placeholder="http://127.0.0.1:4399" />
        </label>

        <label className="opt-field">
          <span className="opt-label">访问令牌</span>
          <input type="password" value={settings.token} onChange={(e) => patch({ token: e.target.value })} placeholder="x-land-token" />
          <span className="opt-help">
            服务启动后存在本机 <code>data/token</code>；也可以在 land-a-job 页面打开 <code>/api/bootstrap</code> 复制。
          </span>
        </label>

        <div className="opt-inline">
          <button className="btn" onClick={() => void test()}>保存并测试连接</button>
          <span className="opt-help">会先保存，再请求一次本地服务</span>
        </div>
      </section>

      <section className="opt-card">
        <div className="opt-card-head">
          <span className="opt-step">2</span>
          <div>
            <h2>抓哪些岗位</h2>
            <p className="opt-desc">
              浏览 BOSS 时，扩展把岗位类型不在勾选范围内的直接跳过，不进缓存。
              只影响之后抓到的岗位，<b>已有记录不会被删</b>。
            </p>
          </div>
        </div>

        <div className="opt-cats">
          {JOB_CATEGORIES.map((id) => {
            const on = current.captureCategories.includes(id)
            return (
              <button
                key={id}
                type="button"
                className={on ? 'opt-cat on' : 'opt-cat'}
                aria-pressed={on}
                onClick={() => toggleCategory(id)}
              >
                <span className="opt-cat-top">
                  <span className="opt-cat-box" aria-hidden>{on ? '✓' : ''}</span>
                  <span className="opt-cat-name">{CATEGORY_LABELS[id]}</span>
                </span>
                <span className="opt-cat-eg">{CATEGORY_EXAMPLES[id]}</span>
              </button>
            )
          })}
        </div>

        <p className="opt-summary">
          当前会抓：<b>{kept.join('、')}</b>
          {kept.length === JOB_CATEGORIES.length && <span className="opt-tag">等于不筛选</span>}
        </p>

        <details className="opt-details">
          <summary>怎么判断类型？</summary>
          <ul className="opt-list">
            <li><b>实习</b>：标题含「实习」或「Intern」</li>
            <li><b>校招</b>：标题含「校招」「校园」「应届」「毕业生」或「27届」这类届别</li>
            <li><b>外包</b>：标题含「外包」「驻场」「外派」「派遣」「项目顾问」，或挂在几家人力外包公司名下</li>
            <li><b>社招</b>：以上都没命中</li>
          </ul>
          <p className="opt-help">只看岗位名和公司名，不看 JD 正文；拿不准就归社招，宁可多抓。一个岗位可能同时算两类（例如外包公司的实习岗）。</p>
        </details>
      </section>

      <section className="opt-card">
        <div className="opt-card-head">
          <span className="opt-step">3</span>
          <div>
            <h2>招呼语怎么写</h2>
            <p className="opt-desc">
              本地模板，不调用任何模型。生成的只是草稿，复制发送仍然由你来点。
            </p>
          </div>
        </div>

        <label className="opt-field">
          <span className="opt-label">模板</span>
          <textarea
            value={settings.greetingTemplate}
            onChange={(e) => patch({ greetingTemplate: e.target.value })}
            rows={3}
          />
          <span className="opt-help">
            可用占位符：<code>{'{brandName}'}</code> 公司名 · <code>{'{jobName}'}</code> 岗位名 ·{' '}
            <code>{'{salaryDesc}'}</code> 薪资 · <code>{'{highlights}'}</code> 下面填的关键词
          </span>
        </label>

        <div className="opt-preview">
          <div className="opt-preview-head">
            <span>预览（示例岗位：{SAMPLE_JOB.brandName} · {SAMPLE_JOB.jobName}）</span>
            <span className={preview.length > GREETING_MAX_LENGTH ? 'opt-count over' : 'opt-count'}>
              {preview.length} / {GREETING_MAX_LENGTH}
            </span>
          </div>
          <p className="opt-preview-text">{preview || '（模板是空的）'}</p>
        </div>

        <label className="opt-field">
          <span className="opt-label">简历里确实有的关键词</span>
          <input
            type="text"
            value={highlights}
            onChange={(e) => { setHighlights(e.target.value); setNotice('') }}
            placeholder="React、TypeScript、可视化"
          />
          <span className="opt-help">
            顿号或逗号分隔，最多取前 3 个塞进 <code>{'{highlights}'}</code>。留空就不出现经历描述——这里只填简历里真有的，不编造。
          </span>
        </label>

        <div className="opt-inline">
          <button
            className="btn"
            onClick={() => patch({ greetingTemplate: DEFAULT_SETTINGS.greetingTemplate })}
          >恢复默认模板</button>
          <span className="opt-help">改完要重新「筛选并生成招呼语」，已生成的草稿不会自动改写</span>
        </div>
      </section>

      <section className="opt-card">
        <div className="opt-card-head">
          <span className="opt-step">4</span>
          <div>
            <h2>安全与节奏</h2>
            <p className="opt-desc">这两项决定扩展肯做多少事，默认都在保守一侧。</p>
          </div>
        </div>

        <label className="opt-switch">
          <input type="checkbox" checked={settings.dryRun} onChange={(e) => patch({ dryRun: e.target.checked })} />
          <span>
            <b>只出草稿，不发送</b>
            <em>打开时流水线只生成招呼语文案和预览；关掉也不会替你点发送，发送动作在 popup 里单独控制。</em>
          </span>
        </label>

        <label className="opt-switch">
          <input type="checkbox" checked={settings.autoOpenDetail} onChange={(e) => patch({ autoOpenDetail: e.target.checked })} />
          <span>
            <b>允许自动打开岗位详情</b>
            <em>会切换你正在看的页面（整页导航），但只读页面内容、不调用任何写接口。默认关闭。</em>
          </span>
        </label>

        <div className="opt-rules">
          <div className="opt-rules-title">内置节奏限制（不需要配置）</div>
          <ul className="opt-list">
            <li>两条动作间隔 1.5 秒起，带随机抖动；单批最多 10 条</li>
            <li>连续动作之间会插随机小憩，夜间不动作</li>
            <li>遇到风控提示（频繁、环境异常、今日沟通已达 120/150 位）立即停机，不自动重试</li>
          </ul>
        </div>
      </section>

      <div className="opt-savebar">
        <span className={error ? 'opt-error' : dirty ? 'opt-dirty' : 'opt-saved'}>
          {error || (dirty ? '有未保存的修改' : notice || '设置已保存')}
        </span>
        <button className="btn primary" onClick={() => void save()} disabled={!dirty && !error}>
          {dirty ? '保存修改' : '保存'}
        </button>
      </div>
    </div>
  )
}
