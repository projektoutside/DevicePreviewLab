const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', '.logs/**', '.browser-profiles/**', '.playwright-cli/**', 'output/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['server.js', 'local-server-discovery.js', 'terminal-service.js', 'scripts/**/*.js', 'tests/**/*.js', 'eslint.config.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['app.js', 'terminal-hall.js', 'integrations/**/*.js', 'tests/*browser-review.js', 'tests/browser-review.js'],
    languageOptions: { globals: { ...globals.browser, Terminal: 'readonly', FitAddon: 'readonly' } },
  },
];
