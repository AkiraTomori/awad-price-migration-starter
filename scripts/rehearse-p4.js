// Development rehearsal only: always creates its own disposable DB and ports.
// The final continuous v1-to-Contract demonstration is a separate operation.
import assert from 'node:assert/strict';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const pins = { v1: '2b889bde433190c17744f30d3900d38ab333a756', v2: 'dadb816bac9dad5ffcbf098d130d387bbbdd338c', v3: 'ccd19db7c1cf14d2a5df21f38769c73dd96f27b2' };
async function until(fn, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await pause(20);
  }
  throw new Error(message);
}
async function unusedPort() {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

export async function rehearseP4({ outputDir, v4Ref = null, rows = 300 } = {}) {
  assert.ok(outputDir, 'outputDir is required');
  assert.ok(Number.isInteger(rows) && rows >= 100, 'at least 100 rows required');
  for (const [tag, sha] of Object.entries(pins)) assert.equal(git('rev-parse', `${tag}^{}`), sha);
  if (existsSync(outputDir)) throw new Error('refusing to overwrite an existing evidence directory');
  mkdirSync(outputDir, { recursive: true });
  const temp = mkdtempSync(join(tmpdir(), 'ia2-p4-'));
  const auditPath = join(outputDir, 'rehearsal.txt');
  const checkPath = join(outputDir, 'checks.txt');
  const trafficPath = join(outputDir, 'traffic.txt');
  const log = (line) => appendFileSync(auditPath, `${new Date().toISOString()} ${line}\n`);
  const env = { ...process.env, DB_PATH: join(temp, 'shared.db'), PATH: dirname(process.execPath) + delimiter + process.env.PATH };
  const children = [];
  let traffic, failure;
  const slots = [];
  function launch(file, cwd, extra, name) {
    const proc = spawn(process.execPath, [file], { cwd, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    const child = { proc, stdout: '', stderr: '', name };
    proc.stdout.on('data', (data) => { child.stdout += data; });
    proc.stderr.on('data', (data) => { child.stderr += data; });
    child.done = new Promise((r) => proc.once('close', (code, signal) => r({ code, signal })));
    children.push(child);
    log(`START ${name} pid=${proc.pid} cwd=${cwd} file=${file} env=${JSON.stringify({ DB_PATH: env.DB_PATH, ...extra })}`);
    return child;
  }
  async function command(cwd, args, program = process.execPath) {
    log(`COMMAND cwd=${cwd} ${program} ${JSON.stringify(args)} DB_PATH=${env.DB_PATH}`);
    try {
      const result = await exec(program, args, { cwd, env, maxBuffer: 10 * 1024 * 1024 });
      log(result.stdout.trim());
      if (result.stderr) log(result.stderr.trim());
      return result.stdout;
    } catch (e) { log(`COMMAND FAILED ${e.stdout}\n${e.stderr}`); throw e; }
  }
  async function health(slot) {
    try {
      const res = await fetch(`${slot.target}/health`, { signal: AbortSignal.timeout(1000) });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }
  async function start(slot, version) {
    slot.child = launch('src/server.js', join(temp, version), { PORT: String(slot.port) }, `${slot.name} ${version}`);
    await until(async () => {
      if (slot.child.proc.exitCode !== null) throw new Error(`instance failed: ${slot.child.stderr}`);
      const h = await health(slot);
      return h?.ok === true && h.version === version;
    }, `${slot.name} health did not become ${version}`);
    slot.version = version;
    log(`HEALTH ${slot.name} ${slot.target} version=${version} pid=${slot.child.proc.pid}`);
  }
  async function check(label) {
    const versions = [];
    for (const slot of slots) {
      const h = await health(slot);
      assert.equal(h?.version, slot.version);
      versions.push(h.version);
    }
    const state = versions.join('/');
    const status = await command(root, ['run', 'migrate:status'], 'npm');
    const output = await command(root, ['run', 'check'], 'npm');
    appendFileSync(checkPath, `\n=== ${label} ${state} DB_PATH=${env.DB_PATH} ===\n${status}${output}`);
    assert.match(output, /\nCONSISTENT\n$/);
    assert.match(output, /price_vnd_null\s+0\n/);
    assert.match(output, /disagree\s+0\n/);
    if (traffic) {
      assert.equal(traffic.proc.exitCode, null, 'traffic must still be running');
      assert.doesNotMatch(traffic.stdout, /(?:ERROR|CONTRACT|STALE|UNAVAILABLE) /);
    }
    log(`CHECK PASS ${label} state=${state} traffic_pid=${traffic?.proc.pid ?? 'not started'}`);
    return state;
  }
  try {
    log(`P4 DEVELOPMENT REHEARSAL ONLY; node=${process.version}; shared DB_PATH=${env.DB_PATH}`);
    for (const version of ['v3', 'v4']) {
      const ref = version === 'v3' ? 'v3' : v4Ref;
      log(`SOURCE ${version} ref=${ref ?? 'WORKTREE'} commit=${ref ? git('rev-parse', `${ref}^{}`) : git('rev-parse', 'HEAD')}`);
      const files = ['package.json', 'src/app.js', 'src/db.js', 'src/server.js'];
      if (version === 'v3') files.push('scripts/migrate.js', 'scripts/seed.js', 'migrations/001_init.up.sql', 'migrations/002_add_price_vnd.up.sql');
      for (const file of files) {
        const source = ref ? execFileSync('git', ['show', `${ref}:${file}`], { cwd: root }) : readFileSync(join(root, file));
        const dest = join(temp, version, file);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, source);
        log(`SOURCE_FILE ${version}/${file} sha256=${createHash('sha256').update(source).digest('hex')}`);
      }
    }
    await command(root, ['scripts/migrate.js', 'up', '--to', '002_add_price_vnd']);
    await command(root, ['scripts/seed.js', String(rows)]);
    for (const name of ['A', 'B']) {
      const port = await unusedPort();
      const slot = { name, port, target: `http://127.0.0.1:${port}` };
      slots.push(slot);
      await start(slot, 'v3');
    }
    env.TARGETS = slots.map((s) => s.target).join(',');
    log(`TARGETS=${env.TARGETS}`);
    await check('QUALIFIED v3/v3 BEFORE BRIDGE');
    await command(root, ['scripts/migrate.js', 'up', '--to', '003_sync_legacy_price']);
    await check('BRIDGE INSTALLED / BEFORE v4');
    traffic = launch('scripts/traffic.js', root, {
      TARGETS: env.TARGETS, IDS: String(rows), NEW_CLIENTS: '0.3', NEW_CLIENTS_FILE: '',
      DURATION: '0', LOG: trafficPath,
    }, 'one continuous development traffic process');
    await until(() => traffic.stdout.includes('=== traffic start'), 'traffic did not start');
    const trafficPid = traffic.proc.pid;
    await pause(100);
    const states = [await check('BASELINE')];
    const steps = [[0, 'v4', 'DEPLOY A'], [1, 'v4', 'DEPLOY B / BEFORE ROLLBACK'],
      [1, 'v3', 'ROLLBACK B'], [0, 'v3', 'ROLLBACK A'],
      [1, 'v4', 'RESTORE B'], [0, 'v4', 'RESTORE A / AFTER ROLLBACK']];
    for (const [index, version, label] of steps) {
      const slot = slots[index], standby = slots[1 - index];
      assert.equal((await health(standby))?.version, standby.version);
      log(`ROLL ${label}: stopping ${slot.name} ${slot.version} pid=${slot.child.proc.pid}; standby=${standby.name}/${standby.version}`);
      const oldCount = (traffic.stdout.match(new RegExp(`${slot.target} down`, 'g')) ?? []).length;
      const backCount = (traffic.stdout.match(new RegExp(`${slot.target} back`, 'g')) ?? []).length;
      slot.child.proc.kill('SIGTERM');
      assert.equal((await slot.child.done).code, 0);
      // Leave one port down until the unchanged traffic client observes it.
      await until(() => (traffic.stdout.match(new RegExp(`${slot.target} down`, 'g')) ?? []).length > oldCount, 'missing real down event');
      await start(slot, version);
      await until(() => (traffic.stdout.match(new RegExp(`${slot.target} back`, 'g')) ?? []).length > backCount, 'missing real back event');
      assert.equal(traffic.proc.pid, trafficPid);
      states.push(await check(label));
    }
    traffic.proc.kill('SIGINT');
    assert.equal((await traffic.done).code, 0, traffic.stdout + traffic.stderr);
    const raw = readFileSync(trafficPath, 'utf8');
    assert.equal((raw.match(/=== traffic start/g) ?? []).length, 1);
    assert.match(raw, /FINAL ok=\d+ error=0 contract=0 stale=0 unavailable=0/);
    assert.match(raw, /RESULT: zero failed requests/);
    const final = raw.split('\n').find((line) => line.includes(' FINAL '));
    const summary = { trafficPid, states, final, down: (raw.match(/ down \(/g) ?? []).length, back: (raw.match(/ back\n/g) ?? []).length };
    assert.ok(summary.down >= 6 && summary.back >= 6);
    log(`PASS ${JSON.stringify(summary)}`);
    return summary;
  } catch (e) {
    failure = e;
    log(`FAILED ${e.stack}`);
    throw e;
  } finally {
    if (traffic?.proc.exitCode === null && traffic.proc.signalCode === null) traffic.proc.kill('SIGINT');
    for (const slot of slots) if (slot.child?.proc.exitCode === null && slot.child.proc.signalCode === null) slot.child.proc.kill('SIGTERM');
    for (const child of children) {
      const timer = setTimeout(() => child.proc.kill('SIGKILL'), 5000);
      await child.done;
      clearTimeout(timer);
      if (child.stderr) log(`STDERR ${child.name}: ${child.stderr.trim()}`);
    }
    rmSync(temp, { recursive: true, force: true });
    log(`CLEANUP complete; ${failure ? 'failed' : 'passed'} development rehearsal; final v1-to-Contract demo NOT RUN`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  rehearseP4({ outputDir: resolve(process.env.P4_EVIDENCE_DIR ?? 'docs/evidence/p4-rollback'), v4Ref: process.env.V4_REF ?? 'v4' })
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((e) => { console.error(e); process.exitCode = 1; });
}
