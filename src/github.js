// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import { CODES, PostboxError, fail } from './errors.js';

/**
 * Minimal GitHub REST client bound to exactly one repository.
 *
 * Only the endpoints listed in ALLOWED can be called. There is no endpoint
 * for merging, closing, deleting, editing bodies, changing settings or
 * reading code. Adding one is a deliberate code change, not a config switch.
 */
const N = '[1-9][0-9]{0,9}';
const ALLOWED = [
  ['GET', /^\/user$/],
  ['GET', /^\/repos\/R$/],
  ['GET', /^\/repos\/R\/issues$/],
  ['POST', /^\/repos\/R\/issues$/],
  ['GET', new RegExp(`^/repos/R/issues/${N}$`)],
  ['GET', new RegExp(`^/repos/R/issues/${N}/comments$`)],
  ['POST', new RegExp(`^/repos/R/issues/${N}/comments$`)],
  ['GET', new RegExp(`^/repos/R/issues/comments/${N}$`)],
  ['GET', new RegExp(`^/repos/R/issues/${N}/labels$`)],
  ['POST', new RegExp(`^/repos/R/issues/${N}/labels$`)],
  ['DELETE', new RegExp(`^/repos/R/issues/${N}/labels/[^/]+$`)],
  ['GET', new RegExp(`^/repos/R/pulls/${N}$`)],
  ['GET', new RegExp(`^/repos/R/pulls/${N}/reviews$`)],
  ['POST', new RegExp(`^/repos/R/pulls/${N}/reviews$`)],
  ['GET', new RegExp(`^/repos/R/pulls/${N}/reviews/${N}$`)],
];

export class GitHubError extends PostboxError {
  constructor(status, message) {
    super(CODES.GITHUB, `GitHub API ${status}: ${message}`, { status });
    this.status = status;
  }

  /** 4xx (except timeouts/rate limits) means GitHub rejected the write: nothing happened. */
  get definitelyNotApplied() {
    return this.status >= 400 && this.status < 500 && ![408, 409, 429].includes(this.status);
  }
}

export class GitHub {
  constructor({ owner, repo, token, fetch: fetchImpl = globalThis.fetch, baseUrl = 'https://api.github.com', userAgent = 'agent-postbox' }) {
    if (!token) fail(CODES.TOKEN, 'missing GitHub token');
    this.owner = owner;
    this.repo = repo;
    this.repoPath = `/repos/${owner}/${repo}`;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.basePath = new URL(this.baseUrl).pathname.replace(/\/$/, ''); // e.g. /api/v3 on GitHub Enterprise Server
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
    Object.defineProperty(this, 'token', { value: token, enumerable: false });
  }

  #allowed(method, path) {
    const normalized = path.startsWith(this.repoPath + '/') || path === this.repoPath
      ? '/repos/R' + path.slice(this.repoPath.length)
      : path;
    return ALLOWED.some(([m, re]) => m === method && re.test(normalized));
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path);
    // Check what will actually be sent: URL normalisation (dot segments) must not change the path.
    if (url.pathname !== this.basePath + path || !this.#allowed(method, path)) fail(CODES.POLICY, `endpoint not allowed: ${method} ${path}`);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined) url.searchParams.set(k, String(v));
    let res;
    try {
      res = await this.fetch(url.toString(), {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': this.userAgent,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new GitHubError(0, `network error: ${String(e.message || e).replaceAll(this.token, '***')}`);
      throw err;
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 200) };
      }
    }
    if (!res.ok) throw new GitHubError(res.status, String(data?.message || res.statusText || 'error').replaceAll(this.token, '***'));
    const headers = {};
    res.headers?.forEach?.((v, k) => { headers[k.toLowerCase()] = v; });
    return { data, headers };
  }

  repoUrl(suffix = '') {
    return `${this.repoPath}${suffix}`;
  }
}
