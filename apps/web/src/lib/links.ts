/**
 * 对外链接集中一处：官网（GitHub Pages）与仓库。
 *
 * 页面里凡是「去 GitHub 看看」「交给 Agent 安装」的入口都从这里取，
 * 换仓库地址时只改这里，不用满仓库搜字符串。
 */
export const GITHUB_URL = 'https://github.com/Dada-liu/land-a-job'
export const SITE_URL = 'https://dada-liu.github.io/land-a-job/'
/** 给 Agent 看的安装说明（纯文本，Agent 直接读这个比读 HTML 稳） */
export const AGENT_INSTALL_URL = `${SITE_URL}agent-install.md`
