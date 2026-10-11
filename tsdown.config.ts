import { defineConfig } from 'tsdown';

/**
 * Two halves, two shapes.
 *
 * The Host half is an ordinary ES module the Loader imports. The Client half is
 * not: the browser module table expects a lazy factory registered through
 * `window.__ModuleLoader__.load`, so it is emitted as CommonJS and wrapped into
 * that envelope by `scripts/wrap-client.ts` after the bundle is written. React
 * and the platform packages stay external because the module table supplies them
 * at materialization time.
 */
export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    dts: false,
    clean: false,
    fixedExtension: false,
  },
  {
    entry: { client: 'src/client.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    fixedExtension: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', /^@deepseek-ai\//] },
  },
]);
