/**
 * 依脉开方的两种分组维度：五行 / 左右手
 *
 * 归类依据（两条资料线分别标注，不合并）：
 *
 *  **脉位 → 脏 → 五行**（五行归类出讲稿 2010·第一讲，脏位对应出讲义 2026-10·p30）
 *    - 木·肝 ＝ 左手关：「肝主筋，人体的筋需要肝血滋养」（讲义 2026-10·p30）
 *    - 火·心 ＝ 左手寸：「心主脉，是唯一的火脏」（讲义 2026-10·p30）
 *    - 土·脾 ＝ 右手关：「脾主肌肉」（讲义 2026-10·p30）
 *    - 金·肺 ＝ 右手寸：「肺主皮毛」（讲义 2026-10·p30）
 *    - 水·肾 ＝ 尺（双侧）：「肾主骨」（讲义 2026-10·p30）
 *    - 「木、火、土、金、水；肝、心、脾、肺、肾」（讲稿 2010·第一讲·五行归类）
 *
 *  **左右手**（讲义 2026-10·p30 的左右手脏位 + 讲稿的血分气分提法）
 *    - 左手（心肝·血分）＝ 左寸 + 左关；「心肝主血，脾统血」（讲稿 2010·第十三讲）
 *    - 右手（肺脾·气分）＝ 右寸 + 右关
 *    - 尺肾（水）＝ 双侧尺脉
 *    - 双手相兼 ＝ 条目主脉位横跨左右（如肝肺同治、双关同治、六脉……）
 *
 *  **归类取「主脉位」**：一条用方条目读的是哪个部位的脉，就归到那个部位对应的脏与行；
 *  讲稿点名「本脏」时以本脏为准（如肝肺同治「症见于肺，病本实乎肝」→ 木·肝），
 *  兼涉他脏的记入 also，并在 basis 里写明出处。
 *  主脉位为全身性（变脉、六脉、三不用、上盛下虚、三焦疗法）者，以肾为本，
 *  依讲稿「人体补的进去的只有脾肾，脾肾为根源」。
 *
 * 本文件只做**归类**，不改写任何原文；方剂的组成／服法／加减／禁忌见 drugs.ts。
 */

export type Wuxing = '木' | '火' | '土' | '金' | '水'
export type ZangFu = '肝' | '心' | '脾' | '肺' | '肾'
export type HandSide = '左手' | '右手' | '尺肾' | '双手相兼'

export interface Attribution {
  /** 本脏 */
  zang: ZangFu
  /** 本脏所属五行 */
  wuxing: Wuxing
  /** 兼涉的本脏（讲稿「相生脏／相克脏」或同条涉及他脏） */
  also?: ZangFu[]
  /** 主脉位（该条目读的是哪个部位的脉） */
  site: string
  /** 左右手归属 */
  side: HandSide
  /** 归类依据（讲稿／讲义出处） */
  basis: string
}

/* ------------------------------------------------------------------ */
/* 维度定义                                                            */
/* ------------------------------------------------------------------ */

export const WUXING_ORDER: Wuxing[] = ['木', '火', '土', '金', '水']

export const WUXING_INFO: Record<Wuxing, { zang: ZangFu; site: string; note: string }> = {
  木: {
    zang: '肝',
    site: '左手关',
    note: '肝主筋，人体的筋需要肝血滋养（讲义 2026-10·p30）；木属肝（讲稿 2010·第一讲·五行归类）',
  },
  火: {
    zang: '心',
    site: '左手寸',
    note: '心主脉，是唯一的火脏（讲义 2026-10·p30）；火属心（讲稿 2010·第一讲·五行归类）',
  },
  土: {
    zang: '脾',
    site: '右手关',
    note: '脾主肌肉（讲义 2026-10·p30）；土属脾（讲稿 2010·第一讲·五行归类）',
  },
  金: {
    zang: '肺',
    site: '右手寸',
    note: '肺主皮毛（讲义 2026-10·p30）；金属肺（讲稿 2010·第一讲·五行归类）',
  },
  水: {
    zang: '肾',
    site: '尺·双侧',
    note: '肾主骨（讲义 2026-10·p30）；水属肾（讲稿 2010·第一讲·五行归类）',
  },
}

export const HAND_ORDER: HandSide[] = ['左手', '右手', '尺肾', '双手相兼']

export const HAND_INFO: Record<HandSide, { title: string; short: string; note: string }> = {
  左手: {
    title: '左手 · 心肝（血分）',
    short: '左手 · 心肝',
    note: '左寸＝心、左手关＝肝（讲义 2026-10·p30）；「心肝主血，脾统血」（讲稿 2010·第十三讲）',
  },
  右手: {
    title: '右手 · 肺脾（气分）',
    short: '右手 · 肺脾',
    note: '右寸＝肺、右关＝脾（讲义 2026-10·p30）；「脾统血」（讲稿 2010·第十三讲）',
  },
  尺肾: {
    title: '尺脉 · 肾（水）',
    short: '尺脉 · 肾',
    note: '尺主肾，双侧皆尺（讲义 2026-10·p30）；「人体补的进去的只有脾肾」（讲稿 2010·第十三讲）',
  },
  双手相兼: {
    title: '双手相兼',
    short: '双手相兼',
    note: '主脉位横跨左右者：肝肺同治（左关右寸）、双关同治、六脉……',
  },
}

/* ------------------------------------------------------------------ */
/* 分组顺序与短标签（筛选开关、导出共用）                                */
/* ------------------------------------------------------------------ */

/** 两个维度的分组顺序 */
export const DIM_ORDER: Record<'wuxing' | 'hand', string[]> = {
  wuxing: WUXING_ORDER,
  hand: HAND_ORDER,
}

/** 分组短标签（筛选开关上的名称）；未知键原样返回 */
export function groupShortLabel(dim: 'wuxing' | 'hand', key: string): string {
  if (dim === 'wuxing') {
    const wx = key as Wuxing
    return WUXING_INFO[wx] ? `${wx} · ${WUXING_INFO[wx].zang}` : key
  }
  const side = key as HandSide
  return HAND_INFO[side] ? HAND_INFO[side].short : key
}

/* ------------------------------------------------------------------ */
/* 用方条目的归属                                                       */
/* ------------------------------------------------------------------ */

export const RULE_ATTRIB: Record<string, Attribution> = {
  /* 肾虚 */
  'fx-bianmai-wuli': {
    zang: '肾', wuxing: '水', also: ['心', '脾', '肺'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「肾虚·变脉无力」用三焦疗法；上、中、下焦方分养心肺／脾／肾（讲稿 2010·第十三讲）',
  },
  'fx-bianmai-youli': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「变脉有力」以减半三焦疗法护航，三部曲清左寸、凉右关、凉尺脉',
  },
  'fx-shenyong-mubiao': {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第二讲「清完挡路，用正宗的下焦方」，下焦方主尺脉',
  },
  /* 上盛下虚 */
  'fx-ssx-qingdanglu': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「上盛下虚…下虚就是尺弱，或没有，或不平衡」，以尺为根',
  },
  'fx-ssx-yinhuo': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「上盛下虚用引火归元」，引火归元即六味地黄加桂，滋肾水',
  },
  /* 挡路一（右关） */
  'fx-dl1-jiawei-sijun': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第四讲「右关浮取无或者弱」用加味四君（理中），补脾胃',
  },
  'fx-dl1-yinyang': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第四讲「右关浮无、中有力」用阴阳方，即中焦方加味四君子加麦冬、干姜、黄芪',
  },
  'fx-dl1-liushen': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲「右关比较浮软…胃出血在这个脉象…用六神加黄芪、陈皮」',
  },
  'fx-dl1-zengye': {
    zang: '脾', wuxing: '土', also: ['肾'], site: '右关', side: '右手',
    basis: '讲稿 2010·第四讲「看下面浮大的脉。我们用增液汤」；增液汤滋肾水以安卫',
  },
  'fx-dl1-hongda-huhang': {
    zang: '脾', wuxing: '土', also: ['心', '肾'], site: '右关', side: '右手',
    basis: '讲稿 2010·第四讲「浮洪大…一定要用三号的上焦方护航…然后早上吃一点下焦方」',
  },
  'fx-dl1-guanjian': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第四讲「右关是第一关键，右关问题先解决才有办法往下走」',
  },
  /* 挡路二（肝肺同治） */
  'fx-dl2-youcun-da': {
    zang: '肺', wuxing: '金', also: ['肝'], site: '右寸', side: '右手',
    basis: '讲稿 2010·第四讲「右寸如果出现浮大的时候，我们是用参苏跟肝肺同治」',
  },
  'fx-dl2-youcun-hongda': {
    zang: '肺', wuxing: '金', also: ['肝'], site: '右寸', side: '右手',
    basis: '讲稿 2010·第四讲「右寸浮洪大…参苏加减、肝肺同治」',
  },
  'fx-dl2-zuoguan-hongxian': {
    zang: '肝', wuxing: '木', site: '左关', side: '左手',
    basis: '讲稿 2010·第四讲「左关浮洪或弦」用加味龙胆，去肝胆经的湿热',
  },
  'fx-dl2-zuoguan-zhongyouli': {
    zang: '肝', wuxing: '木', also: ['脾'], site: '左关', side: '左手',
    basis: '讲稿 2010·第四讲「左关中有力，湿热压在比较深层一点…俟机散泻」',
  },
  'fx-dl2-zuoguan-youcun-da': {
    zang: '肝', wuxing: '木', also: ['肺'], site: '左关右寸', side: '双手相兼',
    basis: '讲稿 2010·第四讲「症见于肺，病本实乎肝」，木克金',
  },
  'fx-dl2-zuoguan-fuwu': {
    zang: '肝', wuxing: '木', also: ['肾'], site: '左关', side: '左手',
    basis: '讲稿 2010·第四讲「左关浮无或弱…就是滋肾以补肝」',
  },
  'fx-dl2-zuoguan-xuzang-ladun': {
    zang: '肝', wuxing: '木', also: ['肾', '肺'], site: '左关', side: '左手',
    basis: '讲稿 2010·第四讲「左关虚脏…用六味加天冬去拉右寸，或单一用参苏拉右寸」',
  },
  'fx-dl2-zuocun-guan-fu': {
    zang: '心', wuxing: '火', also: ['肝'], site: '左寸关', side: '左手',
    basis: '讲稿 2010·第四讲「左寸关浮…肝心同治，并依脉添加滋阴的药」',
  },
  'fx-dl2-shuangguan-youcun-da': {
    zang: '肝', wuxing: '木', also: ['肺'], site: '左关右寸', side: '双手相兼',
    basis: '讲义 2026-10·p44 肝肺同治框「⑥ 双关右寸浮大：黄芪鳖甲」',
  },
  /* 挡路三（左寸） */
  'fx-dl3-zuocun-da': {
    zang: '心', wuxing: '火', site: '左寸', side: '左手',
    basis: '讲稿 2010·第四讲清挡路三「左寸浮大」用天王补心丹加芪',
  },
  'fx-dl3-zuocun-ding': {
    zang: '心', wuxing: '火', site: '左寸', side: '左手',
    basis: '讲稿 2010·第四讲清挡路三「左寸顶」用天王加防风',
  },
  'fx-dl3-bianmai-wuli': {
    zang: '心', wuxing: '火', also: ['肺'], site: '左寸', side: '左手',
    basis: '讲稿 2010·第四讲清挡路三「左寸变脉无力」用上焦方；上焦方养心肺',
  },
  /* 挡路四（尺脉） */
  'fx-dl4-chi-bupingheng': {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第四讲清挡路四「尺脉不平衡」用知柏六味桂',
  },
  'fx-dl4-chi-da-ding': {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第四讲清挡路四「尺浮大或顶手…属扫障碍，必须清除」',
  },
  /* 挡路五、六 */
  'fx-dl5-shuangguan': {
    zang: '肝', wuxing: '木', also: ['脾'], site: '双关', side: '双手相兼',
    basis: '讲稿 2010·第六讲「双关同治是两个关都有出现浮大」；讲稿 2010·第二讲（三）肝脾（双关）同治',
  },
  'fx-dl6-ganxin': {
    zang: '心', wuxing: '火', also: ['肝'], site: '左寸关', side: '左手',
    basis: '讲稿 2010·第六讲「左手寸关浮大的时候，用肝心同治」',
  },
  /* 头痛（第五讲） */
  'fx-toutou-bianmai': {
    zang: '肾', wuxing: '水', site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第五讲「变脉…用三焦疗法」',
  },
  'fx-toutou-cunguan': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第五讲「寸关浮大、尺弱或不平衡」用引火归元并清挡路',
  },
  'fx-toutou-shuangguan': {
    zang: '肝', wuxing: '木', also: ['脾'], site: '双关', side: '双手相兼',
    basis: '讲稿 2010·第五讲「双关浮大」用双关同治、上焦方护航',
  },
  /* 讲稿方剂 */
  'fx-yao-yangxu': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲「阳虚（右关脉弱）→四君子汤加温热药」',
  },
  'fx-yao-yinxu': {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第二讲「阴虚（尺弱）→六味汤加温热药」',
  },
  'fx-yao-jiawei-sijun-peifang': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲「用加味四君时，以理中汤易四君子汤，再加白术、葛根」',
  },
  'fx-yao-liushen-peifang': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲「用六神散／四君子汤时」的配伍',
  },
  'fx-yao-xiaoyao': {
    zang: '肝', wuxing: '木', also: ['心'], site: '左关', side: '左手',
    basis: '讲稿 2010·第二讲逍遥散小注「余以一方治木郁，而诸郁皆愈」',
  },
  'fx-yao-huangqi-biejia': {
    zang: '肝', wuxing: '木', also: ['肺'], site: '左关右寸', side: '双手相兼',
    basis: '讲稿 2010·第五讲「双关右寸浮大、肝火深层」用黄芪鳖甲、柴鳖骨',
  },
  'fx-yao-bianbian': {
    zang: '肾', wuxing: '水', also: ['脾'], site: '尺', side: '尺肾',
    basis: '讲稿 2010·第七讲（便秘）「肾虚的人…用三焦疗法，或者用下焦方；上盛下虚的人，用引火归元」',
  },
  /* 叁、用方（第二讲） */
  'fx2-yiti-lengreshui': {
    zang: '脾', wuxing: '土', also: ['肾'], site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲「从右关去抓——右关脉没有能量就是寒证；很浮大就是热证」',
  },
  'fx2-sanjiao-wuli': {
    zang: '肾', wuxing: '水', also: ['心', '脾', '肺'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「肾虚区块（变脉无力）用三焦疗法」',
  },
  'fx2-jianban-sanjiao': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「减半三焦疗法」三部曲：清左寸、凉右关、凉尺脉',
  },
  'fx2-yinhuo-guiyuan': {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第二讲「寸关浮大，尺脉弱或没有」用引火归元',
  },
  'fx2-xiajiao-rukemen': {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第二讲「下焦方只要寸关不浮大，就可以进得去」',
  },
  'fx2-yinhuo-jiazi': {
    zang: '肾', wuxing: '水', also: ['肝', '心', '肺'], site: '尺', side: '尺肾',
    basis: '讲稿 2010·第二讲「尺脉不平衡加知柏；左关浮大加柴味归；右寸浮大加天冬、五味子」',
  },
  'fx2-youguanchi-fuda-ding-muxiang': {
    zang: '脾', wuxing: '土', also: ['肾'], site: '右关尺', side: '右手',
    basis: '讲稿 2010·第二讲（五脏疗法·十四）「右关尺（浮大顶手）」用木香顺气',
  },
  'fx2-youguanchi-zuoguan-fuda-soufeng': {
    zang: '脾', wuxing: '土', also: ['肝', '肾'], site: '右关尺左关', side: '双手相兼',
    basis: '讲稿 2010·第二讲（五脏疗法·十五）「右关尺左关（浮大）」用搜风顺气',
  },
  /* 肆、依脉辨证论治（第二讲） */
  'fx2-ssx-yinhuo': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '尺', side: '尺肾',
    basis: '讲稿 2010·第二讲「（一）寸关浮大，尺脉弱或无，或不平衡」用引火归元',
  },
  'fx2-zuocun-ding-tianwang': {
    zang: '心', wuxing: '火', site: '左寸', side: '左手',
    basis: '讲稿 2010·第二讲「（二）左寸顶手，或比较浮大」用天王补心丹',
  },
  'fx2-zuocunguan-ganyan': {
    zang: '心', wuxing: '火', also: ['肝'], site: '左寸关', side: '左手',
    basis: '讲稿 2010·第二讲「（三）左寸关浮大」用肝心同治',
  },
  'fx2-shuangcun-fuda': {
    zang: '心', wuxing: '火', also: ['肺', '脾', '肾'], site: '双寸', side: '双手相兼',
    basis: '讲稿 2010·第二讲「（四）双寸比较浮大」',
  },
  'fx2-youguan-fuda-zengye': {
    zang: '脾', wuxing: '土', also: ['肾'], site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲「（五）右关比较浮大数（内伤虚热）」用增液汤、易简地黄',
  },
  'fx2-youguan-xuzang-lizhong': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲「（五）右关比较浮软，偏迟，或弱，或无力，或浮取无（内伤虚寒）」用理中加陈芪',
  },
  'fx2-zuoguan-youcun-huangqi': {
    zang: '肝', wuxing: '木', also: ['肺', '肾'], site: '左关右寸', side: '双手相兼',
    basis: '讲稿 2010·第二讲「（六）左关右寸，浮大微洪，或弦、或顶手」用黄芪鳖甲、秦艽扶羸',
  },
  'fx2-zuoguan-fuda-longdan': {
    zang: '肝', wuxing: '木', also: ['肺'], site: '左关', side: '左手',
    basis: '讲稿 2010·第二讲「（六）左关浮洪大或弦，或右寸浮大」用加味龙胆泻肝',
  },
  'fx2-shuangguan-fuda-buzhong': {
    zang: '肝', wuxing: '木', also: ['脾'], site: '双关', side: '双手相兼',
    basis: '讲稿 2010·第二讲「（七）双关比较浮大」用肝脾（双关）同治',
  },
  'fx2-chi-bupingheng-zhibai': {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第二讲「（八）尺脉不平衡或过大」用知柏六味地黄',
  },
  'fx2-liumai-xianxi': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '六脉', side: '双手相兼',
    basis: '讲稿 2010·第二讲「（九）六脉弦细数」按变脉有力（肾虚区块）的方式治',
  },
  'fx2-liumai-fuhongdaxian': {
    zang: '肾', wuxing: '水', also: ['肝', '心', '肺', '脾'], site: '六脉', side: '双手相兼',
    basis: '讲稿 2010·第二讲「（十）六脉浮洪大弦」；「次用黄芪鳖甲，或肝心同治加滋阴药，这是左边的问题，易简地黄或增液汤加散药调治，这是右边的问题」',
  },
  'fx2-zuoyou-bupingheng-renshen': {
    zang: '脾', wuxing: '土', also: ['肺', '肾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「（十一）左右脉不平衡…先用人参养荣汤」；人参养荣汤益气养血，以脾肺为主',
  },
  'fx2-zuoguan-xuzang-zishen': {
    zang: '肝', wuxing: '木', also: ['肾', '脾'], site: '左关', side: '左手',
    basis: '讲稿 2010·第二讲「（十二）左关虚脏」用滋肾以补肝',
  },
  /* 用药禁忌（常驻） */
  'fx-jinji-sanyong': {
    zang: '肾', wuxing: '水', also: ['肺', '心', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第一讲「我有三不用，麻黄不用，黄连不用，大黄不用」；肾虚者不受此三药',
  },
  'fx-jinji-baihu-shenqi': {
    zang: '肾', wuxing: '水', also: ['肺', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第一讲「上盛用白虎汤袪热，下虚用肾气丸」',
  },
}

/* ------------------------------------------------------------------ */
/* 方剂的归属                                                          */
/* ------------------------------------------------------------------ */

export const DRUG_ATTRIB: Record<string, Attribution> = {
  'yiti-leng-re-shui': {
    zang: '脾', wuxing: '土', also: ['肾'], site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲「从右关去抓——没有能量就是寒证；很浮大就是热证」',
  },
  'shangjiao-1': {
    zang: '心', wuxing: '火', also: ['肺'], site: '左寸', side: '左手',
    basis: '讲稿 2010·第十三讲「我们的三焦疗法，上焦方是不是左寸？」；上焦方养心肺',
  },
  'shangjiao-2': {
    zang: '心', wuxing: '火', also: ['肺'], site: '左寸', side: '左手',
    basis: '同上（上焦方二号）',
  },
  'shangjiao-3': {
    zang: '心', wuxing: '火', also: ['肺'], site: '左寸', side: '左手',
    basis: '同上（上焦方三号·二仁茯芪）',
  },
  zhongjiao: {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第十三讲「中焦方是不是右关？」',
  },
  xiajiao: {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第十三讲「下焦方是不是尺脉？」',
  },
  'sanjiao-liaocheng': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「肾虚区块（变脉无力）用三焦疗法」',
  },
  'jianban-sanjiao': {
    zang: '肾', wuxing: '水', also: ['心', '脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲「减半三焦疗法」三部曲',
  },
  'yinhui-guiyuan': {
    zang: '肾', wuxing: '水', site: '尺', side: '尺肾',
    basis: '讲稿 2010·第二讲「引火归元（肾脏疗法）」＝六味地黄加桂，滋肾水',
  },
  'ganyan-tongzhi': {
    zang: '心', wuxing: '火', also: ['肝', '脾'], site: '左寸关', side: '左手',
    basis: '讲稿 2010·第二讲「肝心同治主要是治左手的寸关出了问题」；逍遥散治木郁',
  },
  'shuangguan-tongzhi': {
    zang: '肝', wuxing: '木', also: ['脾'], site: '双关', side: '双手相兼',
    basis: '讲稿 2010·第二讲（三）「肝脾（双关）同治」＝补中益气加散药',
  },
  'zuoguan-xuzang-tongzhi': {
    zang: '肝', wuxing: '木', also: ['肾', '脾'], site: '左关', side: '左手',
    basis: '讲稿 2010·第二讲（四）「左关虚脏…滋肾以补肝」',
  },
  'youguan-liushen': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲（五）「右关虚脏·浮大而软」用六神汤',
  },
  'youguan-jiawei-lizhong': {
    zang: '脾', wuxing: '土', site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲（五）「右关虚脏·软而无力」用加味理中',
  },
  'zuocun-fuda-tianwang': {
    zang: '心', wuxing: '火', site: '左寸', side: '左手',
    basis: '讲稿 2010·第二讲（六）「左寸浮大·脉数」用天王补心丹加芪',
  },
  'zuocun-fuda-yangxin': {
    zang: '心', wuxing: '火', site: '左寸', side: '左手',
    basis: '讲稿 2010·第二讲（七）「左寸浮大·脉迟」用养心汤',
  },
  'youcun-fuda-cansu': {
    zang: '肺', wuxing: '金', also: ['肝'], site: '右寸', side: '右手',
    basis: '讲稿 2010·第二讲（八）「右寸浮大」用参苏饮',
  },
  'zuoguan-youcun-fuda': {
    zang: '肝', wuxing: '木', also: ['肺'], site: '左关右寸', side: '双手相兼',
    basis: '讲稿 2010·第二讲（九）「左关右寸（浮大带点）」用黄芪鳖甲／秦艽扶羸',
  },
  'zuoguan-youcun-fuhongda': {
    zang: '肝', wuxing: '木', also: ['肺'], site: '左关右寸', side: '双手相兼',
    basis: '讲稿 2010·第二讲（十）「左关右寸（浮洪大）」用黄芪鳖甲',
  },
  'youguanchi-fuda-zengye': {
    zang: '脾', wuxing: '土', also: ['肾'], site: '右关尺', side: '右手',
    basis: '讲稿 2010·第二讲（十一）「右关尺（浮大）」用增液汤加减',
  },
  'youmai-fuda-yijian': {
    zang: '脾', wuxing: '土', also: ['肾'], site: '右关', side: '右手',
    basis: '讲稿 2010·第二讲（十二）「右脉（浮大微弦）」用易简地黄饮子',
  },
  'youguanchi-fuhongda-fangfeng': {
    zang: '脾', wuxing: '土', also: ['肺'], site: '右关尺', side: '右手',
    basis: '讲稿 2010·第二讲（十三）「右关尺（浮洪大）」用防风通圣散',
  },
  'youguanchi-dingshou-muxiang': {
    zang: '脾', wuxing: '土', also: ['肾'], site: '右关尺', side: '右手',
    basis: '讲稿 2010·第二讲（十四）「右关尺（浮大顶手）」用木香顺气',
  },
  'soufeng-shunqi': {
    zang: '脾', wuxing: '土', also: ['肝', '肾'], site: '右关尺左关', side: '双手相兼',
    basis: '讲稿 2010·第二讲（十五）「右关尺左关（浮大）」用搜风顺气',
  },
  'zuoguan-fuhongda-longdan': {
    zang: '肝', wuxing: '木', also: ['肺'], site: '左关', side: '左手',
    basis: '讲稿 2010·第二讲（十六）「左关（浮洪大）」用加味龙胆泻肝',
  },
  'zuoyou-bupingheng-renshen': {
    zang: '脾', wuxing: '土', also: ['肺', '肾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲（十七）「左右脉（不平衡）」用人参养荣汤，可作收底药',
  },
  'shipu-shen': {
    zang: '肾', wuxing: '水', also: ['脾'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲（十八）「食补肾」＝还少丹加减',
  },
  xifang: {
    zang: '肝', wuxing: '木', also: ['心'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲（十九）「洗方」；皮肤问题属血分，「心肝主血，脾统血」（讲稿 2010·第十三讲）',
  },
  mafang: {
    zang: '肝', wuxing: '木', also: ['心'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲（二十）「抹方」；皮肤问题属血分',
  },
  'yuxue-zhuangshang': {
    zang: '肝', wuxing: '木', also: ['心'], site: '全身', side: '双手相兼',
    basis: '讲稿 2010·第二讲（二十一）「瘀血撞伤」外敷方；活血化瘀属血分',
  },
}

/* ------------------------------------------------------------------ */
/* 分组工具                                                            */
/* ------------------------------------------------------------------ */

/**
 * 常驻条目在维度视图里的显示标签 —— 讲稿原序下它们的标题是「（常驻）」，
 * 在按五行／左右手浏览时改成可读的短标签，内容仍以 therapy 为准。
 */
export const STANDING_DISPLAY: Record<string, string> = {
  'fx-jinji-sanyong': '三不用（麻黄、黄连、大黄）',
  'fx-jinji-baihu-shenqi': '上盛用白虎汤／下虚用肾气丸（讲者批评）',
}

/** 合并两套归属表（条目与方剂 id 不冲突，可直接查） */
export const RULE_OR_DRUG_ATTRIB: Record<string, Attribution> = {
  ...RULE_ATTRIB,
  ...DRUG_ATTRIB,
}

export interface Group<T> {
  key: string
  label: string
  note: string
  items: T[]
}

/** 按五行分组（顺序：木火土金水） */
export function groupByWuxing<T>(items: T[], idOf: (item: T) => string): Group<T>[] {
  const out: Group<T>[] = []
  for (const wx of WUXING_ORDER) {
    const info = WUXING_INFO[wx]
    const bucket = items.filter((it) => RULE_OR_DRUG_ATTRIB[idOf(it)]?.wuxing === wx)
    if (bucket.length === 0) continue
    out.push({
      key: wx,
      label: `${wx} · ${info.zang}（${info.site}）`,
      note: info.note,
      items: bucket,
    })
  }
  const rest = items.filter((it) => !RULE_OR_DRUG_ATTRIB[idOf(it)])
  if (rest.length > 0) {
    out.push({ key: '未归类', label: '未归类', note: '本条未标注五行归属，待补。', items: rest })
  }
  return out
}

/** 按左右手分组（顺序：左手 / 右手 / 尺肾 / 双手相兼） */
export function groupByHand<T>(items: T[], idOf: (item: T) => string): Group<T>[] {
  const out: Group<T>[] = []
  for (const side of HAND_ORDER) {
    const info = HAND_INFO[side]
    const bucket = items.filter((it) => RULE_OR_DRUG_ATTRIB[idOf(it)]?.side === side)
    if (bucket.length === 0) continue
    out.push({ key: side, label: info.title, note: info.note, items: bucket })
  }
  const rest = items.filter((it) => !RULE_OR_DRUG_ATTRIB[idOf(it)])
  if (rest.length > 0) {
    out.push({ key: '未归类', label: '未归类', note: '本条未标注左右手归属，待补。', items: rest })
  }
  return out
}
