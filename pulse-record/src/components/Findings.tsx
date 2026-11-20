import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RuleHit } from '../domain/rules'
import {
  CONSTITUTION_TABLE,
  FORMULA_ROUTE_ORDER,
  getStandingRules,
  type FormulaHit,
} from '../domain/formulas'
import { getDrugById, type Drug } from '../domain/drugs'
import { cellLabel } from '../domain/library-search'
import type { FormulaLink } from '../domain/formula-links'
import { addChip, removeChip, sameChips, setChip } from '../domain/library-chips.mjs'
import { useLibrary } from '../state/library'
import { DoseLines } from './DoseLines'
import { PatternStrip } from './PatternStrip'
import { hasCells } from './PatternSheet'
import { usePatterns } from '../state/patterns'
import { attribOf, STANDING_DISPLAY, type Attribution } from '../domain/grouping'

export interface SessionHit {
  sessionId: string
  sessionLabel: string
  hit: RuleHit
}

export interface SessionFormulaHit {
  sessionId: string
  sessionLabel: string
  hit: FormulaHit
}

interface Props {
  hits: SessionHit[]
  formulaHits: SessionFormulaHit[]
  onFocus: (h: SessionHit) => void
  /**
   * 点命中行的一条 → 在 ③ 用方知识库里定位到它。
   *
   * ⓘ 2026-11-20 起 ② 只列摘要、不再渲染详情；详情（脉象图／原文／方剂卡／剂量）
   *   只在 ③ 渲染一处，所以点条目必须能跳过去。
   */
  onOpenFormula?: (link: FormulaLink) => void
  /** 常驻条目（用药禁忌）显不显示 —— 与③ 用方知识库共用同一个开关（开关本身在 ③） */
  showStanding: boolean
}

const SEVERITY_LABEL: Record<RuleHit['severity'], string> = {
  high: '高危',
  warn: '提示',
  info: '参考',
}

type Tab = 'risk' | 'formula'

/** 归类标记：本脏·五行 ＋ 兼涉本脏 */
/**
 * 归类标记（五行·脏 / 兼涉脏 / 主脉位）。
 *
 * ⚠️ 没有归类时**不静默** —— 在「讲稿原序」维度下，条目按讲次排，
 *    看不出哪些还没归类 ⇒ 标一个「未分类」（2026-11-15 用户要求）。
 */
function AttrChip({
  attr,
  markUnclassified = false,
}: {
  attr: Attribution | undefined
  /** 没有归类时标一个「未分类」徽章（只在知识库里要，② 命中区不要） */
  markUnclassified?: boolean
}) {
  if (!attr) {
    if (!markUnclassified) return null
    return (
      <span className="pr-attr is-unclassified" title="这一条还没定归类 —— 点「编辑」补上">
        未分类
      </span>
    )
  }
  return (
    <span className="pr-attr" title={attr.basis}>
      <span className="pr-attr-main">
        {attr.wuxing}·{attr.zang}
      </span>
      {attr.also && attr.also.length > 0 && (
        <span className="pr-attr-also">兼{attr.also.join('')}</span>
      )}
      <span className="pr-attr-site">{attr.site}</span>
    </span>
  )
}

/** 归类依据 */
function AttrBasis({ attr }: { attr: Attribution | undefined }) {
  if (!attr) return null
  return <p className="pr-attr-basis">归类依据：{attr.basis}</p>
}

/**
 * ③ 知识库里管理员的编辑能力。
 *
 * ⚠️ ② 命中区**不传**这个 ⇒ 那边一个编辑／删除按钮都不出现。
 * ⓘ 「方名标签」（chip）的改／删走 `onFormulasChange` —— 与命令行改 `formulas[]`
 *   是同一件事、同一口径（服务端 PATCH 的 `patch: { formulas: [...] }`）。
 */
export interface LibraryTools {
  /** 改方名数组（chip 上的 ✎／✕ 走这个） */
  onFormulasChange?: (next: string[]) => void
  /** 条目级的「编辑」／「删除」按钮 */
  actions?: ReactNode
  /**
   * 打开**另一类条目**的编辑弹层（kind ＋ id）。
   *
   * ⓘ 用在「剂量对照」那几行：同和堂版成方（`dose`）与讲稿方剂（`drug`）
   *   是**两个不同的条目**，点哪一行的编辑，改的就是那一条。
   */
  onEditEntry?: (
    kind: string,
    id: string,
    name: string,
    /** 这一行剂量属于哪一条（rule）。给了就打开**那条 rule** 的编辑弹层，落在「剂量」页 */
    parent?: { kind: string; id: string },
  ) => void
}

/**
 * 方剂卡片：组成／服法／科学中药／加减／适用脉象／禁忌，全部照抄讲稿原文
 *
 * ## 两种版式（`compact`）
 *
 * · **默认** —— ② 命中区用的完整卡片，六行原文全摊开。
 * · **`compact`** —— 「用方知识库」用的紧凑一行：折叠时只留
 *   **疗法 ｜ 方名**，点开才出组成／服法／科学中药／适用脉象／加减／禁忌。
 *   （与 `FormulaItem` 的紧凑态同一套做法 —— 知识库那一段要能一眼扫完。）
 */
export function DrugCard({
  drug,
  showAttr,
  compact,
  autoOpen,
  tools,
  markUnclassified,
}: {
  drug: Drug
  showAttr?: boolean
  /** 紧凑一行：折叠时只留一行摘要，点开才看原文 */
  compact?: boolean
  /** 紧凑态默认展开（从 ③ 的方名跳进来时用，落在哪一条就展开哪一条） */
  autoOpen?: boolean
  /** ③ 知识库里的管理员工具（② 命中区不传） */
  tools?: LibraryTools
  /** 没有归类时标「未分类」（③ 知识库传 true；② 命中区不传） */
  markUnclassified?: boolean
}) {
  // 归类：条目自己选的优先，静态表兜底（2026-11-15）
  const attr = attribOf(drug.id, drug)
  const [open, setOpen] = useState(!!autoOpen)

  /** 焦点落在这一条时就展开（同 FormulaItem：初值只在挂载时读一次，得跟着变） */
  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])

  /** 原文六行 —— 两种版式共用 */
  const detail = (
    <>
      {drug.composition && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">组成</span>
          {drug.composition}
        </p>
      )}
      {drug.usage && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">服法</span>
          {drug.usage}
        </p>
      )}
      {drug.science && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">科学中药</span>
          {drug.science}
        </p>
      )}
      {drug.indication && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">适用脉象</span>
          {drug.indication}
        </p>
      )}
      {drug.adjustments && drug.adjustments.length > 0 && (
        <p className="pr-drug-line">
          <span className="pr-drug-key">加减</span>
          <span className="pr-drug-add">
            {drug.adjustments.map((a, i) => (
              <span key={i} className="pr-drug-add-item">
                · {a}
              </span>
            ))}
          </span>
        </p>
      )}
      {drug.contraindication && (
        <p className="pr-drug-line is-warn">
          <span className="pr-drug-key">禁忌</span>
          {drug.contraindication}
        </p>
      )}
      {showAttr && <AttrBasis attr={attr} />}
      <p className="pr-finding-src">〔{drug.source}〕</p>
    </>
  )

  if (compact) {
    return (
      <div className={`pr-drug pr-drug-compact${open ? ' is-open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="pr-drug-row"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="pr-formula-caret">{open ? '▾' : '▸'}</span>
          <span className="pr-drug-therapy">{drug.therapy}</span>
          <strong className="pr-drug-row-name">{drug.name}</strong>
          {/*
           * 「讲稿原序」维度下 showAttr 是 false（不显示五行·脏那一套），
           * 但**没归类的条目要标出来** —— 按讲次排时看不出哪些待补。
           */}
          {(showAttr || markUnclassified) && (
            <AttrChip attr={attr} markUnclassified={markUnclassified} />
          )}
        </button>
        {/*
          ⚠️ 工具区在 button **外面** —— button 里不能套 button
          ⓘ 展开时把它放到**原文下方**：看完「组成／服法／加减」想改，手就在同一处
            （折叠时仍贴在行下方，不占额外高度）。
        */}
        {open ? (
          <>
            <div className="pr-formula-detail">{detail}</div>
            {tools?.actions && (
              <div className="pr-formula-tools is-after">{tools.actions}</div>
            )}
          </>
        ) : (
          tools?.actions && <div className="pr-formula-tools">{tools.actions}</div>
        )}
      </div>
    )
  }

  return (
    <div className="pr-drug" onClick={(e) => e.stopPropagation()}>
      <div className="pr-drug-head">
        <span className="pr-drug-therapy">{drug.therapy}</span>
        <strong>{drug.name}</strong>
        {(showAttr || markUnclassified) && (
          <AttrChip attr={attr} markUnclassified={markUnclassified} />
        )}
      </div>
      {detail}
    </div>
  )
}

/**
 * 一条依脉用方条目
 *
 * ## 两种版式（`compact`）
 *
 * · **默认** —— ② 命中区用的完整卡片：kind 徽章 ＋ 标题 ＋ 疗法 ＋ 方名 ＋ 脉象图 ＋ 原文
 *   ＋ 方剂卡 ＋ 组成剂量 ＋ 出处，一屏一条，**带 kind 徽章**（主线／挡路／加味／禁忌）。
 * · **`compact`** —— 「用方知识库」用的紧凑一行：折叠时只留
 *   **标题 ｜ 疗法 ｜ 方名**（kind 徽章不出现），点开才出脉象图／原文／方剂卡。
 *
 * ## 为什么紧凑态不挂 kind 徽章
 *
 * 知识库里 61 条依脉用方按 route 分组（叁、用方／肆、依脉辨证论治／挡路一~六…），
 * route 标题已经把结构说清楚了，再挂一个「主线」徽章是**重复信息**，而且 61 条里
 * 有 28 条都是「主线」——最吵的那种重复。
 * ⚠️ kind 本身**没有丢**：左侧色条仍按 kind 着色（`.pr-formula.is-*`），颜色区分照旧。
 *
 * ## 内容只有一份
 *
 * 两种版式共用同一份详情区（`detail`），不各写一遍 ——
 * 「能合成一个来源的，绝不留在两处」。
 */
export function FormulaItem({
  item,
  showAttr,
  sessions,
  srcNote,
  autoOpen,
  tools,
  markUnclassified,
}: {
  item: SessionFormulaHit
  showAttr?: boolean
  /** 按维度分组时，同一条规则合并多次命中，此处列出命中的记录 */
  sessions?: string[]
  /** 出处行后面的补充说明（「用方知识库」里写「全量条目」，命中区写命中记录） */
  srcNote?: string
  /** 紧凑态默认展开（从 ③ 的方名跳进来时用，落在哪一条就展开哪一条） */
  autoOpen?: boolean
  /** ③ 知识库里的管理员工具（② 命中区不传） */
  tools?: LibraryTools
  /** 没有归类时标「未分类」（③ 知识库传 true；② 命中区不传） */
  markUnclassified?: boolean
}) {
  const { sessionLabel, hit } = item
  const attr = attribOf(hit.id, hit)
  /**
   * 这一条的脉象图是不是**只有关系注记、没有格子**（如「任意格变脉且有力」）。
   *
   * ⓘ 那种图渲染出来是一张纯文字的「关系示意」卡 —— 单独占一块很浪费版面，
   *   而且它说的本来就是条件本身 ⇒ 并入「说明」那一块（2026-11-13 用户定）。
   *   有格子的图照旧显示缩略矩阵（那是要对着摸脉核对的，不能省）。
   */
  const { patternsOf } = usePatterns()
  const myPatterns = patternsOf(hit.id, hit.patterns)
  const relationOnly = myPatterns.length > 0 && myPatterns.every((p) => !hasCells(p))
  const relationTexts = relationOnly
    ? myPatterns.flatMap((p) => (p.relations ?? []).map((r) => `${r.kind}：${r.text}`))
    : []
  const [open, setOpen] = useState(!!autoOpen)
  /** 正在**就地编辑**的方名 chip（③ 管理员用；② 命中区没有 tools ⇒ 不会进这个态） */
  const [editingChip, setEditingChip] = useState<number | null>(null)
  const [chipDraft, setChipDraft] = useState('')
  /** 正在**新增**一个方名 chip（③ 管理员用） */
  const [addingChip, setAddingChip] = useState(false)

  /**
   * 焦点落在这一条时就展开。
   *
   * ⚠️ 不能只靠 `useState(!!autoOpen)` 的初值 —— 知识库是**整块渲染**的：
   * 第一次跳转就把 61＋30 条全挂上了，那会儿 `autoOpen` 还是 false；
   * 后来焦点才移到这一条，初值不会再读一遍 ⇒ 落点是折着的。
   * 所以这里跟着 `autoOpen` 变一次就展开一次（用户自己折起来的不受影响）。
   */
  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])

  /**
   * 方名 chip 改完了 —— 交给上层落库（`patch: { formulas: [...] }`）。
   *
   * ⚠️ 改的是**方名数组**（`formulas[]`）；「添加药」（`adds[]`）在编辑弹层里改 ——
   *    两者语义不同（一个是「用哪些方」，一个是「加哪几味」），别混。
   */
  function commitChip(index: number) {
    if (editingChip !== index) return
    const next = setChip(hit.formulas, index, chipDraft)
    setEditingChip(null)
    // 文字没变（或改空了）⇒ 什么都不做 —— 别白跑一趟落库
    if (sameChips(next, hit.formulas)) return
    tools?.onFormulasChange?.(next)
  }

  /**
   * 新方名 chip 输入完了 —— 追加到数组末尾并落库。
   *
   * ⚠️ 只**追加**，不碰已有的项（`addChip` 是纯函数，空文字／重名都原样返回）。
   *    重名与空值直接早退，不白跑一趟落库。
   */
  function commitAdd() {
    if (!addingChip) return
    const next = addChip(hit.formulas, chipDraft)
    setAddingChip(false)
    setChipDraft('')
    // 判「有没有变化」要比内容（`sameChips`）—— 空值／重名时 addChip 原样返回，这里就不落库
    if (sameChips(next, hit.formulas)) return
    tools?.onFormulasChange?.(next)
  }

  /**
   * 详情区 —— 折叠时不出，点开才出。
   *
   * ⓘ 「疗法／方名」在折叠行上已经有了，这里不再重复一遍。
   */
  const detail = (
    <>
      {/*
        脉象图：紧贴方名，说明「什么脉象才用这个方」。
        ⚠️ 只有关系注记（没有格子）的那几张**不单独占一块** —— 见下面 relationOnly 的说明。
      */}
      {!relationOnly && (
        <PatternStrip formulaId={hit.id} formulaLabel={hit.condition} baseline={hit.patterns} />
      )}
      <p className="pr-formula-quote">{hit.quote}</p>
      {relationOnly && (
        <p className="pr-formula-relation">
          <span className="pr-formula-relation-key">条件示意</span>
          {relationTexts.join('；')}
        </p>
      )}
      {showAttr && <AttrBasis attr={attr} />}
      {hit.drugs && hit.drugs.length > 0 && (
        <div className="pr-drugs">
          {hit.drugs.map((id) => {
            const d = getDrugById(id)
            return d ? <DrugCard key={id} drug={d} /> : null
          })}
        </div>
      )}
      {/*
        组成与剂量：讲义 p44／p46 出头的条目多半只给了方名，
        这里按方名补上两套资料（克／比例制）；两套都没载的方名不渲染，免得满屏「未载」。
        已有讲稿方剂卡片的条目只补同和堂版（克）那一套，免得与卡片重复。
      */}
      {hit.formulas.length > 0 && (
        <div className="pr-formula-doses">
          {hit.formulas
            .filter((f) => !(hit.adds && hit.adds.includes(f)))
            .map((f) => (
              <DoseLines
                key={f}
                name={f}
                className="pr-formula-dose"
                sources={hit.drugs && hit.drugs.length > 0 ? ['th'] : ['th', 'draft']}
                skipWhenMissing
                canEdit={!!tools?.onEditEntry}
                onEdit={(k, i, n) =>
                  tools?.onEditEntry?.(k, i, n, { kind: 'rule', id: item.hit.id })
                }
              />
            ))}
        </div>
      )}
      <p className="pr-finding-src">
        〔{hit.source}〕
        {srcNote !== undefined
          ? srcNote
          : sessions && sessions.length > 0
            ? sessions[0] === STANDING_LABEL
              ? ' · 常驻条目（不依脉象）'
              : ` · 命中记录 ${sessions.join('、')}`
            : ` · 记录 ${sessionLabel}`}
      </p>
    </>
  )

  return (
      <div className={`pr-formula pr-formula-compact is-${hit.kind}${open ? ' is-open' : ''}`}>
        <button
          type="button"
          className="pr-formula-row"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="pr-formula-caret">{open ? '▾' : '▸'}</span>
          <strong className="pr-formula-row-title">{hit.condition}</strong>
          <span className="pr-formula-row-therapy" title={hit.therapy}>
            {hit.therapy}
          </span>
          {/*
           * 「讲稿原序」维度下 showAttr 是 false（不显示五行·脏那一套），
           * 但**没归类的条目要标出来** —— 按讲次排时看不出哪些待补。
           */}
          {(showAttr || markUnclassified) && (
          <AttrChip attr={attr} markUnclassified={markUnclassified} />
        )}
        </button>
        {/*
          ⚠️ 方名 chip 在 button **外面** —— chip 上有「✎／✕」按钮，
          button 里不能套 button（HTML 无效 ＋ 点击会冒泡）。
        */}
        {(hit.formulas.length > 0 || tools?.onFormulasChange) && (
          <div className="pr-formula-list-inline">
            {hit.formulas.map((f, i) => (
              <span key={`${f}-${i}`} className="pr-formula-chip">
                {editingChip === i ? (
                  <input
                    className="pr-led-chip-input"
                    value={chipDraft}
                    autoFocus
                    aria-label="改这个方名"
                    onChange={(e) => setChipDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitChip(i)
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setEditingChip(null)
                      }
                    }}
                    onBlur={() => commitChip(i)}
                  />
                ) : (
                  <>
                    {f}
                    {tools?.onFormulasChange ? (
                      <span className="pr-led-chip-ops">
                        <button
                          type="button"
                          title="改这个标签"
                          onClick={() => {
                            setEditingChip(i)
                            setChipDraft(f)
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          title="删这个标签"
                          onClick={() => tools.onFormulasChange?.(removeChip(hit.formulas, i))}
                        >
                          ✕
                        </button>
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            ))}
            {/*
              新增一个方名 chip（只有管理员看得到）。
              ⚠️ 只往 `formulas[]` 里追加一项 —— 与 ✎／✕ 同一条落库路径（覆盖层即时生效），
                不是新增一条 p44 条目（那种要判定函数，命令行也补不出来）。
            */}
            {tools?.onFormulasChange ? (
              addingChip ? (
                <span className="pr-formula-chip is-adding">
                  <input
                    className="pr-led-chip-input"
                    value={chipDraft}
                    autoFocus
                    placeholder="新方名"
                    aria-label="新方名"
                    onChange={(e) => setChipDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitAdd()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setAddingChip(false)
                        setChipDraft('')
                      }
                    }}
                    onBlur={commitAdd}
                  />
                </span>
              ) : (
                <button
                  type="button"
                  className="pr-formula-chip pr-formula-chip-add"
                  title="加一个方名"
                  onClick={() => {
                    setAddingChip(true)
                    setChipDraft('')
                  }}
                >
                  ＋ 添加
                </button>
              )
            ) : null}
          </div>
        )}
        {tools?.actions && <div className="pr-formula-tools">{tools.actions}</div>}
        {open && <div className="pr-formula-detail">{detail}</div>}
      </div>
  )
}

/**
 * ② 命中区的**一行摘要**。
 *
 * ## 为什么要这一层
 *
 * 2026-11-20 用户提出「② 和用方知识库显示重复」：同一张脉象图、同一段原文、
 * 同一张方剂卡在两处各渲染一遍。② 的职责只是「**这次命中了哪几条、用什么方**」；
 * 条目的详情（脉象图／原文／方剂卡／组成剂量／编辑入口）**只在 ③ 用方知识库渲染一处**。
 *
 * ## 两个动作
 *
 * - 点这一行 → 跳 ③ 并定位到该条（`onOpenFormula` → `FormulaLibrary.focus`）
 *
 * ⓘ 2026-11-20 用户要求「做减法」：出处行（〔讲稿 2010·第二讲…〕· 命中记录 …）、
 *    「看命中格子」链接、五行/左右手 chip 都从这一行撤掉了 —— 一行只留
 *    「kind ｜ 条目名 ｜ 命中脉位 ｜ 疗法 ｜ 方名 ｜ 在知识库看 →」。
 */
function FormulaHitRow({
  item,
  onOpenFormula,
}: {
  item: SessionFormulaHit
  /** 点整行 → 请在知识库里定位这一条 */
  onOpenFormula?: (link: FormulaLink) => void
}) {
  const { hit, sessionId } = item
  const standing = sessionId === STANDING_ID
  /** 格键 → 「右尺浮」这种人话；不认识的键原样返回（宁可难看，也不拼错） */
  const cells = hit.cells.map(cellLabel)

  return (
    <div className={`pr-formula pr-hit is-${hit.kind}`}>
      <button
        type="button"
        className="pr-hit-main"
        title="在 ③ 用方知识库看这一条的脉象图、原文与组成"
        onClick={() =>
          onOpenFormula?.({
            kind: 'rule',
            id: hit.id,
            label: hit.condition,
            basis: '② 判读提示的命中条目 —— 详情见 ③ 用方知识库',
          })
        }
      >
        <span className="pr-formula-kind">{hit.kind}</span>
        <strong className="pr-hit-title">{hit.condition}</strong>
        {/* 常驻条目不依脉象 —— 标一下，别让读者以为是这次摸出来的（2026-11-20） */}
        {standing && <span className="pr-hit-standing">常驻</span>}
        {cells.length > 0 && (
          <span className="pr-hit-cells">
            <span className="pr-hit-cells-key">命中</span>
            {cells.join('、')}
          </span>
        )}
        {hit.therapy ? (
          <span className="pr-hit-therapy" title={hit.therapy}>
            {hit.therapy}
          </span>
        ) : null}
        <span className="pr-hit-goto">在知识库看 →</span>
      </button>
      {/* 方名 chip 在 button 外面 —— 与 ③ 的紧凑行同一套做法 */}
      {hit.formulas.length > 0 && (
        <div className="pr-formula-list-inline">
          {hit.formulas.map((f, i) => (
            <span key={`${f}-${i}`} className="pr-formula-chip">
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 同一条规则被多次记录命中时合并为一条，并列出命中的记录 */
function mergeByRule(items: SessionFormulaHit[]): { item: SessionFormulaHit; sessions: string[] }[] {
  const map = new Map<string, { item: SessionFormulaHit; sessions: string[] }>()
  for (const it of items) {
    const key = it.hit.id
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { item: it, sessions: [it.sessionLabel] })
    } else if (!prev.sessions.includes(it.sessionLabel)) {
      prev.sessions.push(it.sessionLabel)
    }
  }
  return Array.from(map.values())
}

/** 常驻条目（三不用、白虎汤／肾气丸）：不依赖脉象，始终列出 */
const STANDING_LABEL = '常驻'
const STANDING_ID = '__standing__'

/**
 * 一条常驻条目 → 命中项（不依脉象，所以 `cells` 为空）。
 *
 * ⚠️ 「讲稿原序」那一节与五行／左右手分组用的是**同一个**函数 ——
 *    两处若各拼一份，出处行与显示名迟早会分叉。
 */
function standingHitOf(rule: Omit<FormulaHit, 'cells'>): SessionFormulaHit {
  return {
    sessionId: STANDING_ID,
    sessionLabel: STANDING_LABEL,
    hit: { ...rule, condition: STANDING_DISPLAY[rule.id] ?? rule.therapy, cells: [] },
  }
}


export function Findings({
  hits,
  formulaHits,
  onFocus,
  onOpenFormula,
  showStanding,
}: Props) {
  const [tab, setTab] = useState<Tab>('risk')

  /**
   * 订阅运行期生效集（基线 ⊕ 服务端覆盖层）。
   *
   * ⚠️ 只为**订阅**：管理员在 ③ 里改过／删过条目 ⇒ 生效集变了 ⇒
   *    ② 的常驻条目要跟着变。字段本身这里一个都不读。
   */
  useLibrary()

  /**
   * 依脉用方按讲稿原序（路线）分组，路线顺序依讲稿第四讲「一、二、三、四……第五、第六」。
   *
   * ⓘ 2026-11-20 用户要求「做减法」：**五行／左右手两个维度从这里撤掉**
   *    （维度切换、维度说明、筛选分组 chip、每行的出处行一起去掉）。
   *    归类维度在 ③ 用方知识库仍在（讲稿原序／按五行／按左右手三个视图），
   *    只是不再占 ② 的版面。
   */
  const grouped = useMemo(() => {
    const map = new Map<string, SessionFormulaHit[]>()
    for (const h of formulaHits) {
      const list = map.get(h.hit.route) ?? []
      list.push(h)
      map.set(h.hit.route, list)
    }
    const order = [...FORMULA_ROUTE_ORDER, ...Array.from(map.keys()).filter((k) => !FORMULA_ROUTE_ORDER.includes(k))]
    return order.filter((r) => map.has(r)).map((r) => ({ route: r, items: map.get(r)! }))
  }, [formulaHits])

  return (
    <section className="pr-panel">
      <header className="pr-panel-head">
        <h2>判读提示</h2>
        <div className="pr-tabs">
          <button
            type="button"
            className={`pr-tab${tab === 'risk' ? ' is-on' : ''}`}
            onClick={() => setTab('risk')}
          >
            风险提示 {hits.length}
          </button>
          <button
            type="button"
            className={`pr-tab${tab === 'formula' ? ' is-on' : ''}`}
            onClick={() => setTab('formula')}
          >
            依脉用方 {formulaHits.length}
          </button>
        </div>
      </header>

      {tab === 'risk' ? (
        hits.length === 0 ? (
          <p className="pr-empty">暂无命中的脉象组合。规则全部来自讲稿原文，录入后自动比对。</p>
        ) : (
          <>
            <p className="pr-target-line">按讲稿规则检查 · 点击定位到格子</p>
            <ul className="pr-findings">
              {hits.map(({ sessionId, sessionLabel, hit }) => (
                <li
                  key={`${sessionId}-${hit.id}`}
                  className={`pr-finding is-${hit.severity}`}
                  onClick={() => onFocus({ sessionId, sessionLabel, hit })}
                >
                  <div className="pr-finding-head">
                    <span className={`pr-badge is-${hit.severity}`}>{SEVERITY_LABEL[hit.severity]}</span>
                    <strong>{hit.title}</strong>
                  </div>
                  <p className="pr-finding-detail">{hit.detail}</p>
                  <p className="pr-finding-src">
                    〔{hit.source}〕· 记录 {sessionLabel}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        <>
          <p className="pr-target-line">
            讲义 p44「依脉用方」＋ p46 附表一「治疗」列，讲稿第二讲「叁、用方」「肆、依脉辨证论治」与第三~六讲方剂为补充 · 只照抄原文写明的方，不加减方
          </p>

          {/*
            内容区自己滚动，与「风险提示」那一栏同一套（`.pr-findings` 也是 460px 封顶）。
          */}
          <div className="pr-findings-scroll">
          {/*
            没有命中、又把关掉的常驻条目藏起来时，面板会空着 —— 给一句话。
            ⚠️ 原来写的是 `grouped.length === 0 && STANDING_FORMULA_RULES.length === 0`，
            后半个条件恒为 false（常驻条目恒有 2 条），所以这句话从来没出现过。
          */}
          {grouped.length === 0 && !showStanding && (
            <p className="pr-empty">
              暂无命中的用方条目（常驻条目已隐藏）。录入脉象后，按讲义 p44
              的六个方框与讲稿第四讲「清挡路一~四」自动比对。
            </p>
          )}

          {/*
            ⭐ 原来这里还有一条「总路线（流程骨架）」引导条（`FlowPath`）——
            走一遍讲义 p44 ＋ 讲稿第二/四/五/六讲的先后次序，并标出哪几步有命中。
            2026-11-20 用户要求「做减法」并确认去掉：它在手机上占 1952px，
            要先划过它才看到命中的条目；而条目本来就按讲稿原序分组排列，
            先后次序由分组标题（route）体现。
            ⚠️ 组件与数据（`components/FlowPath.tsx`、`domain/sequence.ts`）**都还在**，
               想放回来只需在这里加回一行 `<FlowPath hitRoutes={hitRoutes} />`。
          */}

          <div className="pr-formula-list">
            {grouped.map(({ route, items }) => (
                  <section key={route} className="pr-formula-group">
                    <h3 className="pr-formula-route">{route}</h3>
                    {/* 同一条规则被多次记录命中 ⇒ 合并成一行（示例数据是 6 个日期） */}
                    {mergeByRule(items).map(({ item }) => (
                      <FormulaHitRow
                        key={item.hit.id}
                        item={item}
                        onOpenFormula={onOpenFormula}
                      />
                    ))}
                  </section>
                ))}

            {showStanding && getStandingRules().length > 0 && (
              <section className="pr-formula-group">
                <h3 className="pr-formula-route">用药禁忌（常驻）</h3>
                {getStandingRules().map((rule) => (
                  <FormulaHitRow key={rule.id} item={standingHitOf(rule)} onOpenFormula={onOpenFormula} />
                ))}
              </section>
            )}
          </div>

          <section className="pr-formula-group">
            <h3 className="pr-formula-route">附表一体质用药对照（讲义 p46）</h3>
            <p className="pr-target-line">
              这一列要靠望、问、切多项合参才能定，本工具不据脉象自动判定，仅作对照参考。
            </p>
            <table className="pr-constitution">
              <thead>
                <tr>
                  <th>切</th>
                  <th>治疗</th>
                  <th>方</th>
                </tr>
              </thead>
              <tbody>
                {CONSTITUTION_TABLE.map((row) => (
                  <tr key={row.mark}>
                    <td className="pr-constitution-mark">{row.mark}</td>
                    <td>{row.therapy}</td>
                    <td className="pr-constitution-formulas">{row.formulas.join('｜')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          </div>

          {/*
            ⭐ 这里原来还有一节「方剂备查（讲稿 2010·第二讲 叁、用方）」——
            讲稿方剂 **全量 30 方**，与 ③ 用方知识库里的「讲稿方剂 30 方」
            **同一份数据、同一个全集**，只是这里用厚卡片、那里用紧凑行。
            ⇒ 同一份内容渲染两遍（2026-11-12 用户提出「判读提示和方药知识库
            是不是重复显示了」）。
            已删：讲稿方剂一律去 ③ 知识库查（那里可搜索、可点开看详情）；
            ② 命中条目本身已内嵌该条的组成／服法／加减／禁忌，判读不受影响。

            ⚠️ 同和堂版成方（原下一节「方剂备查（同和堂版《臧氏脉学方剂汇总统表》）」）
            也**已删**（2026-11-19 用户提出「它和用方知识库重复了」）：成方 49 方与科中 17 条
            在 **③ 用方知识库的「剂量对照」**、以及**用药记录里的「讲义 p42 原表对照 ·
            配伍与剂量」列**都能看到 ⇒ 一律去 ③ 查。
            ② 命中条目本身已内嵌该条的组成／服法／加减／禁忌，判读不受影响。
          */}

          {/* 同和堂版成方：三个维度都显示（它没有五行／左右手归属，不参与分组筛选） */}
        </>
      )}
    </section>
  )
}
