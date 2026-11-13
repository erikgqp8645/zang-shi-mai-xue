/**
 * 用方知识库 · 新建条目的 **id 自动生成**
 *
 * ## 为什么要它
 *
 * 「＋ 新增条目」时让管理员自己编一个 id（还没意义的一串字符）是没必要的负担。
 * 他们真正关心的是「条件／治法／方名／脉象图」，id 只是给系统认的。
 *
 * ## 两条纪律
 *
 * 1. **没保存就不生成** —— 打开新增弹层、点「自动生成」之前，后台什么都不写。
 *    （id 只是表单里的一个字符串，落库在 `POST /api/library/entries/:kind` 那一刻。）
 * 2. **留空也能保存** —— 用户没填、也没点「自动生成」，保存时自动补一个；
 *    不会因为「id 空着」把他刚画好的脉象图拦在门外。
 *
 * ## 格式
 *
 * `u-YYMMDD-xxxx`（如 `u-261113-a3f9`），符合服务端的
 * `^[A-Za-z0-9_-]{2,64}$`：
 *   · `u-` 前缀 —— 一眼看出是「网站端自建」的条目，与基线里 `fx-…` 的条目区分开；
 *   · `YYMMDD` —— 建的那天，`library apply` 之后在内容文件里也认得出先后；
 *   · 4 位 36 进制随机 —— 同日建多条时不撞。
 *
 * ⚠️ 随机**可能撞**（409 时让用户再点一次生成），所以不做「全局唯一保证」的假承诺，
 *    而是在保存失败时把服务端的话原样给用户看。
 */

/**
 * 生成一个条目 id。
 *
 * @param now 当前时间（测试可注入固定值）
 * @returns 形如 `u-261113-a3f9`
 */
export function makeRuleId(now: Date = new Date()): string {
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  // 36 进制、4 位 —— 不用 crypto：这个 id 不是凭据，撞了服务端会 409
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
  return `u-${yy}${mm}${dd}-${rand}`
}
