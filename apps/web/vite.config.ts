import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 只做开发服务器与打包。daemon 地址由页面的 ?daemon= 参数给，不在构建期写死
// 端口 5180：5173 常被其它项目占用（English/vocab-video 的 vite 在 5174），nginx 的 domi.z.io 反代到这个端口
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, allowedHosts: ['domi.z.io'] },
  build: { outDir: 'dist', emptyOutDir: true },
})
