import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 仕様書 §2: Vitest + Playwright(E2E最低限)
 *
 * - @/ エイリアス: tsconfig.json と同じ root を絶対パスで解決
 * - macOS AppleDouble (._*) を exclude(MS PicoGo 等の exFAT/NTFS 系で生成される)
 */
const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      // macOS AppleDouble メタデータファイル
      '**/._*',
    ],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: [
      // tsconfig.json の "paths": { "@/*": ["./*"] } と対応
      { find: /^@\/(.*)$/, replacement: `${rootDir}/$1` },
    ],
  },
});
