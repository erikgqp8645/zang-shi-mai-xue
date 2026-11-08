import { useCallback, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'

import type { PatientSummary, Patient } from '@domain/api'
import { formatAt } from '@domain/api'
import { formatCodes } from '@domain/symbols'

import { deletePatient, deleteVisit, getPatient, health, listPatients, renamePatient, savePatient, searchPatients } from '../../utils/data'
import { selectPatient } from '../../store/context'
import type { NetFailure } from '../../utils/net-error'
import Sheet from '../../components/sheet'
import NetError from '../../components/net-error'

import './index.scss'

/**
 * tab 1 · 病例 —— 患者列表
 *
 * ## 与原生版的差别（这就是 IA 重构的一部分）
 *
 * 原生版点「录入编辑」会跳到 `/pages/record/record`（又是一个页），
 * 点「看表/看图」跳到 `/pages/case-detail/case-detail`（又一个页），
 * 一趟下来 6~8 次跳页。
 *
 * 现在：
 *   · 点患者 → **切到「就诊」tab**（`switchTab`，不是跳页），上下文已选好
 *   · 「看表/看图」→ 仍去病例详情页（那里摆记录表 ＋ 寸关尺关系图，确实需要一个独立页面）
 *   · 「新建记录」→ 弹层问名字 → 建好患者直接切到就诊 tab 的「新建一次」状态
 *
 * 上下文用 `store/context.ts` 传递 —— `switchTab` 不能带 query，所以状态得先写进 store。
 */

/** 一次就诊记录的符号摘要：部位-取法 手别+符号（如「寸浮 左+」） */
function visitSummary(visit: { values?: Record<string, string[]> }): string {
  const parts: string[] = []
  const values = visit.values || {}
  Object.keys(values).forEach((key) => {
    const codes = values[key]
    if (!codes || codes.length === 0) return
    const seg = key.split('|')
    parts.push(`${seg[1]}${seg[2]} ${seg[0] === 'R' ? '右' : '左'}${formatCodes(codes)}`)
  })
  return parts.length ? parts.join('　') : '（无符号）'
}

interface VisitRow {
  id: string
  label: string
  atText: string
  summary: string
  constitution?: string | null
  therapy?: string | null
}

export default function Cases() {
  const [keyword, setKeyword] = useState('')
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [expanded, setExpanded] = useState('')
  const [detail, setDetail] = useState<Patient | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /**
   * 网络失败的**结构化诊断**（有值就渲染「网络诊断块」）
   *
   * ⚠️ 为什么要有它（2026-11-08）：
   *   真机上只显示一句「网络请求失败」，使用者既不知道连的是哪台服务器，
   *   也不知道真实原因（微信给的是 `errMsg`，旧代码读 `.message` 读不到）。
   *   → 诊断块把「结论 + 原因 + 地址 + 怎么改」一次说清，还能一键复制。
   */
  const [netError, setNetError] = useState<NetFailure | null>(null)
  const [mode, setMode] = useState('multi')
  /** 服务端探活成不成功 —— 探不到就别硬说「数据存在服务器」 */
  const [serverOk, setServerOk] = useState<boolean | null>(null)
  const [renaming, setRenaming] = useState('')
  const [renameText, setRenameText] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')

  const refresh = useCallback(async () => {
    try {
      const list = await listPatients()
      setPatients(list)
      setError('')
      setNetError(null)
    } catch (e) {
      setError((e as Error)?.message || '读取失败')
      // ⚠️ **只有传输层失败（status 0）才有结构化诊断** ——
      //    业务错误（401/404/500）显示的是服务端给的文字，不是网络问题。
      const d = (e as { detail?: NetFailure })?.detail
      setNetError(d || null)
    }
  }, [])

  useDidShow(() => {
    refresh()
    health()
      .then((h) => {
        const m = (h as { mode?: string })?.mode
        if (m) setMode(m)
        setServerOk(true)
      })
      .catch(() => {
        // ⚠️ **探不到服务端就别装作连上了** ——
        //    旧代码这里 `.catch(() => undefined)`，于是 mode 停在默认的 'multi'，
        //    界面上照样写着「数据存在服务器，按账号隔离」——
        //    **连都没连上，却跟使用者说数据在服务器上**（2026-11-08 真机截图就是这个）。
        setServerOk(false)
      })
  })

  usePullDownRefresh(() => {
    refresh().finally(() => Taro.stopPullDownRefresh())
  })

  const onInputKeyword = (text: string) => {
    setKeyword(text)
    const q = text.trim()
    if (!q) {
      refresh()
      return
    }
    searchPatients(q)
      .then((list) => setPatients(list))
      .catch(() => refresh())
  }

  const clearKeyword = () => {
    setKeyword('')
    refresh()
  }

  const loadDetail = async (id: string) => {
    setLoading(true)
    try {
      const d = await getPatient(id)
      if (!d) {
        setDetail(null)
        return
      }
      setDetail({
        ...d,
        visits: (d.visits || []).map((v) => ({
          ...v,
          atText: formatAt(v.at),
          summary: visitSummary(v),
        })),
      } as unknown as Patient)
    } catch {
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded('')
      setDetail(null)
      return
    }
    setExpanded(id)
    loadDetail(id)
  }

  const startRename = (id: string, name: string) => {
    setRenaming(id)
    setRenameText(name)
  }

  const commitRename = async () => {
    const id = renaming
    const name = renameText.trim()
    setRenaming('')
    if (!id || !name) return
    try {
      await renamePatient(id, name)
      refresh()
    } catch (e) {
      Taro.showToast({ title: (e as Error)?.message || '重命名失败', icon: 'none' })
    }
  }

  const confirmDelete = (title: string): Promise<boolean> =>
    new Promise((resolve) => {
      Taro.showModal({
        title,
        content: '删除后不可恢复。',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })

  const removePatient = async (id: string) => {
    if (!(await confirmDelete('删除该患者的全部记录？'))) return
    try {
      await deletePatient(id)
      if (expanded === id) {
        setExpanded('')
        setDetail(null)
      }
      refresh()
    } catch (e) {
      Taro.showToast({ title: (e as Error)?.message || '删除失败', icon: 'none' })
    }
  }

  const removeVisit = async (id: string) => {
    if (!(await confirmDelete('删除这次记录？'))) return
    try {
      await deleteVisit(id)
      if (expanded) loadDetail(expanded)
      refresh()
    } catch (e) {
      Taro.showToast({ title: (e as Error)?.message || '删除失败', icon: 'none' })
    }
  }

  /**
   * 去「就诊」工作台 —— **切 tab，不是跳页**。
   *
   * `switchTab` 不能带 query，所以先把上下文写进 store，再切。
   */
  const goVisit = async (id: string) => {
    try {
      const d = await getPatient(id)
      const visits = (d?.visits || []).map((v) => ({ id: v.id, label: v.label, at: v.at }))
      selectPatient(id, visits)
    } catch {
      selectPatient(id, [])
    }
    Taro.switchTab({ url: '/pages/visit/index' })
  }

  /** 看表 / 看图 —— 需要独立页面（记录表 ＋ 寸关尺关系图） */
  const goDetail = (id: string) => {
    Taro.navigateTo({ url: `/pages/case-detail/index?patientId=${encodeURIComponent(id)}` })
  }

  /** 新建患者 → 建完直接切到就诊 tab 的「新建一次」状态 */
  const createPatient = async () => {
    const name = newName.trim()
    if (!name) {
      Taro.showToast({ title: '先写个名字', icon: 'none' })
      return
    }
    try {
      const p = await savePatient({ name, layout: 'nine', visits: [] })
      if (!p) throw new Error('没建成')
      setNewOpen(false)
      setNewName('')
      selectPatient(p.id, [])
      Taro.switchTab({ url: '/pages/visit/index' })
    } catch (e) {
      Taro.showToast({ title: (e as Error)?.message || '新建失败', icon: 'none' })
    }
  }

  const detailVisits = (detail?.visits || []) as unknown as VisitRow[]

  return (
    <View className='pr-page'>
      <View className='pr-cases-head'>
        <View className='pr-cases-search'>
          <Input
            className='pr-input'
            value={keyword}
            placeholder='搜姓名 / 日期 / 符号（如 ↑）'
            confirmType='search'
            onInput={(e) => onInputKeyword(e.detail.value)}
          />
          {keyword ? (
            <View className='pr-cases-clear' onClick={clearKeyword}>
              ×
            </View>
          ) : null}
        </View>
        <View className='pr-cases-ops'>
          <Text className='pr-note'>
            {serverOk === false
              ? '连不上服务器 · 下面的红字说明了原因'
              : mode === 'single'
                ? '单机模式 · 数据只在本机'
                : '数据存在服务器，按账号隔离'}
          </Text>
          <View className='pr-btn pr-btn-sm' onClick={refresh}>
            刷新
          </View>
        </View>
      </View>

      {netError ? <NetError detail={netError} extra='病例列表读取失败' /> : null}
      {error && !netError ? <Text className='pr-note pr-err'>{error}</Text> : null}

      {!patients.length && !error && !netError ? (
        <View className='pr-empty'>还没有保存过病例。点下面的「新建记录」开始。</View>
      ) : null}

      {patients.map((item) => (
        <View key={item.id} className='pr-card'>
          <View className='pr-case-row'>
            <View className='pr-case-name'>
              {renaming !== item.id ? (
                <Text onClick={() => goDetail(item.id)}>{item.name}</Text>
              ) : (
                <Input
                  className='pr-input pr-case-rename'
                  value={renameText}
                  autoFocus
                  onInput={(e) => setRenameText(e.detail.value)}
                  onBlur={commitRename}
                  onConfirm={commitRename}
                />
              )}
            </View>
            <Text className='pr-case-meta'>
              {item.visitCount} 次 · {formatAt(item.at)}
            </Text>
          </View>

          {item.matchType === 'visit' && item.matchedVisits?.length ? (
            <View className='pr-case-badge'>
              命中：{item.matchedVisits.map((v) => v.label).join('、')}
            </View>
          ) : null}

          <View className='pr-case-ops'>
            <Text className='pr-link' onClick={() => goVisit(item.id)}>
              去就诊
            </Text>
            <Text className='pr-link' onClick={() => goDetail(item.id)}>
              看表 / 看图
            </Text>
            <Text className='pr-link' onClick={() => startRename(item.id, item.name)}>
              重命名
            </Text>
            <Text className='pr-link' onClick={() => toggleExpand(item.id)}>
              {expanded === item.id ? '收起' : '每次记录'}
            </Text>
            <Text className='pr-x' onClick={() => removePatient(item.id)}>
              ×
            </Text>
          </View>

          {expanded === item.id ? (
            <View className='pr-case-visits'>
              {loading ? <Text className='pr-note'>读取中……</Text> : null}
              {!loading && detail && !detailVisits.length ? (
                <Text className='pr-note'>（该患者还没有记录）</Text>
              ) : null}
              {detailVisits.map((v) => (
                <View key={v.id} className='pr-visit'>
                  <View className='pr-visit-head'>
                    <Text className='pr-visit-label'>{v.label || '（未命名日期）'}</Text>
                    <Text className='pr-visit-at'>{v.atText}</Text>
                  </View>
                  <Text className='pr-visit-summary'>{v.summary}</Text>
                  {v.constitution ? (
                    <Text className='pr-visit-tags'>
                      {v.constitution}体质 · {v.therapy}
                    </Text>
                  ) : null}
                  <View className='pr-case-ops'>
                    <Text className='pr-link' onClick={() => goVisit(item.id)}>
                      去就诊
                    </Text>
                    <Text className='pr-x' onClick={() => removeVisit(v.id)}>
                      ×
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}

      <View className='pr-btn pr-btn-primary pr-btn-block' onClick={() => setNewOpen(true)}>
        新建记录
      </View>

      <Sheet visible={newOpen} title='新建病例' onClose={() => setNewOpen(false)}>
        <View className='pr-label'>患者姓名</View>
        <Input
          className='pr-input'
          value={newName}
          placeholder='比如：郭丽君'
          onInput={(e) => setNewName(e.detail.value)}
        />
        <View className='pr-btn pr-btn-primary pr-btn-block pr-new-ok' onClick={createPatient}>
          建好，去就诊
        </View>
        <View className='pr-note pr-new-tip'>
          建好后会切到「就诊」页，新建一次就诊记录。
        </View>
      </Sheet>
    </View>
  )
}
