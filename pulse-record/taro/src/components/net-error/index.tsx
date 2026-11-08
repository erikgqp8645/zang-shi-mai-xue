import { Text, View } from '@tarojs/components'

import type { NetFailure } from '../../utils/net-error'

import './index.scss'

/**
 * 网络诊断块 —— 把「网络请求失败」变成**能照着改**的东西
 *
 * ## 为什么单独做成组件
 *
 * 这个块要在**三个地方**出现：病例页（读列表失败）、登录页（探不到服务端）、
 * 「我的」页（探活失败）。三处各写一遍 → 迟早改漏一处。
 *
 * ## 显示什么
 *
 * 1. **结论**（`summary`）—— 一句话说清「哪一步错了」；
 * 2. **真实原因**（`reason`）—— 微信给的原始 `errMsg`，不是我们自己编的；
 * 3. **目标地址**（`target`）—— 手机上 `127.0.0.1` 指手机自己，
 *    不把地址亮出来，使用者根本判断不了自己连的是哪台机器；
 * 4. **怎么改**（`hints`）—— 每条都是「去哪儿改什么」。
 *
 * ## ⚠️ **这里没有「复制诊断信息」按钮**（2026-11-08 改）
 *
 * 原本想加一个「一键复制」，用 `Taro.setClipboardData` ——
 * **但那是微信的隐私接口**。维护者 2026-11-05 已经定了规矩：
 *
 *     小程序不再提供导出 → **不调用任何隐私接口**
 *     → 微信后台《用户隐私保护指引》**一项都不用勾**
 *
 * 为了一个诊断按钮去动这条规矩不划算（后台要重新填隐私指引、
 * 隐私政策页要同步声明、审核多一道坎）。
 * ⇒ 改成**内容全部显示在界面上，使用者截图即可** ——
 *    维护者拿到截图就能直接定位，省掉来回问「你连的是哪台服务器」。
 */

export interface NetErrorProps {
  /** 诊断结果（来自 `utils/net-error.ts` 的 `describeNetFailure`） */
  detail?: NetFailure | null
  /** 额外补一行（比如「这是读列表时失败的」） */
  extra?: string
}

export default function NetError({ detail, extra }: NetErrorProps) {
  if (!detail) return null

  return (
    <View className='pr-neterr'>
      {extra ? <Text className='pr-neterr-extra'>{extra}</Text> : null}
      <Text className='pr-neterr-summary'>{detail.summary}</Text>
      <Text className='pr-neterr-reason'>原因：{detail.reason}</Text>
      <Text className='pr-neterr-target'>地址：{detail.target || '（拿不到）'}</Text>
      {detail.hints.length ? (
        <View className='pr-neterr-hints'>
          {detail.hints.map((h, i) => (
            <Text key={i} className='pr-neterr-hint'>
              {i + 1}. {h}
            </Text>
          ))}
        </View>
      ) : null}
      <Text className='pr-neterr-tip'>把这一屏截图发给维护者，就能直接定位。</Text>
    </View>
  )
}
