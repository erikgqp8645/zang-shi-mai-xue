/**
 * 管理员命令行 —— 账号维护（不做可视化后台）
 *
 * 用法：
 *   npm run admin -- list                          列出所有账号
 *   npm run admin -- create <登录名> <密码> [昵称]  建一个账号（普通用户）
 *   npm run admin -- create-admin <登录名> <密码>   建一个管理员账号
 *   npm run admin -- reset <登录名> <新密码>        重置密码（会清掉该账号所有会话）
 *   npm run admin -- role <登录名> admin|user       改角色
 *   npm run admin -- wechat <登录名>                看该账号的微信绑定状态
 *   npm run admin -- claim <登录名>                 把内置单机账号名下的老数据转给该账号
 *   npm run admin -- claim-local <登录名>           把该账号名下的数据转给内置单机账号（桌面版用）
 *   npm run admin -- bind-wechat <登录名> <openid>  把 openid 手动绑到账号上（运维兜底）
 *
 * 直接操作本机 SQLite（server/db.mjs），不经过 HTTP —— 所以服务器上也能用。
 */

import { openDb, getLocalUser } from '../server/db.mjs'
import {
  authenticate,
  bindWechatIdentity,
  createUser,
  findUserByWechat,
  getUserById,
  hasWechatIdentity,
  resetPassword,
} from '../server/auth.mjs'

const [, , cmd, ...args] = process.argv

function die(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const db = openDb()

/** 按登录名取账号 */
function byLoginName(loginName) {
  return db.prepare('SELECT * FROM users WHERE login_name = ?').get(String(loginName ?? ''))
}

switch (cmd) {
  case 'list': {
    const rows = db.prepare('SELECT id, login_name, display_name, role, created_at FROM users ORDER BY created_at').all()
    if (rows.length === 0) console.log('（还没有账号）')
    for (const r of rows) {
      const ident = db
        .prepare('SELECT provider, external_id FROM identities WHERE user_id = ?')
        .all(r.id)
        .map((i) => i.provider === 'wechat' ? `微信:${i.external_id.slice(0, 8)}…` : i.provider)
        .join(' ')
      console.log(
        `${r.login_name}\t${r.display_name}\t${r.role}\t${ident}\t${new Date(r.created_at).toLocaleString('zh-CN')}`,
      )
    }
    break
  }

  case 'create':
  case 'create-admin': {
    const [loginName, password, displayName] = args
    if (!loginName || !password) die('用法：npm run admin -- create <登录名> <密码> [昵称]')
    const result = await createUser(db, { loginName, displayName, password })
    if (result.error) {
      const map = {
        invalid_login_name: '登录名要用 11 位手机号，或 4~20 位字母开头的字母数字下划线',
        weak_password: '密码至少 6 位',
        login_name_taken: '这个登录名已经被用了',
      }
      die(map[result.error] ?? result.error)
    }
    if (cmd === 'create-admin') {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(result.user.id)
    }
    console.log(`✓ 已创建：${loginName}（${cmd === 'create-admin' ? '管理员' : '普通用户'}）`)
    break
  }

  case 'reset': {
    const [loginName, password] = args
    if (!loginName || !password) die('用法：npm run admin -- reset <登录名> <新密码>')
    const row = byLoginName(loginName)
    if (!row) die('没有这个账号')
    const r = await resetPassword(db, row.id, password)
    if (r.error) die(r.error === 'weak_password' ? '密码至少 6 位' : '重置失败')
    console.log(`✓ 已重置 ${loginName} 的密码（该账号的登录状态已全部失效）`)
    break
  }

  case 'role': {
    const [loginName, role] = args
    if (!loginName || !['admin', 'user'].includes(role)) die('用法：npm run admin -- role <登录名> admin|user')
    const row = byLoginName(loginName)
    if (!row) die('没有这个账号')
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, row.id)
    console.log(`✓ ${loginName} 的角色改为 ${role}`)
    break
  }

  case 'claim': {
    // 把内置单机账号（local）名下的老数据转给指定账号。
    // 场景：单机时代录的病例，升级到多用户后老数据归在 local 名下，
    // 新注册的账号看不到（隔离是对的，但数据得有人认领）。
    const [loginName] = args
    if (!loginName) die('用法：npm run admin -- claim <登录名>')
    const row = byLoginName(loginName)
    if (!row) die('没有这个账号')
    const local = await getLocalUser(db)
    if (!local) die('库里没有内置单机账号')
    if (local.id === row.id) die('这就是单机账号本身，没什么可转的')

    // 父子表一起转，保持 owner 一致（visit→patient、medication→visit 的归属不变）
    let total = 0
    db.exec('BEGIN')
    try {
      for (const table of ['patients', 'visits', 'medication', 'custom_symbols']) {
        const n = db
          .prepare(`UPDATE ${table} SET owner_id = ? WHERE owner_id = ?`)
          .run(row.id, local.id).changes
        total += n
        if (n > 0) console.log(`  ${table}：转了 ${n} 行`)
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      die(`转移失败：${e?.message ?? e}`)
    }
    console.log(`✓ 已把内置单机账号名下的 ${total} 行数据转给 ${loginName}`)
    console.log('  （登录该账号就能看到这些记录了；数据本身一个字节没改，只换了归属）')
    break
  }

  case 'claim-local': {
    // 把某个账号名下的数据转给内置单机账号（local）—— 与 claim 方向相反。
    // 场景：多用户时代录的病例要带进桌面版（桌面版是单机免登录，
    // 所有请求都归到 local 名下，不转过去就一条也看不到）。
    const [loginName] = args
    if (!loginName) die('用法：npm run admin -- claim-local <登录名>')
    const row = byLoginName(loginName)
    if (!row) die('没有这个账号')
    const local = await getLocalUser(db)
    if (!local) die('库里没有内置单机账号')
    if (local.id === row.id) die('这就是单机账号本身，没什么可转的')

    // 父子表一起转，保持 owner 一致（visit→patient、medication→visit 的归属不变）
    let total = 0
    db.exec('BEGIN')
    try {
      for (const table of ['patients', 'visits', 'medication', 'custom_symbols']) {
        const n = db
          .prepare(`UPDATE ${table} SET owner_id = ? WHERE owner_id = ?`)
          .run(local.id, row.id).changes
        total += n
        if (n > 0) console.log(`  ${table}：转了 ${n} 行`)
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      die(`转移失败：${e?.message ?? e}`)
    }
    console.log(`✓ 已把 ${loginName} 名下的 ${total} 行数据转给内置单机账号（local）`)
    console.log('  （桌面版是单机免登录，转过去才看得见；数据本身一个字节没改，只换了归属）')
    break
  }

  case 'wechat': {
    const [loginName] = args
    if (!loginName) die('用法：npm run admin -- wechat <登录名>')
    const row = byLoginName(loginName)
    if (!row) die('没有这个账号')
    const bound = await hasWechatIdentity(db, row.id)
    const ident = db
      .prepare("SELECT external_id, union_id FROM identities WHERE user_id = ? AND provider = 'wechat'")
      .get(row.id)
    console.log(bound ? `✓ 已绑定微信：openid=${ident?.external_id}` : '（未绑定微信）')
    break
  }

  case 'bind-wechat': {
    // 运维兜底：把某个 openid 手动绑到账号上（正常流程是在小程序里用账号密码绑）
    const [loginName, openid] = args
    if (!loginName || !openid) die('用法：npm run admin -- bind-wechat <登录名> <openid>')
    const row = byLoginName(loginName)
    if (!row) die('没有这个账号')
    const existing = await findUserByWechat(db, openid)
    if (existing && existing.id !== row.id) die('这个 openid 已经绑到别的账号上了')
    const r = await bindWechatIdentity(db, row.id, openid)
    if (r.error) die(r.error)
    console.log(`✓ 已把 openid 绑到 ${loginName}`)
    break
  }

  case 'verify': {
    // 自检：账号密码能不能对上（排查「明明密码没错却登不上」）
    const [loginName, password] = args
    if (!loginName || !password) die('用法：npm run admin -- verify <登录名> <密码>')
    const r = await authenticate(db, loginName, password)
    console.log(r.error ? `✗ ${r.error}` : `✓ 密码正确：${JSON.stringify(r.user)}`)
    break
  }

  default:
    console.log(`臧氏脉学 · 账号管理

  npm run admin -- list                          列出所有账号
  npm run admin -- create <登录名> <密码> [昵称]  建一个普通账号
  npm run admin -- create-admin <登录名> <密码>   建一个管理员账号
  npm run admin -- reset <登录名> <新密码>        重置密码
  npm run admin -- role <登录名> admin|user       改角色
  npm run admin -- claim <登录名>                  把内置单机账号名下的老数据转给该账号
  npm run admin -- claim-local <登录名>            把该账号名下的数据转给内置单机账号（桌面版用）
  npm run admin -- wechat <登录名>                看微信绑定状态
  npm run admin -- bind-wechat <登录名> <openid>  手动绑微信（运维兜底）
  npm run admin -- verify <登录名> <密码>         自检密码
`)
    break
}

db.close()
