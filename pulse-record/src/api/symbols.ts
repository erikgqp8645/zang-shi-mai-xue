/**
 * 自定义符号 API —— 存本机 SQLite（server/schema.sql 的 custom_symbols 表）
 *
 * 讲义 p33–34 的固定符号集之外的符号由使用者自建（如「涩」记作 S），
 * 存本机磁盘，不随清缓存消失，与病例记录同一套「永久存储」思路。
 */

import type { CustomSymbol } from '../domain/symbols'

/** 服务端没起／起不来时，给出可照做的提示 */
const OFFLINE = '连不上本地服务（/api/symbols）。请用 npm run start 起本地应用。'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new Error(OFFLINE)
  }
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`
    try {
      const body = await res.json()
      if (body?.error) msg = String(body.error)
    } catch {
      /* 保留默认信息 */
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
}

/** 自定义符号清单 */
export async function listCustomSymbols(): Promise<CustomSymbol[]> {
  const { symbols } = await request<{ symbols: CustomSymbol[] }>('/api/symbols')
  return symbols ?? []
}

/** 新增（或改名）一个自定义符号 */
export async function saveCustomSymbol(symbol: CustomSymbol): Promise<CustomSymbol> {
  const { symbol: saved } = await request<{ symbol: CustomSymbol }>('/api/symbols', {
    method: 'POST',
    body: JSON.stringify({ code: symbol.code, name: symbol.name }),
  })
  return saved
}

/** 删除一个自定义符号（已录入的历史符号不受影响） */
export async function deleteCustomSymbol(code: string): Promise<void> {
  await request<{ ok: true }>(`/api/symbols/${encodeURIComponent(code)}`, { method: 'DELETE' })
}
