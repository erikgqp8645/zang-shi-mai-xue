/**
 * ArkTS 严格模式补丁 —— Taro 4.3.2 鸿蒙产物 `app.ets` 的唯一一处违规
 *
 * ## 上游出了什么事
 *
 * `@tarojs/vite-runner@4.3.2` 的鸿蒙 app 模板（`dist/harmony/template/app.js`，
 * 硬编码字符串）里有这么一段：
 *
 * ```ts
 * onMemoryLevel(level: AbilityConstant.MemoryLevel) {
 *   let levelRes: number          // ← 没有初值
 *
 *   switch (level) {
 *     case MEMORY_LEVEL_MODERATE: levelRes = 5;  break
 *     case MEMORY_LEVEL_LOW:      levelRes = 10; break
 *     case MEMORY_LEVEL_CRITICAL:  levelRes = 15; break
 *   }
 *
 *   if (levelRes) {               // ← 编译器无法证明 switch 一定命中某个分支
 *     hooks.call('getMemoryLevel', { level: levelRes })
 *   }
 * }
 * ```
 *
 * ArkTS（ArkTS 1.2 严格模式）要求「使用前必须赋值」，
 * 而 `switch` 没有 `default` 分支 → 静态分析判定 `levelRes` 可能未赋值 →
 * 编译直接失败：
 *
 * ```
 * 1 ERROR: 10605999 ArkTS Compiler Error
 * Error Message: Variable 'levelRes' is used before being assigned.
 *               At File: .../entry/src/main/ets/app.ets:77:9
 * ```
 *
 * ## 为什么这么修
 *
 * **最小修正：给个初值 `0`。语义完全不变** ——
 * 原来 switch 没命中任何 case 时 `levelRes` 是 `undefined`（falsy），
 * 修正后是 `0`（同样 falsy），`if (levelRes)` 的判断结果一模一样。
 *
 * 之所以不在 Taro 侧改：那份模板是 `node_modules` 里的硬编码字符串，
 * 改不了也不该改（升级即丢）；放构建脚本里做后处理，
 * 补丁和它的说明都在仓库里，谁都能看见、能复核、能测。
 *
 * ## 幂等与失配
 *
 * - **幂等**：已经打过就原样返回（重复构建不会打两遍补丁）。
 * - **失配**：模板改了、找不到目标就**抛错**，不静默放过 ——
 *   否则问题会推迟到 hvigor 阶段才爆，报错更难懂。
 */

/** 补丁前的原文（上游模板里的写法） */
export const LEVEL_RES_ORIGINAL = 'let levelRes: number'

/** 补丁后的写法 */
export const LEVEL_RES_PATCHED = 'let levelRes: number = 0'

/**
 * 纯函数：给 Taro 生成的 app.ets 源码打补丁。
 *
 * @param {string} source app.ets 源码
 * @returns {string} 打好补丁的源码（幂等）
 * @throws {Error} 找不到目标 —— 说明上游模板变了，补丁需要重新确认
 */
export function patchArkTsStrictMode(source) {
  if (typeof source !== 'string') {
    throw new TypeError('patchArkTsStrictMode(source) 需要字符串')
  }
  if (source.includes(LEVEL_RES_PATCHED)) return source
  if (!source.includes(LEVEL_RES_ORIGINAL)) {
    throw new Error(
      'app.ets 里找不到 `let levelRes: number` —— ' +
        '上游模板可能已经改过，这条 ArkTS 补丁需要重新确认。',
    )
  }
  return source.replace(LEVEL_RES_ORIGINAL, LEVEL_RES_PATCHED)
}
