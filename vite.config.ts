// vite.config.ts
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Lego/' : './',  // Use './' for local dev, '/Lego/' for GitHub Pages
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  }
}))