import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { acquireConnection } = createRequire(import.meta.url)('../dist/database/acquire-connection.js');
let attempts = 0, released = 0;
const runner = await acquireConnection(() => ({
  connect: async () => { if (++attempts < 3) throw Object.assign(new Error(), { code: 'ETIMEDOUT' }); },
  release: async () => { released++; },
}));
assert.equal(attempts, 3);
assert.equal(released, 2);
await runner.release();
let badAttempts = 0;
await assert.rejects(() => acquireConnection(() => ({
  connect: async () => { badAttempts++; throw Object.assign(new Error(), { code: '28P01' }); },
  release: async () => {},
})));
assert.equal(badAttempts, 1, 'authentication failures must not retry');
let exhausted = 0;
await assert.rejects(() => acquireConnection(() => ({
  connect: async () => { exhausted++; throw Object.assign(new Error(), { code: 'ETIMEDOUT' }); },
  release: async () => {},
})));
assert.equal(exhausted, 3);
console.log('PASS: bounded connection-only retries, resource release, permanent errors fail immediately');
