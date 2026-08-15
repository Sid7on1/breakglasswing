import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // Phase 8 adds the Desktop Trust Center's evidence view model under src/shared; it is graded by
  // the same command as the Mac capability suites (`npm --prefix app run test:mac:unit`).
  roots: [
    '<rootDir>/src/capabilities/mac', '<rootDir>/src/shared', '<rootDir>/src/phase9', '<rootDir>/src/main',
    // Renderer logic that is pure and worth pinning (view models, motion geometry). Components that
    // need a DOM stay in the design-preview harness; this root is for the parts a layout engine
    // cannot make more true.
    '<rootDir>/src/renderer/src/components/ui',
  ],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
  },
  collectCoverage: false,
  maxWorkers: 2,
};

export default config;
