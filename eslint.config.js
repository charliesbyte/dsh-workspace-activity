import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config. `typescript-eslint` supplies the type-aware-free recommended set,
 * `eslint-plugin-react-hooks` guards the slot entry's hook usage, and
 * `eslint-config-prettier` goes last so formatting never becomes a lint error.
 */
const hookRules =
  (reactHooks.configs['recommended-latest'] ?? reactHooks.configs.recommended)?.rules ?? {};

export default tseslint.config(
  { ignores: ['lib/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...hookRules },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  prettier,
);
