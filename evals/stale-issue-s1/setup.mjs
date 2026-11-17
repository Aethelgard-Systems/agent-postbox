// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand
// Usage: node evals/stale-issue-s1/setup.mjs <empty-target-dir>
// Copies the synthetic fixture into a fresh directory for one agent run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
if (!target) {
  console.error('usage: node setup.mjs <empty-target-dir>');
  process.exit(2);
}
if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
  console.error('target directory must not exist or must be empty');
  process.exit(2);
}
fs.cpSync(path.join(here, 'fixture'), target, { recursive: true });
console.log(`fixture copied to ${target}`);
