import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Input, ScrollView, Text, View } from '@tarojs/components'

import { groupRows } from '@domain/layout'
import { cellKey } from '@domain/types'
import type { Constitution, Depth, Hand, LayoutMode, Organ } from '@domain/types'
import { COMMON_GROUPS, SYMBOL_BY_CODE, formatCodes, parseCodes } from '@domain/symbols'
import { CONSTITUTION_OPTIONS, THERAPY_OPTIONS, therapyOf } from '@domain/triad'

import { cleanSessions, sameSessions, toCodeArray } from './shapes'
import './index.scss'

/**
 * 录入记录表 —— **录入页与病例详情页「记录表」共用同一个**
 *
 * ## 为什么要做成组件（原生版沿用这条，2026-11-05 立下）
 *
 * 当初病例详情页的「记录表」是 canvas 画的，录入页的「录入记录」是 WXML 画的 ——
 * **两套各画各的**，于是同一位患者在两个界面长得不一样。
 * 现在两处都用这个组件：**版式与交互只有一份**，不可能再走偏。
 *
 * Taro 化后这仍是唯一一份实现 —— 迁移自 `miniprogram/components/record-sheet/`，
 * **逐节点对应**，不合并、不简化版式。
 *
 * ## 版式（照抄讲义 2026-10 PDF p34「④ 脉象记录」实例表）
 *
 *   表头第一行：标签区留白（姓名框上方不画线），每个日期横跨「左＋右」两列
 *   表头第二行：姓名框横跨「部位＋取法」两列，其后是「左 / 右」
 *   正文：部位列纵向合并一组三行（组内不画横线），取法列只存在于正文
 *   表下：体质行 / 疗法行 —— **每个记录日期各记各的**
 *        （讲义原表没有这两行，是工具自己加的，**不进导出**）
 *
 * 行结构直接取自共享包 `domain/layout.ts` 的 groupRows —— 与网站端同一份代码。
 *
 * ## 对外接口
 *
 *   props:  sessions / layout / customSymbols / name / editable
 *   events: onChange(sessions)      —— 格值／体质／疗法有改动时抛出
 *           onSessionTap(id)        —— 点了表头日期（宽表高亮那一次／一次一屏换那一次）
 *
 * ## 「当前那一次」与高亮（2026-11-07）
 *
 * 维护者要的交互：**选中日期高亮 → 点「一次一屏」→ 单独编辑那一次**。
 * 于是：
 *   · 宽表里点某个日期 → `onSessionTap` → 那一列**整列高亮**（表头日期、左右格、数据格同色）
 *   · 一次一屏顶上**放大显示**这一次：日期大字 + 体质 + 疗法（点一下就地改）
 *   · 一次一屏里也有一排日期 chip，随时换到别的一次
 *
 * 组件内部只有一处推导「当前那一次」（`activeSession`），高亮、竖排、元信息全都认它。
 *
 * 组件**只管显示与交互**，落库由页面决定：
 *   · 录入页：拿到 onChange 更新本地 state，点「保存」才落库
 *   · 病例详情页：拿到 onChange **立即落库**（那里没有「保存」按钮）
 */

export interface SheetSession {
  id: string
  label?: string
  at?: number
  values?: Record<string, string[]>
  constitution?: Constitution | null
  therapy?: string | null
}

export interface CustomSymbol {
  code: string
  name: string
}

export interface RecordSheetProps {
  sessions?: SheetSession[]
  layout?: LayoutMode
  customSymbols?: CustomSymbol[]
  name?: string
  editable?: boolean
  /**
   * 录入视图：**宽表**（讲义 p34 体例）／**一次一屏**（竖排）。
   *
   * 两者是**同一个组件的两个渲染分支**，共用同一份 `values` ——
   * 不新增第二份真源，切视图不丢数据。
   */
  view?: 'wide' | 'single'
  /** 「一次一屏」下正在录的那一次（竖排只显示这一次的脉点） */
  activeSessionId?: string | null
  onChange?: (sessions: SheetSession[]) => void
  onSessionTap?: (id: string) => void
}

/** 一次就诊在某格的符号数组 */
interface SelectedCell {
  sessionId: string
  hand: Hand
  organ: Organ
  depth: Depth
}

/* -------------------------------------------------------------------------- */
/* 形状规整                                                                    */
/* -------------------------------------------------------------------------- */

/** 取一次就诊在某格的符号数组 */
function codesOf(session: SheetSession, hand: Hand, organ: Organ, depth: Depth): string[] {
  const v = session.values || {}
  return toCodeArray(v[cellKey(hand, organ, depth)])
}

/** 已选代码 → 查表对象（模板里没法调 indexOf） */
function toSet(codes: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  codes.forEach((c) => {
    out[c] = true
  })
  return out
}

/** 符号面板：讲义 p48–50 记录表表头的三组「常用脉象」 */
function buildPalette() {
  return COMMON_GROUPS.map((g) => ({
    title: g.title,
    items: g.codes.map((code) => {
      const def = SYMBOL_BY_CODE[code]
      return { code, label: (def && def.label) || code }
    }),
  }))
}

/* -------------------------------------------------------------------------- */
/* 组件                                                                        */
/* -------------------------------------------------------------------------- */

export default function RecordSheet(props: RecordSheetProps) {
  const {
    sessions: propsSessions,
    layout = 'nine',
    customSymbols = [],
    name = '',
    editable = true,
    view = 'wide',
    activeSessionId = null,
    onChange,
    onSessionTap,
  } = props

  /** 组件持有的 sessions —— 编辑就改这里，改完通过 onChange 抛给页面 */
  const [sessions, setSessions] = useState<SheetSession[]>(() => cleanSessions(propsSessions))

  /**
   * 父组件带来的 sessions 变了才同步。
   *
   * 为什么要比内容而不是比引用：父组件每次 render 都新建数组的话，
   * 「只在引用变了才 setState」会把用户正在输入的手输组合冲掉。
   * 比内容则安全：内容没变就保留本地编辑，内容真变了才跟随。
   */
  useEffect(() => {
    const incoming = cleanSessions(propsSessions)
    setSessions((prev) => (sameSessions(prev, incoming) ? prev : incoming))
  }, [propsSessions])

  const [selected, setSelected] = useState<SelectedCell | null>(null)
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [manualText, setManualText] = useState('')
  const [editingConstitution, setEditingConstitution] = useState('')
  const [editingTherapy, setEditingTherapy] = useState('')

  const paletteGroups = useMemo(() => buildPalette(), [])
  const selectedSet = useMemo(() => toSet(selectedCodes), [selectedCodes])

  /* --------------------------- 渲染结构（按部位分组） --------------------------- */

  /**
   * 当前那一次 —— **表格里选中的那次**；没选就落最后一次。
   *
   * 「选中列高亮」「一次一屏只摊开这一次」「体质/疗法记在哪一次」全都认它，
   * 一处推导，几处用，不会各说各话。
   */
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || sessions[sessions.length - 1] || null,
    [sessions, activeSessionId],
  )

  /** 当前那次的序号（第几次 / 共几次） */
  const activeIndex = useMemo(
    () => (activeSession ? sessions.findIndex((s) => s.id === activeSession.id) : -1),
    [sessions, activeSession],
  )

  /** 选中的那次 id —— 高亮与「这一次」都以它为准 */
  const activeId = activeSession ? activeSession.id : ''

  const groups = useMemo(
    () =>
      groupRows(layout).map((g) => ({
        organ: g.organ,
        rows: g.rows.map((row) => ({
          organ: row.organ,
          depth: row.depth,
          cells: sessions.map((s) => ({
            sessionId: s.id,
            on: s.id === activeId,
            L: formatCodes(codesOf(s, 'L', row.organ, row.depth)),
            R: formatCodes(codesOf(s, 'R', row.organ, row.depth)),
          })),
        })),
      })),
    [sessions, layout, activeId],
  )

  const headSessions = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.id,
        label: s.label || '',
        constitution: s.constitution || '',
        therapy: s.therapy || '',
        on: s.id === activeId,
      })),
    [sessions, activeId],
  )

  /**
   * 「一次一屏」的竖排行 —— **只列正在录的那一次**
   *
   * 宽表在 750rpx 屏上只放得下约 3.7 个日期列，格子小到点不准；
   * 竖排把一次就诊的 7（或 9）个脉点摊成 7（或 9）行，手指能点。
   * 数据仍然是同一份 `values` —— 改哪一格都是同一格。
   */
  const singleRows = useMemo(() => {
    const active = activeSession
    return groupRows(layout).flatMap((g) =>
      g.rows.map((row) => ({
        organ: row.organ,
        depth: row.depth,
        sessionId: active ? active.id : '',
        L: active ? formatCodes(codesOf(active, 'L', row.organ, row.depth)) : '',
        R: active ? formatCodes(codesOf(active, 'R', row.organ, row.depth)) : '',
      })),
    )
  }, [activeSession, layout])

  /* --------------------------- 表格交互 --------------------------- */

  /** 点一个格子 → 选中它，弹出符号面板 */
  const onCellTap = useCallback(
    (sessionId: string, hand: Hand, organ: Organ, depth: Depth) => {
      if (!editable) return
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return
      const codes = codesOf(session, hand, organ, depth)
      setSelected({ sessionId, hand, organ, depth })
      setSelectedCodes(codes.slice())
      setManualText(formatCodes(codes))
      setEditingConstitution('')
      setEditingTherapy('')
    },
    [editable, sessions],
  )

  /** 关闭符号面板 */
  const closePalette = useCallback(() => {
    setSelected(null)
    setSelectedCodes([])
    setManualText('')
  }, [])

  /**
   * 把符号写回当前格。
   *
   * 只改本地 state，**不落库** —— 落库由页面决定（录入页等「保存」，
   * 病例详情页收到 onChange 后立即存）。
   */
  const applyCodes = useCallback(
    (codes: string[]) => {
      if (!selected) return
      // 先把整份规整（格值都还原成数组），再改这一格 ——
      // 否则上一轮留下的 {"0":"X"} 会被原样带出去、存进数据库。
      const next = cleanSessions(sessions).map((s) => {
        if (s.id !== selected.sessionId) return s
        const values = { ...s.values }
        const key = cellKey(selected.hand, selected.organ, selected.depth)
        if (!codes.length) delete values[key]
        else values[key] = codes.slice()
        return { ...s, values }
      })
      setSessions(next)
      onChange?.(next)
    },
    [selected, sessions, onChange],
  )

  /** 点一个符号 → 在当前格里加/去这个符号 */
  const toggleSymbol = useCallback(
    (code: string) => {
      const codes = selectedCodes.slice()
      const i = codes.indexOf(code)
      if (i >= 0) codes.splice(i, 1)
      else codes.push(code)
      setSelectedCodes(codes)
      setManualText(formatCodes(codes))
      applyCodes(codes)
    },
    [selectedCodes, applyCodes],
  )

  /** 手输组合 */
  const onManualInput = useCallback(
    (text: string) => {
      const codes = parseCodes(text, customSymbols.map((s) => s.code))
      setManualText(text)
      setSelectedCodes(codes)
      applyCodes(codes)
    },
    [customSymbols, applyCodes],
  )

  /** 清空本格 */
  const clearCell = useCallback(() => {
    setSelectedCodes([])
    setManualText('')
    applyCodes([])
  }, [applyCodes])

  /** 点表头日期 → 设为当前列（与网站一致：图示、① 框都跟着这一列） */
  const onHeadTap = useCallback(
    (id: string) => {
      onSessionTap?.(id)
    },
    [onSessionTap],
  )

  /* --------------------------- 体质 / 疗法 --------------------------- */

  const onConstitutionTap = useCallback(
    (id: string) => {
      if (!editable) return
      setEditingConstitution(id)
      setEditingTherapy('')
    },
    [editable],
  )

  const onTherapyTap = useCallback(
    (id: string) => {
      if (!editable) return
      setEditingTherapy(id)
      setEditingConstitution('')
    },
    [editable],
  )

  /** 选体质 → 按讲义 p47 图上的配对带出疗法（仍可改） */
  const pickConstitution = useCallback(
    (sessionId: string, id: Constitution) => {
      const therapy = therapyOf(id)
      const next = cleanSessions(sessions).map((s) =>
        s.id === sessionId ? { ...s, constitution: id, therapy } : s,
      )
      setSessions(next)
      setEditingConstitution('')
      onChange?.(next)
    },
    [sessions, onChange],
  )

  const clearConstitution = useCallback(
    (sessionId: string) => {
      const next = cleanSessions(sessions).map((s) =>
        s.id === sessionId ? { ...s, constitution: null, therapy: null } : s,
      )
      setSessions(next)
      setEditingConstitution('')
      onChange?.(next)
    },
    [sessions, onChange],
  )

  const pickTherapy = useCallback(
    (sessionId: string, id: string) => {
      const next = cleanSessions(sessions).map((s) => (s.id === sessionId ? { ...s, therapy: id } : s))
      setSessions(next)
      setEditingTherapy('')
      onChange?.(next)
    },
    [sessions, onChange],
  )

  /* ------------------------------- 渲染 ------------------------------- */

  return (
    <View className='pr-sheet-root'>
      {/* ---------- 主表：宽表（讲义体例）／ 一次一屏（竖排） ---------- */}
      {view === 'wide' ? (
        <ScrollView scrollX className='pr-table-scroll' showScrollbar={false}>
        <View className='pr-table'>
          {/* 表头第一行：标签区留白；日期横跨「左＋右」两列 */}
          <View className='pr-thead'>
            <View className='pr-thead-lead'>
              <View className='pr-thead-blank' />
              <View className='pr-thead-name'>{name || '姓名'}</View>
            </View>
            <View className='pr-thead-cols'>
              <View className='pr-thead-dates'>
                {headSessions.map((s) => (
                  <View
                    key={s.id}
                    className={`pr-thead-date ${s.on ? 'is-on' : ''}`}
                    onClick={() => onHeadTap(s.id)}
                  >
                    {s.label}
                  </View>
                ))}
              </View>
              {/* 表头第二行：「左 / 右」。
                  **平铺的 84rpx 格，不套容器** —— 与正文的数据格同构，列界必然对齐
                  （2026-11-07 修「竖线逐列错开」，详见 index.scss 的说明）。 */}
              <View className='pr-thead-hands'>
                {headSessions.map((s) => (
                  <Fragment key={s.id}>
                    <View
                      className={`pr-thead-hand is-l ${s.on ? 'is-on' : ''}`}
                      onClick={() => onHeadTap(s.id)}
                    >
                      左
                    </View>
                    <View
                      className={`pr-thead-hand is-r ${s.on ? 'is-on' : ''}`}
                      onClick={() => onHeadTap(s.id)}
                    >
                      右
                    </View>
                  </Fragment>
                ))}
              </View>
            </View>
          </View>

          {/* 正文：部位列纵向合并一组三行，组内不画横线 */}
          <View className='pr-tbody'>
            {groups.map((g) => (
              <View key={g.organ} className='pr-grp'>
                <View className='pr-organ'>{g.organ}</View>
                <View className='pr-grp-rows'>
                  {g.rows.map((row) => (
                    <View key={row.depth} className='pr-row'>
                      <View className='pr-depth'>{row.depth}</View>
                      <View className='pr-cells'>
                        {row.cells.map((c) => (
                          <Fragment key={`${c.sessionId}-${row.organ}-${row.depth}`}>
                            <View
                              className={`pr-cell ${c.on ? 'is-on' : ''}`}
                              onClick={() => onCellTap(c.sessionId, 'L', row.organ, row.depth)}
                            >
                              {c.L}
                            </View>
                            <View
                              className={`pr-cell ${c.on ? 'is-on' : ''}`}
                              onClick={() => onCellTap(c.sessionId, 'R', row.organ, row.depth)}
                            >
                              {c.R}
                            </View>
                          </Fragment>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>

          {/* 表下：体质行 / 疗法行（每个记录日期各记各的；讲义原表没有这两行，不进导出）
              标签与值同行 —— lead 第 1 行是「体质」、第 2 行是「疗法」，
              值那边第 1 行是体质值、第 2 行是疗法值（2026-11-07 修「标签错行」）。 */}
          <View className='pr-tfoot'>
            <View className='pr-tfoot-lead'>
              <View className='pr-tfoot-label'>体质</View>
              <View className='pr-tfoot-label'>疗法</View>
            </View>
            <View className='pr-tfoot-cols'>
              <View className='pr-tfoot-row'>
                {headSessions.map((s) => (
                  <View
                    key={s.id}
                    className={`pr-tfoot-cell ${s.on ? 'is-on' : ''}`}
                    onClick={() => onConstitutionTap(s.id)}
                  >
                    {s.constitution || '（未判）'}
                  </View>
                ))}
              </View>
              <View className='pr-tfoot-row'>
                {headSessions.map((s) => (
                  <View
                    key={s.id}
                    className={`pr-tfoot-cell ${s.on ? 'is-on' : ''}`}
                    onClick={() => onTherapyTap(s.id)}
                  >
                    {s.therapy || '（未定）'}
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>
        </ScrollView>
      ) : (
        /* ---------- 一次一屏：竖排摊开这一次就诊的每个脉点 ---------- */
        <View className='pr-single-wrap'>
          {/* ---------- 「这一次」的头 —— 把选中的那次放大显示出来 ----------
              2026-11-07 维护者要的：一次一屏编辑时要看得见**日期、体质**，
              目的是「把选中的日期拿出来放大显示，方便编辑」。
              体质／疗法直接点一下就能改 —— 复用的是宽表那两个弹层，改的还是同一次。 */}
          <View className='pr-single-head'>
            <View className='pr-single-head-top'>
              <View className='pr-single-date'>{activeSession?.label || '（还没选日期）'}</View>
              <View className='pr-single-count'>
                {activeIndex >= 0 ? `第 ${activeIndex + 1} 次／共 ${sessions.length} 次` : ''}
              </View>
            </View>
            <View className='pr-single-meta'>
              <View
                className='pr-single-item'
                onClick={() => activeSession && onConstitutionTap(activeSession.id)}
              >
                <Text className='pr-single-item-k'>体质</Text>
                <Text className='pr-single-item-v'>{activeSession?.constitution || '（未判）'}</Text>
              </View>
              <View
                className='pr-single-item'
                onClick={() => activeSession && onTherapyTap(activeSession.id)}
              >
                <Text className='pr-single-item-k'>疗法</Text>
                <Text className='pr-single-item-v'>{activeSession?.therapy || '（未定）'}</Text>
              </View>
            </View>
            <Text className='pr-note'>上面「体质」「疗法」点一下就能改 —— 只改这一次。</Text>
          </View>

          {/* 换一次：日期一排，选中的高亮 —— 与宽表同一套「选中日期」的心智 */}
          <ScrollView scrollX className='pr-single-dates' showScrollbar={false}>
            {headSessions.map((s) => (
              <View
                key={s.id}
                className={`pr-single-chip ${s.on ? 'is-on' : ''}`}
                onClick={() => onHeadTap(s.id)}
              >
                {s.label}
              </View>
            ))}
          </ScrollView>

          <View className='pr-single'>
            {singleRows.map((row) => (
              <View key={`${row.organ}-${row.depth}`} className='pr-single-row'>
                <View className='pr-single-label'>
                  <Text className='pr-single-organ'>{row.organ}</Text>
                  <Text className='pr-single-depth'>{row.depth}</Text>
                </View>
                <View
                  className='pr-single-slot'
                  onClick={() => onCellTap(row.sessionId, 'L', row.organ, row.depth)}
                >
                  <Text className='pr-single-hand'>左</Text>
                  <Text className='pr-single-val'>{row.L}</Text>
                </View>
                <View
                  className='pr-single-slot'
                  onClick={() => onCellTap(row.sessionId, 'R', row.organ, row.depth)}
                >
                  <Text className='pr-single-hand'>右</Text>
                  <Text className='pr-single-val'>{row.R}</Text>
                </View>
              </View>
            ))}
            {!singleRows.length ? (
              <View className='pr-empty'>还没有记录 —— 先在下面「＋ 记录」加一次就诊。</View>
            ) : null}
          </View>
        </View>
      )}

      {/* ---------- 体质选择 ---------- */}
      {editingConstitution ? (
        <View className='pr-mask' onClick={() => onConstitutionTap(editingConstitution)}>
          <View className='pr-dialog' onClick={(e) => e.stopPropagation()}>
            <View className='pr-dialog-title'>选这次的体质（① 判体质）</View>
            <View className='pr-note'>
              体质的判定由你自己判断后手工选定，工具不代判。选后会按讲义 p47 图上的配对带出疗法，疗法仍可改。
            </View>
            {CONSTITUTION_OPTIONS.map((item) => (
              <View
                key={item.id}
                className='pr-dialog-item'
                onClick={() => pickConstitution(editingConstitution, item.id)}
              >
                <View className='pr-dialog-item-title'>{item.label}</View>
                <View className='pr-note'>{item.path}</View>
                {item.stateHint ? <View className='pr-note'>状态佐证：{item.stateHint}</View> : null}
                <View className='pr-note'>〔{item.source}〕</View>
              </View>
            ))}
            <View
              className='pr-dialog-item pr-dialog-clear'
              onClick={() => clearConstitution(editingConstitution)}
            >
              清除这次的体质
            </View>
          </View>
        </View>
      ) : null}

      {/* ---------- 疗法选择 ---------- */}
      {editingTherapy ? (
        <View className='pr-mask' onClick={() => onTherapyTap(editingTherapy)}>
          <View className='pr-dialog' onClick={(e) => e.stopPropagation()}>
            <View className='pr-dialog-title'>选这次的疗法（② 定疗法）</View>
            {THERAPY_OPTIONS.map((item) => (
              <View
                key={item.id}
                className='pr-dialog-item'
                onClick={() => pickTherapy(editingTherapy, item.id)}
              >
                <View className='pr-dialog-item-title'>{item.label}</View>
                {item.prescriptions.map((p) => (
                  <View key={p.no} className='pr-note'>
                    {p.no}. {p.name}
                  </View>
                ))}
                <View className='pr-note'>〔{item.source}〕</View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* ---------- 符号录入面板 ---------- */}
      {selected ? (
        <View className='pr-mask' onClick={closePalette}>
          <View className='pr-sheet' onClick={(e) => e.stopPropagation()}>
            <View className='pr-sheet-head'>
              <View>当前格：{(selected.hand === 'R' ? '右' : '左') + selected.organ + selected.depth}</View>
              <View className='pr-x' onClick={closePalette}>
                ×
              </View>
            </View>

            <ScrollView scrollY className='pr-sheet-body'>
              {paletteGroups.map((g) => (
                <View key={g.title} className='pr-pal-grp'>
                  <View className='pr-pal-title'>常用脉象 {g.title}</View>
                  <View className='pr-pal-btns'>
                    {g.items.map((item) => (
                      <View
                        key={item.code}
                        className={`pr-sym ${selectedSet[item.code] ? 'is-on' : ''}`}
                        onClick={() => toggleSymbol(item.code)}
                      >
                        <Text className='pr-sym-code'>{item.code}</Text>
                        <Text className='pr-sym-label'>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}

              {customSymbols.length ? (
                <View className='pr-pal-grp'>
                  <View className='pr-pal-title'>自定义符号（自建，如 涩＝S）</View>
                  <View className='pr-pal-btns'>
                    {customSymbols.map((item) => (
                      <View
                        key={item.code}
                        className={`pr-sym ${selectedSet[item.code] ? 'is-on' : ''}`}
                        onClick={() => toggleSymbol(item.code)}
                      >
                        <Text className='pr-sym-code'>{item.code}</Text>
                        <Text className='pr-sym-label'>{item.name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View className='pr-manual'>
                <View className='pr-label'>手输组合（如 X↑ / 0+# / ++）</View>
                <Input className='pr-input' value={manualText} onInput={(e) => onManualInput(e.detail.value)} />
                <View className='pr-btn pr-btn-sm pr-manual-clear' onClick={clearCell}>
                  清空本格
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  )
}
