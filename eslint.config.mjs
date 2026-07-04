import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      // Lazy `require()` inside try/catch is a deliberate pattern here — it breaks import
      // cycles (config ↔ mind ↔ protocol) and defers heavy/optional modules until first use.
      // Same intentional-but-flagged tier as `any`: a warning, not a CI-failing error.
      '@typescript-eslint/no-require-imports': 'warn',
      'consistent-return': 'error',
    },
  }
);
