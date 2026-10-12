// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

/**
 * Every refusal carries a stable machine-readable code so that agents and
 * humans can react without parsing prose.
 */
export const CODES = Object.freeze({
  CONFIG: 'CONFIG',
  INPUT: 'INPUT',
  POLICY: 'POLICY',
  SECRET: 'SECRET',
  LIMIT: 'LIMIT',
  SELF_REVIEW: 'SELF_REVIEW',
  UNKNOWN_OUTCOME: 'UNKNOWN_OUTCOME',
  READBACK_MISMATCH: 'READBACK_MISMATCH',
  RECEIPTS: 'RECEIPTS',
  GITHUB: 'GITHUB',
  TOKEN: 'TOKEN',
});

export class PostboxError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PostboxError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return { error: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const fail = (code, message, details) => {
  throw new PostboxError(code, message, details);
};
