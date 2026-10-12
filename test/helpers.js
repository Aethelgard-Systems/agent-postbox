// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseConfig } from '../src/config.js';
import { GitHub } from '../src/github.js';
import { Mailbox } from '../src/mailbox.js';
import { ReceiptStore } from '../src/receipts.js';
import { fakeGitHub } from './fake-github.js';

export const SYNTHETIC_TOKEN = 'synthetic-test-token-not-a-secret';

export function setup(t, { agent = 'agent-a', login = 'agent-a-bot', config = {}, classicScopes } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'countersign-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cfg = parseConfig({ repository: 'example-org/example-repo', agent, receiptsFile: path.join(dir, 'receipts.json'), ...config });
  const fake = fakeGitHub({ login, classicScopes });
  const github = new GitHub({ owner: cfg.owner, repo: cfg.repo, token: SYNTHETIC_TOKEN, fetch: fake.fetch });
  const receipts = new ReceiptStore(cfg.receiptsFile);
  return { dir, config: cfg, fake, gh: fake.state, github, receipts, mailbox: new Mailbox({ config: cfg, github, receipts }) };
}

export const writes = (gh) => gh.calls.filter((c) => c.method !== 'GET');
