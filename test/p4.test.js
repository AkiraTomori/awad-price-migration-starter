import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { open } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createV3 } from '../test-support/v3.js';
import { rehearseP4 } from '../scripts/rehearse-p4.js';
import { createClientMix } from '../scripts/lib/client-mix.js';

const root = new URL('../', import.meta.url);
const sql = (v, direction = 'up') => readFileSync(new URL(`../migrations/${v}.${direction}.sql`, import.meta.url), 'utf8');
const baseSchema = () => sql('001_init') + sql('002_add_price_vnd');
const call = async (base, method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
async function serve(app, db) {
  const server = app(db).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

// These must pass with recursive triggers explicitly enabled as well as disabled.
test('003 INSERT/UPDATE bridge is reversible and terminates with recursive triggers ON/OFF', () => {
  for (const recursive of [0, 1]) {
    const db = open(':memory:');
    try {
      db.exec(baseSchema() + `PRAGMA recursive_triggers=${recursive};`);
      db.exec("INSERT INTO menu_items VALUES (1, 'Tea', 5, 5000)");
      db.exec(sql('003_sync_legacy_price'));
      db.exec("INSERT INTO menu_items (id, name, price_vnd) VALUES (2, 'Coffee', 45501)");
      assert.equal(db.prepare('SELECT price FROM menu_items WHERE id=2').get().price, 45.501);
      db.exec('UPDATE menu_items SET price_vnd=12345 WHERE id=1');
      assert.equal(db.prepare('SELECT price FROM menu_items WHERE id=1').get().price, 12.345);
      db.exec('UPDATE menu_items SET price=999 WHERE id=1');
      assert.equal(db.prepare('SELECT price FROM menu_items WHERE id=1').get().price, 12.345);
      db.exec('UPDATE menu_items SET price=7, price_vnd=7000 WHERE id=1');
      const before = db.prepare('SELECT * FROM menu_items ORDER BY id').all();
      db.exec(sql('003_sync_legacy_price', 'down'));
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger'").get().n, 0);
      assert.deepEqual(db.prepare('SELECT * FROM menu_items ORDER BY id').all(), before);
      db.exec(sql('003_sync_legacy_price'));
      db.exec('UPDATE menu_items SET price_vnd=8000 WHERE id=1');
      assert.equal(db.prepare('SELECT price FROM menu_items WHERE id=1').get().price, 8);
    } finally { db.close(); }
  }
});

test('explicit migration target stages 003, rejects invalid targets and preserves data on down/re-up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p4-stage-'));
  const env = { ...process.env, DB_PATH: join(dir, 'disposable.db') };
  const run = (...args) => execFileSync(process.execPath, ['scripts/migrate.js', ...args], { cwd: root, env, encoding: 'utf8' });
  const db = open(env.DB_PATH);
  try {
    run('up', '--to', '002_add_price_vnd');
    db.exec("INSERT INTO menu_items VALUES (1, 'Tea', 5, 5000); INSERT INTO orders VALUES (1, 'test'); INSERT INTO order_items VALUES (1, 1, 2, 5)");
    const before = db.prepare('SELECT * FROM order_items').all();
    run('up', '--to', '003_sync_legacy_price');
    assert.equal(db.prepare('SELECT max(version) AS v FROM schema_migrations').get().v, '003_sync_legacy_price');
    assert.ok(db.prepare('PRAGMA table_info(menu_items)').all().some((c) => c.name === 'price'));
    assert.match(run('up', '--to', '003_sync_legacy_price'), /nothing to apply/);
    for (const args of [['up', '--to', 'missing'], ['up', '--to', '001_init'], ['down', '--to', '002_add_price_vnd']]) {
      const result = spawnSync(process.execPath, ['scripts/migrate.js', ...args], { cwd: root, env });
      assert.notEqual(result.status, 0);
      assert.equal(db.prepare('SELECT max(version) AS v FROM schema_migrations').get().v, '003_sync_legacy_price');
    }
    assert.match(run('down'), /reverted 003/);
    run('up', '--to', '003_sync_legacy_price');
    assert.deepEqual(db.prepare('SELECT * FROM order_items').all(), before);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('v4 SQL never names legacy price; bridge supports mixed v3/v4 old/new writes and order units', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p4-mixed-'));
  const path = join(dir, 'shared.db');
  const db = open(path), old = open(path);
  db.exec(baseSchema() + sql('003_sync_legacy_price'));
  const statements = [];
  const traced = {
    prepare(statement) { statements.push(statement); assert.doesNotMatch(statement, /\bprice\b/); return db.prepare(statement); },
    exec(statement) { assert.doesNotMatch(statement, /\bprice\b/); return db.exec(statement); },
  };
  const v4 = await serve(createApp, traced);
  const v3 = await serve(createV3, old);
  try {
    assert.deepEqual((await call(v4.base, 'GET', '/health')).body, { ok: true, version: 'v4' });
    const mix = await createClientMix({ initial: 0.3, targets: [v3.base, v4.base], log() {} });
    assert.equal(mix.share, 0.3);
    for (const writer of [v3.base, v4.base]) for (const payload of [{ price: 45.501 }, { priceVnd: 45501 }, { price: 45.501, priceVnd: 45501 }]) {
      const created = await call(writer, 'POST', '/menu', { name: 'Dish', ...payload });
      assert.equal(created.status, 201);
      const id = created.body.id;
      for (const patch of [{ price: 12.345 }, { priceVnd: 12345 }]) {
        const result = await call(writer, 'PATCH', `/menu/${id}`, patch);
        assert.equal(result.status, 200);
        for (const reader of [v3.base, v4.base]) {
          assert.deepEqual((await call(reader, 'GET', `/menu/${id}`)).body, { id, name: 'Dish', price: 12.345, priceVnd: 12345 });
          assert.ok((await call(reader, 'GET', '/menu')).body.some((r) => r.id === id && r.price === 12.345));
          const order = await call(reader, 'POST', '/orders', { items: [{ menuItemId: id, qty: 2 }] });
          assert.equal(order.status, 201);
          assert.equal(order.body.total, 24.69);
          assert.equal(db.prepare('SELECT unit_price FROM order_items WHERE order_id=?').get(order.body.id).unit_price, 12.345);
        }
        assert.equal(db.prepare('SELECT price FROM menu_items WHERE id=?').get(id).price, 12.345);
      }
    }
    for (const bad of [{ priceVnd: 0 }, { priceVnd: 1.5 }, { price: 1, priceVnd: 2000 }, { price: 0.0001 }, { price: null }]) {
      assert.equal((await call(v4.base, 'POST', '/menu', { name: 'bad', ...bad })).status, 400);
      assert.equal((await call(v4.base, 'PATCH', '/menu/1', bad)).status, 400);
    }
    const rounded = await call(v4.base, 'POST', '/menu', { name: 'rounded', price: 45.1234 });
    assert.equal(rounded.body.price, 45.123);
    assert.equal(rounded.body.priceVnd, 45123);
    assert.ok(statements.length > 0);
  } finally {
    await Promise.all([v3.server, v4.server].map((s) => new Promise((r) => s.close(r))));
    old.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('v4 startup rejects invalid VND without a legacy-column query', () => {
  for (const value of [null, 0, 5000.5, 100000001]) {
    const db = open(':memory:');
    try {
      db.exec(baseSchema());
      db.prepare('INSERT INTO menu_items (name, price_vnd) VALUES (?, ?)').run('bad', value);
      assert.throws(() => createApp(db), /v4 requires valid backfilled integer VND/);
    } finally { db.close(); }
  }
});

test('rolling v3/v4 bridge rollout and rollback preserve one traffic PID and consistency', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p4-roll-test-'));
  try {
    const result = await rehearseP4({ outputDir: join(dir, 'evidence') });
    assert.deepEqual(result.states, ['v3/v3', 'v4/v3', 'v4/v4', 'v4/v3', 'v3/v3', 'v3/v4', 'v4/v4']);
    assert.match(result.final, /error=0 contract=0 stale=0 unavailable=0/);
    console.log(`P4 disposable rolling rehearsal ${JSON.stringify(result)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
