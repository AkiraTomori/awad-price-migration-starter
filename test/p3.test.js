import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { open } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createV2 } from '../test-support/v2.js';
import { rehearseP3 } from '../scripts/rehearse-p3.js';
import { createClientMix } from '../scripts/lib/client-mix.js';
import { requireV2 } from '../scripts/lib/v2-readiness.js';

const schema = () => ['001_init', '002_add_price_vnd'].map((v) => readFileSync(new URL(`../migrations/${v}.up.sql`, import.meta.url), 'utf8')).join('\n');
const call = async (base, method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
async function serve(app, db) {
  const server = app(db).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('v3 refuses incomplete, disagreeing or invalid backfill before serving', () => {
  for (const [price, vnd] of [[5, null], [5, 1], [null, 5000], [0.0001, 0], [5, 5000.5], [100001, 100001000]]) {
    const db = open(':memory:');
    try {
      db.exec(schema());
      db.prepare('INSERT INTO menu_items (name, price, price_vnd) VALUES (?, ?, ?)').run('bad', price, vnd);
      assert.throws(() => createApp(db), /requires completed backfill/);
    } finally { db.close(); }
  }
});

test('v3 reads menu and order prices solely from VND, retaining thousands for orders', async () => {
  const db = open(':memory:');
  db.exec(schema());
  db.exec("INSERT INTO menu_items VALUES (1, 'Tea', 45.5, 45500)");
  const { server, base } = await serve(createApp, db);
  try {
    // Deliberately corrupt only this isolated unit fixture after qualification.
    db.exec('UPDATE menu_items SET price = 99 WHERE id = 1');
    const expected = { id: 1, name: 'Tea', price: 45.5, priceVnd: 45500 };
    assert.deepEqual((await call(base, 'GET', '/menu/1')).body, expected);
    assert.deepEqual((await call(base, 'GET', '/menu')).body, [expected]);
    const order = await call(base, 'POST', '/orders', { items: [{ menuItemId: 1, qty: 2 }] });
    assert.equal(order.status, 201);
    assert.equal(order.body.total, 91);
    assert.equal(db.prepare('SELECT unit_price FROM order_items').get().unit_price, 45.5);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});

test('mixed exact-tag v2/v3 supports both payloads, atomic pairs, rounding and original order units', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p3-mixed-'));
  const path = join(dir, 'shared.db');
  const db = open(path);
  db.exec(schema());
  db.exec(`CREATE TRIGGER pair_insert BEFORE INSERT ON menu_items
    WHEN NEW.price_vnd IS NULL OR NEW.price_vnd <> CAST(round(NEW.price * 1000) AS INTEGER)
    BEGIN SELECT RAISE(ABORT, 'pair insert'); END;
    CREATE TRIGGER pair_update BEFORE UPDATE ON menu_items
    WHEN NEW.price_vnd IS NULL OR NEW.price_vnd <> CAST(round(NEW.price * 1000) AS INTEGER)
    BEGIN SELECT RAISE(ABORT, 'pair update'); END;`);
  const db2 = open(path);
  const v2 = await serve(createV2, db2);
  const v3 = await serve(createApp, db);
  try {
    assert.deepEqual((await call(v3.base, 'GET', '/health')).body, { ok: true, version: 'v3' });
    // Positive client share can also be enabled in mixed and all-v3 states.
    const mix = await createClientMix({ initial: 0.3, targets: [v2.base, v3.base], log() {} });
    assert.equal(mix.share, 0.3);
    await assert.rejects(requireV2([v2.base, v3.base]), /must report healthy version v2/);
    const thirdDb = open(path);
    const third = await serve(createApp, thirdDb);
    try {
      const file = join(dir, 'share.json');
      writeFileSync(file, '0');
      const allV3 = await createClientMix({ file, targets: [v3.base, third.base], log() {}, intervalMs: 0 });
      writeFileSync(file, '0.3');
      await allV3.reload();
      assert.equal(allV3.share, 0.3);
    } finally { await new Promise((r) => third.server.close(r)); thirdDb.close(); }
    for (const base of [v2.base, v3.base]) {
      for (const payload of [{ price: 12.345 }, { priceVnd: 12345 }, { price: 12.345, priceVnd: 12345 }]) {
        const created = await call(base, 'POST', '/menu', { name: 'Dish', ...payload });
        assert.equal(created.status, 201);
        const id = created.body.id;
        for (const reader of [v2.base, v3.base]) assert.equal((await call(reader, 'GET', `/menu/${id}`)).body.price, 12.345);
        for (const update of [{ price: 45.501 }, { priceVnd: 45501 }]) {
          assert.equal((await call(base, 'PATCH', `/menu/${id}`, update)).status, 200);
          const row = db.prepare('SELECT price, price_vnd FROM menu_items WHERE id = ?').get(id);
          assert.equal(row.price, 45.501);
          assert.equal(row.price_vnd, 45501);
          for (const reader of [v2.base, v3.base]) {
            assert.equal((await call(reader, 'GET', `/menu/${id}`)).body.priceVnd, 45501);
            const order = await call(reader, 'POST', '/orders', { items: [{ menuItemId: id, qty: 2 }] });
            assert.equal(order.body.total, 91.002);
            assert.equal(db.prepare('SELECT unit_price FROM order_items WHERE order_id = ?').get(order.body.id).unit_price, 45.501);
          }
        }
        for (const bad of [{ priceVnd: 0 }, { priceVnd: 1.5 }, { price: 1, priceVnd: 2000 }, { price: null }]) {
          assert.equal((await call(v3.base, 'PATCH', `/menu/${id}`, bad)).status, 400);
          assert.equal((await call(v3.base, 'POST', '/menu', { name: 'bad', ...bad })).status, 400);
        }
      }
    }
    const rounded = await call(v3.base, 'POST', '/menu', { name: 'rounded', price: 45.1234 });
    assert.equal(rounded.body.price, 45.123);
    assert.equal(rounded.body.priceVnd, 45123);
    assert.equal((await call(v2.base, 'GET', `/menu/${rounded.body.id}`)).body.price, 45.123);
    const patch = await call(v3.base, 'PATCH', `/menu/${rounded.body.id}`, { price: 0.0005 });
    assert.equal(patch.body.price, 0.001);
    assert.equal(patch.body.priceVnd, 1);
    // A v2 write can retain sub-VND legacy precision; v3 reads its rounded VND.
    await call(v2.base, 'PATCH', `/menu/${rounded.body.id}`, { price: 45.1234 });
    assert.equal((await call(v2.base, 'GET', `/menu/${rounded.body.id}`)).body.price, 45.1234);
    assert.equal((await call(v3.base, 'GET', `/menu/${rounded.body.id}`)).body.price, 45.123);
  } finally {
    await Promise.all([v2.server, v3.server].map((s) => new Promise((r) => s.close(r))));
    db2.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('rolling v2/v3 deploy and rollback keep one real traffic process and consistent shared DB', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p3-rehearsal-test-'));
  try {
    const result = await rehearseP3({ outputDir: join(dir, 'evidence') });
    assert.deepEqual(result.states, ['v2/v2', 'v3/v2', 'v3/v3', 'v3/v2', 'v2/v2', 'v2/v3', 'v3/v3']);
    assert.match(result.final, /error=0 contract=0 stale=0 unavailable=0/);
    console.log(`P3 disposable rolling rehearsal ${JSON.stringify(result)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
