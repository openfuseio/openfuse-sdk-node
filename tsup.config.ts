import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  treeshake: true,
  sourcemap: false,
  minify: false,
  platform: 'node',
  target: 'node18',
  skipNodeModulesBundle: true,
})
