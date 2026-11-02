import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' —— 构建产物可直接以 file:// 打开，便于离线分享
// proxy: 开发时把 /api 转到本地 SQLite 服务（历史记录永久存储层）
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets' },
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT ?? 5178}`,
        changeOrigin: true,
      },
    },
  },
})
