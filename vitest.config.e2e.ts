import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'vitest/config'

// Load test environment variables
loadEnv({ path: '.env.test' })

export default defineConfig({
  test: {
    globals: false,
    isolate: true,
    include: ['tests/integration/e2e/**/*.{test,spec}.{js,ts}'],
    testTimeout: 120000,
    hookTimeout: 120000,
    reporters: ['verbose'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
})
