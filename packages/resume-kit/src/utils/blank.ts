/**
 * 「这条内容到底有没有东西」。
 *
 * 编辑器允许先点「添加」再慢慢填，Agent 也可能写出只带 id 的空条目；
 * 模板渲染前用它筛一遍，否则简历上会留下空白的条目块、甚至一个空的灰标签。
 * 只认字符串与字符串数组：模板里展示的就是这些字段，
 * 不参与展示的字段（比如项目的 role）就算有值也视为空。
 */
export function hasContent(...values: Array<string | string[] | undefined | null>): boolean {
  return values.some((value) => {
    if (Array.isArray(value)) return value.some((item) => item.trim() !== '')
    return typeof value === 'string' && value.trim() !== ''
  })
}
