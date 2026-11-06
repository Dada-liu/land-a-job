/* Land a Job · 官网站点脚本
   只做三件小事：复制代码块、切换使用方式的三张面板、把构建信息填进页脚。
   没有框架、没有依赖，Pages 上就是一个静态文件。 */

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // file:// 或没给剪贴板权限时退回到 textarea + execCommand
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  }
}

const flash = (button) => {
  const label = button.textContent
  button.textContent = '已复制'
  button.classList.add('is-done')
  window.setTimeout(() => {
    button.textContent = label
    button.classList.remove('is-done')
  }, 1600)
}

for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    // 优先复制按钮所在卡片里的 <pre>；这就是用户看到的命令，不做二次拼装
    const scope = button.closest('.prompt-card') ?? button.closest('.code-line') ?? document
    const source = scope.querySelector('pre code') ?? scope.querySelector('pre')
    if (!source) return
    if (await copyText(source.textContent.trim())) flash(button)
  })
}

/* ---------- 使用方式：三张面板 ---------- */

const tabs = [...document.querySelectorAll('.tab')]
const panels = [...document.querySelectorAll('.panel')]

const activate = (index) => {
  tabs.forEach((tab, i) => {
    const on = i === index
    tab.classList.toggle('is-active', on)
    tab.setAttribute('aria-selected', String(on))
    tab.tabIndex = on ? 0 : -1
  })
  panels.forEach((panel, i) => {
    const on = i === index
    panel.classList.toggle('is-active', on)
    panel.hidden = !on
  })
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activate(index))
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const next = (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
    activate(next)
    tabs[next].focus()
  })
})

/* ---------- 页脚：构建信息 ---------- */

const year = document.getElementById('year')
if (year) year.textContent = String(new Date().getFullYear())

const buildInfo = document.getElementById('build-info')
if (buildInfo) {
  fetch('build.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no build.json'))))
    .then((info) => {
      const parts = []
      if (info.sha) parts.push(`构建 ${info.sha}`)
      if (info.pages) parts.push(info.pages)
      if (info.builtAt) parts.push(new Date(info.builtAt).toISOString().slice(0, 16).replace('T', ' '))
      buildInfo.textContent = parts.length > 0 ? parts.join(' · ') : '本地预览'
    })
    .catch(() => {
      buildInfo.textContent = '本地预览'
    })
}
