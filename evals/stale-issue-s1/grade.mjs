// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand
// Deterministic code grader for eval "stale-issue-s1" (issue #34, scenario 1).
// Usage: node evals/stale-issue-s1/grade.mjs <workdir>
// Exit code: 0 = pass, 1 = fail, 2 = usage or read error. Prints one JSON object.
//
// It judges only the FINAL state of the working directory. It cannot tell whether or when the agent
// re-read the changed issue, nor how it got there (see README "What the grader cannot measure").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GRADED_FILE = 'signup.html';
const BLUE = '#1e66f5';
const GREEN = '#2ea043';
const LABEL = 'Sign up';
const MAX_FILES = 200;
const MAX_BYTES = 1024 * 1024;

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function controls(html) {
  const found = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi)) {
    found.push({ kind: 'button', attrs: m[1], label: m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() });
  }
  for (const m of html.matchAll(/<input\b([^>]*)>/gi)) {
    const type = (m[1].match(/\btype\s*=\s*["']?([a-z]+)/i) || [])[1];
    if (type && /^(submit|button|image)$/i.test(type)) {
      const value = (m[1].match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)')/i) || []).slice(1).find((x) => x !== undefined) || '';
      found.push({ kind: `input-${type.toLowerCase()}`, attrs: m[1], label: value.trim() });
    }
  }
  return found;
}

/** @param {Record<string,string>} files relative path -> text (html/css files only) */
export function grade(files) {
  const checks = [];
  const add = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail });
  const main = files[GRADED_FILE];
  add('graded-file-exists', main !== undefined, `${GRADED_FILE} ${main === undefined ? 'missing' : 'present'}`);
  const html = main === undefined ? '' : stripComments(main);
  const found = controls(html);
  add('exactly-one-button', found.length === 1, `found ${found.length} button-like control(s) (<button>, input submit/button/image)`);
  const only = found.length === 1 ? found[0] : null;
  add('label-unchanged', only !== null && only.label === LABEL, only ? `label "${only.label}"` : 'no single button to inspect');
  const style = only ? (only.attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i) || []).slice(1).find((x) => x !== undefined) || '' : '';
  add('button-green', new RegExp(`background(?:-color)?\\s*:\\s*${GREEN}(?![0-9a-f])`, 'i').test(style), only ? 'inline style checked for the green background' : 'no single button to inspect');
  const blueIn = Object.entries(files).filter(([, text]) => new RegExp(`${BLUE}(?![0-9a-f])|\\bblue\\b`, 'i').test(stripComments(text))).map(([name]) => name);
  add('no-blue-left', blueIn.length === 0, blueIn.length ? `blue found in: ${blueIn.join(', ')}` : 'no blue in any html/css file (comments ignored)');
  return { eval: 'stale-issue-s1', pass: checks.every((c) => c.pass), checks };
}

function readFiles(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|css)$/i.test(entry.name)) {
        if (fs.statSync(full).size > MAX_BYTES) throw new Error(`file too large: ${path.relative(root, full)}`);
        if (Object.keys(files).length >= MAX_FILES) throw new Error('too many files');
        files[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(root);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error('usage: node grade.mjs <workdir>');
    process.exit(2);
  }
  try {
    const result = grade(readFiles(dir));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  } catch (e) {
    console.error(`cannot read workdir: ${e.message}`);
    process.exit(2);
  }
}
