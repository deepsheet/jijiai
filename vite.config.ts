import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // This is needed for Tauri to work properly
  build: {
    target: 'es2020',
  },
})