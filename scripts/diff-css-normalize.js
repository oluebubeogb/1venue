#!/usr/bin/env node
'use strict';

/**
 * Compare two CSS files after stripping comments and collapsing whitespace
 * (outside of strings). Used to prove a split/join did not change rule order.
 *
 * Usage: node scripts/diff-css-normalize.js <original.css> <new.css>
 */

const fs = require('fs');

function stripComments(css) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (css[i] === '"' || css[i] === "'") {
      const q = css[i];
      out += q;
      i++;
      while (i < n && css[i] !== q) {
        if (css[i] === '\\' && i + 1 < n) {
          out += css[i] + css[i + 1];
          i += 2;
          continue;
        }
        out += css[i++];
      }
      if (i < n) out += css[i++];
      continue;
    }
    out += css[i++];
  }
  return out;
}

function collapseWhitespace(css) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    if (css[i] === '"' || css[i] === "'") {
      const q = css[i];
      out += q;
      i++;
      while (i < n && css[i] !== q) {
        if (css[i] === '\\' && i + 1 < n) {
          out += css[i] + css[i + 1];
          i += 2;
          continue;
        }
        out += css[i++];
      }
      if (i < n) out += css[i++];
      continue;
    }
    if (/\s/.test(css[i])) {
      const start = i;
      while (i < n && /\s/.test(css[i])) i++;
      const prev = out[out.length - 1];
      const next = css[i];
      const tight = /[{};:,]/.test(prev || '') || /[{};:,]/.test(next || '');
      if (!tight && prev && next) out += ' ';
      else if (start !== i) {
        // dropped a whitespace run
      }
      continue;
    }
    out += css[i++];
  }
  return out.trim();
}

function normalize(css) {
  return collapseWhitespace(stripComments(css));
}

function countRules(normalized) {
  let count = 0;
  let i = 0;
  const n = normalized.length;
  while (i < n) {
    if (normalized[i] === '"' || normalized[i] === "'") {
      const q = normalized[i++];
      while (i < n && normalized[i] !== q) {
        if (normalized[i] === '\\' && i + 1 < n) i += 2;
        else i++;
      }
      if (i < n) i++;
      continue;
    }
    if (normalized[i] === '}') count++;
    i++;
  }
  return count;
}

function firstDiff(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      return { index: i, a: a.slice(Math.max(0, i - 80), i + 80), b: b.slice(Math.max(0, i - 80), i + 80) };
    }
  }
  if (a.length !== b.length) {
    return { index: len, a: a.slice(Math.max(0, len - 80)), b: b.slice(Math.max(0, len - 80)) };
  }
  return null;
}

function main() {
  const [, , leftPath, rightPath] = process.argv;
  if (!leftPath || !rightPath) {
    console.error('Usage: node scripts/diff-css-normalize.js <original.css> <new.css>');
    process.exit(2);
  }
  const left = fs.readFileSync(leftPath, 'utf8');
  const right = fs.readFileSync(rightPath, 'utf8');
  const nLeft = normalize(left);
  const nRight = normalize(right);
  const rulesLeft = countRules(nLeft);
  const rulesRight = countRules(nRight);
  console.log('normalized rule count (original):', rulesLeft);
  console.log('normalized rule count (new):     ', rulesRight);
  console.log('normalized length (original):', nLeft.length);
  console.log('normalized length (new):     ', nRight.length);
  if (nLeft === nRight) {
    console.log('diff: empty (rule sequences match)');
    return;
  }
  const diff = firstDiff(nLeft, nRight);
  console.log('diff: NOT empty');
  if (diff) {
    console.log('first difference at index', diff.index);
    console.log('original around diff:', JSON.stringify(diff.a));
    console.log('new around diff:     ', JSON.stringify(diff.b));
  }
  process.exit(1);
}

main();
