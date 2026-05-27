import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['static/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Global-script architecture: functions defined in one file are used as
      // globals in another. ESLint cannot track cross-file global usage, so
      // unused-vars and prefer-const produce false positives throughout.
      '@typescript-eslint/no-unused-vars': 'off',
      'prefer-const': 'off',
    },
  },
  {
    // Empty interfaces in ambient declaration files are intentional stubs
    // for CDN globals (Three.js loaders, controls).
    files: ['src/**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: ['tests/frontend/**/*.js', 'jest.config.js', 'jest-global-script-transform.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
    },
  }
);
