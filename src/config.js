// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODES, fail } from './errors.js';

const AGENT_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const LABEL_RE = /^[^\s,][^,]{0,48}$/;

const DEFAULTS = Object.freeze({
  tokenEnv: 'COUNTERSIGN_TOKEN',
  addressPrefix: 'to:',
  claimPrefix: 'claimed:',
  proposalLabel: 'proposal',
  protectedLabels: ['approved', 'decision:*'],
  allowedLabels: ['needs-review', 'blocked', 'question'],
  limits: { writesPerDay: 50, proposalsPerDay: 5, bodyMaxChars: 6000, titleMaxChars: 120 },
  allowClassicToken: false,
});

const KEYS = new Set([
  '$schema', 'repository', 'agent', 'login', 'tokenEnv', 'addressPrefix', 'claimPrefix',
  'proposalLabel', 'protectedLabels', 'allowedLabels', 'limits', 'receiptsFile', 'allowClassicToken',
]);
const LIMIT_KEYS = new Set(Object.keys(DEFAULTS.limits));

const stateDir = () =>
  process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');

export function matchLabel(pattern, label) {
  const p = pattern.toLowerCase();
  const l = label.toLowerCase();
  return p.endsWith('*') ? l.startsWith(p.slice(0, -1)) : l === p;
}

function labelList(value, field) {
  if (!Array.isArray(value)) fail(CODES.CONFIG, `${field} must be an array`);
  for (const l of value) if (typeof l !== 'string' || !LABEL_RE.test(l)) fail(CODES.CONFIG, `${field} contains an invalid label: ${JSON.stringify(l)}`);
  return [...value];
}

export function parseConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(CODES.CONFIG, 'config must be a JSON object');
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) fail(CODES.CONFIG, `unknown config key: ${k}`);
  if (typeof raw.repository !== 'string' || !REPO_RE.test(raw.repository)) fail(CODES.CONFIG, 'repository must look like "owner/repo"');
  if (typeof raw.agent !== 'string' || !AGENT_RE.test(raw.agent)) fail(CODES.CONFIG, 'agent must be lowercase letters, digits or dashes (max 39)');
  if (raw.login !== undefined && (typeof raw.login !== 'string' || !/^[A-Za-z0-9-]+(\[bot\])?$/.test(raw.login))) fail(CODES.CONFIG, 'login must be a GitHub login');
  if (raw.tokenEnv !== undefined && (typeof raw.tokenEnv !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(raw.tokenEnv))) fail(CODES.CONFIG, 'tokenEnv must be an environment variable name');
  for (const k of ['addressPrefix', 'claimPrefix', 'proposalLabel']) {
    if (raw[k] !== undefined && (typeof raw[k] !== 'string' || !LABEL_RE.test(raw[k]))) fail(CODES.CONFIG, `${k} must be a label string`);
  }
  if (raw.allowClassicToken !== undefined && typeof raw.allowClassicToken !== 'boolean') fail(CODES.CONFIG, 'allowClassicToken must be boolean');
  const limits = { ...DEFAULTS.limits };
  if (raw.limits !== undefined) {
    if (!raw.limits || typeof raw.limits !== 'object') fail(CODES.CONFIG, 'limits must be an object');
    for (const [k, v] of Object.entries(raw.limits)) {
      if (!LIMIT_KEYS.has(k)) fail(CODES.CONFIG, `unknown limit: ${k}`);
      if (!Number.isInteger(v) || v < 0 || v > 100000) fail(CODES.CONFIG, `limits.${k} must be a non-negative integer`);
      limits[k] = v;
    }
  }
  const [owner, repo] = raw.repository.split('/');
  const config = {
    ...DEFAULTS,
    ...raw,
    owner,
    repo,
    limits,
    protectedLabels: labelList(raw.protectedLabels ?? DEFAULTS.protectedLabels, 'protectedLabels'),
    allowedLabels: labelList(raw.allowedLabels ?? DEFAULTS.allowedLabels, 'allowedLabels'),
  };
  for (const a of config.allowedLabels) {
    if (config.protectedLabels.some((p) => matchLabel(p, a) || matchLabel(a, p))) fail(CODES.CONFIG, `label "${a}" is both allowed and protected`);
  }
  for (const special of [config.addressPrefix + '*', config.claimPrefix + '*', config.proposalLabel]) {
    if (config.protectedLabels.some((p) => matchLabel(p, special.replace(/\*$/, 'x')))) fail(CODES.CONFIG, `protectedLabels must not cover "${special}"`);
  }
  config.receiptsFile = raw.receiptsFile ??
    path.join(stateDir(), 'countersign', `${owner}-${repo}-${config.agent}.json`.toLowerCase());
  return Object.freeze(config);
}

export function loadConfig(file = process.env.COUNTERSIGN_CONFIG || 'countersign.config.json') {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(CODES.CONFIG, `cannot read config file ${file}: ${e.code || e.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    fail(CODES.CONFIG, `config file ${file} is not valid JSON: ${e.message}`);
  }
  return parseConfig(raw);
}

export function readToken(config, env = process.env) {
  const token = env[config.tokenEnv];
  if (!token || !token.trim()) fail(CODES.TOKEN, `environment variable ${config.tokenEnv} is not set`);
  return token.trim();
}
