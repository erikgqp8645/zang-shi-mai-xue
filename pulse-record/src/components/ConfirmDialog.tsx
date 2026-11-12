import type { ReactNode } from 'react'

/**
 * 站内确认框
 *
 * ## 为什么不用 `window.confirm`
 *
 * 原生 `confirm()` 在 Electron 桌面端会把**整个渲染进程冻住**（原生模态框挂在窗口上，
 * 页面上的 JS 一行都跑不动）—— 点「删除」或「恢复默认」之后，页面就再也不响应了，
 * 连刷新都救不回来，只能重启应用。
 * 浏览器里它只是弹个框，没那么难受，但既然两种端都可能跑，就统一用站内的。
 *
 * ⓘ 样式沿用编辑器那套（`pr-ps-modal`／`pr-ed-foot`）—— 同一套弹层，不另发明一套。
 *
 * ⓘ **只有一处**：删除条目（`FormulaLibrary.tsx`）与恢复默认（`RuleEditor.tsx`
 *   的统一编辑弹层 —— 条目与脉象图都在这儿）都用它 ⇒ 确认框的样子和措辞只有一个来源。
 */

export type ConfirmDialogProps = {
  /** 标题 */
  title: string
  /** 正文（可以是多行说明） */
  body?: ReactNode
  /** 确定按钮上的字 */
  okText?: string
  /** 取消按钮上的字 */
  cancelText?: string
  /** 确定按钮用危险色 */
  danger?: boolean
  /** 正在处理中（禁用两个按钮） */
  busy?: boolean
  onOk: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  body,
  okText = '确定',
  cancelText = '取消',
  danger,
  busy,
  onOk,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      className="pr-ps-modal is-confirm"
      onClick={(e) => {
        // 挡住外层弹层的「点遮罩关闭」——否则点确认框的遮罩会把编辑器一起关掉
        e.stopPropagation()
        if (!busy) onCancel()
      }}
    >
      <div
        className="pr-ps-modal-box is-confirm"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pr-ps-modal-head">
          <h4>{title}</h4>
          <button type="button" className="pr-ps-close" onClick={onCancel} disabled={busy}>
            ✕
          </button>
        </header>

        {body ? <div className="pr-confirm-body">{body}</div> : null}

        <footer className="pr-ed-foot pr-confirm-foot">
          <span className="pr-ed-tip" />
          <button type="button" className="pr-ghost" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button
            type="button"
            className={danger ? 'is-danger' : undefined}
            onClick={onOk}
            disabled={busy}
          >
            {busy ? '处理中…' : okText}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default ConfirmDialog
