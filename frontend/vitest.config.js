import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/app/__tests__/setup.js'],
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/main.jsx',
        // Contract one-liners and an import list: nothing a mocked unit
        // test can reach, and Playwright proves them end to end.
        // See docs/test-cases/COVERAGE.md.
        'src/areas/*/api.js',
        'src/app/areas.js',
      ],
    },
  },
})
