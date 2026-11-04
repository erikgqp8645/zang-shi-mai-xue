/**
 * 统一下载入口 —— Web 端与桌面端共用一个
 *
 * 以前有两处各写一遍 blob 下载（src/export/png.ts 与 src/App.tsx）：
 *   `URL.createObjectURL` ＋ `<a download>` ＋ `a.click()`
 * 桌面版里这种写法会把文件甩进「下载」目录、用户找不到位置，
 * 所以现在收成一处：
 *
 * 1. 桌面版（有 `window.__pulseDesktop`）→ 走系统「另存为」对话框
 * 2. Web 端／小程序端 → **原样保留**原来的 `<a download>` 行为（逐字节不变）
 */

/** 桌面版桥接层的返回 */
export interface DownloadResult {
  ok: boolean
  /** 桌面版：最终落盘路径 */
  path?: string
  /** 用户取消了对话框 */
  canceled?: boolean
  error?: string
}

/** blob → base64（主进程要的是 base64，好直接 writeFileSync） */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // 分块转，避免大文件一次 apply 参数过多炸栈
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * 下载一个文件。
 *
 * @param filename 建议文件名
 * @param blob     文件内容
 */
export async function downloadBlob(filename: string, blob: Blob): Promise<DownloadResult> {
  const bridge = typeof window === 'undefined' ? undefined : window.__pulseDesktop
  if (bridge) {
    try {
      const base64 = await blobToBase64(blob)
      return await bridge.saveBlob(base64, filename)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  }

  // Web 兜底：浏览器下载（原行为）
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { ok: true }
}
