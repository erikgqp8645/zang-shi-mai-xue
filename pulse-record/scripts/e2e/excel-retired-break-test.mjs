#!/usr/bin/env node
/**
 * break-test：证明「Excel 已退役」那几条断言**不是恒绿**
 *
 * ## 背景
 *
 * 2026-11-12：用户拍板**「让我们废除掉 excel」** —— 数据处理归到后端
 * （本地后台 ＋ 发布管道 ＋ 覆盖层），Excel 这个「中间人工编辑层」整个拿掉。
 *
 * 「退役」有两种坏法：
 *   · **文件还在、只是不推荐用** —— 下次有人看到 `content:excel` 就会以为
 *     那还是条能走的路 ⇒ 双管道又长出来；
 *   · **类型登记与真实数据错位** —— 改动「看起来能改」，
 *     实际在校验那一步就被拒，而且**报错信息完全不提「数组」两个字**。
 *
 * ## 这个脚本干什么
 *
 * 逐个把仓库**故意写坏**，跑一遍 `excel-retired.mjs`，验证：
 *   · 该红的真的红了（写坏必被抓）；
 *   · 不该红的仍然绿（否则就是恒红／恒绿的摆设）。
 *
 * 跑法：node scripts/e2e/excel-retired-break-test.mjs
 *
 * ⚠️ 无论怎么退出，被改的文件都要还原（**逐字节核对**）。
 * ⚠️ **别用会提前掐断管道的命令跑它**（例如 `… | Select-Object -First N`）——
 *    进程被掐掉时 `finally` 来不及执行，文件会**留在写坏的状态**。
 *    要看输出就重定向到文件再看。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const E2E = join(ROOT, 'scripts', 'e2e', 'excel-retired.mjs')

/* ------------------------------ 断言 ------------------------------ */

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
  return cond
}

/* --------------------------- 改文件的小工具 --------------------------- */

/**
 * 在一个文件里替换若干段文字。
 *
 * 先把 CRLF 归一成 LF 再替换 —— 这样无论工作区是 CRLF 还是 LF，
 * 替换片段都能对上；写回时再把原来的行尾还原。
 *
 * @returns {string|null} 替换后的内容；有一段没找到 → null
 */
function applyReplacements(original, replacements) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  let lf = original.replace(/\r\n/g, '\n')
  for (const r of replacements) {
    if (!lf.includes(r.from)) return null
    lf = lf.replace(r.from, r.to)
  }
  return lf.split('\n').join(eol)
}

/* ------------------------------ 跑 e2e ------------------------------ */

function runE2E() {
  const r = spawnSync(process.execPath, [E2E], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { code: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

/** 某条断言在输出里是红（✗）还是绿（✓） */
function isRed(out, name) {
  return out.includes(`✗ ${name}`)
}
function isGreen(out, name) {
  return out.includes(`✓ ${name}`)
}

/* ------------------------------ mutation ------------------------------ */

const LIB = 'server/library-schema.mjs'
const PKG = 'package.json'
const XLSX = 'content/臧氏脉学-用方知识库.xlsx'

const MUTATIONS = [
  {
    id: 'M1',
    title: '注册表把 adjustments 又登记成 string（数组字段被当成文字）',
    files: [
      {
        path: LIB,
        replacements: [
          {
            from: "{ key: 'adjustments', label: '加减', type: 'string[]' }",
            to: "{ key: 'adjustments', label: '加减', type: 'string' }",
          },
        ],
      },
    ],
    expectRed: [
      '注册表登记的字段类型与基线数据的真实形状一致',
      '带数组字段（adjustments）的讲稿方剂改得动',
    ],
    expectGreen: [],
  },
  {
    id: 'M2',
    title: 'package.json 里把 content:excel 又加回来（双管道复活）',
    files: [
      {
        path: PKG,
        replacements: [
          {
            from: '"test:e2e:core": "node scripts/e2e/core-smoke.mjs",',
            to:
              '"test:e2e:core": "node scripts/e2e/core-smoke.mjs",\n    ' +
              '"content:excel": "node scripts/excel_from_json.py",',
          },
        ],
      },
    ],
    expectRed: ['package.json 里没有 Excel 相关的脚本'],
    expectGreen: ['Excel 相关的 15 个文件全部不存在'],
  },
  {
    id: 'M3',
    title: '把工作簿又放回 content/（人工编辑层复活）',
    files: [],
    create: [{ path: XLSX, bytes: Buffer.from('PK\u0003\u0004 dummy', 'utf8') }],
    expectRed: [
      'Excel 相关的 15 个文件全部不存在',
      '仓库里再没有 .py / .xlsx（node_modules 除外）',
    ],
    expectGreen: ['新内容层的命令还在（后台／发布／快照／回滚）'],
  },
  {
    // 这一条是 2026-11-12 实测补的：守卫进了主链之后，**主链那项断言自己红了** ——
    // 原因是用子串正则 `/test:e2e:excel/` 去比，把守卫自己的
    // `test:e2e:excel-retired` 也命中了（假阳）。改成按脚本名全等之后，
    // 这条 mutation 就是它的反证：真的把 Excel 回归塞回主链，它必须红。
    id: 'M4',
    title: '主测试链里又把 Excel 回归塞回来（npm run test:e2e:excel）',
    files: [
      {
        path: PKG,
        replacements: [
          {
            from: '&& npm run test:e2e:rule-delete-loader && npm run test:e2e:excel-retired',
            to:
              '&& npm run test:e2e:rule-delete-loader && npm run test:e2e:excel' +
              ' && npm run test:e2e:excel-retired',
          },
        ],
      },
    ],
    expectRed: ['主测试链里不再有 Excel 回归'],
    expectGreen: [
      'package.json 里没有 Excel 相关的脚本',
      'Excel 退役守卫自己还挂在主测试链上',
    ],
  },
]

/* ------------------------------ 跑 ------------------------------ */

console.log('\nExcel 退役 · break-test（证明守卫不是恒绿）\n')

for (const m of MUTATIONS) {
  console.log(`${m.id} ${m.title}`)

  /** 备份：改之前把每个涉及的文件的原始字节存下来 */
  const backup = new Map()
  for (const f of m.files) {
    const p = join(ROOT, f.path)
    backup.set(p, readFileSync(p))
  }
  const created = []
  for (const c of m.create ?? []) {
    const p = join(ROOT, c.path)
    created.push(p)
    writeFileSync(p, c.bytes)
  }

  try {
    // ① 改坏
    let applied = true
    for (const f of m.files) {
      const p = join(ROOT, f.path)
      const next = applyReplacements(backup.get(p).toString('utf8'), f.replacements)
      if (next === null) {
        applied = false
        ok(`${m.id} 替换片段对得上`, false, `${f.path} 里没找到要替换的那段`)
        break
      }
      writeFileSync(p, next, 'utf8')
    }
    if (!applied) continue

    // ② 跑守卫：它必须红
    const r = runE2E()
    ok(`${m.id} 守卫测试红了（退出码非 0）`, r.code !== 0, `exit=${r.code}`)

    for (const name of m.expectRed) {
      ok(`${m.id} 该红的真的红了：${name}`, isRed(r.out, name))
    }
    for (const name of m.expectGreen) {
      ok(`${m.id} 不该红的仍然绿：${name}`, isGreen(r.out, name))
    }
  } finally {
    // ③ 还原：文件逐字节还原，创建出来的删掉
    for (const [p, bytes] of backup) {
      writeFileSync(p, bytes)
    }
    for (const p of created) {
      rmSync(p, { force: true })
    }
    // ④ 还原自检：逐字节一致
    let same = true
    for (const [p, bytes] of backup) {
      if (!existsSync(p) || !readFileSync(p).equals(bytes)) same = false
    }
    for (const p of created) {
      if (existsSync(p)) same = false
    }
    ok(`${m.id} 还原后逐字节一致`, same)
  }

  // ⑤ 还原后再跑一次：必须全绿
  const again = runE2E()
  ok(`${m.id} 还原后守卫测试全绿`, again.code === 0, `exit=${again.code}`)
  console.log('')
}

/* ------------------------------ 收尾 ------------------------------ */

console.log(`=== 通过 ${pass} ｜ 失败 ${fail} ===`)
if (failures.length) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail === 0 ? 0 : 1)
