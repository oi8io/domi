import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 只做开发服务器与打包。daemon 地址由页面的 ?daemon= 参数给，不在构建期写死
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
})
