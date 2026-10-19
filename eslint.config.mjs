import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/.turbo/**',
      '**/.tmp/**',
      'docs/screenshots/**',
      'examples/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // URL/query synchronisation and "select first item" are intentional effects in this app.
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-debugger': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'warn',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tooling/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]
