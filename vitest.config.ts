import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'vitest/config'

// Load test environment variables
loadEnv({ path: '.env.test' })

export default defineConfig({
  test: {
    globals: false,
    isolate: true,
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['tests/integration/e2e/**'],
    testTimeout: 10000,
    reporters: ['verbose'],
  },
})
