import { useEffect, useState } from 'react'
import { cellKey } from '../domain/types'
import { groupRows } from '../domain/layout'
import { formatCodes } from '../domain/symbols'
import {
  formatAt,
  getPatient,
  searchPatients,
  type Patient,
  type PatientSummary,
  type Visit,
} from '../api/patients'

/**
 * 病例记录面板 —— 按「患者 → 每次就诊记录」两级查看与编辑
 *
 * 存盘：本地 SQLite（pulse-record/local-data/history.sqlite），不经浏览器 localStorage。
 * - 「载入编辑」患者：把该患者的全部次记录读进上方主表（整体编辑）
 * - 「载入编辑」某次：只把这一条次记录读进主表（单次编辑），改完「保存该次记录」写回同一次
 * 展开某位患者时，按需取该患者的全部就诊记录。
 */

export interface EditingRef {
  patientId: string | null
  visitId: string | null
}

interface Props {
  patients: PatientSummary[]
  /** 主表当前正在编辑的对象 */
  editing: EditingRef | null
  /** 数据库位置（由 /api/health 带出），显示给使用者确认存在哪 */
  dbPath: string | null
  /** 服务未连通时的提示 */
  error: string | null
  /** 每次保存后自增，用来把展开的明细重新拉一遍 */
  version: number
  onLoadPatient: (id: string) => void
  onLoadVisit: (patientId: string, visitId: string) => void
  onRename: (id: string, name: string) => void
  onDeletePatient: (id: string) => void
  onDeleteVisit: (id: string) => void
  onRefresh: () => void
}

/** 一次就诊记录的符号摘要：部位-取法 手别+符号（如「寸浮 左+」「寸浮 右+」） */
function visitSummary(visit: Visit): string {
  const parts: string[] = []
  for (const [key, codes] of Object.entries(visit.values)) {
    if (!codes || codes.length === 0) continue
    const [hand, organ, depth] = key.split('|')
    parts.push(`${organ}${depth} ${hand === 'R' ? '右' : '左'}${formatCodes(codes)}`)
  }
  return parts.length ? parts.join('　') : '（无符号）'
}

/** 单次就诊记录的只读预览表（版式同讲义 p34 实例表：部位 / 取法 / 左右） */
function VisitPreview({ visit, layout }: { visit: Visit; layout: Patient['layout'] }) {
  const groups = groupRows(layout)
  return (
    <div className="pr-history-preview">
      <table className="pr-history-table">
        <thead>
          <tr>
            <th>部位</th>
            <th>取法</th>
            <th>左</th>
            <th>右</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) =>
            g.rows.map((row, i) => (
              <tr key={`${row.organ}${row.depth}`}>
                {i === 0 && (
                  <th rowSpan={g.rows.length} className="pr-history-organ">
                    {row.organ}
                  </th>
                )}
                <td className="pr-history-depth">{row.depth}</td>
                <td>{formatCodes(visit.values[cellKey('L', row.organ, row.depth)] ?? []) || '—'}</td>
                <td>{formatCodes(visit.values[cellKey('R', row.organ, row.depth)] ?? []) || '—'}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  )
}

export function HistoryPanel({
  patients,
  editing,
  dbPath,
  error,
  version,
  onLoadPatient,
  onLoadVisit,
  onRename,
  onDeletePatient,
  onDeleteVisit,
  onRefresh,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewVisit, setPreviewVisit] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  /** 搜索关键字：患者姓名、日期标签、脉象符号（如 ↑ / X）都能搜 */
  const [keyword, setKeyword] = useState('')
  /** 搜索结果；null 表示未搜索，用完整列表 */
  const [found, setFound] = useState<PatientSummary[] | null>(null)

  const kw = keyword.trim()

  /** 关键字变了就向服务端要一次搜索结果（防抖） */
  useEffect(() => {
    if (!kw) {
      setFound(null)
      return
    }
    const timer = setTimeout(() => {
      searchPatients(kw)
        .then(setFound)
        .catch(() => setFound(null))
    }, 180)
    return () => clearTimeout(timer)
  }, [kw])

  const list = found ?? patients

  /** 搜索后若原先展开的患者已被筛掉，收起明细，免得留着看不见的旧内容 */
  useEffect(() => {
    if (!expanded || !found) return
    if (!found.some((p) => p.id === expanded)) {
      setExpanded(null)
      setPreviewVisit(null)
    }
  }, [expanded, found])

  /** 展开某位患者时取其全部就诊记录；保存后（version 变化）重新拉一遍 */
  useEffect(() => {
    if (!expanded) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoading(true)
    getPatient(expanded)
      .then((p) => {
        if (!cancelled) setDetail(p)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, version])

  /**
   * 搜索时，展开的次记录清单只留命中项。
   * 仅当该患者是靠「次记录命中」被搜出来的才过滤；靠姓名命中的照常列出全部次记录。
   */
  const expandedSummary = list.find((p) => p.id === expanded) ?? null
  const filterVisits = expandedSummary?.matchType === 'visit'
  const shownVisits = detail
    ? filterVisits
      ? detail.visits.filter(
          (v) => v.label.includes(kw) || JSON.stringify(v.values).includes(kw),
        )
      : detail.visits
    : []

  function toggleExpand(id: string) {
    if (expanded === id) {
      setExpanded(null)
      setPreviewVisit(null)
      return
    }
    setExpanded(id)
    setPreviewVisit(null)
  }

  function startRename(p: PatientSummary) {
    setRenaming(p.id)
    setRenameText(p.name)
  }

  function commitRename(id: string) {
    const name = renameText.trim()
    setRenaming(null)
    if (name) onRename(id, name)
  }

  return (
    <section className="pr-history">
      <header className="pr-history-head">
        <h2>病例记录</h2>
        <span className="pr-history-search">
          <input
            type="search"
            value={keyword}
            placeholder="搜患者姓名 / 日期 / 符号（如 ↑）"
            onChange={(ev) => setKeyword(ev.target.value)}
          />
          {keyword && (
            <button type="button" className="pr-x" onClick={() => setKeyword('')} title="清空搜索">
              ×
            </button>
          )}
        </span>
        <span className="pr-muted">
          {dbPath ? `存于 ${dbPath}` : '存于服务端数据库'}
          {kw ? `　搜索「${kw}」命中 ${list.length} 位患者` : patients.length > 0 ? `　共 ${patients.length} 位患者` : ''}
        </span>
        <button type="button" className="pr-ghost" onClick={onRefresh}>
          刷新
        </button>
      </header>

      {error && <p className="pr-history-error">{error}</p>}

      {patients.length === 0 && !error && <p className="pr-muted">（还没有保存过病例）</p>}

      {kw && list.length === 0 && <p className="pr-muted">没有匹配「{kw}」的患者或就诊记录。</p>}

      {list.length > 0 && (
        <table className="pr-history-list">
          <thead>
            <tr>
              <th>患者</th>
              <th>就诊次数</th>
              <th>最近记录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={editing?.patientId === p.id ? 'is-editing' : undefined}>
                <td>
                  {renaming === p.id ? (
                    <span className="pr-inline">
                      <input
                        type="text"
                        value={renameText}
                        onChange={(ev) => setRenameText(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') commitRename(p.id)
                          if (ev.key === 'Escape') setRenaming(null)
                        }}
                      />
                      <button type="button" onClick={() => commitRename(p.id)}>
                        存
                      </button>
                      <button type="button" className="pr-x" onClick={() => setRenaming(null)}>
                        ×
                      </button>
                    </span>
                  ) : (
                    <span className="pr-history-name">
                      {p.name}
                      {editing?.patientId === p.id && <em className="pr-history-badge">　正在编辑</em>}
                      {p.matchType === 'visit' && p.matchedVisits && p.matchedVisits.length > 0 && (
                        <em className="pr-history-badge">
                        　命中：{p.matchedVisits.map((v) => v.label).join('、')}
                        </em>
                      )}
                    </span>
                  )}
                </td>
                <td>{p.visitCount} 次</td>
                <td>{formatAt(p.at)}</td>
                <td className="pr-history-ops">
                  <button type="button" className="pr-link" onClick={() => onLoadPatient(p.id)}>
                    载入编辑
                  </button>
                  <button type="button" className="pr-link" onClick={() => startRename(p)}>
                    重命名
                  </button>
                  <button type="button" className="pr-link" onClick={() => toggleExpand(p.id)}>
                    {expanded === p.id ? '收起' : '每次记录'}
                  </button>
                  <button type="button" className="pr-x" onClick={() => onDeletePatient(p.id)} title="删除该患者全部记录">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {expanded && detail && (
        <div className="pr-history-visits">
          <h3 className="pr-history-sub">
            每次就诊记录
            {filterVisits && shownVisits.length !== detail.visits.length
              ? `（只显示命中的 ${shownVisits.length} 次）`
              : ''}
          </h3>
          {loading && <p className="pr-muted">读取中……</p>}
          {!loading && detail.visits.length === 0 && <p className="pr-muted">（该患者还没有记录）</p>}
          {!loading && filterVisits && shownVisits.length === 0 && detail.visits.length > 0 && (
            <p className="pr-muted">该患者的 {detail.visits.length} 次记录里没有匹配「{kw}」的。</p>
          )}
          {!loading &&
            shownVisits.length > 0 && (
              <table className="pr-history-list">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>记录时间</th>
                    <th>脉象摘要</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {shownVisits.map((v) => (
                    <tr key={v.id} className={editing?.visitId === v.id ? 'is-editing' : undefined}>
                      <td>{v.label || '（未命名日期）'}</td>
                      <td>{formatAt(v.at)}</td>
                      <td className="pr-history-summary">{visitSummary(v)}</td>
                      <td className="pr-history-ops">
                        <button type="button" className="pr-link" onClick={() => onLoadVisit(detail.id, v.id)}>
                          载入编辑
                        </button>
                        <button
                          type="button"
                          className="pr-link"
                          onClick={() => setPreviewVisit(previewVisit === v.id ? null : v.id)}
                        >
                          {previewVisit === v.id ? '收起' : '查看'}
                        </button>
                        <button type="button" className="pr-x" onClick={() => onDeleteVisit(v.id)} title="删除这次记录">
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          {previewVisit && detail && detail.visits.some((v) => v.id === previewVisit) && (
            <VisitPreview visit={detail.visits.find((v) => v.id === previewVisit)!} layout={detail.layout} />
          )}
        </div>
      )}
    </section>
  )
}
