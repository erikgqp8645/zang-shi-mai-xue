/**
 * 登录流程的**纯判断** —— 不碰网络、不碰存储，所以能直接断言
 *
 * ## 为什么把判断单独拆出来
 *
 * 「进登录页要不要自动进去」这条规则，2026-11-08 之前是**散在页面的 useEffect 里**的
 * 一句 `if (body.mode === 'single') goCases()`。它有两个毛病：
 *
 * ① 查不动 —— 静态回归查不出「这台机器上到底会不会自动进去」；
 * ② 判错代价大 —— 一旦无条件自动进，点「退出登录」就**退不掉**
 *    （退出 → 回登录页 → 又自动进去 → 等于没退）。
 *
 * → 拆成纯函数，好处是：规则只有**一处**、能被回归逐条断言、
 *   页面那边只管「拿到结果就照做」，不会再各写各的。
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

/**
 * 进登录页要不要**自动进去**
 *
 * 规则（维护者 2026-11-08 拍板）：
 *
 * - **多用户模式：永远不自动进** —— 等用户点「微信一键登录」。
 *   自动进等于「用户还没点就替他登录了」。
 * - **单机模式：默认自动进**（原来就这样，是设计），
 *   **但被显式退出过就不自动进** —— 用户说了「退出」，
 *   就得尊重它：停在登录页，给一个「继续使用（单机模式）」按钮，
 *   由用户自己决定回不回来。
 *
 * @param mode         服务端模式（`/api/health` 的 `mode`）
 * @param justLoggedOut 本地是否记着「刚被退出过」
 */
export function shouldAutoEnter(mode: string | undefined | null, justLoggedOut: boolean): boolean {
  if (!isSingleMode(mode)) return false
  if (justLoggedOut) return false
  return true
}
