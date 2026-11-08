import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

import {
  login as authLogin,
  me as authMe,
  register as authRegister,
  wechatBind,
  wechatLogin,
} from '../../utils/auth'
import { entryKind } from '../../utils/auth-flow'
import { buildLabel } from '../../utils/build'
import { health } from '../../utils/data'
import type { NetFailure } from '../../utils/net-error'
import { clearLoggedOutMark, wasLoggedOut } from '../../utils/storage'
import NetError from '../../components/net-error'

import './index.scss'

/**
 * 登录页 —— 微信登录 / 账号密码绑定 / 账号密码登录 / 注册
 *
 * 账号模型（与服务端一致）：一个 users 账号挂多种登录身份。
 * 小程序用「网站账号＋密码」把微信身份绑到同一个账号上 —— 绑定后两端看到同一份数据。
 *
 * 流程：
 *   登录 code → 服务端换 openid
 *     ├ 已绑定 → 签发令牌 → 直接进
 *     └ 未绑定 → need_bind → 本页引导输入「网站账号＋密码」绑定
 *                  （也可以直接在这里注册一个新账号）
 *
 * 服务端没配微信时，会明确提示原因，这时可以直接用「账号密码登录」进。
 *
 * ⚠️ **微信登录只能由用户点按钮发起**（维护者 2026-11-08 明确要求）：
 *   进页面就自动 `wechatLogin()` 是错的 —— 那等于「用户还没点就替他登录了」，
 *   最典型的后果是**点「退出登录」根本退不掉**（退出 → 回本页 → 又自动登录 → 又进去了）。
 *   本页的 `useEffect` **只探 `/api/health`**（判断是单机还是多用户模式），
 *   绝不发起任何登录请求；`tryWechat()` 只挂在「微信一键登录」按钮的 `onClick` 上。
 *
 * ⚠️ **单机模式也不自动进**（维护者 2026-11-08 补充拍板）：
 *   单机模式那条路**压根不登录** —— 它是 `health()` 说「我是单机模式」→ 直接进。
 *   所以只修「不自动登录」修不掉它：退出登录后照样被自动带回病例页。
 *   → 现在**两种模式都得用户点一下**：
 *     多用户模式 → 点「微信一键登录」；单机模式 → 点「进入（单机模式）」。
 *   规则统一收在 `utils/auth-flow.ts` 的 `entryKind(mode)`（只有这一处）。
 *
 * 与原生版的差别只有一处：原生版从 `getApp().globalData.mode` 读「是不是单机模式」，
 * Taro 侧没有全局 App 对象 —— 改为进页面时探一次 `/api/health`（utils/data.ts 的 health()），
 * 与「病例」页同一套写法。
 */

/** 'wechat' 首次进 | 'bind' 要绑账号 | 'account' 账号密码登录 | 'register' 注册 */
type Step = 'wechat' | 'bind' | 'account' | 'register'

/** 输入框事件 */
interface InputEvt {
  detail: { value: string }
}

/** /api/health 的返回体 */
interface HealthBody {
  mode?: string
}

export default function Login() {
  const [step, setStep] = useState<Step>('wechat')
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 服务端是单机模式时为 true —— 不用登录 */
  const [singleMode, setSingleMode] = useState(false)
  /**
   * 用户刚点过「退出登录」→ 在登录页说明一句
   *
   * ⚠️ **它不再决定「要不要自动进去」** —— 现在一律不自动进（一律要点一下）。
   *    这个标记现在只负责**告知**：「你刚才退出了登录，要用请点下面的按钮」。
   */
  const [justLoggedOut, setJustLoggedOut] = useState(false)
  /**
   * 探不到服务端时的**网络诊断**
   *
   * ⚠️ 旧代码这里是 `.catch(() => undefined)` —— 静默失败。
   *    后果：真机上没配域名 / 地址填成 127.0.0.1 时，
   *    登录页看起来一切正常（正常显示「微信一键登录」），
   *    等使用者点下去才在别处报错，而且看不出原因。
   *    → 现在探活失败**当场把诊断说出来**。
   */
  const [netError, setNetError] = useState<NetFailure | null>(null)

  /** 登录成功 → 回病例 tab */
  const goCases = useCallback(() => {
    Taro.switchTab({ url: '/pages/cases/index' })
  }, [])

  /** 试一次微信登录：已绑定就直接进，没绑定就转去绑定 */
  const tryWechat = useCallback(async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await wechatLogin()
      if (res && res.status === 'bound') {
        clearLoggedOutMark()
        goCases()
        return
      }
      setStep('bind')
      setNotice('这个微信还没绑定账号。输入网站上的账号和密码，绑定后两端看到同一份病例。')
    } catch (e) {
      setStep('account')
      setNotice('')
      setError((e as Error)?.message || '微信登录失败')
    } finally {
      setBusy(false)
    }
  }, [goCases])

  useEffect(() => {
    let alive = true
    health()
      .then((h) => {
        const body = (h || {}) as HealthBody
        const mode = body.mode || ''
        // ⚠️ **这里只判断「显示哪种入口」，绝不自动进** ——
        //    规则只有一处：utils/auth-flow.ts 的 entryKind(mode)
        //      · multi  → 显示「微信一键登录」，用户点了才发起登录；
        //      · single → 显示「进入（单机模式）」，用户点了才进病例页。
        //
        //    ⚠️⚠️ **不要在这里调 `goCases()`** —— 那是「自动进入」，
        //    维护者 2026-11-08 明确要求：任何模式都得用户点一下。
        //    （旧代码在这句 `if (body.mode === 'single') goCases()` ——
        //      点「退出登录」后被自动带回病例页，就是它干的。）
        if (alive) setSingleMode(entryKind(mode) === 'single-enter')
        if (alive) setJustLoggedOut(wasLoggedOut())
        if (alive) setNetError(null)
      })
      .catch((e) => {
        // 探不到服务端（默认多用户模式）—— 也停在这一步，等用户自己点。
        // 不猜、不自动尝试。
        // ⚠️ 但**不能静默**：把原因说出来（2026-11-08 真机「网络请求失败」的教训）。
        if (!alive) return
        const d = (e as { detail?: NetFailure })?.detail
        if (d) setNetError(d)
      })
    return () => {
      alive = false
    }
  }, [])

  const handleLoginName = useCallback((e: InputEvt) => {
    setLoginName(e.detail.value)
  }, [])

  const handlePassword = useCallback((e: InputEvt) => {
    setPassword(e.detail.value)
  }, [])

  const handleDisplayName = useCallback((e: InputEvt) => {
    setDisplayName(e.detail.value)
  }, [])

  /** 账号密码登录（不绑定微信） */
  const onLogin = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await authLogin(loginName.trim(), password)
      clearLoggedOutMark()
      goCases()
    } catch (e) {
      setError((e as Error)?.message || '登录失败')
    } finally {
      setBusy(false)
    }
  }, [busy, loginName, password, goCases])

  /** 用网站账号＋密码把当前微信绑上 */
  const onBind = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await wechatBind(loginName.trim(), password)
      clearLoggedOutMark()
      goCases()
    } catch (e) {
      setError((e as Error)?.message || '绑定失败')
    } finally {
      setBusy(false)
    }
  }, [busy, loginName, password, goCases])

  /** 注册新账号（同时把当前微信绑上） */
  const onRegister = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError('')
    const name = displayName.trim() || loginName.trim()
    try {
      // 先注册（注册即登录），再把微信身份绑到这个账号上
      await authRegister(loginName.trim(), name, password)
      await wechatBind(loginName.trim(), password)
      await authMe()
      clearLoggedOutMark()
      goCases()
    } catch (e) {
      setError((e as Error)?.message || '注册失败')
    } finally {
      setBusy(false)
    }
  }, [busy, loginName, displayName, password, goCases])

  const goAccount = useCallback(() => {
    setStep('account')
    setError('')
    setNotice('')
  }, [])

  const goBind = useCallback(() => {
    setStep('bind')
    setError('')
    setNotice('')
  }, [])

  const goRegister = useCallback(() => {
    setStep('register')
    setError('')
    setNotice('')
  }, [])

  /**
   * 「微信一键登录」按钮的点击处理 —— **微信登录唯一的入口**
   *
   * ⚠️ 别再把 `tryWechat()` 挂到 `useEffect` 上自动跑：
   *    那等于「用户没点就替他登录」，点「退出登录」会退不掉
   *    （退出 → 回本页 → 又自动登录 → 又进去了）。
   */
  const onWechatLogin = useCallback(() => {
    tryWechat()
  }, [tryWechat])

  /**
   * 「进入（单机模式）」—— **单机模式也不自动进**，用户点一下才进去
   *
   * 维护者 2026-11-08 拍板：「单机模式也要点一下才进去」。
   * 所以这台机器上**没有**任何自动进入的路径 —— 不管多用户还是单机，
   * 都得用户自己点一下。
   *
   * 单机模式没有账号、没有令牌，压根不存在「登录」这回事；
   * 但用户点了「退出登录」，就得**尊重这个动作** —— 不能替他自动进去。
   */
  const onEnterSingle = useCallback(() => {
    clearLoggedOutMark()
    setJustLoggedOut(false)
    goCases()
  }, [goCases])

  return (
    <View className="pr-page pr-login">
      <View className="pr-login-head">
        <View className="pr-login-title">臧氏脉学</View>
        <View className="pr-login-sub">脉象记录表生成器</View>
      </View>

      <View className="pr-disclaimer">
        本工具只做记录，不构成诊断。体质的判定由使用者自己判断后手工选定，工具不代判、不开方。
      </View>

      {/* 连不上服务端 —— 当场说清楚，不让使用者去猜 */}
      {netError ? <NetError detail={netError} extra='登录页探活失败（连不到服务器）' /> : null}

      {singleMode ? null : (
        <View className="pr-card">
          {/* 微信登录 */}
          {step === 'wechat' || step === 'bind' ? (
            <>
              <View className="pr-card-title">微信登录</View>
              <View className="pr-note">
                点下面的按钮才登录 —— 退出登录后不会自动再进来。
              </View>
              {notice ? <View className="pr-note">{notice}</View> : null}
              {error ? <View className="pr-note">{error}</View> : null}
              <Button
                className="pr-btn pr-btn-primary pr-btn-block"
                loading={busy}
                onClick={onWechatLogin}
              >
                微信一键登录
              </Button>
            </>
          ) : null}

          {/* 账号密码登录 */}
          {step === 'account' ? (
            <>
              <View className="pr-card-title">账号密码登录</View>
              {notice ? <View className="pr-note">{notice}</View> : null}
              {error ? <View className="pr-note">{error}</View> : null}
              <View className="pr-label">登录名（11 位手机号，或 4~20 位字母开头的用户名）</View>
              <Input
                className="pr-input"
                value={loginName}
                placeholder="登录名"
                onInput={handleLoginName}
              />
              <View className="pr-label">密码</View>
              <Input
                className="pr-input"
                password
                value={password}
                placeholder="密码（至少 6 位）"
                onInput={handlePassword}
              />
              <Button
                className="pr-btn pr-btn-primary pr-btn-block"
                loading={busy}
                onClick={onLogin}
              >
                登录
              </Button>
              <View className="pr-login-alt">
                <Text className="pr-link" onClick={goBind}>
                  用网站账号绑定微信
                </Text>
                <Text className="pr-link" onClick={goRegister}>
                  注册新账号
                </Text>
              </View>
            </>
          ) : null}

          {/* 绑定（网站账号＋密码） */}
          {step === 'bind' ? (
            <>
              <View className="pr-card-title">绑定网站账号</View>
              <View className="pr-note">
                输入你在网站上用的账号和密码。绑定后，小程序和网站看到的是同一份病例。
              </View>
              {error ? (
                <View className="pr-note" style={{ color: '#b03a2e' }}>
                  {error}
                </View>
              ) : null}
              <View className="pr-label">登录名</View>
              <Input
                className="pr-input"
                value={loginName}
                placeholder="登录名"
                onInput={handleLoginName}
              />
              <View className="pr-label">密码</View>
              <Input
                className="pr-input"
                password
                value={password}
                placeholder="密码"
                onInput={handlePassword}
              />
              <Button
                className="pr-btn pr-btn-primary pr-btn-block"
                loading={busy}
                onClick={onBind}
              >
                绑定并进入
              </Button>
              <View className="pr-login-alt">
                <Text className="pr-link" onClick={goAccount}>
                  用账号密码直接登录
                </Text>
                <Text className="pr-link" onClick={goRegister}>
                  注册新账号
                </Text>
              </View>
            </>
          ) : null}

          {/* 注册 */}
          {step === 'register' ? (
            <>
              <View className="pr-card-title">注册新账号</View>
              <View className="pr-note">注册后当前微信会自动绑定到这个账号，以后直接进。</View>
              {error ? (
                <View className="pr-note" style={{ color: '#b03a2e' }}>
                  {error}
                </View>
              ) : null}
              <View className="pr-label">登录名（11 位手机号，或 4~20 位字母开头的用户名）</View>
              <Input
                className="pr-input"
                value={loginName}
                placeholder="登录名"
                onInput={handleLoginName}
              />
              <View className="pr-label">显示名称（可不填，默认同登录名）</View>
              <Input
                className="pr-input"
                value={displayName}
                placeholder="显示名称"
                onInput={handleDisplayName}
              />
              <View className="pr-label">密码（至少 6 位）</View>
              <Input
                className="pr-input"
                password
                value={password}
                placeholder="密码（至少 6 位）"
                onInput={handlePassword}
              />
              <Button
                className="pr-btn pr-btn-primary pr-btn-block"
                loading={busy}
                onClick={onRegister}
              >
                注册并进入
              </Button>
              <View className="pr-login-alt">
                <Text className="pr-link" onClick={goAccount}>
                  已有账号，直接登录
                </Text>
              </View>
            </>
          ) : null}
        </View>
      )}

      {/* 单机模式 → 给一个「进入（单机模式）」按钮，由用户自己点 */}
      {singleMode ? (
        <View className="pr-card">
          <View className="pr-card-title">单机模式</View>
          <View className="pr-note">
            这台服务器是单机模式（数据只在这一台机器上），不用登录。
            {justLoggedOut ? '你刚才点了「退出登录」，所以没有自动带你进来。' : ''}
            要用就点下面的按钮。
          </View>
          <Button
            className="pr-btn pr-btn-primary pr-btn-block"
            onClick={onEnterSingle}
          >
            进入（单机模式）
          </Button>
        </View>
      ) : null}

      {/* 构建标识 —— 一眼确认「现在跑的是不是刚构建的那一份」 */}
      <View className="pr-build">{buildLabel()}</View>
    </View>
  )
}
