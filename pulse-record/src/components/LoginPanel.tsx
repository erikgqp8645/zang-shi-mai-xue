/**
 * 登录页 —— 多用户模式下的入口
 *
 * 单机模式（服务端 PULSE_SINGLE_USER=1）：不用登录，直接进；
 *   页面会明写「单机模式」，免得使用者误判数据是不是共享的。
 * 多用户模式：登录名＋密码登录，或注册新账号。
 *
 * 声明（登录页也要有）：本工具只做记录，不构成诊断。
 */

import { useState } from 'react'
import { login, register, type AuthUser } from '../api/auth'

export interface LoginPanelProps {
  /** 单机模式（服务端不用登录） */
  single: boolean
  /** 单机模式下点「进入」时回调 */
  onEnterSingle: () => void
  /** 登录／注册成功后回调 */
  onLoggedIn: (user: AuthUser) => void
}

export function LoginPanel({ single, onEnterSingle, onLoggedIn }: LoginPanelProps) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [loginName, setLoginName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (tab === 'register') {
        const user = await register({ loginName, displayName, password })
        onLoggedIn(user)
      } else {
        const user = await login({ loginName, password })
        onLoggedIn(user)
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  if (single) {
    return (
      <div className="pr-login">
        <div className="pr-login-card">
          <h1>臧氏脉学 · 脉象记录表生成器</h1>
          <p className="pr-login-mode">当前是<b>单机模式</b>：这台机器上的数据只有本机能读写，不用登录。</p>
          <p className="pr-login-note">本工具只做记录，不构成诊断。</p>
          <button type="button" className="pr-login-submit" onClick={onEnterSingle}>
            进入
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pr-login">
      <div className="pr-login-card">
        <h1>臧氏脉学 · 脉象记录表生成器</h1>
        <p className="pr-login-note">本工具只做记录，不构成诊断。</p>

        <div className="pr-login-tabs">
          <button
            type="button"
            className={tab === 'login' ? 'pr-login-tab pr-login-tab-on' : 'pr-login-tab'}
            onClick={() => {
              setTab('login')
              setError(null)
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={tab === 'register' ? 'pr-login-tab pr-login-tab-on' : 'pr-login-tab'}
            onClick={() => {
              setTab('register')
              setError(null)
            }}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="pr-login-form">
          <label className="pr-login-label">
            登录名
            <input
              type="text"
              value={loginName}
              autoComplete="username"
              placeholder="11 位手机号，或 4~20 位字母开头的用户名"
              onChange={(e) => setLoginName(e.target.value)}
            />
          </label>

          {tab === 'register' && (
            <label className="pr-login-label">
              昵称<span className="pr-muted">（可不填，默认用登录名）</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
          )}

          <label className="pr-login-label">
            密码
            <input
              type="password"
              value={password}
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              placeholder={tab === 'register' ? '至少 6 位' : ''}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className="pr-login-error">{error}</p>}

          <button type="submit" className="pr-login-submit" disabled={busy}>
            {busy ? '请稍候…' : tab === 'register' ? '注册并进入' : '登录'}
          </button>
        </form>

        <p className="pr-login-tip">
          登录名就是你的账号。<b>在小程序上用同一个账号登录，就能看到这里的病例</b>——
          两端数据存在同一处，任一处改动，另一处刷新即见。
        </p>
      </div>
    </div>
  )
}
