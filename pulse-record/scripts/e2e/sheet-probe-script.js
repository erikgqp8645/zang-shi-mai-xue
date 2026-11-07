/**
 * 几何探针的**测量脚本** —— Chromium 与 WKWebView 共用这一份。
 *
 * 为什么单独抽出来：
 *   · `sheet-layout-probe.mjs` 在 Chrome（Chromium）里量；
 *   · `sheet-layout-webkit-probe.mjs` 在 WKWebView（**iOS 同引擎**）里量。
 * 两边必须量**同一份页面、同一个脚本**，比出来的差异才有意义 ——
 * 脚本分叉两份，比的就不是「引擎差异」而是「两份脚本的差异」了。
 *
 * 它把结果塞进一个 id 为 probe-result 的 pre 元素（Chromium 侧用 `--dump-dom` 取），
 * 或者由调用方直接 `evaluateJavaScript` 取返回值（WKWebView 侧）。
 *
 * ⚠️ 这个文件会被原样嵌进 `<script>` 里，而 Chromium 的 `--dump-dom` 会把脚本源码
 *    原样吐出来 —— 所以**这里不能出现「取结果用的那个标签」的字面量**，
 *    否则 dump-dom 的正则会先匹配到注释里的它，取到一坨注释文本。
 */
(function () {
  const out = {}
  const box = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => {
    const r = e.getBoundingClientRect()
    return { l: Math.round(r.left * 100) / 100, r: Math.round(r.right * 100) / 100 }
  })
  out.headHand = box('.pr-thead-hand')
  out.headDate = box('.pr-thead-date')
  out.dateText = box('.pr-thead-date-text')
  out.bodyCell = box('.pr-cell')
  out.footCell = box('.pr-tfoot-cell')
  out.footText = box('.pr-tfoot-cell-text')
  out.headTop = box('.pr-thead')
  out.bodyRow = box('.pr-row')
  // 2026-11-07 实机错开后补测：各段的**外宽**与姓名格本身
  out.headLead = box('.pr-thead-lead')
  out.nameCell = box('.pr-thead-name')
  out.nameText = box('.pr-thead-name-text')
  out.organ = box('.pr-organ')
  out.depth = box('.pr-depth')

  // ⭐ 竖线必须用 inset box-shadow 画，不能用 border（2026-11-07 实机错开的根因）
  //    —— 光量「外宽」在 Chromium 里抓不到回归（border-box 本来就对），
  //    得直接查**计算样式**：border-right-width 必须是 0，box-shadow 必须带 inset。
  const styleOf = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      borderRightWidth: cs.borderRightWidth,
      borderLeftWidth: cs.borderLeftWidth,
      boxShadow: cs.boxShadow,
      fontSize: cs.fontSize,
      // ⭐ 文字的**真实内容宽**：元素盒宽被 overflow:hidden 钉住了，
      //    量 getBoundingClientRect() 只会量到盒子，量不到字 —— 用 scrollWidth。
      scrollWidth: el.scrollWidth,
      overflow: cs.overflow,
      textOverflow: cs.textOverflow,
    }
  }
  out.style = {
    cell: styleOf('.pr-cell'),
    hand: styleOf('.pr-thead-hand'),
    // ⭐ 日期/表下取**画线的那一半**（is-r）—— 左半格是「明确不画线」的，
    //    它的 box-shadow 必然是 none，不能混进「竖线必须用 inset」这条断言里。
    //    「左半格必须是 none」由下面的 dateShadows / footShadows 逐个断言。
    date: styleOf('.pr-thead-date.is-r'),
    foot: styleOf('.pr-tfoot-cell.is-r'),
    organ: styleOf('.pr-organ'),
    depth: styleOf('.pr-depth'),
    name: styleOf('.pr-thead-name'),
    nameText: styleOf('.pr-thead-name-text'),
  }

  // ⭐ 拆半格后：左半格**不画竖线**（讲义 p34：日期横跨「左＋右」两列，中间不画竖线）
  //    ⇒ 逐个半格查它的 box-shadow：左半格应为 none，右半格应有 inset。
  //    这是**计算样式级**断言 —— 量坐标量不出来（格子边界还在，只是没画线）。
  //
  // ⭐ 按 **class** 判定「谁是左半格」，**不按下标奇偶** ——
  //    奇偶只在「每行格子数是偶数」时恰好成立（当前是），
  //    一旦 DOM 顺序调整就会误判。按 class 判定与顺序无关。
  const shadowsOf = (sel) =>
    Array.from(document.querySelectorAll(sel)).map((e) => ({
      l: e.classList.contains('is-l'),
      r: e.classList.contains('is-r'),
      shadow: getComputedStyle(e).boxShadow,
    }))
  out.dateShadows = shadowsOf('.pr-thead-date')
  out.footShadows = shadowsOf('.pr-tfoot-cell')

  // ⭐ 跨格文字（日期标签 / 表下值）是绝对定位在左半格上的 ——
  //    左半格若带 overflow:hidden，会把文字裁成「（未」（2026-11-07 真机截图可见）。
  out.halfStyle = {
    dateL: styleOf('.pr-thead-date.is-l'),
    footL: styleOf('.pr-tfoot-cell.is-l'),
  }
  // 文字的**真实字宽**（scrollWidth，不是元素盒宽）
  out.textReal = {
    date: (document.querySelector('.pr-thead-date-text') || {}).scrollWidth || 0,
    foot: (document.querySelector('.pr-tfoot-cell-text') || {}).scrollWidth || 0,
  }

  out.singleHead = (document.querySelector('.pr-single-head') || {}).textContent || ''
  out.singleDate = (document.querySelector('.pr-single-date') || {}).textContent || ''
  out.singleItems = Array.from(document.querySelectorAll('.pr-single-item')).map((e) => e.textContent)
  out.singleChips = Array.from(document.querySelectorAll('.pr-single-chip')).map((e) => e.textContent)
  const pre = document.createElement('pre')
  pre.id = 'probe-result'
  pre.textContent = JSON.stringify(out)
  document.body.appendChild(pre)
})()
</script>