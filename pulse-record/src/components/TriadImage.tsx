import { useEffect, useState } from 'react'
import triadUrl from '../assets/triad-p47.png'

/**
 * 开方三部曲 · 原图（页面最顶端）
 *
 * 图源：讲义 2026-10 PDF p47（印刷页码 45）里的第二张图「臧氏脉学 开方三部曲」
 *       （同页第一张是符号对照表，取图时务必逐张比对，别只取最大的那张）。
 *
 * 原图从 PDF 的图像层取出后转白底（源数据是带透明通道的位图，
 * 直接转 RGB 会把透明处变成黑底）。
 *
 * 这张图是整套工具的总纲：①判体质 → ②定疗法 → ③开方药，③ 有一条虚线回路回到 ①。
 * 下面三个框就是照它分的。
 *
 * 手机上字小，所以整图可点开放大看。
 */

export function TriadImage() {
  const [zoom, setZoom] = useState(false)

  // 放大时按 Esc 关闭
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  return (
    <figure className="pr-triad-fig">
      <button
        type="button"
        className="pr-triad-fig-btn"
        onClick={() => setZoom(true)}
        title="点开放大看"
      >
        <img
          src={triadUrl}
          alt="臧氏脉学 开方三部曲：①判体质 → ②定疗法 → ③开方药，③ 有一条虚线回路回到 ①"
        />
      </button>
      <figcaption className="pr-triad-fig-cap">
        讲义 2026-10·p47（印刷 45）「臧氏脉学 开方三部曲」· 点图可放大
      </figcaption>

      {zoom && (
        <div
          className="pr-triad-zoom"
          role="dialog"
          aria-label="开方三部曲 原图"
          onClick={() => setZoom(false)}
        >
          <img src={triadUrl} alt="臧氏脉学 开方三部曲（原图放大）" />
          <button type="button" className="pr-triad-zoom-close" onClick={() => setZoom(false)}>
            ×
          </button>
        </div>
      )}
    </figure>
  )
}
