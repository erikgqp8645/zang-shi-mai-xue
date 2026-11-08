/**
 * 登录流程的**纯判断** —— 不碰网络、不碰存储，所以能直接断言
 *
 * ## 规则（维护者 2026-11-08 两次拍板，合并成一条）
 *
 * > 「需要用户点击才可以登录」＋「单机模式也要点一下才进去」
 *
 * ⇒ **这个工具没有「自动进入」这回事**：
 *
 * | 服务端模式 | 登录页显示什么 | 用户点哪里 |
 * |---|---|---|
 * | multi（多用户） | 「微信一键登录」按钮（＋账号密码登录／注册） | 点按钮 → 才发起登录 |
 * | single（单机） | 「进入（单机模式）」按钮 | 点按钮 → 才进病例页 |
 *
 * ## 为什么把判断单独拆出来
 *
 * 「进登录页该显示哪种入口」这条规则，先是散在页面的 `useEffect` 里的一句
 * `if (body.mode === 'single') { setSingleMode(true); goCases() }`。
 * 它有两个毛病：
 *
 * ① 查不动 —— 静态回归查不出「这台机器上到底会不会自动进去」；
 * ② 判错代价大 —— 一旦无条件自动进，点「退出登录」就**退不掉**
 *    （退出 → 回登录页 → 又自动进去 → 等于没退）。
 *
 * → 拆成纯函数，好处是：规则只有**一处**、能被回归逐条断言、
 *   页面那边只管「拿到结果就照做」，不会再各写各的。
 *
 * ⚠️ **没有 `shouldAutoEnter` 这种函数了** —— 「要不要自动进去」这个问题的
 *    答案恒为「否」。与其留一个恒假的函数让人以为还有得选，
 *    不如把规则写成**「显示哪种入口」**：读代码时一眼看得见没有自动进入。
 */

/** 服务端模式 —— `/api/health` 的 `mode` 字段 */
export type ServerMode = 'single' | 'multi' | ''

/**
 * 是不是单机模式
 *
 * 单机模式压根没有「登录」这回事 —— 数据就在这一台机器上。
 */
export function isSingleMode(mode?: string | null): boolean {
  return mode === 'single'
}

/** 登录页该显示哪种入口 */
export type EntryKind = 'single-enter' | 'wechat-login'

/**
 * 进登录页该显示哪种入口
 *
 * @param mode 服务端模式（`/api/health` 的 `mode`）
 */
export function entryKind(mode?: string | null): EntryKind {
  return isSingleMode(mode) ? 'single-enter' : 'wechat-login'
}
