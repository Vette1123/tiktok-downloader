'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Surface } from './Surface'

type AccessState = 'checking' | 'ready' | 'locked' | 'unconfigured'

export function PrivateGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AccessState>('checking')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/private/status', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as {
          configured?: boolean
          authenticated?: boolean
        }
        if (!active) return
        setState(
          !data.configured
            ? 'unconfigured'
            : data.authenticated
              ? 'ready'
              : 'locked',
        )
      })
      .catch(() => active && setState('locked'))
    return () => {
      active = false
    }
  }, [])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch('/api/private/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = (await response.json()) as { success?: boolean; error?: string }
      if (!response.ok || !data.success) {
        setMessage(data.error || '登录失败，请检查账号和密码。')
        return
      }
      setPassword('')
      setState('ready')
    } catch {
      setMessage('无法连接服务器，请稍后再试。')
    } finally {
      setSubmitting(false)
    }
  }

  async function logout() {
    await fetch('/api/private/logout', { method: 'POST' }).catch(() => null)
    setState('locked')
    setUsername('')
    setPassword('')
  }

  if (state === 'checking') {
    return (
      <Surface radius='3xl' elevation='raised' className='p-8 text-center'>
        <p className='text-sm text-white/70'>正在检查访问权限……</p>
      </Surface>
    )
  }

  if (state === 'unconfigured') {
    return (
      <Surface radius='3xl' elevation='raised' className='space-y-3 p-6'>
        <h2 className='text-xl font-bold text-white'>私人访问尚未配置</h2>
        <p className='text-sm leading-relaxed text-white/70'>
          为防止解析接口被陌生人消耗，请先在 Cloudflare 的“变量和机密”中添加
          WEB_USERNAME、WEB_PASSWORD、SESSION_SECRET 和 SHORTCUT_API_KEY。
          配置完成后刷新本页。
        </p>
      </Surface>
    )
  }

  if (state === 'locked') {
    return (
      <Surface
        glow
        radius='3xl'
        elevation='raised'
        className='mx-auto w-full max-w-md p-6 sm:p-8'
      >
        <div className='mb-6 text-center'>
          <h2 className='text-2xl font-bold text-white'>登录解析器</h2>
          <p className='mt-2 text-sm text-white/60'>
            登录成功后才能调用解析和媒体代理接口。
          </p>
        </div>
        <form onSubmit={login} className='space-y-4'>
          <label className='block space-y-2'>
            <span className='text-sm font-medium text-white/80'>账号</span>
            <input
              autoComplete='username'
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className='w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20'
              required
            />
          </label>
          <label className='block space-y-2'>
            <span className='text-sm font-medium text-white/80'>密码</span>
            <input
              type='password'
              autoComplete='current-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className='w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/20'
              required
            />
          </label>
          {message && (
            <p className='rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
              {message}
            </p>
          )}
          <button
            type='submit'
            disabled={submitting}
            className='btn-grad btn-press w-full rounded-xl px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-60'
          >
            {submitting ? '正在登录……' : '登录'}
          </button>
        </form>
        <p className='mt-5 text-center text-xs leading-relaxed text-white/45'>
          登录信息只通过 HTTPS 发送；浏览器仅保存 HttpOnly 签名会话，不保存
          Instagram Cookie。
        </p>
      </Surface>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex justify-end'>
        <button
          type='button'
          onClick={logout}
          className='btn-ghost btn-press rounded-lg px-3 py-1.5 text-xs text-white/70'
        >
          退出登录
        </button>
      </div>
      {children}
    </div>
  )
}

