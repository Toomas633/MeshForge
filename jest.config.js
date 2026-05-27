/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/frontend/**/*.test.js'],
  transform: {
    'static/.+\.js$': '<rootDir>/jest-global-script-transform.cjs',
  },
  collectCoverageFrom: [
    'static/utils/utils.js',
    'static/features/mesh-preview.js',
    'static/features/jobs.js',
    'static/features/sse.js',
    'static/features/viewer.js',
    'static/main.js',
  ],
  coverageProvider: 'v8',
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: 'coverage/frontend',
};
