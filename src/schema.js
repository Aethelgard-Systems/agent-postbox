// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Marco Gernand

import { CODES, fail } from './errors.js';

/**
 * Validator for the small JSON Schema subset used by the tool definitions:
 * object (properties, required, additionalProperties:false), string
 * (minLength, maxLength, enum), integer (minimum, maximum), array
 * (items, maxItems). Unknown keywords are not silently accepted.
 */
const SUPPORTED = new Set(['type', 'description', 'properties', 'required', 'additionalProperties', 'minLength', 'maxLength', 'enum', 'minimum', 'maximum', 'items', 'maxItems', 'default']);

export function validate(schema, value, at = 'arguments') {
  for (const k of Object.keys(schema)) if (!SUPPORTED.has(k)) throw new Error(`schema keyword not supported: ${k}`);
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(CODES.INPUT, `${at} must be an object`);
      const props = schema.properties || {};
      for (const r of schema.required || []) if (value[r] === undefined) fail(CODES.INPUT, `${at}.${r} is required`);
      for (const [k, v] of Object.entries(value)) {
        if (!Object.hasOwn(props, k)) {
          if (schema.additionalProperties === false) fail(CODES.INPUT, `${at}.${k} is not allowed`);
          continue;
        }
        validate(props[k], v, `${at}.${k}`);
      }
      return value;
    }
    case 'string':
      if (typeof value !== 'string') fail(CODES.INPUT, `${at} must be a string`);
      if (schema.minLength !== undefined && value.length < schema.minLength) fail(CODES.INPUT, `${at} is too short`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(CODES.INPUT, `${at} is too long`);
      if (schema.enum && !schema.enum.includes(value)) fail(CODES.INPUT, `${at} must be one of ${schema.enum.join(', ')}`);
      return value;
    case 'integer':
      if (!Number.isInteger(value)) fail(CODES.INPUT, `${at} must be an integer`);
      if (schema.minimum !== undefined && value < schema.minimum) fail(CODES.INPUT, `${at} is too small`);
      if (schema.maximum !== undefined && value > schema.maximum) fail(CODES.INPUT, `${at} is too large`);
      return value;
    case 'array':
      if (!Array.isArray(value)) fail(CODES.INPUT, `${at} must be an array`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(CODES.INPUT, `${at} has too many items`);
      value.forEach((v, i) => validate(schema.items, v, `${at}[${i}]`));
      return value;
    default:
      throw new Error(`schema type not supported: ${schema.type}`);
  }
}
