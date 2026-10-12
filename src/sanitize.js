// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import { CODES, fail } from './errors.js';

/**
 * Best-effort detection of credentials in text an agent is about to publish.
 * This reduces risk; it is not a guarantee. Patterns are deliberately
 * conservative to keep false positives low on ordinary engineering text.
 */
const SECRET_PATTERNS = [
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['openai-style-key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private-key-block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['url-credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{6,}@/i],
  ['assignment', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[^\s"']{8,}/i],
];

function entropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Long mixed-case alphanumeric runs with high entropy look like generated secrets. */
function highEntropyRuns(text) {
  const hits = [];
  for (const m of text.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) {
    const s = m[0];
    if (/^[0-9a-f]+$/i.test(s)) continue; // git SHAs, digests
    if (!(/[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s))) continue;
    if (/^[A-Za-z]+(?:[-_/][A-Za-z]+)+$/.test(s)) continue; // paths, slugs
    if (entropy(s) >= 4.2) hits.push('high-entropy-string');
  }
  return hits;
}

export function findSecrets(text) {
  const found = new Set();
  for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) found.add(name);
  for (const h of highEntropyRuns(text)) found.add(h);
  return [...found];
}

export function cleanBody(value, { field = 'body', max = 6000 } = {}) {
  if (typeof value !== 'string') fail(CODES.INPUT, `${field} must be a string`);
  const text = value.replace(/\r\n/g, '\n').trim();
  if (!text) fail(CODES.INPUT, `${field} must not be empty`);
  if (text.length > max) fail(CODES.INPUT, `${field} exceeds ${max} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail(CODES.INPUT, `${field} contains control characters`);
  if (/<!--\s*countersign\b/i.test(text)) fail(CODES.INPUT, `${field} must not contain countersign markers`);
  const secrets = findSecrets(text);
  if (secrets.length) fail(CODES.SECRET, `${field} looks like it contains a credential; nothing was written`, { kinds: secrets });
  return text;
}

export function cleanTitle(value, { max = 120 } = {}) {
  if (typeof value !== 'string') fail(CODES.INPUT, 'title must be a string');
  const title = value.trim();
  if (title.length < 5 || title.length > max) fail(CODES.INPUT, `title must be 5-${max} characters`);
  if (/[\r\n]/.test(title)) fail(CODES.INPUT, 'title must be a single line');
  const secrets = findSecrets(title);
  if (secrets.length) fail(CODES.SECRET, 'title looks like it contains a credential', { kinds: secrets });
  return title;
}
