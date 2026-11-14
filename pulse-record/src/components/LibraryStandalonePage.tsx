import { useEffect, useState } from 'react'
import { FormulaLibrary } from './FormulaLibrary'

/**
 * 用方知识库 · 独立页面（地址 `/library`）
 *
 * ## 为什么单独一个地址
 *
 * `FormulaLibrary` 的「单独页面」不是把浮层撑满屏 —— 那样既不能收藏、也不能
 * 在新标签页并排看（对着病例查方时，一边一个标签最顺手）。这里给的是一个真实的
 * 页面地址，服务端的静态托管已经带 SPA 回退（找不到文件就返回 `index.html`），
 * 所以 `/library` 直接可用，不需要另加路由库。
 *
 * ## 与主页面共用一份内容
 *
 * 内容仍然是同一个 `FormulaLibrary`（`forceMode="page"`），搜索／维度／编辑／
 * 定位逻辑一份。这里只负责页面壳：标题、说明、返回记录表。
 *
 * ⚠️ 登录态靠同源 `localStorage['pulse.token']` —— 与主页面是同一个源，所以
 *    在主页面登录过，这里打开就是登录状态。
 */
export function LibraryStandalonePage({ canEdit }: { canEdit: boolean }) {
  /** 常驻条目（用药禁忌）显不显示 —— 本页自己的开关，与主页面互不影响 */
  const [showStanding, setShowStanding] = useState(true)

  // 标签页标题 —— 收藏夹里看得出来这是「用方知识库」而不是记录表
  useEffect(() => {
    const prev = document.title
    document.title = '用方知识库 · 臧氏脉学'
    return () => {
      document.title = prev
    }
  }, [])

  return (
    <div className="pr-app pr-lib-page">
      <header className="pr-lib-page-head">
        <div className="pr-lib-page-titles">
          <h1>用方知识库</h1>
          <p className="pr-sub">
            讲义 2026-10·p44「依脉用方」＋ 讲稿 2010·第二讲方剂 ＋ 同和堂版《方剂汇总统表》。
            三种资料并列，剂量单位各按原文（讲稿用比例制、同和堂版用克），不换算、不合并。
            <strong className="pr-sub-warn">本页只做资料查阅，不构成诊断。</strong>
          </p>
        </div>
        <a className="pr-lib-page-back" href="/">
          ← 返回记录表
        </a>
      </header>

      <FormulaLibrary
        forceMode="page"
        showStanding={showStanding}
        onToggleStanding={() => setShowStanding((v) => !v)}
        canEdit={canEdit}
      />
    </div>
  )
}
