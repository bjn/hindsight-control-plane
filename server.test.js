'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBaseUrl,
  safeInt,
  isReadOnlyExplorerRoute,
  summarizeBanksPayload
} = require('./server');

test('normalizes upstream base URLs', () => {
  assert.equal(normalizeBaseUrl('http://hindsight-memory:8888/'), 'http://hindsight-memory:8888');
  assert.equal(normalizeBaseUrl('http://hindsight-memory:8888///'), 'http://hindsight-memory:8888');
});

test('safeInt clamps and falls back', () => {
  assert.equal(safeInt('25', 10, 1, 100), 25);
  assert.equal(safeInt('999', 10, 1, 100), 100);
  assert.equal(safeInt('-5', 10, 1, 100), 1);
  assert.equal(safeInt('nope', 10, 1, 100), 10);
});

test('route allowlist rejects write/delete endpoints', () => {
  assert.equal(isReadOnlyExplorerRoute('GET', '/api/banks'), true);
  assert.equal(isReadOnlyExplorerRoute('GET', '/api/banks/hermes-default/memories'), true);
  assert.equal(isReadOnlyExplorerRoute('POST', '/api/banks/hermes-default/recall'), true);

  assert.equal(isReadOnlyExplorerRoute('POST', '/api/banks/hermes-default/memories'), false);
  assert.equal(isReadOnlyExplorerRoute('DELETE', '/api/banks/hermes-default/documents'), false);
  assert.equal(isReadOnlyExplorerRoute('PATCH', '/api/banks/hermes-default/tags'), false);
  assert.equal(isReadOnlyExplorerRoute('GET', '/v1/default/banks/hermes-default/memories/list'), false);
});

test('summarizes supported bank list response shapes', () => {
  assert.deepEqual(summarizeBanksPayload([{ bank_id: 'a' }]), [{ bank_id: 'a' }]);
  assert.deepEqual(summarizeBanksPayload({ banks: [{ bank_id: 'b' }] }), [{ bank_id: 'b' }]);
  assert.deepEqual(summarizeBanksPayload({ items: [{ bank_id: 'c' }] }), [{ bank_id: 'c' }]);
  assert.deepEqual(summarizeBanksPayload({ nope: [] }), []);
});
