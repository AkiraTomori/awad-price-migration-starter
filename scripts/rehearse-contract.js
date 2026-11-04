// OFFLINE/DISPOSABLE P4 proof only. Never accepts a live DB_PATH.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { open } from '../src/db.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const v4sha = '51669379446f8f34473a90104ea939284335e9f2';
export async function rehearseContract({ outputDir } = {}) {
  assert.ok(outputDir);
  assert.equal(execFileSync('git', ['rev-parse', 'v4^{}'], { cwd: root, encoding: 'utf8' }).trim(), v4sha);
  assert.equal(execFileSync('git', ['ls-tree', '-r', '--name-only', 'v4', 'migrations/004_drop_price.up.sql'], { cwd: root, encoding: 'utf8' }), '');
  if (existsSync(outputDir)) throw new Error('refusing to overwrite contract evidence');
  mkdirSync(outputDir, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'ia2-p4-contract-'));
  const env = { ...process.env, DB_PATH: join(dir, 'disposable.db'), PATH: dirname(process.execPath) + delimiter + process.env.PATH };
  const db = open(env.DB_PATH), servers = [];
  const log = (line) => appendFileSync(join(outputDir, 'contract.txt'), `${new Date().toISOString()} ${line}\n`);
  const run = (script, ...args) => {
    log(`COMMAND node ${JSON.stringify([`scripts/${script}.js`, ...args])} DB_PATH=${env.DB_PATH}`);
    const output = execFileSync(process.execPath, [`scripts/${script}.js`, ...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    log(output.trim());
    return output;
  };
  const statusCheck = (label) => {
    log(`CHECK ${label}`);
    run('migrate', 'status');
    assert.match(run('check'), /\nCONSISTENT(?:, but[^\n]*)?\n$/);
  };
  const cols = () => db.prepare('PRAGMA table_info(menu_items)').all().map((c) => c.name);
  const orders = () => [db.prepare('SELECT * FROM orders ORDER BY id').all(), db.prepare('SELECT * FROM order_items ORDER BY order_id, menu_item_id').all()];
  const legacy = () => [db.prepare('SELECT id,name,price FROM menu_items ORDER BY id').all(), ...orders()];
  const current = () => [db.prepare('SELECT id,name,price_vnd FROM menu_items ORDER BY id').all(), ...orders()];
  async function start(port = 0) {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', `import {open} from './src/db.js'; import {createApp} from './src/app.js'; const server=createApp(open()).listen(${port},'127.0.0.1',()=>console.log(server.address().port)); process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`], { cwd: join(dir, 'v4'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    const slot = { proc, stdout: '', stderr: '' };
    slot.done = new Promise((r) => proc.once('close', (code) => r(code)));
    proc.stdout.on('data', (d) => { slot.stdout += d; });
    proc.stderr.on('data', (d) => { slot.stderr += d; });
    servers.push(slot);
    for (let i = 0; i < 500 && !slot.stdout.trim(); i++) {
      if (proc.exitCode !== null) throw new Error(slot.stderr);
      await pause(10);
    }
    slot.port = Number(slot.stdout.trim());
    assert.ok(slot.port > 0);
    slot.base = `http://127.0.0.1:${slot.port}`;
    log(`START v4=${v4sha} pid=${proc.pid} port=${slot.port} DB_PATH=${env.DB_PATH}`);
    return slot;
  }
  const active = () => servers.filter((s) => s.proc.exitCode === null && s.proc.signalCode === null);
  async function verifyBoth() {
    assert.equal(active().length, 2);
    for (const slot of active()) {
      const res = await fetch(slot.base + '/health');
      const health = await res.json();
      assert.deepEqual(health, { ok: true, version: 'v4' });
      log(`HEALTH pid=${slot.proc.pid} ${JSON.stringify(health)}`);
    }
  }
  function backup(name) {
    const path = join(dir, name);
    db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
    const saved = open(path);
    try {
      assert.equal(saved.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(saved.prepare('SELECT count(*) AS n FROM menu_items').get().n, db.prepare('SELECT count(*) AS n FROM menu_items').get().n);
      assert.equal(saved.prepare('SELECT count(*) AS n FROM order_items').get().n, db.prepare('SELECT count(*) AS n FROM order_items').get().n);
      log(`VERIFIED DISPOSABLE BACKUP ${path} integrity=ok`);
    } finally { saved.close(); }
  }
  async function httpProof() {
    for (const slot of active()) for (const payload of [{ price: 45.501 }, { priceVnd: 45501 }]) {
      const request = async (method, path, body) => {
        const res = await fetch(slot.base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
        const value = await res.json();
        log(`HTTP ${slot.base} ${method} ${path} body=${JSON.stringify(body)} status=${res.status} response=${JSON.stringify(value)}`);
        return { status: res.status, body: value };
      };
      const made = await request('POST', '/menu', { name: 'Contract HTTP proof', ...payload });
      assert.equal(made.status, 201);
      const id = made.body.id;
      for (const patch of [{ price: 12.345 }, { priceVnd: 45501 }]) {
        const updated = await request('PATCH', `/menu/${id}`, patch);
        assert.equal(updated.status, 200);
        assert.equal(updated.body.price, (patch.priceVnd ?? Math.round(patch.price * 1000)) / 1000);
      }
      assert.deepEqual((await request('GET', `/menu/${id}`)).body, { id, name: 'Contract HTTP proof', price: 45.501, priceVnd: 45501 });
      assert.ok((await request('GET', '/menu?limit=200')).body.some((r) => r.id === id && r.priceVnd === 45501));
      const order = await request('POST', '/orders', { items: [{ menuItemId: id, qty: 2 }] });
      assert.equal(order.status, 201);
      assert.equal(order.body.total, 91.002);
      assert.equal(db.prepare('SELECT unit_price FROM order_items WHERE order_id=?').get(order.body.id).unit_price, 45.501);
    }
  }
  try {
    log(`P4 DISPOSABLE MIGRATION/RECOVERY PROOF node=${process.version} DB_PATH=${env.DB_PATH} v4=${v4sha}`);
    run('migrate', 'up', '--to', '001_init');
    statusCheck('001 up');
    run('migrate', 'down');
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='menu_items'").get().n, 0);
    run('migrate', 'status');
    log('001 down verified absent application tables; app consistency check not applicable to absent schema');
    run('migrate', 'up', '--to', '001_init');
    db.exec("INSERT INTO menu_items VALUES (1,'Tea',5),(2,'Pho',45.5); INSERT INTO orders VALUES (1,'before migrations'); INSERT INTO order_items VALUES (1,1,2,5)");
    const original = legacy();
    statusCheck('001 re-up and fixture');
    run('migrate', 'up', '--to', '002_add_price_vnd');
    statusCheck('002 up');
    run('migrate', 'down');
    assert.deepEqual(legacy(), original);
    statusCheck('002 down data preserved');
    run('migrate', 'up', '--to', '002_add_price_vnd');
    db.exec('UPDATE menu_items SET price_vnd=CAST(round(price*1000) AS INTEGER)');
    statusCheck('002 re-up / fixture populated with valid VND');
    run('migrate', 'up', '--to', '003_sync_legacy_price');
    statusCheck('003 up');
    run('migrate', 'down');
    assert.deepEqual(legacy(), original);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger'").get().n, 0);
    statusCheck('003 down offline, no v4 writer present');
    run('migrate', 'up', '--to', '003_sync_legacy_price');
    assert.ok(cols().includes('price'));
    assert.equal(db.prepare('SELECT max(version) AS v FROM schema_migrations').get().v, '003_sync_legacy_price');
    statusCheck('003 re-up; 004 staged but NOT applied');
    for (const file of ['package.json', 'src/app.js', 'src/db.js']) {
      const dest = join(dir, 'v4', file);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, execFileSync('git', ['show', `v4:${file}`], { cwd: root }));
    }
    await start(); await start();
    await verifyBoth(); backup('before-first-contract.db');
    const before = current();
    run('migrate', 'up', '--to', '004_drop_price');
    assert.ok(!cols().includes('price'));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger'").get().n, 0);
    assert.deepEqual(current(), before);
    statusCheck('004 up: data preserved and triggers removed');
    const v3source = execFileSync('git', ['show', 'v3:src/app.js'], { cwd: root });
    const { createApp: v3 } = await import(`data:text/javascript;base64,${v3source.toString('base64')}`);
    assert.throws(() => v3(db), /no such column/);
    log('EXPECTED: v3 cannot start after Contract; schema recovery must precede code rollback');
    await httpProof();
    // Restart only one v4 to prove its startup gate also works without price.
    const first = active()[0]; first.proc.kill('SIGTERM'); assert.equal(await first.done, 0);
    await start(first.port); await verifyBoth();
    const afterHttp = current();
    run('migrate', 'down');
    assert.ok(cols().includes('price'));
    assert.deepEqual(current(), afterHttp);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger'").get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM menu_items WHERE price <> price_vnd/1000.0').get().n, 0);
    v3(db); // Constructor qualification only; no v3 listener/writer is started.
    log('RECOVERY verified: v3 constructor succeeds only after 004.down; both active listeners remain v4');
    statusCheck('004 down recovery with bridge restored');
    await httpProof(); // v4 writes continue synchronizing after schema recovery.
    const beforeReUp = current();
    await verifyBoth(); backup('before-second-contract.db');
    run('migrate', 'up', '--to', '004_drop_price');
    assert.ok(!cols().includes('price'));
    assert.deepEqual(current(), beforeReUp);
    statusCheck('004 re-up preserves recovered menu/orders');
    await httpProof();
    run('seed', '3'); // Schema-aware seed after Contract.
    statusCheck('post-Contract old/new HTTP and seed');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    log('PASS 001/002/003/004 up/down/re-up, staged runner, backups, legacy/new HTTP, order units and recovered bridge');
    return { passed: true, v4: v4sha, menuRows: db.prepare('SELECT count(*) AS n FROM menu_items').get().n };
  } finally {
    for (const slot of active()) slot.proc.kill('SIGTERM');
    for (const slot of servers) { const timer = setTimeout(() => slot.proc.kill('SIGKILL'), 5000); await slot.done; clearTimeout(timer); }
    db.close(); rmSync(dir, { recursive: true, force: true });
    log('CLEANUP disposable DB, backup files and listeners removed; live Contract/final demonstration NOT RUN');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  rehearseContract({ outputDir: resolve(process.env.P4_CONTRACT_EVIDENCE_DIR ?? 'docs/evidence/p4-contract') })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((e) => { console.error(e); process.exitCode = 1; });
