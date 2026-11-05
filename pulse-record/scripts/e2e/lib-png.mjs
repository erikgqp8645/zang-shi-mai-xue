/**
 * 极简 PNG 解码 —— 只为回答一个问题：**这张截图是不是白屏**。
 *
 * ## 为什么需要它
 *
 * 小程序启动崩溃（最典型的是产物里残留 `process.env.xxx` → 运行时没有 `process`）时，
 * 开发者工具的截图会返回**一张纯白图** —— 看起来像「截图功能坏了」，其实是**小程序没跑起来**。
 * 而且这种错：构建不报错、静态回归全绿（查的是文件在不在，不是运行时）。
 *
 * 所以这里直接解 PNG 看**有没有内容**，把「整屏白」变成一条能自动抓到的回归。
 *
 * ## 支持范围
 *
 * 8 位、非隔行、颜色类型 0（灰度）／2（RGB）／4（灰度+透明）／6（RGBA）。
 * 开发者工具的截图就是这几种。其它类型（调色板、16 位、隔行）直接抛错，
 * 不猜 —— 猜错了会给出错误的「白屏」结论。
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * 读一张 PNG，返回像素统计。
 * @returns {{width:number,height:number,channels:number,distinctColors:number,nonWhiteRatio:number}}
 */
export function pngStats(file) {
  const buf = readFileSync(file)
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error(`不是 PNG：${file}`)

  let off = 8
  let ihdr = null
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  if (!ihdr) throw new Error(`PNG 缺 IHDR：${file}`)
  if (ihdr.bitDepth !== 8) throw new Error(`只支持 8 位色深，这张是 ${ihdr.bitDepth}：${file}`)
  if (ihdr.interlace) throw new Error(`不支持隔行 PNG：${file}`)

  const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }
  const channels = CHANNELS[ihdr.colorType]
  if (!channels) throw new Error(`不支持的颜色类型 ${ihdr.colorType}：${file}`)

  const raw = inflateSync(Buffer.concat(idat))
  const bpp = channels
  const stride = ihdr.width * bpp
  const pixels = Buffer.alloc(ihdr.height * stride)

  let pos = 0
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[pos++]
    const rowStart = y * stride
    const prevStart = rowStart - stride
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++]
      const a = x >= bpp ? pixels[rowStart + x - bpp] : 0
      const b = y > 0 ? pixels[prevStart + x] : 0
      const c = y > 0 && x >= bpp ? pixels[prevStart + x - bpp] : 0
      let value
      switch (filter) {
        case 0: value = rawByte; break
        case 1: value = rawByte + a; break
        case 2: value = rawByte + b; break
        case 3: value = rawByte + ((a + b) >> 1); break
        case 4: value = rawByte + paeth(a, b, c); break
        default: throw new Error(`未知的行过滤器 ${filter}：${file}`)
      }
      pixels[rowStart + x] = value & 0xff
    }
  }

  // 统计：颜色种类数 + 非白像素占比
  const colors = new Set()
  let nonWhite = 0
  let total = 0
  for (let y = 0; y < ihdr.height; y++) {
    const rowStart = y * stride
    for (let x = 0; x < ihdr.width; x++) {
      const i = rowStart + x * bpp
      const r = pixels[i]
      const g = channels >= 3 ? pixels[i + 1] : r
      const b = channels >= 3 ? pixels[i + 2] : r
      const a = channels === 4 ? pixels[i + 3] : 255
      total++
      // 透明像素当白（截图背景是白的，但可能被存成透明）
      const isWhite = a < 16 || (r > 244 && g > 244 && b > 244)
      if (!isWhite) nonWhite++
      colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3))
    }
  }

  return {
    width: ihdr.width,
    height: ihdr.height,
    channels,
    distinctColors: colors.size,
    nonWhiteRatio: total ? nonWhite / total : 0,
  }
}

/**
 * 判断一张截图是不是「白屏」。
 *
 * 判据（两个都满足才算有内容）：
 *   · 非白像素占比 ≥ 1.5%
 *   · 颜色种类 ≥ 8 种（真页面有边框、底色、文字色；纯白只有 1~2 种）
 */
export function isBlankShot(file, opts = {}) {
  const minRatio = opts.minRatio ?? 0.015
  const minColors = opts.minColors ?? 8
  const s = pngStats(file)
  const blank = s.nonWhiteRatio < minRatio || s.distinctColors < minColors
  return { blank, ...s }
}
