import { draftDoseView, thDoseView, type DoseSourceView } from '../domain/dose-lookup'

/**
 * 两套资料的组成 —— 并列显示，各自带出处与单位。
 *
 * - 同和堂版《臧氏脉学方剂汇总统表》＝成方，**克**
 * - 讲稿 2010·第二讲 ＝组成用**比例制**
 *
 * 两套**不可互相换算、也不合并**。查得就列出来，查不到就明说「未载」，
 * 不拿名字相近的方顶替，也不替读者在同名不同号的几条里选。
 */
export function DoseLines({
  name,
  className,
}: {
  /** 方名（原文用字） */
  name: string
  className?: string
}) {
  const q = name.trim()
  if (!q) return null

  const th = thDoseView(q)
  const draft = draftDoseView(q)

  return (
    <div className={`pr-dose-lines${className ? ` ${className}` : ''}`}>
      <DoseBlock label="同和堂版（克）" view={th} />
      <DoseBlock label="讲稿 2010（比例制）" view={draft} />
    </div>
  )
}

/** 一套资料的组成 */
function DoseBlock({ label, view }: { label: string; view: DoseSourceView }) {
  if (view.matched === 'none') {
    return (
      <p className="pr-dose-line is-missing">
        <span className="pr-dose-block-label">{label}</span>
        未载
      </p>
    )
  }
  /** 同名不同号：原方名里含这个名字，工具不替读者选 */
  const note =
    view.entries.length > 1
      ? `　同名不同号 ${view.entries.length} 条（原方名各不相同，工具不替你选）`
      : '　同名的一条（原方名见后）'
  /** 别名对照：用名不同，但有明确对照依据 */
  const showName = view.matched === 'contains' || view.matched === 'alias'
  return (
    <div className="pr-dose-block">
      <span className="pr-dose-block-label">
        {label}
        {view.matched === 'contains' && note}
        {view.matched === 'alias' && '　别名对照（有明确对照依据）'}
      </span>
      {view.entries.map((e) => (
        <p key={`${label}-${e.name}`} className="pr-dose-line">
          {showName && <span className="pr-dose-name">{e.name}：</span>}
          {e.composition}
          {e.science && <span className="pr-dose-science">　科中：{e.science}</span>}
          {e.usage && <span className="pr-dose-usage">　服法：{e.usage}</span>}
          <span className="pr-dose-src">〔{e.source}〕</span>
        </p>
      ))}
    </div>
  )
}
