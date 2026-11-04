// `up` applies all pending files; use `up --to NNN_name` to stage a rollout.
// `down` reverts only the last applied migration. Destructive downs are test-only.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, DB_PATH } from '../src/db.js';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const versions = readdirSync(DIR).filter((f) => f.endsWith('.up.sql')).sort().map((f) => f.replace('.up.sql', ''));
const cmd = process.argv[2] ?? 'status';
const args = process.argv.slice(3);
const target = args.length === 2 && args[0] === '--to' ? args[1] : undefined;
if (!['up', 'down', 'status'].includes(cmd) || (args.length && (cmd !== 'up' || !target)))
  throw new Error('usage: migrate.js up [--to NNN_name] | down | status');
if (target && !versions.includes(target)) throw new Error(`unknown migration target: ${target}`);
const db = open();
try {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  if (target && [...applied].some((v) => v > target))
    throw new Error('target is below the applied schema; explicit down/recovery is required');
  function run(sql, after) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(sql); after(); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (cmd === 'up') {
    const pending = versions.filter((v) => !applied.has(v) && (!target || v <= target));
    if (!pending.length) console.log('nothing to apply');
    for (const v of pending) {
      run(readFileSync(join(DIR, `${v}.up.sql`), 'utf8'), () =>
        db.prepare("INSERT INTO schema_migrations VALUES (?, datetime('now'))").run(v));
      console.log(`applied  ${v}`);
    }
  } else if (cmd === 'down') {
    const last = db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
    if (!last) console.log('nothing to revert');
    else {
      const file = join(DIR, `${last.version}.down.sql`);
      if (!existsSync(file)) throw new Error(`no ${last.version}.down.sql — this step has no way back`);
      run(readFileSync(file, 'utf8'), () => db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(last.version));
      console.log(`reverted ${last.version}`);
    }
  } else {
    console.log(`db ${DB_PATH}`);
    for (const v of versions) console.log(`${applied.has(v) ? '[x]' : '[ ]'} ${v}`);
  }
} finally { db.close(); }
