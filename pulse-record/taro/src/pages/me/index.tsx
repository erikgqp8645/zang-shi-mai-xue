import { useCallback, useState } from 'react'
import { Button, Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { request as platformRequest } from '../../platform/request'
import { cloudAvailable, cloudErrorMessage } from '../../platform/cloud'
import {
  changePassword as changePasswordApi,
  logout as authLogout,
  me as authMe,
  unbindWechat as unbindWechatApi,
} from '../../utils/auth'
import {
  API_BASE,
  TRANSPORT,
  normalizeBase,
  resetApiBase as resetApiBaseConfig,
  resolveApiBase,
  setApiBase as setApiBaseConfig,
} from '../../utils/config'
import { health } from '../../utils/data'
import { getUser } from '../../utils/storage'
import type { StoredUser } from '../../utils/storage'

import './index.scss'

/**
 * tab 4 · 我的 —— 账号信息、微信绑定、服务器地址、改密码、退出登录
 *
 * 账号模型（与服务端一致）：一个 users 账号挂多种登录身份。
 * 微信绑定状态由服务端给（/api/auth/me 的 wechatBound），不本地猜。
 *
 * 与原生版的差别只有一处：原生版从 `getApp().globalData` 读「服务端模式／存储位置」，
 * Taro 侧没有全局 App 对象 —— 改为每次进页面探一次 `/api/health`（utils/data.ts 的 health()），
 * 与「病例」页同一套写法。
 */

/** /api/health 的返回体 */
interface HealthBody {
  ok?: boolean
  db?: string
  mode?: string
}

/** 输入框事件 */
interface InputEvt {
  detail: { value: string }
}

/** 探测结果 */
interface ProbeResult {
  ok: boolean
  body?: HealthBody
  error?: string
}

/** 弹一个确认框 */
function confirmModal(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    Taro.showModal({
      title,
      content,
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    })
  })
}

/** 给一个请求加超时（原生版探活是 8000ms） */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject({ errMsg: 'request:fail timeout' }), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * 探一次某个地址的 /api/health
 *
 * 不走 utils/api.ts —— 那是认令牌的，这里要测的是「这个地址通不通」，
 * 得能对还没保存的地址试，所以直接用平台适配层的 request。
 */
async function probe(base: string): Promise<ProbeResult> {
  try {
    const res = await withTimeout(
      platformRequest({ url: base + '/api/health', method: 'GET' }),
      8000,
    )
    const body = (res.data || {}) as HealthBody
    if (res.statusCode === 200 && body.ok) return { ok: true, body }
    return {
      ok: false,
      error: '服务有响应但不像本项目的后端（HTTP ' + res.statusCode + '）',
    }
  } catch (err) {
    const msg =
      (err as { errMsg?: string })?.errMsg || (err as Error)?.message || '连不上'
    return { ok: false, error: msg }
  }
}

export default function Me() {
  const [loginName, setLoginName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('')
  const [wechatBound, setWechatBound] = useState(false)
  const [mode, setMode] = useState('multi')
  const [dbPath, setDbPath] = useState('')
  /** 当前实际连的服务器地址 */
  const [apiBase, setApiBase] = useState('')
  /** 输入框里的地址（可能还没保存） */
  const [apiBaseInput, setApiBaseInput] = useState('')
  const [apiHint, setApiHint] = useState('')
  const [apiTesting, setApiTesting] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  /** 同步当前地址到界面（改完、恢复默认后都走这里） */
  const refreshApiBase = useCallback(() => {
    const base = resolveApiBase()
    setApiBase(base)
    setApiBaseInput(base)
  }, [])

  /**
   * 实际在走哪条传输。
   *
   * **必须显示出来** —— 云通道失败时 api.ts 会静默退回直连（这是有意设计，
   * 为了避免整屏报错），代价是「转换到底生效没有」从界面上完全看不出来。
   * 这一行是判断「环境转换是否成功」的唯一直接依据：
   * 显示「云函数」= 通了；显示「直连（云通道不可用：…）」= 没通，括号里就是原因。
   */
  const transportText = (): string => {
    if (TRANSPORT !== 'cloud') return '直连（request，编译期固定）'
    if (cloudAvailable()) return '云函数（callFunction）'
    return '直连（云通道不可用：' + (cloudErrorMessage() || '未初始化') + '）'
  }

  /** 拉一次当前登录者 */
  const refresh = useCallback(async () => {
    try {
      const res = (await authMe()) as { user?: StoredUser; wechatBound?: boolean }
      const u = res?.user
      setLoginName(u?.loginName || '')
      setDisplayName(u?.displayName || '')
      setRole(typeof u?.role === 'string' ? u.role : '')
      setWechatBound(!!res?.wechatBound)
      setError('')
    } catch (e) {
      // 未登录／令牌失效时 api 层会跳登录页，这里只记录原因
      setError((e as Error)?.message || '读取账号信息失败')
    }
  }, [])

  useDidShow(() => {
    refreshApiBase()
    const cached = getUser()
    if (cached) {
      setLoginName(cached.loginName || '')
      setDisplayName(cached.displayName || '')
      setRole(typeof cached.role === 'string' ? cached.role : '')
    }
    refresh()
    health()
      .then((h) => {
        const body = (h || {}) as HealthBody
        if (body.mode) setMode(body.mode)
        setDbPath(body.db || '')
      })
      .catch(() => undefined)
  })

  /* ------------------------------ 服务器地址 ------------------------------ */

  /** 探一个地址，顺带把「连不上时先查什么」写在提示里 */
  const testBase = useCallback(async (base: string): Promise<ProbeResult> => {
    const res = await probe(base)
    if (res.ok) return res
    const msg = res.error || '连不上'
    // 本机地址与云端地址的排查方向完全不同，不能混着提示
    const isLocal = /\/\/(127\.0\.0\.1|localhost|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base)
    const hint = /url not in domain list|合法域名/.test(msg)
      ? '（域名校验没开：开发工具 → 详情 → 本地设置 → 勾「不校验合法域名…」；真机 → 右上「…」→ 打开调试）'
      : /timeout|fail|ERR_|超时/i.test(msg)
        ? isLocal
          ? '（手机与电脑要连同一个 Wi-Fi；电脑防火墙放行该端口；后端要监听 0.0.0.0 而不是 127.0.0.1）'
          : '（云端地址连不上：先确认网关是否还在、手机网络是否正常）'
        : ''
    return { ok: false, error: msg + hint }
  }, [])

  const handleApiBaseInput = useCallback((e: InputEvt) => {
    setApiBaseInput(e.detail.value)
    setApiHint('')
  }, [])

  const saveApiBase = useCallback(async () => {
    const res = setApiBaseConfig(apiBaseInput)
    if (!res.ok) {
      setApiHint(res.error || '保存失败')
      setApiBase(res.base)
      return
    }
    setApiBase(res.base)
    setApiBaseInput(res.base)
    setApiHint('已保存，正在测试连接…')
    const probeResult = await testBase(res.base)
    if (probeResult.ok) {
      const body = probeResult.body || {}
      setApiHint(
        '连接正常（' +
          (body.mode === 'single' ? '单机模式，不用登录' : '多用户模式，需要登录') +
          '）。重新进一次页面即可按新地址取数据。',
      )
      if (body.mode) setMode(body.mode)
    } else {
      setApiHint('已保存，但连不上：' + (probeResult.error || ''))
    }
  }, [apiBaseInput, testBase])

  const testApiBase = useCallback(async () => {
    if (apiTesting) return
    const base = normalizeBase(apiBaseInput)
    if (!base) {
      setApiHint('地址要以 http:// 或 https:// 开头')
      return
    }
    setApiTesting(true)
    setApiHint('')
    const res = await testBase(base)
    if (res.ok) {
      const body = res.body || {}
      setApiHint(
        '连接正常：' +
          (body.mode === 'single' ? '单机模式（不用登录）' : '多用户模式（需要登录）') +
          (body.db ? '｜库：' + body.db : ''),
      )
    } else {
      setApiHint('连不上：' + (res.error || ''))
    }
    setApiTesting(false)
  }, [apiBaseInput, apiTesting, testBase])

  const resetApiBase = useCallback(() => {
    const res = resetApiBaseConfig()
    setApiBase(res.base)
    setApiBaseInput(res.base)
    setApiHint('已恢复默认地址：' + res.base)
  }, [])

  /* ------------------------------ 账号操作 ------------------------------ */

  const handleOldPassword = useCallback((e: InputEvt) => {
    setOldPassword(e.detail.value)
  }, [])

  const handleNewPassword = useCallback((e: InputEvt) => {
    setNewPassword(e.detail.value)
  }, [])

  const changePassword = useCallback(async () => {
    if (busy) return
    if (!oldPassword || !newPassword) {
      setError('原密码与新密码都要填')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await changePasswordApi(oldPassword, newPassword)
      setNotice('密码已改。改密码后全部会话失效，需要重新登录。')
      setOldPassword('')
      setNewPassword('')
      await authLogout()
      Taro.reLaunch({ url: '/pages/login/index' })
    } catch (e) {
      setError((e as Error)?.message || '改密码失败')
    } finally {
      setBusy(false)
    }
  }, [busy, oldPassword, newPassword])

  const unbindWechat = useCallback(async () => {
    const ok = await confirmModal(
      '解绑微信？',
      '解绑后这个微信再打开小程序要重新输入网站账号和密码。',
    )
    if (!ok) return
    try {
      await unbindWechatApi()
      setWechatBound(false)
      setNotice('已解绑微信。')
    } catch (e) {
      Taro.showToast({ title: (e as Error)?.message || '解绑失败', icon: 'none' })
    }
  }, [])

  /** 隐私政策 —— 审核要求「小程序内可见」，从「我的」页一键可达 */
  const goPrivacy = useCallback(() => {
    Taro.navigateTo({ url: '/pages/privacy/index' })
  }, [])

  const logout = useCallback(async () => {
    const ok = await confirmModal('退出登录？', '数据仍存在服务器上，重新登录即可看到。')
    if (!ok) return
    await authLogout()
    setLoginName('')
    setDisplayName('')
    setRole('')
    setWechatBound(false)
    Taro.reLaunch({ url: '/pages/login/index' })
  }, [])

  return (
    <View className="pr-page">
      {error ? <View className="pr-note pr-err">{error}</View> : null}
      {notice ? <View className="pr-note pr-ok">{notice}</View> : null}

      <View className="pr-card">
        <View className="pr-card-title">账号</View>
        <View className="pr-me-row">
          <Text className="pr-me-key">登录名</Text>
          <Text className="pr-me-val">{loginName || '（未登录）'}</Text>
        </View>
        <View className="pr-me-row">
          <Text className="pr-me-key">显示名称</Text>
          <Text className="pr-me-val">{displayName || '—'}</Text>
        </View>
        <View className="pr-me-row">
          <Text className="pr-me-key">身份</Text>
          <Text className="pr-me-val">{role === 'admin' ? '管理员' : '普通用户'}</Text>
        </View>
        <View className="pr-me-row">
          <Text className="pr-me-key">模式</Text>
          <Text className="pr-me-val">
            {mode === 'single' ? '单机模式（数据只在本机）' : '多用户模式（按账号隔离）'}
          </Text>
        </View>
        {dbPath ? (
          <View className="pr-me-row">
            <Text className="pr-me-key">存储位置</Text>
            <Text className="pr-me-val pr-me-path">{dbPath}</Text>
          </View>
        ) : null}
      </View>

      <View className="pr-card">
        <View className="pr-card-title">微信绑定</View>
        {wechatBound ? (
          <View className="pr-note">已绑定。微信与网站账号指向同一份病例数据。</View>
        ) : (
          <View className="pr-note">
            未绑定。绑定后用微信就能直接进入，看到的是网站上的同一份病例。
          </View>
        )}
        {wechatBound ? (
          <View className="pr-btn pr-btn-sm pr-me-btn" onClick={unbindWechat}>
            解绑微信
          </View>
        ) : null}
      </View>

      <View className="pr-card">
        <View className="pr-card-title">隐私政策</View>
        <View className="pr-note">
          我们收集哪些信息、为什么收集、保存多久、怎么删 —— 都在这一页里写明了。
        </View>
        <View className="pr-btn pr-btn-sm" onClick={goPrivacy}>
          查看隐私政策
        </View>
      </View>

      <View className="pr-card">
        <View className="pr-card-title">服务器</View>
        <View className="pr-note">
          小程序连的是哪台服务。默认是打包时写进去的地址（下方「恢复默认」就是回到它）；
          本机联调时改成电脑的局域网地址（如 http://192.168.1.20:5178）。
          改这里不用改代码、不用重新编译。
        </View>
        <View className="pr-me-row">
          <Text className="pr-me-key">传输方式</Text>
          <Text className="pr-me-val">{transportText()}</Text>
        </View>
        <View className="pr-me-row">
          <Text className="pr-me-key">当前连接</Text>
          <Text className="pr-me-val pr-me-path">{apiBase}</Text>
        </View>
        <View className="pr-label">服务器地址</View>
        <Input
          className="pr-input"
          value={apiBaseInput}
          placeholder={API_BASE}
          onInput={handleApiBaseInput}
        />
        <View className="pr-me-actions">
          <View className="pr-btn pr-btn-sm" onClick={saveApiBase}>
            保存
          </View>
          <View className="pr-btn pr-btn-sm" onClick={testApiBase}>
            {apiTesting ? '测试中…' : '测试连接'}
          </View>
          <View className="pr-btn pr-btn-sm" onClick={resetApiBase}>
            恢复默认
          </View>
        </View>
        {apiHint ? <View className="pr-note pr-me-hint">{apiHint}</View> : null}
      </View>

      <View className="pr-card">
        <View className="pr-card-title">改密码</View>
        <View className="pr-note">改完后全部会话失效，需要重新登录。</View>
        <View className="pr-label">原密码</View>
        <Input
          className="pr-input"
          password
          value={oldPassword}
          placeholder="原密码"
          onInput={handleOldPassword}
        />
        <View className="pr-label">新密码（至少 6 位）</View>
        <Input
          className="pr-input"
          password
          value={newPassword}
          placeholder="新密码"
          onInput={handleNewPassword}
        />
        <Button
          className="pr-btn pr-btn-primary pr-btn-block pr-me-btn"
          loading={busy}
          onClick={changePassword}
        >
          改密码
        </Button>
      </View>

      <Button className="pr-btn pr-btn-block" onClick={logout}>
        退出登录
      </Button>

      <View className="pr-disclaimer pr-me-disclaimer">
        本工具只做记录，不构成诊断。体质的判定由使用者自己判断后手工选定，工具不代判、不开方。
      </View>
    </View>
  )
}
