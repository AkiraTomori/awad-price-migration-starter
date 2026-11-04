// Run only after both instances use v2 and the same absolute DB_PATH.
// No value read outside the write transaction is ever used to update a row.
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { open } from '../src/db.js';
import { parsePrice } from '../src/app.js';
import { requireV2 } from './lib/v2-readiness.js';

export async function backfill(db, { batchSize = 200, delayMs = 10, signal, onBatch = () => {} } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error('BATCH_SIZE must be an integer from 1 to 1000');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60000)
    throw new Error('BATCH_DELAY_MS must be an integer from 0 to 60000');
  // Keyset scan bounds work per transaction, including when most rows are correct.
  const first = db.prepare('SELECT id, price, price_vnd, CAST(round(price * 1000) AS INTEGER) AS sql_vnd FROM menu_items ORDER BY id LIMIT ?');
  const select = db.prepare('SELECT id, price, price_vnd, CAST(round(price * 1000) AS INTEGER) AS sql_vnd FROM menu_items WHERE id > ? ORDER BY id LIMIT ?');
  const update = db.prepare('UPDATE menu_items SET price_vnd = ? WHERE id = ?');
  const result = { batches: 0, scanned: 0, updated: 0, cursor: null, interrupted: false };
  while (!signal?.aborted) {
    let rows, changed = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      rows = result.cursor === null ? first.all(batchSize) : select.all(result.cursor, batchSize);
      for (const row of rows) {
        const prices = parsePrice({ price: row.price });
        if (!prices || prices.priceVnd !== row.sql_vnd)
          throw new Error(`menu item ${row.id}: legacy price is invalid or JS/SQLite rounding disagrees; repair explicitly before retrying`);
        if (row.price_vnd !== prices.priceVnd) {
          update.run(prices.priceVnd, row.id);
          changed++;
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    if (!rows.length) return result;
    result.batches++;
    result.scanned += rows.length;
    result.updated += changed;
    result.cursor = rows.at(-1).id;
    // Observers, logging, HTTP and delay are all outside the write lock.
    await onBatch({ ...result, rows: rows.length, changed });
    await pause(delayMs, undefined, { signal }).catch((e) => { if (e.name !== 'AbortError') throw e; });
  }
  return { ...result, interrupted: true };
}

async function main() {
  if (!process.env.DB_PATH || !isAbsolute(process.env.DB_PATH))
    throw new Error('set DB_PATH to the shared absolute database path');
  const targets = (process.env.TARGETS ?? 'http://localhost:3001,http://localhost:3002').split(',');
  await requireV2(targets);
  console.log(`V2_READY targets=${targets.join(',')} db=${process.env.DB_PATH}; operator must ensure these are all writers and share this DB`);
  const controller = new AbortController();
  let exitCode = 0;
  const interrupt = () => { exitCode = 130; controller.abort(); };
  const terminate = () => { exitCode = 143; controller.abort(); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  const db = open();
  try {
    const result = await backfill(db, {
      batchSize: Number(process.env.BATCH_SIZE ?? 200),
      delayMs: Number(process.env.BATCH_DELAY_MS ?? 10),
      signal: controller.signal,
      onBatch: (batch) => console.log(`BATCH ${JSON.stringify(batch)}`),
    });
    console.log(`${result.interrupted ? 'INTERRUPTED' : 'COMPLETE'} ${JSON.stringify(result)}`);
    process.exitCode = exitCode;
  } finally {
    db.close();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => { console.error(`BACKFILL FAILED: ${e.message}`); process.exitCode = 1; });
