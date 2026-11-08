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
import { health } from '../../utils/data'

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
 *   本页的 `useEffect` **只探 `/api/health`**（判断是不是单机模式），
 *   绝不发起任何登录请求；`tryWechat()` 只挂在「微信一键登录」按钮的 `onClick` 上。
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
        // **只有单机模式自动进** —— 单机模式压根没有登录这回事。
        if (body.mode === 'single') {
          if (alive) setSingleMode(true)
          goCases()
        }
        // ⚠️ 多用户模式**不自动登录**（维护者 2026-11-08 明确要求）：
        //    进页面就发起微信登录，等于「用户还没点就替他登录了」——
        //    最典型的后果是**点「退出登录」根本退不掉**：
        //    退出 → 跳回本页 → 这里又自动登录 → 又进去了（等于没退）。
        //    所以微信登录**只能由用户点「微信一键登录」发起**。
      })
      .catch(() => {
        // 探不到服务端（默认多用户模式）—— 也停在这一步，等用户自己点。
        // 不猜、不自动尝试。
      })
    return () => {
      alive = false
    }
  }, [goCases])

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

  return (
    <View className="pr-page pr-login">
      <View className="pr-login-head">
        <View className="pr-login-title">臧氏脉学</View>
        <View className="pr-login-sub">脉象记录表生成器</View>
      </View>

      <View className="pr-disclaimer">
        本工具只做记录，不构成诊断。体质的判定由使用者自己判断后手工选定，工具不代判、不开方。
      </View>

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
    </View>
  )
}
