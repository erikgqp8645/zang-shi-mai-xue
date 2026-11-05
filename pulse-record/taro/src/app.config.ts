export default defineAppConfig({
  pages: [
    'pages/cases/index', // tab 1 · 病例
    'pages/visit/index', // tab 2 · 就诊（工作台）
    'pages/formulas/index', // tab 3 · 用方
    'pages/me/index', // tab 4 · 我的
    'pages/case-detail/index',
    'pages/login/index',
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#fdfbf7',
    navigationBarTitleText: '臧氏脉学 · 脉象记录表',
    navigationBarTextStyle: 'black',
    backgroundColor: '#fdfbf7',
  },
  tabBar: {
    color: '#7c8974',
    selectedColor: '#2c2925',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/cases/index',
        text: '病例',
        iconPath: 'assets/tabbar/cases.png',
        selectedIconPath: 'assets/tabbar/cases-on.png',
      },
      {
        pagePath: 'pages/visit/index',
        text: '就诊',
        iconPath: 'assets/tabbar/visit.png',
        selectedIconPath: 'assets/tabbar/visit-on.png',
      },
      {
        pagePath: 'pages/formulas/index',
        text: '用方',
        iconPath: 'assets/tabbar/formula.png',
        selectedIconPath: 'assets/tabbar/formula-on.png',
      },
      {
        pagePath: 'pages/me/index',
        text: '我的',
        iconPath: 'assets/tabbar/me.png',
        selectedIconPath: 'assets/tabbar/me-on.png',
      },
    ],
  },
  style: 'v2',
  lazyCodeLoading: 'requiredComponents',
})
