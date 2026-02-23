import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  base: './',
  build: { 
    outDir: 'dist',
    rollupOptions: {
      external: ['better-sqlite3']
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3421', changeOrigin: true }
    }
  }
})
