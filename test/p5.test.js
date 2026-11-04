import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from '../scripts/p5-plan.js';
import { checkPort, evidenceHashes } from '../scripts/p5-preflight.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('P5 plan describes each roll with an explicit S8 gate and executes no demonstration operation', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ia2-p5-plan-'));
  try {
    const plan = buildPlan({ repo });
    assert.equal(plan.executionEnabled, false);
    assert.ok(plan.steps.every((s) => s.status === 'NOT RUN' && s.checkAfter));
    assert.deepEqual(plan.steps.filter((s) => s.action === 'migration').map((s) => s.command.at(-1)), ['001_init', '002_add_price_vnd', '003_sync_legacy_price']);
    assert.deepEqual(plan.steps.filter((s) => s.action === 'roll_one').map((s) => s.state), ['v2/v1', 'v2/v2', 'v3/v2', 'v3/v3', 'v3/v2', 'v2/v2', 'v2/v3', 'v3/v3', 'v4/v3', 'v4/v4']);
    const s8 = plan.steps.findIndex((s) => s.id === 'S8');
    assert.equal(plan.steps[s8 - 1].id, 'S8-gate');
    assert.equal(plan.steps[s8].approvalRequired, true);
    assert.equal(plan.steps[s8].command.at(-1), '004_drop_price');
    assert.equal(plan.steps.filter((s) => s.action === 'start exactly one traffic process').length, 1);
    assert.equal(existsSync(plan.runDir), false);
    assert.equal(existsSync(plan.trafficLog), false);
    assert.equal(existsSync(plan.checkLog), false);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('P5 preparation refuses existing logs, DB directories, unsafe paths and symlink ancestors', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ia2-p5-guard-'));
  try {
    const raw = 'existing raw evidence: preserve exactly\n';
    for (const name of ['traffic-log.txt', 'check-log.txt']) {
      const file = join(repo, name);
      writeFileSync(file, raw);
      assert.throws(() => buildPlan({ repo }), /preserve existing path/);
      assert.equal(readFileSync(file, 'utf8'), raw);
      rmSync(file);
    }
    const runDir = join(repo, 'data', 'existing');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'app.db'), 'existing database bytes');
    assert.throws(() => buildPlan({ repo, runDir }), /preserve existing path/);
    assert.equal(readFileSync(join(runDir, 'app.db'), 'utf8'), 'existing database bytes');
    assert.throws(() => buildPlan({ repo, runDir: '/tmp/unsafe-demo' }), /fresh run directory/);
    assert.throws(() => buildPlan({ repo, dbPath: '/tmp/unsafe.db' }), /fresh run directory/);
    assert.throws(() => buildPlan({ repo, ports: [3001, 3001] }), /distinct/);
    symlinkSync(join(repo, 'data', 'existing'), join(repo, 'data', 'alias'));
    assert.throws(() => buildPlan({ repo, runDir: join(repo, 'data', 'alias', 'fresh') }), /symlink/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('P5 port preflight refuses a busy port without stopping the existing listener', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    await assert.rejects(checkPort(server.address().port), { code: 'EADDRINUSE' });
    assert.equal(server.listening, true);
  } finally { await new Promise((r) => server.close(r)); }
});

test('P5-A proves two exact-v1 PIDs open the same disposable DB; final DB/logs stay absent', { timeout: 30000 }, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ia2-p5-preflight-test-')));
  const before = evidenceHashes();
  const originalLogs = Object.fromEntries(['traffic-log.txt', 'check-log.txt'].filter((name) => existsSync(join(root, name))).map((name) => [name, readFileSync(join(root, name))]));
  try {
    // Exercise the real CLI in an independent Git fixture. Selectively populate
    // it without final-run logs; never hide or remove the operator's evidence.
    const cloneDir = join(dir, 'repo');
    execFileSync('git', ['clone', '--no-hardlinks', '--no-checkout', root, cloneDir]);
    const fixture = realpathSync(cloneDir);
    execFileSync('git', ['checkout', 'HEAD', '--', 'package.json', 'src', 'scripts', 'migrations', 'docs/evidence'], { cwd: fixture });
    const protectedRun = join(fixture, 'data', 'not-created');
    const invoke = (outputDir, ports) => spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { preflight } from './scripts/p5-preflight.js';
      const options = JSON.parse(process.argv[1]);
      try { console.log(JSON.stringify(await preflight(options))); }
      catch (error) { console.error(error); process.exitCode = 1; }
    `, JSON.stringify({ outputDir, runDir: protectedRun, ports })], { cwd: fixture, encoding: 'utf8' });
    for (const output of ['evidence', '..still-inside']) {
      const rejected = invoke(join(protectedRun, output));
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /must be separate/);
    }
    // Production CLI must still reject either pre-existing log, byte-for-byte.
    const fixtureEnv = { ...process.env };
    for (const key of ['DB_PATH', 'P5_RUN_DIR', 'P5_PREFLIGHT_EVIDENCE_DIR']) delete fixtureEnv[key];
    for (const name of ['traffic-log.txt', 'check-log.txt']) {
      const file = join(fixture, name), raw = 'preserve existing fixture evidence\n';
      writeFileSync(file, raw);
      const rejected = spawnSync(process.execPath, ['scripts/p5-preflight.js'], { cwd: fixture, env: fixtureEnv, encoding: 'utf8' });
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /preserve existing path/);
      assert.equal(readFileSync(file, 'utf8'), raw);
      rmSync(file); // This is only the temporary fixture's test-owned log.
    }
    assert.equal(existsSync(protectedRun), false);
    const a = await checkPort(0);
    let b = await checkPort(0);
    while (b === a) b = await checkPort(0);
    const completed = invoke(join(dir, 'evidence'), [a, b]);
    assert.equal(completed.status, 0, completed.stderr);
    const result = JSON.parse(completed.stdout);
    assert.equal(result.passed, true);
    assert.equal(result.demonstrationCreated, false);
    assert.equal(result.finalTrafficStarted, false);
    assert.equal(result.existingEvidenceUnchanged, true);
    assert.equal(result.tagsUnchanged, true);
    assert.notEqual(result.identityProbe.pids[0], result.identityProbe.pids[1]);
    assert.equal(result.identityProbe.initialRows, 20000);
    assert.equal(result.identityProbe.crossInstanceVisibility, true);
    assert.equal(result.identityProbe.orderUnit, 'thousands of VND');
    assert.equal(existsSync(result.plannedDb), false);
    assert.equal(existsSync(result.identityProbe.dbPath), false);
    assert.deepEqual(evidenceHashes(), before);
    for (const [name, raw] of Object.entries(originalLogs)) assert.deepEqual(readFileSync(join(root, name)), raw);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
