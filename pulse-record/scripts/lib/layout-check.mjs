/**
 * 体例自检 —— 「患者的体例」与「格值实际覆盖的行」是否对得上。
 *
 * ## 为什么要有这个检查
 *
 * 体例（7 脉点 / 9 行）是**患者级**属性，记录表与录入记录都按它画：
 *   · `seven` —— 7 脉点体例：寸（浮中沉）＋ 关（浮中沉）＋ 尺（**只沉**）→ 每手 7 格
 *   · `nine`  —— 9 行体例：寸（浮中沉）＋ 关（浮中沉）＋ 尺（浮中沉）→ 每手 9 格
 *
 * 两套体例的格值数不一样：一次就诊在 seven 下是 14 个格（7 行 × 左右），
 * 在 nine 下是 18 个格（9 行 × 左右）。
 *
 * 如果两者对不上（例如 layout 被改成了 nine、但格值还是 7 脉点那 14 个），
 * 表格就会多出两行**空行** —— 看着像「数据丢了」，导出图也会多两行空行。
 * 所以写入演示数据、运维改体例之后，都要用这里的检查把话说清楚。
 *
 * 两套体例都是讲义里真实存在的写法，本工具两套都提供、**不替读者取舍**：
 * 讲义 p34 上方写「寸取 3、关取 3、尺只沉取 1，共 7 个脉点」，
 * p34 实例表与 p48–50 空白表实际是每人 9 行（尺含浮、中、沉）。
 */

/** 每种体例下应有的「部位|取法」清单 */
export function depthsOfLayout(layout) {
  if (layout === 'seven') {
    return ['寸|浮', '寸|中', '寸|沉', '关|浮', '关|中', '关|沉', '尺|沉']
  }
  return ['寸|浮', '寸|中', '寸|沉', '关|浮', '关|中', '关|沉', '尺|浮', '尺|中', '尺|沉']
}

/** 每种体例下，一次就诊应有的格值键（左右手都算上） */
export function expectedCellKeys(layout) {
  const out = []
  for (const d of depthsOfLayout(layout)) {
    out.push(`L|${d}`, `R|${d}`)
  }
  return out
}

/**
 * 检查一位患者的体例与格值是否自洽。
 *
 * @param {{layout: string, visits: {label?: string, values?: Record<string, unknown>}[]}} patient
 * @returns {{ok: boolean, layout: string, expect: number, actual: number, detail: string}}
 */
export function checkPatientLayout(patient) {
  const layout = patient.layout === 'seven' ? 'seven' : 'nine'
  const expect = expectedCellKeys(layout)
  const expectSet = new Set(expect)
  for (const v of patient.visits ?? []) {
    const keys = Object.keys(v.values ?? {})
    const extra = keys.filter((k) => !expectSet.has(k))
    const missing = expect.filter((k) => !keys.includes(k))
    if (extra.length || missing.length) {
      const parts = []
      if (missing.length) parts.push(`缺 ${missing.join('、')}`)
      if (extra.length) parts.push(`多 ${extra.join('、')}`)
      return {
        ok: false,
        layout,
        expect: expect.length,
        actual: keys.length,
        detail: `${v.label ?? '（某次就诊）'}：${parts.join('；')}`,
      }
    }
  }
  return { ok: true, layout, expect: expect.length, actual: expect.length, detail: '' }
}

/** 自检结果的中文说明（写进提示里用） */
export function describeLayoutCheck(result) {
  if (result.ok) return `体例 ${result.layout === 'nine' ? '9 行' : '7 脉点'} 与格值一致（${result.expect} 格）`
  return `体例是 ${result.layout === 'nine' ? '9 行' : '7 脉点'}（应有 ${result.expect} 格），但格值只有 ${result.actual} 格 —— ${result.detail}`
}
