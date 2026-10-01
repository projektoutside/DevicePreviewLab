'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
for (const directory of ['.', 'tests', 'scripts', 'integrations']) {
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(directory, name)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('JavaScript syntax checks passed.');
