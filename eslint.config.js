/**
 * ESLint configuration (flat config).
 *
 * Layers, in order:
 *   1. JavaScript recommended rules,
 *   2. TypeScript recommended rules (typescript-eslint),
 *   3. Vue 3 recommended rules (eslint-plugin-vue; `<script lang="ts" src>` blocks are linted
 *      as regular TypeScript files),
 *   4. project rules: readable, "airy" code – blank lines around blocks, before `return` and
 *      after declaration groups (@stylistic/padding-line-between-statements),
 *   5. eslint-config-prettier last: Prettier owns all formatting, ESLint only code quality
 *      and the blank-line layout that Prettier does not enforce.
 *
 * Run: `npm run lint` (check) or `npm run lint:fix` (fix what can be fixed automatically).
 */
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', '.claude/**', 'docker/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },

  {
    plugins: { '@stylistic': stylistic },
    rules: {
      // Airy layout: blank lines separate logical steps.
      '@stylistic/padding-line-between-statements': [
        'error',
        // Before every `return` (unless it is the first statement of its block).
        { blankLine: 'always', prev: '*', next: 'return' },
        // After a group of declarations, before the code that uses them.
        { blankLine: 'always', prev: ['const', 'let'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
        // Around multi-line blocks (if / for / function … with braces).
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        // Between top-level exports and functions.
        { blankLine: 'always', prev: '*', next: ['export', 'function', 'class'] },
        { blankLine: 'any', prev: 'import', next: 'import' },
        // `case` clauses of a switch stay compact.
        { blankLine: 'any', prev: '*', next: ['case', 'default'] },
      ],
      '@stylistic/lines-between-class-members': [
        'error',
        'always',
        { exceptAfterSingleLine: true },
      ],

      // TypeScript: unused values are errors; a leading underscore marks an intentional one.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Vue: components are named by their folder (GraphNode/GraphNode.vue); several are one word.
      'vue/multi-word-component-names': 'off',
      // v-html is not used; keep it an explicit decision if it ever is.
      'vue/no-v-html': 'error',
    },
  },

  prettier,
)
