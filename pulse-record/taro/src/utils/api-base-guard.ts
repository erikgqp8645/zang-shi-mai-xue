/**
 * 构建期地址校验 —— 把「**必然连不上**的服务器地址」挡在包外面
 *
 * ## 为什么要有这一层
 *
 * 2026-11-08 真出过：照 `docs/deploy.md` 的命令敲了一遍
 *
 * ```bash
 * PULSE_API_BASE=https://mai.example.com npm run mp:taro:build
 * ```
 *
 * 产物留在 `taro/dist/`，第二天用开发者工具一开，病例页满屏红：
 * 「连不上服务器 · request:fail · https://mai.example.com/api/patients」。
 *
 * **代码一行没坏** —— 坏的是构建产物。而构建过程**一声不响地**
 * 把一个不可能的地址打进了包：`example.com` 是 RFC 2606 保留给文档的域名，
 * 被 IANA 永久保留，**不指向任何服务器**。
 *
 * 这类事故的排查代价特别高：现象在界面（「连不上」），
 * 根因却在几个小时前的构建命令里。中间隔着产物、缓存、开发者工具 ——
 * 只能从界面倒着查回去。所以把判定**提前到构建期**：
 * 命中就构建失败，包根本出不来，错误发生在它真正发生的地方。
 *
 * ## 这一层是**纯函数**
 *
 * 不碰 `fs`、不碰 `Taro`、不碰 `process`，也不依赖 `new URL()`
 * （小程序运行时没有它，而这份代码要在两端都能安全求值）。
 * 因此回归可以逐条断言「拦得住什么、放得过什么」
 * （见 `scripts/e2e/taro-api.mjs` 第八段）。
 *
 * ## 只拦「确定不可能通」的
 *
 * | 地址 | 处理 | 理由 |
 * |---|---|---|
 * | `example.com` / `example.net` / `example.org` 及其子域 | **拦** | RFC 2606 保留，永不解析 |
 * | `.example` / `.invalid` 顶级域 | **拦** | RFC 6761 保留，永不解析 |
 * | 空串（没注入） | 放行 | 走源码里的本机默认值，是正常用法 |
 * | `http://` | 只警告 | 开发者工具勾了「不校验合法域名」时能用 |
 * | 局域网 IP / `127.0.0.1` / 带端口 | 放行 | 真机联调与本地开发都要用，硬拦会挡掉正常流程 |
 * | 真实域名 | 放行 | —— |
 */

/** 一次校验的结论 */
export interface ApiBaseCheck {
  /** 能不能继续构建 */
  ok: boolean
  /** 结论级别：没问题 / 只警告 / 中断构建 */
  level: 'ok' | 'warn' | 'error'
  /** 给人看的话（`ok` 时为空串） */
  message: string
}

/**
 * RFC 2606 / RFC 6761 保留给「文档与测试」的域名 —— **永远解析不出来**。
 *
 * 整个 host 必须命中（`^(?:…)*…$`），所以 `api.test.com` 这类真实域名不会被误伤
 * —— 前缀只收「一串子域 + .」，末段必须是保留名。
 *
 * ⚠️ **前缀用 `[^.]+` 而不是 `[a-z0-9-]+`**：
 * IDN 子域（`例え.example.com`，punycode 后是 `xn--….example.com`）同样落在
 * `example.com` 下面，一样永不解析 —— 只收 ASCII 会漏掉它。
 * 而 `臧氏脉学.cn` 的末段是 `cn`，照样放过，不会误伤真实中文域名。
 *
 * ⚠️ **`localhost` 故意不在名单里**：
 * `http://localhost:5178` 在开发者工具里**真的能用**（与 `127.0.0.1` 等价），
 * 拦下来会挡掉正常的联调包。
 *
 * `test` / `invalid` / `example` 都在：它们是 RFC 6761 保留的**顶级域**，
 * 公开 DNS 永远不解析（`.test` 只能靠改 hosts 才能用，那不是本工程的使用场景）。
 * 而 `api.test.com` 的末段是 `.com`，命中不了这条 —— 实测确认过不会误伤。
 */
const RESERVED_HOST = /^(?:[^.]+\.)*(?:example\.(?:com|net|org)|example|invalid|test)$/

/** host 里出现这些字符，就不是一个能解析的域名（含文档里「换成你的域名」那种尖括号写法） */
const ILLEGAL_HOST_CHARS = /[\s<>{}|\\^"`]/

/**
 * 把 host 归一成「能拿去比对」的形态
 *
 * 三个都要做，少一个都能让事故原样复现（2026-11-08 复核时逐条实测过）：
 *
 * | 输入 | 归一后 | 不做会怎样 |
 * |---|---|---|
 * | `example.com.` | `example.com` | 尾点是 root-anchored FQDN，**与不带点是同一个名字**，照样 NXDOMAIN |
 * | `ａｐｉ.example.com`（全角） | `api.example.com` | 中文输入法下很容易打出来，DNS 层等价 |
 * | `a。example.com`（U+3002） | `a.example.com` | **`NFKC` 不处理它**，得单独替换 |
 */
export function normalizeHost(host: string): string {
  return String(host || '')
    .normalize('NFKC')
    // NFKC 只处理「．」(U+FF0E) 一类，句号 U+3002 与半角句点变体 U+FF61 要手动换
    .replace(/[\u3002\uFF61]/g, '.')
    .replace(/^\.+/, '') // 前导点：`.example.com` 与 `example.com` 解析结果相同
    .replace(/\.+$/, '') // 尾点：`example.com.` 是 root-anchored FQDN，同一个名字
    .toLowerCase()
}

/**
 * 把 `scheme://authority` 拆开，**不用 `new URL()`**
 *
 * 只取协议与 host（去 userinfo、去端口、IPv6 保留方括号）。
 * 解析不了（没有 `scheme://`）返回 `null`。
 */
export function splitUrl(value: string): { scheme: string; host: string } | null {
  // ⚠️ 字符类里要排除 `\`：WHATWG 对 http(s) 把反斜杠**当斜杠**，
  //    所以 `https://example.com\@a.cn` 的真实 host 是 `example.com`（必死），
  //    不排除的话会切成 `a.cn` 而放行。
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\\]*)/i.exec(String(value || '').trim())
  if (!m) return null

  let authority = m[2] || ''
  const at = authority.lastIndexOf('@')
  if (at >= 0) authority = authority.slice(at + 1)

  let host = authority
  if (authority.startsWith('[')) {
    // IPv6 字面量：[::1]:5178
    const close = authority.indexOf(']')
    host = close > 0 ? authority.slice(0, close + 1) : authority
  } else {
    const colon = authority.indexOf(':')
    host = colon >= 0 ? authority.slice(0, colon) : authority
  }

  return { scheme: m[1].toLowerCase(), host: host.toLowerCase() }
}

/** 这个 host 是不是「保留给文档、永远解析不出来」的那种 */
export function isReservedHost(host: string): boolean {
  const h = normalizeHost(host)
  /**
   * **单标签主机名一律放行**（`test`、`invalid`、`example` 这种不带点的）。
   *
   * 它们与保留「顶级域」同名，但含义完全不同：
   * `http://test:5178` 在 docker-compose 服务名／hosts／内网 DNS 下**是真的能连**的，
   * 而保留域名那条规矩针对的是 `foo.test`（带点、末段是保留顶级域）。
   *
   * 2026-11-08 复核时实测踩到：只按名字匹配会让 `http://test:5178` 被拦，
   * 而且报错说它「是文档里的示例域名」—— 根因说错了，比不拦更坏。
   */
  if (!h.includes('.')) return false
  return RESERVED_HOST.test(h)
}

/**
 * 校验一个 `PULSE_API_BASE` 值
 *
 * @param raw            构建时注入的地址（不注入时是空串）
 * @param allowPlaceholder 显式放行占位域名（`PULSE_ALLOW_PLACEHOLDER=1`）——
 *        只给「验证注入链路通不通」这种故意要坏包的场景用
 */
export function checkApiBase(raw: unknown, allowPlaceholder = false): ApiBaseCheck {
  const value = String(raw == null ? '' : raw).trim()

  // 没注入 = 用源码里的本机默认值 —— 正常用法，不算问题
  if (!value) return { ok: true, level: 'ok', message: '' }

  const parsed = splitUrl(value)
  if (!parsed || !parsed.host) {
    return {
      ok: false,
      level: 'error',
      message:
        '[PULSE_API_BASE] 构建中止：' +
        value +
        ' 不是合法地址。' +
        '\n  要写成 https://域名 的形式（可以带端口和路径，如 https://pulse.your-domain.cn）。' +
        '\n  例：https://pulse.your-domain.cn' +
        '\n  联调包不用传这个变量（默认 http://127.0.0.1:5178）。',
    }
  }

  // 只认 http(s)：`ftp://`、`wss://` 这类塞进 API_BASE 是小程序请求不了的东西
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') {
    return {
      ok: false,
      level: 'error',
      message:
        '[PULSE_API_BASE] 构建中止：' +
        value +
        ' 的协议是 ' +
        parsed.scheme +
        '，小程序只能请求 http 或 https。' +
        '\n  联调包不用传这个变量（默认 http://127.0.0.1:5178）。',
    }
  }

  /**
   * 尖括号/中文占位 —— 文档里「换成你的域名」那种写法，照抄进来同样是坏包
   *
   * `https://<你的备案域名>`、`https://你的域名` 这两类任何环境都连不上，
   * 但它们的 host 里既没有 `example.com`，也不是非法 URL，很容易漏过去。
   *
   * 判据：**含 URL 不允许的字符**，或**含非 ASCII 且不含点**（真实中文域名一定带点，
   * 如 `臧氏脉学.cn`，不受影响）。
   */
  if (ILLEGAL_HOST_CHARS.test(parsed.host) || (/[^\x00-\x7F]/.test(parsed.host) && !parsed.host.includes('.'))) {
    return {
      ok: false,
      level: 'error',
      message:
        '[PULSE_API_BASE] 构建中止：' +
        value +
        ' 里的域名是占位写法，不是一个真域名。' +
        '\n  <尖括号>、中文说明文字这类占位符必须换成自己已备案的真实域名 ——' +
        '\n  照抄进构建命令，出来的包一定连不上。' +
        '\n  例：PULSE_API_BASE=https://pulse.your-domain.cn npm run mp:taro:build' +
        '\n  联调包不用传这个变量（默认 http://127.0.0.1:5178）。',
    }
  }

  if (isReservedHost(parsed.host)) {
    const tail =
      '  · 联调包：不传 PULSE_API_BASE 就行（产物里是本机默认地址 http://127.0.0.1:5178）' +
      '\n  · 上线包：换成自己已备案的域名，如 PULSE_API_BASE=https://pulse.your-domain.cn npm run mp:taro:build'

    // 故意坏包的人得先自己说一句（docs/progress.md 里那条「双向验证注入」的验证法要用）
    if (allowPlaceholder) {
      return {
        ok: true,
        level: 'warn',
        message:
          '[PULSE_API_BASE] 已放行占位域名（PULSE_ALLOW_PLACEHOLDER=1）：' +
          value +
          '\n  ⚠️ 这个包连不上任何服务器，只能用来验证「注入链路通不通」，别拿去装。',
      }
    }

    return {
      ok: false,
      level: 'error',
      message:
        '[PULSE_API_BASE] 构建中止：' +
        value +
        ' 是文档里的示例域名，永远解析不出来。' +
        '\n  example.com / example.net / example.org 被 IANA 永久保留，不指向任何服务器 ——' +
        '\n  拿它构建出来的包，装上就必然连不上，界面上只会显示 request:fail。' +
        '\n' +
        '\n  怎么办：\n' +
        tail +
        '\n  · 只想验证「注入链路通不通」：加 PULSE_ALLOW_PLACEHOLDER=1 显式放行',
    }
  }

  if (parsed.scheme !== 'https') {
    // 只提醒、不中断：开发者工具勾了「不校验合法域名」时 http 能用，
    // 真机联调也可能走局域网 http —— 拦下来反而挡掉正常用法。
    return {
      ok: true,
      level: 'warn',
      message:
        '[PULSE_API_BASE] 提醒：' +
        value +
        ' 不是 https。' +
        '\n  微信的 request 合法域名只收 https（且不收 IP、不收端口、需已备案）。' +
        '\n  这个包只有「开发者工具勾了不校验合法域名」时能连上，真机与正式版都会被拦。',
    }
  }

  return { ok: true, level: 'ok', message: '' }
}
