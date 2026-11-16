import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS } from '../../src/lib/constants.js'
import { sendToBackground } from '../../src/lib/messages.js'
import type { RuntimeResponse } from '../../src/lib/messages.js'
import type { BridgeSettings } from '../../src/lib/types.js'

export function OptionsApp() {
  const [settings, setSettings] = useState<BridgeSettings>(DEFAULT_SETTINGS)
  const [highlights, setHighlights] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void sendToBackground<RuntimeResponse>({ type: 'GET_SETTINGS' }).then((res) => {
      if (res.ok && res.settings) {
        setSettings(res.settings)
        setHighlights(res.settings.highlights.join('、'))
      }
    })
  }, [])

  function patch(next: Partial<BridgeSettings>) {
    setSettings((prev) => ({ ...prev, ...next }))
  }

  async function save() {
    setNotice('')
    setError('')
    const next: BridgeSettings = {
      ...settings,
      highlights: highlights.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean),
    }
    const res = await sendToBackground<RuntimeResponse>({ type: 'SET_SETTINGS', settings: next })
    if (res.ok) setNotice('已保存')
    else setError(res.error)
  }

  async function test() {
    setNotice('')
    setError('')
    await save()
    const res = await sendToBackground<RuntimeResponse>({ type: 'TEST_BRIDGE' })
    if (res.ok) setNotice('已保存，本地服务可达')
    else setError(res.error)
  }

  return (
    <div className="wrap" style={{ maxWidth: 620 }}>
      <h1>BOSS 桥接 · 设置</h1>
      <p className="sub">所有配置只存本机 chrome.storage.local。扩展不存任何 LLM Key，也不自动发送内容。</p>

      <label className="field">
        <span>land-a-job 服务地址</span>
        <input type="text" value={settings.apiBase} onChange={(e) => patch({ apiBase: e.target.value })} placeholder="http://127.0.0.1:4399" />
      </label>

      <label className="field">
        <span>API 令牌</span>
        <input type="password" value={settings.token} onChange={(e) => patch({ token: e.target.value })} placeholder="x-land-token" />
        <div className="hint">本机服务启动后从 data/token 读取，或在 land-a-job 页面打开 /api/bootstrap 复制。服务端 CORS 白名单需包含本扩展 ID。</div>
      </label>

      <label className="check">
        <input type="checkbox" checked={settings.dryRun} onChange={(e) => patch({ dryRun: e.target.checked })} />
        <span>dry-run（只产出草稿与预览，绝不点击发送）</span>
      </label>

      <label className="check">
        <input type="checkbox" checked={settings.autoOpenDetail} onChange={(e) => patch({ autoOpenDetail: e.target.checked })} />
        <span>允许自动打开候选详情页（页面导航，不调用写接口；默认关闭）</span>
      </label>

      <h2>招呼语模板（0 token）</h2>
      <label className="field">
        <span>可用占位符：{'{jobName}'} / {'{brandName}'} / {'{salaryDesc}'} / {'{highlights}'}</span>
        <textarea value={settings.greetingTemplate} onChange={(e) => patch({ greetingTemplate: e.target.value })} />
        <div className="hint">
          模板存在本地，改了要重新点「跑一次流水线」才会重新生成草稿（已生成的草稿不会自动改写）。
          <button
            className="btn"
            style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
            onClick={() => patch({ greetingTemplate: DEFAULT_SETTINGS.greetingTemplate })}
          >恢复默认模板</button>
        </div>
      </label>

      <label className="field">
        <span>简历里确实有的关键词（顿号或逗号分隔）</span>
        <input type="text" value={highlights} onChange={(e) => setHighlights(e.target.value)} placeholder="React、TypeScript、可视化" />
        <div className="hint">只做槽位填充，不编造经历；留空则模板里不出现经历描述。</div>
      </label>

      <div className="actions">
        <button className="btn primary" onClick={() => void save()}>保存</button>
        <button className="btn" onClick={() => void test()}>保存并测试连接</button>
      </div>
      {notice && <p className="ok">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <h2>风控口径</h2>
      <p className="hint">两条动作间隔 ≥1.5s + 抖动、单批 ≤10、每日 ≤30、单轮请求预算 500；遇到 code 9/31/37、频繁/环境异常提示或「今天已与 120/150 位 BOSS 沟通」立即熔断停机，不自动重试。</p>
    </div>
  )
}
