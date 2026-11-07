/**
 * 对外链接集中一处：官网（GitHub Pages）与仓库。
 *
 * 页面里凡是「去 GitHub 看看」「交给 Agent 安装」的入口都从这里取，
 * 换仓库地址时只改这里，不用满仓库搜字符串。
 *
 * 官网是中英两版：根路径 `index.html` 是英文（和 GitHub 默认展示英文保持一致），
 * 中文页在 `index.zh-CN.html`。Web 界面本身只有中文，所以界面上给出的外链
 * 一律用 `*_ZH` 这几个常量，别让中文用户点进英文页再自己找切换。
 */
export const GITHUB_URL = 'https://github.com/Dada-liu/land-a-job'
/** 官网英文首页（也是 hreflang x-default） */
export const SITE_URL = 'https://dada-liu.github.io/land-a-job/'
export const SITE_URL_ZH = `${SITE_URL}index.zh-CN.html`
/** 给 Agent 看的安装说明（纯文本，Agent 直接读这个比读 HTML 稳） */
export const AGENT_INSTALL_URL = `${SITE_URL}agent-install.md`
export const AGENT_INSTALL_URL_ZH = `${SITE_URL}agent-install.zh-CN.md`
