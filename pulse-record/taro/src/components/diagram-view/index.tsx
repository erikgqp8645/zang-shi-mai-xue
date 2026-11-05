import { useEffect, useState } from 'react'
import { Canvas, Image, Text, View } from '@tarojs/components'

import type { RecordSet } from '@domain/types'

import { OFF_CANVAS_ID, renderDiagramImage } from '../../platform/canvas'
import { previewImage } from '../../platform/preview'

import './index.scss'

/**
 * 寸关尺关系图 —— **直接显示在页面上**。
 *
 * ## 为什么不是「点按钮弹窗」
 *
 * 原来这一页上有个「寸关尺图示」按钮：点了 → 画图 → 再调 `previewImage` 弹系统预览窗。
 * 维护者 2026-11-05 定：**图直接摆在页面上**，按钮那一层去掉 —— 少一次点击，也少一个可能失败的环节。
 *
 * ## 图是怎么来的
 *
 * 仍然是**真画出来的**，不是贴一张静态图：
 *   离屏 canvas → 共享绘制器（`src/export/diagram.ts`，与网站端同一份）→ 临时文件 → `<Image>` 显示。
 * 所以图上的符号**跟着当前记录走**（改一格就重画一次）。
 *
 * ## 画哪一次
 *
 * `sessionId` 给了就画那一次（用户点了表头日期就会跟着换）；
 * 没给就画**最后一次**（与录入页「一次一屏」的默认一致）。
 *
 * ## 离屏画布放在组件里
 *
 * `<canvas id="pulse-off-canvas" type="2d">` 随组件一起挂载／卸载 ——
 * 画布只服务于这一张图，不留在页面上当孤儿。
 */

interface Props {
  /** 要画的记录（形状与网站端一致） */
  set: RecordSet
  /** 画哪一次；不给＝最后一次 */
  sessionId?: string | null
}

/** 数据变了多久之后重画（毫秒）—— 连续点格子时别一张张地画 */
const REDRAW_DELAY = 400

/** 画布节点偶尔还没就绪，重试几次 */
const MAX_ATTEMPTS = 3

export default function DiagramView({ set, sessionId }: Props) {
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  /**
   * 依赖键：只有**图上真会变的东西**变了才重画。
   * （`set` 每次渲染都是新对象，不能直接当依赖）
   */
  const key = JSON.stringify({
    layout: set.layout,
    sessionId: sessionId ?? null,
    sessions: set.sessions.map((s) => ({ id: s.id, values: s.values })),
  })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const draw = async (attempt: number) => {
      try {
        const p = await renderDiagramImage(set, sessionId ?? undefined)
        if (cancelled) return
        setPath(p)
        setError('')
        setLoading(false)
      } catch (e) {
        const msg = (e as Error)?.message || '图示出不来'
        // 画布节点偶尔还没挂好 —— 重试几次；重试仍不行才报出来
        if (attempt < MAX_ATTEMPTS && /画布节点/.test(msg)) {
          timer = setTimeout(() => void draw(attempt + 1), 300)
          return
        }
        if (cancelled) return
        setError(msg)
        setLoading(false)
      }
    }

    setLoading(true)
    timer = setTimeout(() => void draw(1), REDRAW_DELAY)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <View className='pr-diagram-view'>
      {/* 离屏画布：不显示，只用来出图 */}
      <Canvas id={OFF_CANVAS_ID} type='2d' className='pr-off-canvas' />

      {loading && !path ? <Text className='pr-note'>正在画寸关尺关系图…</Text> : null}
      {error ? <Text className='pr-note pr-err'>{error}</Text> : null}

      {path ? (
        <Image
          className='pr-diagram-img'
          src={path}
          mode='widthFix'
          onClick={() => previewImage(path)}
        />
      ) : null}

      {path ? <Text className='pr-note'>点图可放大查看。</Text> : null}
    </View>
  )
}
