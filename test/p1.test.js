import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../src/db.js';
import { createV2 as createApp } from '../test-support/v2.js';

const sql = (name) => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
const call = async (base, method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
async function serve(t, app, db) {
  const server = app(db).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    db.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

// Guards observe each SQL statement, so a two-statement dual write fails.
const atomicGuards = `
  CREATE TRIGGER require_pair_insert BEFORE INSERT ON menu_items
  WHEN NEW.price_vnd IS NULL OR NEW.price_vnd <> CAST(round(NEW.price * 1000) AS INTEGER)
  BEGIN SELECT RAISE(ABORT, 'non-atomic insert'); END;
  CREATE TRIGGER require_pair_update BEFORE UPDATE ON menu_items
  WHEN NEW.price_vnd IS NULL OR NEW.price_vnd <> CAST(round(NEW.price * 1000) AS INTEGER)
  BEGIN SELECT RAISE(ABORT, 'non-atomic update'); END;
`;

test('v2 supports both clients on create/reprice/list/get and preserves order units', async (t) => {
  const db = open(':memory:');
  db.exec(sql('001_init.up') + sql('002_add_price_vnd.up'));
  db.exec(atomicGuards);
  const base = await serve(t, createApp, db);
  assert.deepEqual((await call(base, 'GET', '/health')).body, { ok: true, version: 'v2' });
  for (const [payload, price, priceVnd] of [
    [{ price: 45.1234 }, 45.1234, 45123],
    [{ priceVnd: 45501 }, 45.501, 45501],
    [{ price: 5, priceVnd: 5000 }, 5, 5000],
  ]) {
    const created = await call(base, 'POST', '/menu', { name: 'Phở', ...payload });
    assert.equal(created.status, 201);
    const id = created.body.id;
    const expected = { id, name: 'Phở', price, priceVnd };
    assert.deepEqual(created.body, expected);
    assert.deepEqual((await call(base, 'GET', `/menu/${id}`)).body, expected);
    assert.deepEqual((await call(base, 'GET', '/menu')).body.find((row) => row.id === id), expected);
    assert.deepEqual({ ...db.prepare('SELECT price, price_vnd FROM menu_items WHERE id = ?').get(id) }, { price, price_vnd: priceVnd });
    for (const update of [{ price: 6.7894 }, { priceVnd: 12345 }, { price: 7, priceVnd: 7000 }]) {
      const repriced = await call(base, 'PATCH', `/menu/${id}`, update);
      assert.equal(repriced.status, 200);
      const wantedPrice = update.price ?? update.priceVnd / 1000;
      assert.equal(repriced.body.price, wantedPrice);
      assert.equal(repriced.body.priceVnd, Math.round(wantedPrice * 1000));
      const row = db.prepare('SELECT price, price_vnd FROM menu_items WHERE id = ?').get(id);
      assert.equal(row.price, wantedPrice);
      assert.equal(row.price_vnd, Math.round(wantedPrice * 1000));
    }
    await call(base, 'PATCH', `/menu/${id}`, { priceVnd: 45501 });
    const order = await call(base, 'POST', '/orders', { items: [{ menuItemId: id, qty: 2 }] });
    assert.equal(order.status, 201);
    assert.equal(order.body.total, 91.002);
    assert.equal(db.prepare('SELECT unit_price FROM order_items WHERE order_id = ?').get(order.body.id).unit_price, 45.501);
  }
});

test('invalid payloads do not create or change rows on either write path', async (t) => {
  const db = open(':memory:');
  db.exec(sql('001_init.up') + sql('002_add_price_vnd.up'));
  db.exec("INSERT INTO menu_items VALUES (1, 'Tea', 5, 5000)");
  const base = await serve(t, createApp, db);
  for (const payload of [{}, { price: -1 }, { price: '5' }, { price: 0.0001 }, { price: 100001 },
    { priceVnd: -1 }, { priceVnd: 0 }, { priceVnd: 1.5 }, { priceVnd: '5000' },
    { priceVnd: 100000001 }, { priceVnd: null }, { price: null, priceVnd: 5000 },
    { price: 5, priceVnd: 6000 }, { price: 5, priceVnd: null }]) {
    for (const [method, path] of [['POST', '/menu'], ['PATCH', '/menu/1']]) {
      const res = await call(base, method, path, { name: 'Bad', ...payload });
      assert.equal(res.status, 400, JSON.stringify(payload));
      assert.equal(res.body.error, 'invalid_body');
    }
    assert.deepEqual(db.prepare('SELECT * FROM menu_items').all().map((r) => ({ ...r })), [{ id: 1, name: 'Tea', price: 5, price_vnd: 5000 }]);
  }
  assert.equal((await call(base, 'POST', '/menu', { priceVnd: 5000 })).status, 400);
});

test('original v1 and v2 share expanded DB; v2 reads legacy writes even with stale VND', async (t) => {
  const original = '2b889bde433190c17744f30d3900d38ab333a756';
  const cwd = new URL('../', import.meta.url);
  assert.equal(execFileSync('git', ['rev-parse', 'v1^{}'], { cwd, encoding: 'utf8' }).trim(), original);
  const source = execFileSync('git', ['show', `${original}:src/app.js`], { cwd });
  const { createApp: createV1 } = await import(`data:text/javascript;base64,${source.toString('base64')}`);
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p1-mixed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'shared.db');
  const oldDb = open(path);
  oldDb.exec(sql('001_init.up'));
  const v1 = await serve(t, createV1, oldDb);
  const first = await call(v1, 'POST', '/menu', { name: 'Tea', price: 5 });
  assert.equal(first.status, 201);
  const db = open(path);
  db.exec(sql('002_add_price_vnd.up'));
  const v2 = await serve(t, createApp, db);
  const id = first.body.id;
  assert.equal(db.prepare('SELECT price_vnd FROM menu_items WHERE id = ?').get(id).price_vnd, null);
  assert.equal((await call(v2, 'GET', `/menu/${id}`)).body.priceVnd, 5000);
  assert.equal((await call(v2, 'PATCH', `/menu/${id}`, { price: 6 })).status, 200);
  assert.equal((await call(v1, 'GET', `/menu/${id}`)).body.price, 6);
  assert.equal((await call(v1, 'PATCH', `/menu/${id}`, { price: 7 })).status, 200);
  assert.equal(db.prepare('SELECT price_vnd FROM menu_items WHERE id = ?').get(id).price_vnd, 6000);
  assert.deepEqual((await call(v2, 'GET', `/menu/${id}`)).body, { id, name: 'Tea', price: 7, priceVnd: 7000 });
  assert.equal((await call(v2, 'GET', '/menu')).body[0].priceVnd, 7000);
  const second = await call(v2, 'POST', '/menu', { name: 'Coffee', price: 12.5 });
  assert.equal(second.status, 201);
  assert.equal((await call(v1, 'GET', `/menu/${second.body.id}`)).body.price, 12.5);
  const third = await call(v1, 'POST', '/menu', { name: 'Water', price: 3 });
  assert.equal(third.status, 201);
  assert.equal((await call(v2, 'GET', `/menu/${third.body.id}`)).body.priceVnd, 3000);
  for (const base of [v1, v2]) {
    const order = await call(base, 'POST', '/orders', { items: [{ menuItemId: id, qty: 2 }] });
    assert.equal(order.status, 201);
    assert.equal(order.body.total, 14);
    assert.equal(db.prepare('SELECT unit_price FROM order_items WHERE order_id = ?').get(order.body.id).unit_price, 7);
  }
  // A subsequent v2 write repairs this row; this is not a backfill.
  assert.equal((await call(v2, 'PATCH', `/menu/${id}`, { price: 8 })).status, 200);
  assert.equal(db.prepare('SELECT price_vnd FROM menu_items WHERE id = ?').get(id).price_vnd, 8000);
});

test('002 up/down/re-up preserves legacy menu and order data on a separate DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p1-down-'));
  const db = open(join(dir, 'rehearsal.db'));
  try {
    db.exec(sql('001_init.up'));
    db.exec("INSERT INTO menu_items VALUES (1, 'Tea', 5); INSERT INTO orders VALUES (1, 'test'); INSERT INTO order_items VALUES (1, 1, 2, 5)");
    const before = () => ['SELECT id, name, price FROM menu_items', 'SELECT * FROM orders', 'SELECT * FROM order_items'].map((q) => db.prepare(q).all());
    const snapshot = before();
    db.exec(sql('002_add_price_vnd.up'));
    const col = db.prepare('PRAGMA table_info(menu_items)').all().find((c) => c.name === 'price_vnd');
    assert.equal(col.type, 'INTEGER');
    assert.equal(col.notnull, 0);
    assert.equal(db.prepare('SELECT price_vnd FROM menu_items').get().price_vnd, null);
    db.exec('UPDATE menu_items SET price_vnd = 5000');
    db.exec(sql('002_add_price_vnd.down'));
    assert.equal(db.prepare('PRAGMA table_info(menu_items)').all().some((c) => c.name === 'price_vnd'), false);
    assert.deepEqual(before(), snapshot);
    db.exec(sql('002_add_price_vnd.up'));
    assert.equal(db.prepare('SELECT price_vnd FROM menu_items').get().price_vnd, null);
    assert.deepEqual(before(), snapshot);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
