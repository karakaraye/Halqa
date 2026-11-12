import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores(['.next/**', 'data/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'docs/**', 'next-env.d.ts', 'out/**', 'build/**']),
]);
