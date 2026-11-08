/**
 * 网络失败诊断 —— 把「网络请求失败」翻译成**哪一步错了、怎么改**
 *
 * ## 为什么要有这一层
 *
 * 2026-11-08 维护者在真机上看到病例页一片红：**「网络请求失败」**。
 *
 * 这句话等于没说：不知道连的是哪台服务器、不知道微信报的真实原因、
 * 不知道下一步该做什么（配域名？换地址？还是服务器根本没起）。
 *
 * 病根有两层：
 *
 * ① **平台层的真实原因被丢掉了。**
 *    `wx.request` 失败时给的是 `errMsg`（如
 *    `request:fail url not in domain list`），**不是 `message`**。
 *    旧代码写的是 `(err as Error)?.message || '网络请求失败'` ——
 *    `message` 永远 undefined → 每次都落到那句笼统的兜底上。
 *
 * ② **目标地址从没出现在错误里。**
 *    手机上的 `127.0.0.1` 指的是**手机自己**，不是你的电脑；
 *    这跟开发者工具里 `127.0.0.1` 指的是电脑**完全是两回事**。
 *    不把地址亮出来，使用者根本判断不了自己连的是哪台机器。
 *
 * ## 这一层是**纯函数**
 *
 * 不碰 `Taro`、不碰 `wx`、不发请求 —— 只把「原始报错 + 目标地址 + 传输方式」
 * 变成一段能给人看的诊断。因此回归脚本可以逐条断言
 * （见 `scripts/e2e/taro-api.mjs` 第七段）。
 *
 * ## 判据只有这一处
 *
 * 「这个地址在微信里能不能用」是**微信平台的规矩**，不是本工程自己定的：
 *   · request 合法域名只收 **https + 域名 + 已备案**，不收 IP、不收端口；
 *   · 真机上 `127.0.0.1` 指手机自己。
 * 所以这里只把这些**平台的已知规矩**翻译成人话，不猜、不编。
 */

export type NetTransport = 'request' | 'cloud'

export interface NetFailureInput {
  /** 底层原始报错：`wx` 的 `errMsg`（`request:fail url not in domain list`…）或 `Error.message` */
  raw?: string
  /** 本次请求打到的地址（含路径），用来告诉使用者「连的是哪台机器」 */
  url?: string
  /** 传输方式：request（走合法域名校验）／ cloud（走云函数） */
  transport?: NetTransport
  /** 是不是正式发布版 —— 正式版的域名要求更严，提示要更硬 */
  release?: boolean
}

export interface NetFailure {
  /** 一句话结论 —— 界面顶部那一行红字 */
  summary: string
  /** 真实原因：原始报错（截短后） */
  reason: string
  /** 目标地址（可能空串 —— 拿不到地址时说清楚） */
  target: string
  /** 可执行的下一步 —— 每条都是「去哪儿改什么」 */
  hints: string[]
}

/* ------------------------------ 小工具 ------------------------------ */

/** 从地址里取出 host（去掉端口） */
export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || '').trim())
  if (!m) return ''
  return m[1].replace(/:\d+$/, '')
}

/** 是不是「本机回环地址」（127.0.0.1 / localhost / ::1） */
export function isLoopbackHost(host: string): boolean {
  const h = String(host || '').toLowerCase()
  return h === 'localhost' || h === '::1' || h.startsWith('127.')
}

/** 是不是「局域网地址」（192.168.x / 10.x / 172.16~31.x） */
export function isPrivateHost(host: string): boolean {
  const h = String(host || '').toLowerCase()
  return /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
}

/** 是不是裸 IP（微信的 request 合法域名不收 IP） */
export function isIpHost(host: string): boolean {
  const h = String(host || '').toLowerCase()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true
  return h.includes(':') && !h.includes('.')
}

/** 地址里带了端口吗（微信的 request 合法域名不收端口） */
export function hasPort(url: string): boolean {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || '').trim())
  if (!m) return false
  return /:\d+$/.test(m[1])
}

/** 地址是不是 https */
export function isHttps(url: string): boolean {
  return /^https:\/\//i.test(String(url || '').trim())
}

/** 把原始报错截短（去掉 callid / trace 之类），别把一整坨甩给人看 */
export function briefReason(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  const brief = s.replace(/\s*\(callid:.*$/s, '').replace(/\s*\(trace:.*$/s, '').trim()
  return brief.length > 160 ? brief.slice(0, 160) + '…' : brief
}

/* ------------------------------ 主诊断 ------------------------------ */

type Kind =
  | 'loopback'
  | 'domain-list'
  | 'timeout'
  | 'refused'
  | 'dns'
  | 'tls'
  | 'cloud-env'
  | 'generic'

/** 从原始报错里认出是哪一类失败 */
function classify(raw: string): Kind {
  const s = String(raw || '')
  if (/url not in domain list|not in domain list|合法域名/i.test(s)) return 'domain-list'
  if (/timeout|timed out|超时/i.test(s)) return 'timeout'
  if (/ECONNREFUSED|connection refused|ERR_CONNECTION_REFUSED/i.test(s)) return 'refused'
  if (/ENOTFOUND|getaddrinfo|name not resolved|ERR_NAME_NOT_RESOLVED/i.test(s)) return 'dns'
  if (/certificate|ERR_CERT|SSL|ssl hand shake|TLS/i.test(s)) return 'tls'
  if (/Environment not found|INVALID_ENV|-501000/i.test(s)) return 'cloud-env'
  return 'generic'
}

/**
 * 诊断一次网络失败
 *
 * @param input 原始报错 + 目标地址 + 传输方式
 * @returns 结论 + 真实原因 + 可执行的下一步
 */
export function describeNetFailure(input: NetFailureInput): NetFailure {
  const raw = String(input?.raw || '')
  const url = String(input?.url || '').trim()
  const host = hostOf(url)
  const kind = classify(raw)
  const release = !!input?.release

  const hints: string[] = []
  const push = (s: string) => {
    if (s && hints.indexOf(s) < 0) hints.push(s)
  }

  let summary = ''

  /* ---- 地址层面的判据（跟报错无关 —— 地址本身就不可能通） ---- */

  if (host && isLoopbackHost(host)) {
    summary = '连的是回环地址（' + host + '），手机上它指的是手机自己'
    push(
      '真机上 127.0.0.1 指的是**手机自己**，不是你的电脑 —— 开发者工具里能通、真机上必不通，就是这个原因',
    )
    push('请在「我的」页把地址改成电脑的局域网 IP（如 http://192.168.1.20:5178），或改成上线域名')
  }

  if (host && isPrivateHost(host)) {
    push('手机和电脑要连**同一个 Wi-Fi**；电脑防火墙要放行这个端口；后端要监听 0.0.0.0 而不是 127.0.0.1')
  }

  if (url && !isHttps(url)) {
    push(
      release
        ? '正式版只允许 https：微信的 request 合法域名**只收 https**，http 在正式版一律被拦'
        : '开发者工具里要勾「详情 → 本地设置 → 不校验合法域名…」才能用 http；真机与正式版都要 https',
    )
  }

  if (host && isIpHost(host)) {
    push('微信的 request 合法域名**不收 IP**，要用域名（且已 ICP 备案）')
  }

  if (url && hasPort(url)) {
    push('微信的 request 合法域名**不收端口**，要用域名默认端口（443）')
  }

  /* ---- 报错层面的判据 ---- */

  if (kind === 'domain-list') {
    if (!summary) summary = '这个域名没在微信后台的「request 合法域名」里'
    push(
      '到 mp.weixin.qq.com → 开发管理 → 开发设置 → 服务器域名 → **request 合法域名**，把 ' +
        (host || '这个域名') + ' 加进去',
    )
    push('加完要**重新上传体验版**才生效（合法域名是按版本校验的）')
  } else if (kind === 'timeout') {
    if (!summary) summary = '连接超时，没等到服务器回应'
    push('超时一般是三种原因：服务器没起 / 被防火墙挡 / 手机网络不通 —— 先确认服务器进程还在')
  } else if (kind === 'refused') {
    if (!summary) summary = '连接被拒绝，服务器没有在监听这个端口'
    push('端口不对或服务没起：核对地址里的端口与服务端监听端口是否一致')
  } else if (kind === 'dns') {
    if (!summary) summary = '域名解析不出来'
    push('DNS 没生效或域名写错：先在手机浏览器里打开同一个地址试试')
  } else if (kind === 'tls') {
    if (!summary) summary = 'HTTPS 证书有问题'
    push('自签证书在真机上不被信任 —— 要用受信任的证书（正式版还要求域名已 ICP 备案）')
  } else if (kind === 'cloud-env') {
    if (!summary) summary = '云环境在这个小程序里不可用'
    push('到 mp.weixin.qq.com → 云开发 → 环境，确认**当前小程序已关联**该环境，且环境 id 没写错')
  } else if (!summary) {
    summary = '连不上服务器'
  }

  /* ---- 传输方式与目标地址（让人知道现在走的是哪条路） ---- */

  if (input?.transport === 'cloud') {
    push('当前传输方式：云函数（callFunction）—— 它不受 request 合法域名限制；失败时会自动改走直连')
  } else if (input?.transport === 'request') {
    push('当前传输方式：直连（request）—— 受微信的 request 合法域名校验')
  }

  push('当前连接地址：' + (url || '（拿不到地址）'))

  if (!hints.length) push('把上面的「当前连接地址」和红色原因发给维护者，可以直接定位')

  return {
    summary,
    reason: briefReason(raw) || '（平台没给出更细的原因）',
    target: url,
    hints,
  }
}

/**
 * 把诊断压成**一行**（给 `ApiError` 的 message 用）
 *
 * 界面上的完整诊断由 `describeNetFailure` 渲染；这一行只保证
 * 「就算没有专门的诊断界面，也知道连的是哪台、报的是什么」。
 */
export function formatNetFailure(f: NetFailure): string {
  const parts: string[] = []
  parts.push(f.summary)
  if (f.reason && f.reason !== '（平台没给出更细的原因）') parts.push(f.reason)
  if (f.target) parts.push('（' + f.target + '）')
  return parts.join('：')
}
