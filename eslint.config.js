import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'spike', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, penpot: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Empty catches must at least carry a comment explaining why.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  ...[
    // Penpot runs plugin.js as a classic script: the plugin bundle must be
    // self-contained. Sharing a runtime module with the UI makes Rollup emit
    // a shared chunk and an `import` statement. Types are fine.
    { files: ['src/plugin.ts'], forbidden: '^\\./(?!plugin/|types$)' },
    { files: ['src/plugin/**/*.ts'], forbidden: '^\\.\\./(?!types$)' },
  ].map(({ files, forbidden }) => ({
    files,
    ignores: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{ regex: forbidden, allowTypeImports: true, message: 'The plugin bundle must not share runtime code with the UI.' }],
      }],
    },
  })),
);
