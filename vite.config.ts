import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // This is needed for Tauri to work properly
  build: {
    target: 'es2020',
  },
  server: {
    port: 5174,
    strictPort: true, // 如果端口被占用则退出，而不是尝试其他端口
  },
})