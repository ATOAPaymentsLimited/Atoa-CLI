#!/usr/bin/env node
const [maj] = process.versions.node.split('.').map(Number);
if (maj < 20) {
  process.stderr.write(
    `atoa requires Node.js 20 or newer (you're on ${process.versions.node}). `
  );
  process.exit(1);
}

const {assertTlsHardenedEnv} = require('../dist/bootstrap.js');
try {
  assertTlsHardenedEnv();
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
}

require('../dist/cli.js');
