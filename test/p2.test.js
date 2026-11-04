import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from 'node:http';
import { open } from '../src/db.js';
import { createV2 as createApp } from '../test-support/v2.js';
import { backfill } from '../scripts/backfill.js';
import { createClientMix, parseShare } from '../scripts/lib/client-mix.js';

const root = new URL('../', import.meta.url);
const schema = () => ['001_init', '002_add_price_vnd'].map((v) => readFileSync(new URL(`../migrations/${v}.up.sql`, import.meta.url), 'utf8')).join('\n');
const snapshot = (db) => db.prepare('SELECT * FROM menu_items ORDER BY id').all();
const counts = (db) => ({ ...db.prepare(`SELECT
  sum(price_vnd IS NULL) AS missing,
  sum(price_vnd IS NOT NULL AND price_vnd <> CAST(round(price * 1000) AS INTEGER)) AS disagree
  FROM menu_items`).get() });
async function until(predicate, message, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return;
    await pause(10);
  }
  assert.fail(message);
}
function atomicWrite(path, value) {
  writeFileSync(path + '.next', value);
  renameSync(path + '.next', path);
}
async function fixture(t, rows = 400) {
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p2-test-'));
  const path = join(dir, 'shared.db');
  const db = open(path);
  db.exec(schema());
  const insert = db.prepare('INSERT INTO menu_items (name, price, price_vnd) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  for (let i = 1; i <= rows; i++) insert.run(`Dish ${i}`, 45.5, i % 3 === 0 ? 45500 : i % 3 === 1 ? null : 1);
  db.exec("INSERT INTO orders VALUES (1, 'before backfill'); INSERT INTO order_items VALUES (1, 1, 2, 45.5); COMMIT");
  const servers = [], connections = [], children = [];
  const metrics = { newWrites: 0 };
  for (let i = 0; i < 2; i++) {
    const connection = open(path);
    const server = createApp(connection);
    // Observe without consuming or changing application responses.
    server.on('request', (req) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => { if (raw && Object.hasOwn(JSON.parse(raw), 'priceVnd')) metrics.newWrites++; });
    });
    server.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    connections.push(connection);
    servers.push(server);
  }
  const targets = servers.map((server) => `http://127.0.0.1:${server.address().port}`);
  t.after(async () => {
    for (const child of children) if (child.proc.exitCode === null && child.proc.signalCode === null) child.proc.kill('SIGKILL');
    await Promise.all(children.map((child) => child.done));
    await Promise.all(servers.map((server) => new Promise((r) => server.close(r))));
    for (const connection of connections) connection.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const run = (script, extra = {}) => {
    const proc = spawn(process.execPath, [`scripts/${script}.js`], {
      cwd: root,
      env: { ...process.env, DB_PATH: path, TARGETS: targets.join(','), ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const child = { proc, stdout: '', stderr: '' };
    proc.stdout.on('data', (data) => { child.stdout += data; });
    proc.stderr.on('data', (data) => { child.stderr += data; });
    child.done = new Promise((r) => proc.once('close', (code, signal) => r({ code, signal })));
    children.push(child);
    return child;
  };
  return { dir, path, db, targets, run, metrics };
}

// Exact invalid values include historical NULL prices allowed by starter schema.
test('backfill rolls back an invalid batch, retains earlier commits and resumes after repair', async () => {
  const db = open(':memory:');
  try {
    db.exec(schema());
    db.exec("INSERT INTO menu_items VALUES (1, 'A', 5, NULL), (2, 'B', 6, 1), (3, 'C', 7, NULL), (4, 'Invalid', NULL, NULL)");
    await assert.rejects(backfill(db, { batchSize: 2, delayMs: 0 }), /menu item 4/);
    assert.deepEqual(snapshot(db).map((r) => r.price_vnd), [5000, 6000, null, null]);
    db.exec('UPDATE menu_items SET price = 8 WHERE id = 4');
    const result = await backfill(db, { batchSize: 2, delayMs: 0 });
    assert.equal(result.updated, 2);
    assert.deepEqual(counts(db), { missing: 0, disagree: 0 });
    const before = snapshot(db);
    assert.equal((await backfill(db, { batchSize: 1, delayMs: 0 })).updated, 0);
    assert.deepEqual(snapshot(db), before);
    for (const batchSize of [0, -1, 1.5, 1001, NaN])
      await assert.rejects(backfill(db, { batchSize }), /BATCH_SIZE/);
    await assert.rejects(backfill(db, { delayMs: -1 }), /BATCH_DELAY_MS/);
  } finally { db.close(); }
});

test('backfill reconciles NULL/stale rows in bounded batches without touching correct rows or orders', async (t) => {
  const { db, path, run } = await fixture(t);
  db.exec(`CREATE TABLE changed (id INTEGER);
    CREATE TRIGGER record_changes AFTER UPDATE OF price_vnd ON menu_items BEGIN INSERT INTO changed VALUES (NEW.id); END;`);
  const orders = db.prepare('SELECT * FROM order_items').all();
  const expected = db.prepare('SELECT count(*) AS n FROM menu_items WHERE price_vnd IS NULL OR price_vnd <> 45500').get().n;
  const first = run('backfill', { BATCH_SIZE: '17', BATCH_DELAY_MS: '0' });
  assert.equal((await first.done).code, 0, first.stderr);
  const batches = first.stdout.split('\n').filter((l) => l.startsWith('BATCH ')).map((l) => JSON.parse(l.slice(6)));
  assert.ok(batches.length > 1);
  assert.ok(batches.every((b) => b.rows <= 17));
  assert.equal(db.prepare('SELECT count(*) AS n FROM changed').get().n, expected);
  assert.deepEqual(counts(db), { missing: 0, disagree: 0 });
  const before = snapshot(db);
  const again = run('backfill');
  assert.equal((await again.done).code, 0, again.stderr);
  assert.match(again.stdout, /COMPLETE .*"updated":0/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM changed').get().n, expected);
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(db.prepare('SELECT * FROM order_items').all(), orders);
  const output = execFileSync(process.execPath, ['scripts/check.js'], { cwd: root, env: { ...process.env, DB_PATH: path }, encoding: 'utf8' });
  assert.match(output, /\nCONSISTENT\n$/);
});

test('SIGTERM preserves committed progress and a fresh process resumes idempotently', async (t) => {
  const { db, run } = await fixture(t);
  const child = run('backfill', { BATCH_SIZE: '10', BATCH_DELAY_MS: '200' });
  await until(() => child.stdout.includes('BATCH '), 'first batch did not commit');
  child.proc.kill('SIGTERM');
  assert.equal((await child.done).code, 143, child.stderr);
  assert.match(child.stdout, /INTERRUPTED/);
  const partial = db.prepare('SELECT count(*) AS n FROM menu_items WHERE price_vnd = 45500').get().n;
  assert.ok(partial > 133 && partial < 400);
  const resumed = run('backfill', { BATCH_SIZE: '29', BATCH_DELAY_MS: '0' });
  assert.equal((await resumed.done).code, 0, resumed.stderr);
  assert.deepEqual(counts(db), { missing: 0, disagree: 0 });
  const again = run('backfill', { BATCH_DELAY_MS: '0' });
  assert.equal((await again.done).code, 0);
  assert.match(again.stdout, /COMPLETE .*"updated":0/);
});

test('separate backfill process preserves concurrent v2 HTTP create/reprice writes from both instances', async (t) => {
  const { db, targets, run } = await fixture(t, 1200);
  const child = run('backfill', { BATCH_SIZE: '10', BATCH_DELAY_MS: '5' });
  await until(() => child.stdout.includes('BATCH '), 'backfill did not start');
  const wanted = new Map();
  for (let i = 0; i < 60; i++) {
    const id = i % 2 ? 1190 - i : i + 1;
    const priceVnd = 60001 + i;
    const res = await fetch(`${targets[i % 2]}/menu/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(i % 2 ? { price: priceVnd / 1000 } : { priceVnd }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).priceVnd, priceVnd);
    wanted.set(id, priceVnd);
    if (i % 10 === 0) {
      const created = await fetch(`${targets[i % 2]}/menu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Concurrent', priceVnd }) });
      assert.equal(created.status, 201);
      wanted.set((await created.json()).id, priceVnd);
    }
    await pause(3);
  }
  assert.equal(child.proc.exitCode, null, 'writes must overlap backfill');
  assert.equal((await child.done).code, 0, child.stderr);
  assert.deepEqual(counts(db), { missing: 0, disagree: 0 });
  for (const [id, vnd] of wanted) {
    const row = db.prepare('SELECT price, price_vnd FROM menu_items WHERE id = ?').get(id);
    assert.equal(row.price_vnd, vnd);
    assert.equal(row.price, vnd / 1000);
  }
});

test('backfill waits for an in-flight v2 transaction before reading its latest price', async (t) => {
  const { db, run } = await fixture(t);
  db.exec('BEGIN IMMEDIATE');
  let committed = false;
  try {
    db.prepare('UPDATE menu_items SET price = ?, price_vnd = ? WHERE id = 1').run(98.765, 98765);
    const child = run('backfill', { BATCH_DELAY_MS: '0' });
    await until(() => child.stdout.includes('V2_READY'), 'preflight did not finish');
    await pause(50);
    assert.equal(child.proc.exitCode, null);
    db.exec('COMMIT');
    committed = true;
    assert.equal((await child.done).code, 0, child.stderr);
    assert.deepEqual({ ...db.prepare('SELECT price, price_vnd FROM menu_items WHERE id = 1').get() }, { price: 98.765, price_vnd: 98765 });
    assert.deepEqual(counts(db), { missing: 0, disagree: 0 });
  } finally { if (!committed) db.exec('ROLLBACK'); }
});

test('CLI refuses backfill when either target is not v2, before changing data', async (t) => {
  const { db, targets, run } = await fixture(t);
  const v1 = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true })); // Original v1 health has no version.
  }).listen(0, '127.0.0.1');
  await new Promise((r) => v1.once('listening', r));
  t.after(() => new Promise((r) => v1.close(r)));
  const old = `http://127.0.0.1:${v1.address().port}`;
  const before = snapshot(db);
  for (const targetList of [`${targets[0]},${old}`, `${targets[0]},http://127.0.0.1:1`, `${targets[0]},${targets[0]}/`]) {
    const child = run('backfill', { TARGETS: targetList });
    assert.equal((await child.done).code, 1);
    assert.match(child.stderr, /BACKFILL FAILED/);
    assert.deepEqual(snapshot(db), before);
  }
  const file = join(tmpdir(), `ia2-p2-reject-${process.pid}.json`);
  t.after(() => rmSync(file, { force: true }));
  writeFileSync(file, '0');
  const lines = [];
  const mix = await createClientMix({ file, targets: [targets[0], old], intervalMs: 0, log: (s) => lines.push(s) });
  atomicWrite(file, '0.3');
  await mix.reload();
  assert.equal(mix.share, 0);
  assert.match(lines[0], /must report healthy version v2/);
  await assert.rejects(createClientMix({ initial: 0.3, targets: [targets[0], old], log() {} }), /must report healthy version v2/);
});

test('client mix validates inputs, rejects bad updates, and reloads valid shares', async (t) => {
  const { dir, targets } = await fixture(t);
  for (const v of [-1, 1.1, NaN, Infinity, '0.3', null]) assert.throws(() => parseShare(v));
  const file = join(dir, 'share.json');
  atomicWrite(file, '0');
  const lines = [];
  const mix = await createClientMix({ file, targets, log: (s) => lines.push(s), intervalMs: 0 });
  assert.equal(mix.share, 0);
  for (const raw of ['oops', '', 'null', '"0.3"', '1.1']) {
    atomicWrite(file, raw);
    await mix.reload();
    assert.equal(mix.share, 0);
  }
  atomicWrite(file, '0.3');
  await Promise.all([mix.reload(), mix.reload()]);
  assert.equal(mix.share, 0.3);
  assert.equal(lines.filter((s) => s.includes('0 -> 0.3')).length, 1);
  atomicWrite(file, '0');
  await mix.reload();
  assert.equal(mix.share, 0);
  rmSync(file);
  await mix.reload();
  assert.equal(mix.share, 0);
  await assert.rejects(createClientMix({ file, targets, log() {} }), /ENOENT/);
});

test('one traffic child switches 0 to 0.3 under backfill with all original failure counters zero', async (t) => {
  const { db, dir, run, metrics } = await fixture(t, 300);
  const file = join(dir, 'share.json');
  const log = join(dir, 'traffic.txt');
  atomicWrite(file, '0');
  const traffic = run('traffic', { NEW_CLIENTS: '0', NEW_CLIENTS_FILE: file, IDS: '300', DURATION: '0', LOG: log });
  await until(() => traffic.stdout.includes('=== traffic start'), 'traffic did not start');
  const pid = traffic.proc.pid;
  const fill = run('backfill', { BATCH_SIZE: '10', BATCH_DELAY_MS: '5' });
  assert.equal((await fill.done).code, 0, fill.stderr);
  assert.deepEqual(counts(db), { missing: 0, disagree: 0 });
  const rerun = run('backfill', { BATCH_DELAY_MS: '0' });
  assert.equal((await rerun.done).code, 0);
  assert.match(rerun.stdout, /COMPLETE .*"updated":0/);
  atomicWrite(file, '0.3');
  await until(() => traffic.stdout.includes('CLIENT_MIX 0 -> 0.3'), 'share did not reload');
  await until(() => metrics.newWrites >= 10, 'new-client writes were not exercised');
  assert.equal(traffic.proc.pid, pid);
  traffic.proc.kill('SIGINT');
  assert.equal((await traffic.done).code, 0, traffic.stdout + traffic.stderr);
  assert.match(traffic.stdout, /FINAL ok=\d+ error=0 contract=0 stale=0 unavailable=0/);
  assert.match(traffic.stdout, /RESULT: zero failed requests/);
  assert.equal((traffic.stdout.match(/=== traffic start/g) ?? []).length, 1);
  assert.deepEqual(counts(db), { missing: 0, disagree: 0 });
  console.log(`P2 disposable traffic child pid=${pid}: ${traffic.stdout.trim().replaceAll('\n', ' | ')}`);
});
