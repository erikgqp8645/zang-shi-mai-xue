#!/usr/bin/env node
/**
 * 生成 tabBar 图标（4 个 × 2 色）
 *
 * ## 为什么自己画
 *
 * 微信 tabBar 的图标必须放进小程序包（`iconPath` 相对 miniprogramRoot）。
 * 原生版**没有图标**（只有 text），2026-11-05 的 IA 重构决定补上。
 *
 * 不用第三方图标库的理由：那是别人的美术资源，版权与风格都不归我们管，
 * 而且和 `.pr-*` 那套「宣纸/墨/黛」配色对不上。这里**自己画线稿**，
 * 2px 描边、圆头，跟界面里其它线条是一套。
 *
 * ## 为什么自己写 PNG 编码
 *
 * 本机没有 ImageMagick / sharp 之类的图像库，也不该为了 8 个 81×81 的图标
 * 往项目里加依赖。PNG 格式很简单（zlib 在 Node 里是内置的），几十行就够。
 *
 * 用法：node scripts/gen-tabbar-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'taro', 'src', 'assets', 'tabbar')

/* ------------------------------ PNG 编码 ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** RGBA 像素数组 → PNG buffer */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // 每行前面加一个 filter byte（0 = None）
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const off = y * (width * 4 + 1)
    raw[off] = 0
    rgba.copy(raw, off + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------ 画布 ------------------------------ */

const SIZE = 81

function createCanvas() {
  return { w: SIZE, h: SIZE, data: Buffer.alloc(SIZE * SIZE * 4) }
}

function putPixel(cv, x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return
  const i = (y * cv.w + x) * 4
  const da = cv.data[i + 3] / 255
  const outA = a + da * (1 - a)
  if (outA <= 0) return
  cv.data[i] = Math.round((r * a + cv.data[i] * da * (1 - a)) / outA)
  cv.data[i + 1] = Math.round((g * a + cv.data[i + 1] * da * (1 - a)) / outA)
  cv.data[i + 2] = Math.round((b * a + cv.data[i + 2] * da * (1 - a)) / outA)
  cv.data[i + 3] = Math.round(outA * 255)
}

/** 线段（带粗细，圆头） */
function line(cv, x0, y0, x1, y1, color, width = 2) {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2)
  const half = width / 2
  for (let s = 0; s <= steps; s += 1) {
    const t = steps === 0 ? 0 : s / steps
    const cx = x0 + dx * t
    const cy = y0 + dy * t
    for (let oy = -Math.ceil(half); oy <= Math.ceil(half); oy += 1) {
      for (let ox = -Math.ceil(half); ox <= Math.ceil(half); ox += 1) {
        const d = Math.hypot(ox, oy)
        if (d <= half) putPixel(cv, Math.round(cx + ox), Math.round(cy + oy), color, Math.min(1, half - d + 0.5))
      }
    }
  }
}

function polyline(cv, pts, color, width = 2) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    line(cv, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], color, width)
  }
}

function rect(cv, x, y, w, h, color, width = 2) {
  polyline(
    cv,
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ],
    color,
    width,
  )
}

function circle(cv, cx, cy, r, color, width = 2) {
  const steps = Math.max(24, Math.ceil(r * 8))
  const pts = []
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  polyline(cv, pts, color, width)
}

/* ------------------------------ 四个图标 ------------------------------ */

/** 病例：一份病历（外框 ＋ 三行横线） */
function iconCases(cv, c) {
  rect(cv, 24, 16, 33, 49, c, 2.4)
  for (const y of [30, 40, 50]) line(cv, 31, y, 50, y, c, 2.2)
}

/** 就诊：脉搏波形 */
function iconVisit(cv, c) {
  polyline(
    cv,
    [
      [12, 41],
      [25, 41],
      [30, 28],
      [37, 56],
      [43, 36],
      [48, 41],
      [69, 41],
    ],
    c,
    2.6,
  )
}

/** 用方：一张处方（外框 ＋ 药名两行 ＋ 折角） */
function iconFormula(cv, c) {
  polyline(
    cv,
    [
      [20, 14],
      [52, 14],
      [61, 24],
      [61, 67],
      [20, 67],
      [20, 14],
    ],
    c,
    2.4,
  )
  polyline(
    cv,
    [
      [52, 14],
      [52, 24],
      [61, 24],
    ],
    c,
    2.2,
  )
  line(cv, 28, 36, 53, 36, c, 2.2)
  line(cv, 28, 47, 46, 47, c, 2.2)
}

/** 我的：一个人（头 ＋ 肩） */
function iconMe(cv, c) {
  circle(cv, 40.5, 28, 11, c, 2.4)
  polyline(
    cv,
    [
      [17, 65],
      [17, 58],
      [26, 47],
      [40.5, 43],
      [55, 47],
      [64, 58],
      [64, 65],
    ],
    c,
    2.4,
  )
}

/* ------------------------------ 出图 ------------------------------ */

const COLORS = {
  off: [124, 137, 116], // #7c8974 次色（未选中）
  on: [44, 41, 37], // #2c2925 主色（选中）
}

const ICONS = {
  cases: iconCases,
  visit: iconVisit,
  formula: iconFormula,
  me: iconMe,
}

mkdirSync(OUT, { recursive: true })

let n = 0
for (const [name, draw] of Object.entries(ICONS)) {
  for (const [suffix, color] of [
    ['', COLORS.off],
    ['-on', COLORS.on],
  ]) {
    const cv = createCanvas()
    draw(cv, color)
    const file = join(OUT, `${name}${suffix}.png`)
    writeFileSync(file, encodePng(cv.w, cv.h, cv.data))
    n += 1
  }
}

console.log(`[tabbar] 生成 ${n} 个图标 → ${OUT}`)
