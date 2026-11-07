/**
 * 英文字典。按页面/领域拆成片段，避免一个两千行的文件和别人的改动互相冲突。
 * 加片段要在这里登记一次；key 是中文原文，必须与代码里 t('...') 的实参逐字一致。
 *
 * 校验：`npm run check:i18n`
 *  - 扫出字典里存在但代码已不再使用的 key（改名后忘了同步）
 *  - 扫出源码里 t('...') 的实参在字典中缺失（漏译）
 */
import common from './common'
import nav from './nav'
import dashboard from './dashboard'
import jobs from './jobs'
import pipeline from './pipeline'
import interviews from './interviews'
import offers from './offers'
import resumes from './resumes'
import data from './data'
import ui from './ui'
import type { Dict } from '..'

export const EN: Dict = {
  ...common,
  ...nav,
  ...dashboard,
  ...jobs,
  ...pipeline,
  ...interviews,
  ...offers,
  ...resumes,
  ...data,
  ...ui,
}
