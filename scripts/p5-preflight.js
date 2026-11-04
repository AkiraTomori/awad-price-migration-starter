// Gate A: read-only final-target checks plus a separate disposable v1/v1 probe.
// This module has no path that executes the plan or migrates the demonstration DB.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { buildPlan, RELEASES, P4_HEAD } from './p5-plan.js';
import { open } from '../src/db.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const exec = promisify(execFile);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
export async function checkPort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const assigned = server.address().port;
  await new Promise((r) => server.close(r));
  return assigned;
}
export function evidenceHashes() {
  const files = git('ls-files', 'docs/evidence').split('\n').filter(Boolean);
  return Object.fromEntries(files.map((p) => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]));
}
async function probe(log) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ia2-p5-a-probe-')));
  const dbPath = join(dir, 'disposable.db');
  const env = { ...process.env, DB_PATH: dbPath, PATH: dirname(process.execPath) + delimiter + process.env.PATH };
  const children = [];
  let result;
  try {
    for (const file of ['package.json', 'src/app.js', 'src/db.js', 'src/server.js', 'scripts/seed.js']) {
      const bytes = execFileSync('git', ['show', `v1:${file}`], { cwd: root });
      const dest = join(dir, file); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, bytes);
      log.push({ source: `v1:${file}`, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    log.push({ scope: 'DISPOSABLE ONLY', dbPath, command: ['node', 'scripts/migrate.js', 'up', '--to', '001_init'] });
    const migration = await exec(process.execPath, ['scripts/migrate.js', 'up', '--to', '001_init'], { cwd: root, env });
    log.push({ migration: migration.stdout.trim(), stderr: migration.stderr });
    const seed = await exec(process.execPath, ['scripts/seed.js', '20000'], { cwd: dir, env });
    log.push({ seed: seed.stdout.trim(), stderr: seed.stderr });
    const db = open(dbPath);
    try { assert.equal(db.prepare('SELECT count(*) AS n FROM menu_items').get().n, 20000); } finally { db.close(); }
    for (const slot of ['A', 'B']) {
      const port = await checkPort(0);
      const child = spawn(process.execPath, ['src/server.js'], { cwd: dir, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
      const item = { child, port, stdout: '', stderr: '' };
      item.done = new Promise((r) => child.once('close', (code, signal) => r({ code, signal })));
      child.stdout.on('data', (d) => { item.stdout += d; }); child.stderr.on('data', (d) => { item.stderr += d; });
      children.push(item);
      let healthy = false;
      for (let attempt = 0; attempt < 300; attempt++) {
        if (child.exitCode !== null) throw new Error(item.stderr);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
          assert.deepEqual(await res.json(), { ok: true }); healthy = true; break;
        } catch { await pause(10); }
      }
      assert.ok(healthy, 'disposable v1 did not become healthy');
      let handle;
      if (process.platform === 'linux') {
        const fs = await import('node:fs');
        const fdDir = `/proc/${child.pid}/fd`;
        const matched = fs.readdirSync(fdDir).filter((f) => { try { return fs.readlinkSync(join(fdDir, f)) === dbPath; } catch { return false; } });
        assert.ok(matched.length);
        handle = { procFd: matched, dbPath };
      } else {
        const observed = await exec('lsof', ['-a', '-p', String(child.pid), '-Fn', '--', dbPath]);
        assert.ok(observed.stdout.includes(`p${child.pid}\n`));
        assert.ok(observed.stdout.includes(`n${dbPath}`));
        handle = { lsof: observed.stdout.trim() };
      }
      log.push({ slot, pid: child.pid, sourceCommit: RELEASES.v1, command: [process.execPath, 'src/server.js'], cwd: dir, port, dbPath, dbInode: statSync(dbPath).ino, handle, health: { ok: true }, note: 'v1 has no version field; pinned source, PID, cwd and open DB handle establish identity' });
    }
    assert.notEqual(children[0].child.pid, children[1].child.pid);
    const call = async (index, method, path, body) => {
      const res = await fetch(`http://127.0.0.1:${children[index].port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
      const value = await res.json(); log.push({ probeHttp: true, pid: children[index].child.pid, method, path, body, status: res.status, response: value });
      return { status: res.status, value };
    };
    const made = await call(0, 'POST', '/menu', { name: 'P5-A disposable probe', price: 45.5 });
    assert.equal(made.status, 201);
    const id = made.value.id;
    assert.equal((await call(1, 'GET', `/menu/${id}`)).value.price, 45.5);
    assert.equal((await call(1, 'PATCH', `/menu/${id}`, { price: 6 })).status, 200);
    assert.equal((await call(0, 'GET', `/menu/${id}`)).value.price, 6);
    assert.equal((await call(0, 'POST', '/orders', { items: [{ menuItemId: id, qty: 2 }] })).value.total, 12);
    const confirm = open(dbPath);
    try { assert.equal(confirm.prepare('SELECT unit_price FROM order_items').get().unit_price, 6); } finally { confirm.close(); }
    for (const name of ['migrate:status', 'check']) {
      const output = await exec('npm', ['run', name], { cwd: root, env });
      log.push({ command: ['npm', 'run', name], dbPath, stdout: output.stdout, stderr: output.stderr });
      if (name === 'check') assert.match(output.stdout, /\nCONSISTENT\n$/);
    }
    result = { initialRows: 20000, pids: children.map((c) => c.child.pid), dbPath, crossInstanceVisibility: true, orderUnit: 'thousands of VND' };
    return result;
  } finally {
    for (const c of children) if (c.child.exitCode === null && c.child.signalCode === null) c.child.kill('SIGTERM');
    for (const c of children) {
      const timer = setTimeout(() => c.child.kill('SIGKILL'), 5000);
      const exit = await c.done; clearTimeout(timer);
      log.push({ disposableInstanceExit: c.child.pid, ...exit, stdout: c.stdout, stderr: c.stderr });
    }
    rmSync(dir, { recursive: true, force: true });
    log.push({ disposableProbeCleanedUp: true, passed: !!result });
  }
}

export async function preflight({ outputDir, runDir, dbPath, ports = [3001, 3002] }) {
  assert.equal(process.versions.node.split('.')[0], '22', 'Gate A must run on Node.js 22');
  const plan = buildPlan({ repo: root, runDir, dbPath, ports });
  assert.ok(outputDir && isAbsolute(outputDir), 'use an absolute evidence directory');
  const outputRelative = relative(plan.runDir, resolve(outputDir));
  assert.ok(outputRelative === '..' || outputRelative.startsWith('..' + sep) || isAbsolute(outputRelative), 'preflight evidence must be separate from the planned demonstration directory');
  assert.ok(outputDir && !existsSync(outputDir), 'use a new evidence directory; never overwrite evidence');
  const before = evidenceHashes();
  const tagObjects = Object.fromEntries(Object.keys(RELEASES).map((tag) => [tag, git('rev-parse', tag)]));
  for (const [tag, sha] of Object.entries(RELEASES)) assert.equal(git('rev-parse', `${tag}^{}`), sha);
  git('merge-base', '--is-ancestor', P4_HEAD, 'origin/main');
  assert.equal(git('ls-tree', '-r', '--name-only', 'v4', 'migrations/004_drop_price.up.sql'), '');
  for (const name of readdirSync(join(root, 'migrations')).filter((n) => n.endsWith('.up.sql')))
    assert.ok(existsSync(join(root, 'migrations', name.replace('.up.sql', '.down.sql'))));
  for (const port of ports) await checkPort(port);
  mkdirSync(outputDir, { recursive: true });
  const log = [{ scope: 'P5-A ONLY', node: process.version, time: new Date().toISOString(), main: git('rev-parse', 'origin/main'), branch: git('branch', '--show-current'), tagObjects, releaseCommits: RELEASES, portsAvailableAtPreflight: ports, proposedDbPath: plan.dbPath, proposedDbExists: false, demoStage: 'NOT STARTED', S8: 'NOT AUTHORIZED / NOT EVALUATED', testSuite: 'run separately; this command does not claim npm test results' }];
  try {
    const identityProbe = await probe(log);
    assert.deepEqual(evidenceHashes(), before, 'existing evidence must be preserved byte-for-byte');
    assert.deepEqual(Object.fromEntries(Object.keys(RELEASES).map((tag) => [tag, git('rev-parse', tag)])), tagObjects);
    buildPlan({ repo: root, runDir, dbPath, ports }); // Recheck freshness after probe.
    const summary = { scope: 'P5-A ONLY', passed: true, identityProbe, plannedDb: plan.dbPath, demonstrationCreated: false, finalTrafficStarted: false, existingEvidenceFilesVerified: Object.keys(before).length, existingEvidenceUnchanged: true, tagsUnchanged: true, gate: 'STOP FOR GATE A REVIEW; no S0-S8 execution' };
    writeFileSync(join(outputDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(join(outputDir, 'preserved-evidence.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
    log.push(summary);
    return summary;
  } finally { writeFileSync(join(outputDir, 'preflight.json'), JSON.stringify(log, null, 2) + '\n', { flag: 'wx' }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  preflight({ outputDir: resolve(process.env.P5_PREFLIGHT_EVIDENCE_DIR ?? 'docs/evidence/p5-a-preflight'), runDir: process.env.P5_RUN_DIR, dbPath: process.env.DB_PATH })
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((e) => { console.error(e); process.exitCode = 1; });
