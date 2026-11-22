/**
 * 把 BOSS 列表上的薪资文案解析成**月薪区间（元）**。
 *
 * 为什么要单独一个函数：暂存区存的是 `salaryDesc` 这种给人看的文案（`12-18K`、
 * `20-40K·13薪`），而 land-a-job 的 `job.salary_min/max` 存的是数字（元）。
 * 落库时没人做这层换算，服务端只能从 JD 正文里猜——BOSS 的正文通常不带薪资，
 * 于是插件入库的岗位薪资全是空的。
 *
 * 只收月薪区间。日薪/时薪（`300-500元/天`、`40元/时`）一律不换算：折算成月薪要假设
 * 出勤天数，猜出来的数字比空着更容易误导漏斗和匹配度。
 */
export function salaryRangeYuan(desc?: string | null): { min: number; max: number } | null {
  const text = String(desc ?? '').trim()
  if (!text) return null
  if (/元\s*\/\s*(天|时|小时)/.test(text)) return null

  const unitFactor = (unit: string): number | null => {
    if (!unit) return null
    if (/[Kk千]/.test(unit)) return 1000
    if (unit === '万') return 10_000
    return null
  }

  /** 单位优先取自己那一侧，缺了就借另一侧的（`15-25K` 左边没写单位） */
  const toYuan = (value: number, unit: string, siblingUnit: string): number | null => {
    const factor = unitFactor(unit) ?? unitFactor(siblingUnit)
    if (factor) return Math.round(value * factor)
    /** 没单位时只有明显是「元」才收，别把 `15-25` 当成 15 元 */
    return value >= 1000 ? Math.round(value) : null
  }

  const range = text.match(
    /(\d+(?:\.\d+)?)\s*([Kk千万]?)\s*[-~～—至]\s*(\d+(?:\.\d+)?)\s*([Kk千万]?)/,
  )
  if (range) {
    const min = toYuan(Number(range[1]), range[2] ?? '', range[4] ?? '')
    const max = toYuan(Number(range[3]), range[4] ?? '', range[2] ?? '')
    if (min === null || max === null) return null
    const lo = Math.min(min, max)
    const hi = Math.max(min, max)
    if (lo <= 0 || hi > 100_000_000) return null
    return { min: lo, max: hi }
  }

  /** 单个值：`20K`、`1.5万`；`面议` 这种没有数字的自然落到 null */
  const single = text.match(/^(\d+(?:\.\d+)?)\s*([Kk千万])/)
  if (single) {
    const value = toYuan(Number(single[1]), single[2] ?? '', '')
    if (value === null || value <= 0 || value > 100_000_000) return null
    return { min: value, max: value }
  }
  return null
}

/**
 * 每年发几个月工资：`23-45K·13薪` → 13，`25-40K·15薪` → 15。
 *
 * 只认 12–24 这个区间：BOSS 上常见 13/14/15/16 薪，低于 12 的写法基本是
 * 「12 薪以下」这类描述或别的东西（试用期比例等），当成月数会算错总包。
 */
export function salaryMonthsOf(desc?: string | null): number | null {
  const text = String(desc ?? '').trim()
  if (!text) return null
  const match = text.match(/(\d{1,2})\s*薪/)
  if (!match) return null
  const months = Number(match[1])
  if (!Number.isInteger(months) || months < 12 || months > 24) return null
  return months
}
