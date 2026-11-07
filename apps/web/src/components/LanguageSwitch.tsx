import { useI18n, type Locale } from '../i18n'

/**
 * 语言切换。刻意写「中文 / EN」而不是 `LOCALE_NAMES` 里的全称：
 * 顶栏只有 56px 高，English 这个词会把右侧撑开一截；而切换器本身不该被翻译——
 * 你永远要能用「自己看得懂的那个词」切回来。
 *
 * 用同尺寸双段按钮而不是下拉：只有两个选项，一次点击就能切，少一次交互。
 */
const SHORT: Record<Locale, string> = { zh: '中文', en: 'EN' }

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <div
      data-testid="language-switch"
      className="inline-flex shrink-0 items-center rounded-full border border-stone-200 bg-white p-0.5"
      role="group"
      aria-label={t('切换界面语言')}
    >
      {(['zh', 'en'] as const).map((item) => {
        const active = item === locale
        return (
          <button
            key={item}
            type="button"
            data-testid={`language-${item}`}
            aria-pressed={active}
            onClick={() => setLocale(item)}
            className={[
              'rounded-full py-0.5 text-[11px] transition-colors',
              compact ? 'px-1.5' : 'px-2.5',
              active
                ? 'bg-stone-900 font-medium text-white'
                : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900',
            ].join(' ')}
          >
            {SHORT[item]}
          </button>
        )
      })}
    </div>
  )
}
