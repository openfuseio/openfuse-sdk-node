import eslintPluginTs from '@typescript-eslint/eslint-plugin'
import parserTs from '@typescript-eslint/parser'
import prettierConfig from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'

const commonTSConfig = {
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parser: parserTs,
    parserOptions: { project: './tsconfig.json' },
  },
  plugins: { '@typescript-eslint': eslintPluginTs, prettier: prettierPlugin },
  rules: {
    ...eslintPluginTs.configs.recommended.rules,
    'prettier/prettier': 'error',
  },
}

export default [
  /* ---------- Global ignores ---------- */
  {
    ignores: ['tsup.config.ts', 'vitest.config.ts', 'vitest.config.e2e.ts', 'dist/**'],
  },
  /* -------- TypeScript test files ------- */
  {
    ...commonTSConfig,
    files: ['**/*.test.ts'], // limit this block to TS test files
    rules: {
      ...commonTSConfig.rules,
      '@typescript-eslint/no-empty-function': 'off', // allow empty functions in tests
      '@typescript-eslint/no-explicit-any': 'off', // allow explicit any in tests
    },
  },
  /* ---------- TypeScript files ---------- */
  {
    ...commonTSConfig,
    files: ['**/*.ts'], // limit this block to TS files
    ignores: ['**/*.test.ts', 'tsup.config.ts'], // ignore test files and config
  },

  /* ---------- Plain JavaScript ---------- */
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'], // limit this block to JS files
    plugins: { prettier: prettierPlugin },
    rules: { 'prettier/prettier': 'error' }, // keep formatting errors
  },

  prettierConfig,
]
