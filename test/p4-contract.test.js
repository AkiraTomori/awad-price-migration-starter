import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { rehearseContract } from '../scripts/rehearse-contract.js';

test('all migration downs, staged Contract, exact-tag v4 HTTP and schema recovery on a disposable DB', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p4-contract-test-'));
  try {
    const result = await rehearseContract({ outputDir: join(dir, 'evidence') });
    assert.equal(result.passed, true);
    console.log(`P4 disposable schema/HTTP proof ${JSON.stringify(result)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
