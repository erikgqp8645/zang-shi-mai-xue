/**
 * 用方知识库 · 覆盖层的读写接口（网站端 ③ 的编辑／删除按钮走这里）
 *
 * ## 三个动词 + 一个改
 *
 * | 接口 | 对应命令行 | 干什么 |
 * |---|---|---|
 * | `PATCH /api/library/entries/:kind/:id` | `library set --set 字段=值` | **改一条**（字段级） |
 * | `DELETE /api/library/entries/:kind/:id` | `library del` | **删一条**（写墓碑，带原内容快照） |
 * | `POST …/:id/restore` | `library restore` | **恢复默认**（撤覆盖层这一行 → 回基线） |
 * | `POST …/:id/revive` | `library revive` | **撤销删除**（把墓碑里的快照放回来） |
 *
 * ⚠️ `DELETE` 在这里是「**删除条目**」，不是「删覆盖行」——
 *   后者叫 `restore`。这一点在服务端的路由表注释里也写明了。
 *
 * ## 权限
 *
 * 写接口**仅管理员**（服务端 403）；读接口登录即可 ——
 * 知识库是公共资料，不同账号看到的必须是同一份。
 *
 * ## 不做本地缓存兜底
 *
 * 与 `src/api/patterns.ts` 同一纪律：保存失败必须**当场报错**，
 * 宁可让人重试 —— 静默拿旧内容顶上，用户会以为改动已经上线。
 */

import type { LibraryKind, LibraryOverrides } from '../domain/library-store'
import { request } from './http'

/** 「什么能改」的注册表（前端表单由它驱动 —— 前端不硬编码字段表） */
export async function listLibraryKinds(): Promise<Record<string, LibraryKind>> {
  const { kinds } = await request<{ kinds: Record<string, LibraryKind> }>('/api/library/kinds')
  return kinds ?? {}
}

/** 覆盖层的原始行（按种类、按条目 id 分组） */
export async function listLibraryOverrides(): Promise<LibraryOverrides> {
  const { overrides } = await request<{ overrides: LibraryOverrides }>('/api/library/overrides')
  return overrides ?? {}
}

/** 改一条（字段级：只传要改的字段，其余不动） */
export async function patchLibraryEntry(
  kind: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ entry: Record<string, unknown>; changed: string[] }> {
  return request<{ entry: Record<string, unknown>; changed: string[] }>(
    `/api/library/entries/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ patch }) },
  )
}

/** 删一条（写墓碑；墓碑里带原内容快照 ⇒ 之后能撤销） */
export async function deleteLibraryEntry(
  kind: string,
  id: string,
): Promise<{ id: string; kind: string; snapshot: Record<string, unknown>; hasSnapshot: boolean }> {
  return request<{ id: string; kind: string; snapshot: Record<string, unknown>; hasSnapshot: boolean }>(
    `/api/library/entries/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

/** 恢复默认（撤掉覆盖层这一行 → 回到内置基线） */
export async function restoreLibraryEntry(
  kind: string,
  id: string,
): Promise<{ id: string; kind: string; wasDeleted: boolean }> {
  return request<{ id: string; kind: string; wasDeleted: boolean }>(
    `/api/library/entries/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/restore`,
    { method: 'POST' },
  )
}

/** 撤销删除（把墓碑里的原内容快照放回去） */
export async function reviveLibraryEntry(
  kind: string,
  id: string,
): Promise<{ id: string; kind: string; entry: Record<string, unknown> }> {
  return request<{ id: string; kind: string; entry: Record<string, unknown> }>(
    `/api/library/entries/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/revive`,
    { method: 'POST' },
  )
}
