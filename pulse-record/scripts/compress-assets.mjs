#!/usr/bin/env node
/**
 * 底图压缩 —— 把 `src/assets/hands-pulse.png` 转成同尺寸 JPEG，压到 200 KB 以内。
 *
 * ## 为什么要有这个脚本（2026-11-05）
 *
 * 微信开发者工具「代码质量 → 代码包 → 图片和音频资源大小不应超过 200 K」这一条
 * **未通过**，根因就是底图 298 KB（305 137 B）。
 *
 * 官方规则原文（微信开放文档「性能扫描 / 代码质量」）：
 * > 图片和音频资源大小超过 200 K【建议】小程序代码包里可以存放一些必要的静态资源
 * > （例如 tabbar 的 icon 等），但其他非必要的静态资源体积过大会影响小程序代码包加载速度。
 *
 * ## 为什么是 JPEG 而不是「把 PNG 压小」
 *
 * 底图是**真人手部照片 ＋ 印刷标注**（1070 × 876，RGB）。实测过几条路
 * （体积都是**正确喂 RGBA** 量出来的，别拿斜切废图的数据当参考 —— 见「坑一」）：
 *
 * | 方案 | 体积 | MAE | 结论 |
 * |---|---|---|---|---|
 * | PNG 无损重编码（自适应滤波 + zlib level 9） | 300–363 KB | 0 | ❌ PNG 对照片本来就不擅长，压不动 |
 * | PNG 缩到 850 × 696 | 220.2 KB | 0 | ❌ 还是超 200 K，且印刷字明显发糊 |
 * | JPEG q70 | 52.8 KB | 0.60 | ✅ 余量太大，没必要压这么狠 |
 * | JPEG q85 | 69.9 KB | 0.43 | ✅ |
 * | **JPEG q95（1070 × 876 不变）** | **116.3 KB** | **0.30** | ✅ **选定**：肉眼无损，余 83.7 KB |
 * | JPEG q98 | 159.3 KB | 0.24 | ✅ 更好，但只剩 45 KB 余量 |
 * | JPEG q100 | 250.4 KB | 0.21 | ❌ 超线 |
 *
 * 这张图**大面积是白底印刷 + 平滑手部照片**，熵低，所以 JPEG 质量档每降一档省不了多少 ——
 * 与其压到 180 KB 换一张糊的，不如用 q95 留一张几乎无损的。
 *
 * **尺寸必须保持 1070 × 876**：覆盖层的标记坐标（`src/domain/diagram.ts` 的
 * `MARKS` / `RIGHT_DOT_X`）是按原图像素量得的，底图一旦缩放，标记就会跑位。
 *
 * ## ⚠️ 坑一：jpeg-js 的编码器只认 **RGBA（4 字节/像素）**
 *
 * `jpeg-js@0.3.7` 的 `lib/encoder.js` 把步长写死了：
 *
 * ```js
 * var quadWidth = width * 4;              // ← 固定 4 字节/像素，不是按传入数据推的
 * r = imageData[p++]; g = imageData[p++]; b = imageData[p++];   // 第 4 字节（alpha）被跳过
 * ```
 *
 * 也就是说**喂 RGB（3 字节/像素）会出废图**：编码器仍按 4 字节取色，
 * 每行错位 1/3 像素，1070 宽累积下来整幅图**斜切并环绕重复**，
 * 底部还会读到越界的 `undefined`（脏色块）。
 *
 * 2026-11-05 真的踩过：脚本里把 pngjs 的 RGBA 转成了 RGB 再 encode，
 * 产出一张**体积合规、尺寸合规、内容是斜切废图**的 JPEG ——
 * 而当时所有断言只查「存在 / <200 KB / 1070×876」，**全绿放行**。
 * 只有真机出图才看得出是废图。
 *
 * 所以：① 直接把 pngjs 的 RGBA 喂进去；② **解码回读比对**（见下面 `verifyRoundTrip`），
 * 让这类错在生成这一步就炸掉。
 *
 * ## ⚠️ 坑二：「体积/尺寸合规」不等于「图对」
 *
 * 底图 JPEG 的体积、SOF0 里的尺寸、文件能否打开，全都不能证明内容正确。
 * `scripts/e2e/taro-lint.mjs` 第 25 节因此加了一条**内容一致性**断言：
 * 把 JPEG 解码回来跟 PNG 真源逐像素比（MAE / PSNR）。斜切废图的 MAE 会在 40 以上，
 * 正常 JPEG 在 5 以内 —— 区分度绰绰有余。
 *
 * ## 产物与真源
 *
 * - **真源**：`src/assets/hands-pulse.png`（298 KB，**保留不动**，网站端还在用）
 * - **小程序包用**：`src/assets/hands-pulse.jpg`（本脚本生成，≈180 KB）
 *
 * 两个文件并存是刻意的：网站端（`src/export/png.ts` 的 PNG 导出）要**无损底图**
 * （导出的是 PNG，底图有损会二次压缩），小程序端要**小底图**（包体限制）。
 * 桌面端（`scripts/build-core.mjs`）也跟着换，两端行为一致。
 *
 * ## 用法
 *
 * ```bash
 * npm run assets:compress      # 重新生成 src/assets/hands-pulse.jpg
 * ```
 *
 * 依赖 `jpeg-js` ＋ `pngjs`（**devDependency**）—— 只在生成时用，不进产物。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'assets', 'hands-pulse.png')
const OUT = join(ROOT, 'src', 'assets', 'hands-pulse.jpg')

/**
 * JPEG 质量档。
 *
 * q95 ≈ 116 KB，MAE 0.30 / PSNR 51.6 dB —— 肉眼无损，且距 200 KB 阈值还余 83.7 KB。
 * 不用再往上调（q98 只剩 45 KB 余量，q100 就超线了）。
 */
const QUALITY = 95

/** 微信「图片和音频资源大小不应超过 200 K」的单文件阈值 */
const LIMIT = 200 * 1024

/** 底图必须保持的像素尺寸（覆盖层坐标按这个坐标系量的） */
const EXPECT = { width: 1070, height: 876 }

/**
 * 回读比对的合格线（每通道 0–255）。
 *
 * 正常 q70 JPEG：MAE ≈ 3–6、PSNR ≈ 21 dB。
 * 斜切废图（喂错字节步长）：MAE ≫ 30、PSNR ≪ 12 dB。
 * 取值卡在两者中间，两头都留了余量。
 */
const MAX_MAE = 12
const MIN_PSNR = 15

/** 比对两张同尺寸 RGBA 图（逐通道，不看 alpha） */
function compareRgba(a, b) {
  if (a.length !== b.length) return null
  let sumAbs = 0
  let sumSq = 0
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c])
      sumAbs += d
      sumSq += d * d
      n++
    }
  }
  if (!n) return null
  const mse = sumSq / n
  return {
    mae: sumAbs / n,
    psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
  }
}

function main() {
  if (!existsSync(SRC)) {
    console.error(`[assets] 找不到真源：${SRC}`)
    process.exit(1)
  }

  const png = PNG.sync.read(readFileSync(SRC))
  if (png.width !== EXPECT.width || png.height !== EXPECT.height) {
    console.error(
      `[assets] 真源尺寸是 ${png.width}×${png.height}，与约定的 ${EXPECT.width}×${EXPECT.height} 不符 —— ` +
        '覆盖层坐标是按这个坐标系量的，改尺寸会跑位。',
    )
    process.exit(1)
  }

  // 底图没有透明通道（实测 colorType=2 / 全不透明），转 JPEG 不会丢 alpha。
  // 这里仍按 RGBA 逐像素检查一次，万一真源将来带 alpha 就直接报错，不静默出黑块。
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] !== 255) {
      console.error('[assets] 真源带透明通道 —— JPEG 不支持 alpha，请先换成 PNG 或白底合成。')
      process.exit(1)
    }
  }

  // ⚠️ 直接把 pngjs 的 **RGBA** 交给 jpeg-js —— 它的编码器按 4 字节/像素取色。
  // 千万别在这里「优化」成 RGB（3 字节）：那会产出斜切环绕的废图（详见文件头「坑一」）。
  const encoded = jpeg.encode({ data: png.data, width: png.width, height: png.height }, QUALITY)
  const bytes = encoded.data

  if (bytes.length >= LIMIT) {
    console.error(
      `[assets] 产物 ${bytes.length} B 仍超 200 KB 阈值（${LIMIT} B）—— ` +
        '把 QUALITY 往低调（如 65），或回头评估画质。',
    )
    process.exit(1)
  }

  // ⚠️ 回读比对：解码刚生成的 JPEG，跟真源逐像素比。
  // 这一步专抓「体积合规、尺寸合规、内容却是废图」这类错（详见文件头「坑二」）。
  let decoded = null
  try {
    decoded = jpeg.decode(bytes)
  } catch (e) {
    console.error(`[assets] 产物自己都解不开：${e?.message || e}`)
    process.exit(1)
  }
  if (decoded.width !== EXPECT.width || decoded.height !== EXPECT.height) {
    console.error(
      `[assets] 回读尺寸是 ${decoded.width}×${decoded.height}，与 ${EXPECT.width}×${EXPECT.height} 不符。`,
    )
    process.exit(1)
  }
  const cmp = compareRgba(decoded.data, png.data)
  if (!cmp) {
    console.error('[assets] 回读比对失败：像素数据长度对不上。')
    process.exit(1)
  }
  if (cmp.mae > MAX_MAE || cmp.psnr < MIN_PSNR) {
    console.error(
      `[assets] 回读比对不过 —— 产物与真源内容对不上（MAE ${cmp.mae.toFixed(2)} / PSNR ` +
        `${cmp.psnr.toFixed(2)} dB；合格线 MAE ≤ ${MAX_MAE}、PSNR ≥ ${MIN_PSNR} dB）。` +
        '多半是把 RGBA 改成了 RGB 喂给 jpeg-js（见文件头「坑一」），或编码/解码用了不同的字节步长。',
    )
    process.exit(1)
  }

  writeFileSync(OUT, bytes)
  console.log(
    `[assets] 底图压缩完成：${QUALITY} 档 · ${png.width}×${png.height} · ` +
      `${bytes.length} B（${(bytes.length / 1024).toFixed(1)} KB）· 距 200 KB 阈值余 ${LIMIT - bytes.length} B`,
  )
  console.log(
    `[assets] 回读比对：MAE ${cmp.mae.toFixed(2)}（上限 ${MAX_MAE}）· PSNR ${cmp.psnr.toFixed(2)} dB（下限 ${MIN_PSNR} dB）`,
  )
  console.log(`[assets] 产物：${OUT}`)
}

main()
