import { draftDoseView, thDoseView, type DoseSourceView } from '../domain/dose-lookup'

/**
 * 两套资料的组成 —— 并列显示，各自带出处与单位。
 *
 * - 同和堂版《方剂汇总统表》＝成方，**克**
 * - 讲稿 2010·第二讲 ＝组成用**比例制**
 *
 * 两套**不可互相换算、也不合并**。查得就列出来，查不到就明说「未载」，
 * 不拿名字相近的方顶替，也不替读者在同名不同号的几条里选。
 */

/** 要显示哪一套 */
export type DoseSource = 'th' | 'draft'

export function DoseLines({
  name,
  className,
  sources = ['th', 'draft'],
  skipWhenMissing = false,
  onEdit,
  canEdit = false,
}: {
  /** 方名（原文用字） */
  name: string
  className?: string
  /** 显示哪几套（默认两套都显示） */
  sources?: DoseSource[]
  /** 两套都没查到时整块不渲染（用于「方名只是方名」的场合，避免满屏「未载」） */
  skipWhenMissing?: boolean
  /**
   * 管理员点「编辑」时回调 —— 参数是**具体那一条**的 kind 与 id。
   *
   * ⚠️ 只在能定位到条目时才给按钮（`entries[].id` 存在）：
   *    「未载」是查无此方，没有可编辑的对象。
   */
  onEdit?: (kind: string, id: string, name: string) => void
  /** 是否显示编辑入口（只有管理员看得到） */
  canEdit?: boolean
}) {
  const q = name.trim()
  if (!q) return null

  const th = thDoseView(q)
  const draft = draftDoseView(q)
  const wantTh = sources.includes('th')
  const wantDraft = sources.includes('draft')

  if (skipWhenMissing) {
    const anyHit = (wantTh && th.matched !== 'none') || (wantDraft && draft.matched !== 'none')
    if (!anyHit) return null
  }

  return (
    <div className={`pr-dose-lines${className ? ` ${className}` : ''}`}>
      {wantTh && <DoseBlock label="同和堂版（克）" view={th} onEdit={onEdit} canEdit={canEdit} />}
      {wantDraft && <DoseBlock label="讲稿 2010（比例制）" view={draft} onEdit={onEdit} canEdit={canEdit} />}
    </div>
  )
}

/** kind → 人话（按钮的 title 与提示用） */
function kindLabel(kind: string): string {
  return kind === 'dose' ? '同和堂版成方' : kind === 'drug' ? '讲稿方剂' : kind
}

/** 一套资料的组成 */
function DoseBlock({
  label,
  view,
  onEdit,
  canEdit,
}: {
  label: string
  view: DoseSourceView
  onEdit?: (kind: string, id: string, name: string) => void
  canEdit?: boolean
}) {
  if (view.matched === 'none') {
    return (
      <p className="pr-dose-line is-missing">
        <span className="pr-dose-block-label">{label}</span>
        未载
      </p>
    )
  }
  /** 候选（不含母方）—— 母方是**另一个方**，不算「同名不同号」 */
  const cands = view.entries.filter((e) => e.role !== 'parent')
  /** 名称里含查询词的候选：多条时不替读者选，只有一条时说清是「含」不是「同」 */
  const note =
    cands.length > 1
      ? `　同名不同号 ${cands.length} 条（原方名各不相同，工具不替你选）`
      : '　名称含此名的一条（原方名见后）'
  return (
    <div className="pr-dose-block">
      <span className="pr-dose-block-label">
        {label}
        {view.matched === 'contains' && note}
        {view.matched === 'alias' && '　别名对照（有明确对照依据）'}
      </span>
      {view.entries.map((e) => {
        /** 别名对照：用名不同，但有明确对照依据；母方是另一个方，名字一定要露出来 */
        const showName =
          view.matched === 'contains' || view.matched === 'alias' || e.role === 'parent'
        return (
          <p key={`${label}-${e.name}`} className="pr-dose-line">
            {e.role === 'parent' && <span className="pr-dose-role">母方</span>}
            {showName && <span className="pr-dose-name">{e.name}：</span>}
          {e.composition}
          {e.science && <span className="pr-dose-science">　科中：{e.science}</span>}
          {e.usage && <span className="pr-dose-usage">　服法：{e.usage}</span>}
          <span className="pr-dose-src">〔{e.source}〕</span>
            {e.basis && <span className="pr-dose-ref">　对照：{e.basis}</span>}
            {/*
              「编辑」贴着这一条自己的出处 —— 它改的是**这一条**（同和堂版成方 或 讲稿方剂），
              不是上面那个方名。查无此方（未载）时没有 id，不显示按钮。
            */}
            {canEdit && onEdit && e.id && e.kind ? (
              <button
                type="button"
                className="pr-led-btn pr-dose-edit"
                title={`编辑这一条：${e.name}（${kindLabel(e.kind)}）`}
                onClick={(ev) => {
                  ev.stopPropagation()
                  onEdit(e.kind as string, e.id as string, e.name)
                }}
              >
                编辑
              </button>
            ) : null}
          </p>
        )
      })}
    </div>
  )
}
