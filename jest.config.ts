import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // ts-jest workers grow their heap over a long run (each test file adds transformed-module state);
  // past physical memory they OOM-crash and jest restarts them in a loop — the full suite "hangs"
  // for an hour instead of finishing. Recycling any worker whose idle heap passes this limit keeps
  // the run bounded. Seen 2026-07-02 as an OOM in static.analyzer.test.ts under --coverage.
  workerIdleMemoryLimit: '1GB',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/'
  ]
};

export default config;
