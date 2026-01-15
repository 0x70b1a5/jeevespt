/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/server.ts',
    '!src/legacy/**'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  // Suppress console output during tests for cleaner output
  silent: false,
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts']
};
