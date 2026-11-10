import { useCallback, useState } from 'react'
import Taro from '@tarojs/taro'

import { validateCustomSymbol, type CustomSymbol } from '@domain/symbols'

import { ApiError } from '../utils/api'
import { deleteCustomSymbol, saveCustomSymbol } from '../utils/data'

/**
 * 自定义符号表 —— **就诊页与病例详情页共用这一份**（2026-11-08）
 *
 * ## 为什么抽出来
 *
 * 两个页面都要「加载清单 → 新增 → 删除 → 把错误显示在符号面板里」。
 * 各写一份的后果不是多几行代码，而是**改一处忘另一处**：
 * 比如以后把「代码最多 3 个字符」改成 4，或者加一条保留字，
 * 两个页面就会给出不一样的判定 —— 而使用者只会觉得「有时能存、有时不能」。
 *
 * ## 存放位置
 *
 * 符号存在**各自账号**下（`custom_symbols`，主键 `(owner_id, code)`）——
 * 每人的记法不一样（有人「涩」记 S，有人记 H），换手机／换端登录还在。
 * 页面只拿到状态与动作，不关心底下是 SQLite 还是 CloudBase PG。
 *
 * ## 校验放在哪
 *
 * 新增前先在**本机**跑 `validateCustomSymbol()`（与网页端同一份）：
 * 空符号、不可见字符、占用讲义固定代码、同一人重复代码，在这里就拦下，
 * 不用等服务端来回一趟。服务端仍会再校验一遍（那才是最终防线）。
 */
export function useCustomSymbols() {
  const [customSymbols, setCustomSymbols] = useState<CustomSymbol[]>([])
  const [symbolError, setSymbolError] = useState('')

  const clearSymbolError = useCallback(() => setSymbolError(''), [])

  /**
   * 新增一个自定义符号。
   *
   * 返回 true 表示已落库；false 时原因写在 `symbolError` 里，
   * 由符号面板就地显示（不弹窗打断录入）。
   */
  const addCustomSymbol = useCallback(
    async (code: string, name: string): Promise<boolean> => {
      const err = validateCustomSymbol(code, name, customSymbols)
      if (err) {
        setSymbolError(err)
        return false
      }
      try {
        const saved = await saveCustomSymbol({ code, name })
        if (!saved) throw new Error('保存失败，请重试')
        // 同代码以服务端返回的为准（服务端是唯一真源，可覆盖旧名称）
        setCustomSymbols((prev) => [...prev.filter((s) => s.code !== saved.code), saved])
        setSymbolError('')
        Taro.showToast({ title: `已添加 ${saved.code}＝${saved.name}`, icon: 'none' })
        return true
      } catch (e) {
        setSymbolError((e as Error)?.message || '保存失败')
        return false
      }
    },
    [customSymbols],
  )

  /** 删掉一个自定义符号（已录进格子的历史符号不动） */
  const removeCustomSymbol = useCallback(async (code: string): Promise<boolean> => {
    try {
      await deleteCustomSymbol(code)
      setCustomSymbols((prev) => prev.filter((s) => s.code !== code))
      setSymbolError('')
      Taro.showToast({ title: '已删除该符号', icon: 'none' })
      return true
    } catch (e) {
      // 404 ＝ 服务端已经没有这个符号了（另一台设备／网页端先删过）。
      // 这时本地也应当把它去掉 —— 否则 chip 永远删不掉，点一次红一次。
      if (e instanceof ApiError && e.status === 404) {
        setCustomSymbols((prev) => prev.filter((s) => s.code !== code))
        setSymbolError('')
        return true
      }
      setSymbolError((e as Error)?.message || '删除失败')
      return false
    }
  }, [])

  return {
    customSymbols,
    /** 载入页面时把清单灌进来（列表接口仍在页面里调，失败不挡录入） */
    setCustomSymbols,
    symbolError,
    clearSymbolError,
    addCustomSymbol,
    removeCustomSymbol,
  }
}
