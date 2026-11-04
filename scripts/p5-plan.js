// Gate A only: describe future operations. Nothing in this module executes them.
import { isAbsolute, join, relative, resolve } from 'node:path';
import { lstatSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RELEASES = Object.freeze({
  v1: '2b889bde433190c17744f30d3900d38ab333a756',
  v2: 'dadb816bac9dad5ffcbf098d130d387bbbdd338c',
  v3: 'ccd19db7c1cf14d2a5df21f38769c73dd96f27b2',
  v4: '51669379446f8f34473a90104ea939284335e9f2',
});
export const P4_HEAD = 'c0d33268bd8b791a1948d2dfda8bc116d9dadc17';
const exists = (path) => { try { lstatSync(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

export function validateFinalPaths({ repo, runDir, dbPath, ports }) {
  for (const path of [repo, runDir, dbPath]) if (!isAbsolute(path)) throw new Error('repo, runDir and DB_PATH must be absolute');
  repo = resolve(repo);
  const inside = (parent, child) => { const r = relative(parent, child); return r && !r.startsWith('..') && !isAbsolute(r); };
  if (!inside(join(repo, 'data'), runDir) || !inside(runDir, dbPath))
    throw new Error('use a fresh run directory under repository data/, with DB_PATH inside it');
  if (ports.length !== 2 || new Set(ports).size !== 2 || ports.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535))
    throw new Error('two distinct non-privileged ports are required');
  for (const path of [runDir, dbPath, join(repo, 'traffic-log.txt'), join(repo, 'check-log.txt')])
    if (exists(path)) throw new Error(`preserve existing path; choose/review a fresh run instead: ${path}`);
  let ancestor = runDir;
  while (ancestor !== repo) {
    if (exists(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error('run directory must not traverse a symlink');
    ancestor = resolve(ancestor, '..');
  }
}

export function buildPlan({ repo, runDir = join(repo, 'data', 'p5-final-20261104'), dbPath = join(runDir, 'app.db'), ports = [3001, 3002] }) {
  validateFinalPaths({ repo, runDir, dbPath, ports });
  const steps = [];
  const add = (id, state, action, extra = {}) => steps.push({ id, state, action, status: 'NOT RUN', checkAfter: true, ...extra });
  const up = (id, state, target) => add(id, state, 'migration', { command: ['npm', 'run', 'migrate', '--', '--to', target] });
  const roll = (id, state, slot, version) => add(id, state, 'roll_one', { slot, version, keepTrafficPid: true });
  up('S0-schema', 'v1/v1', '001_init');
  add('S0-seed', 'v1/v1', 'seed exactly 20000 rows before traffic', { command: ['node', 'scripts/seed.js', '20000'] });
  add('S0-start-A', 'v1/-', 'start_instance', { slot: 'A', version: 'v1' });
  add('S0-start-B', 'v1/v1', 'start_instance', { slot: 'B', version: 'v1' });
  add('S0-traffic', 'v1/v1', 'start exactly one traffic process', { share: 0, duration: 0, log: join(repo, 'traffic-log.txt') });
  up('S1', 'v1/v1', '002_add_price_vnd');
  roll('S2-A', 'v2/v1', 'A', 'v2'); roll('S2-B', 'v2/v2', 'B', 'v2');
  add('S3-backfill', 'v2/v2', 'backfill after proving no v1 writer remains', { command: ['npm', 'run', 'backfill'], requirePlainConsistent: true });
  add('S3-rerun', 'v2/v2', 'backfill rerun must update 0', { command: ['npm', 'run', 'backfill'], requirePlainConsistent: true });
  add('S3-clients', 'v2/v2', 'atomically replace NEW_CLIENTS_FILE; observe accepted log entry in same traffic PID', { share: 0.3 });
  roll('S4-A', 'v3/v2', 'A', 'v3'); roll('S4-B', 'v3/v3', 'B', 'v3');
  roll('S5-back-B', 'v3/v2', 'B', 'v2'); roll('S5-back-A', 'v2/v2', 'A', 'v2');
  roll('S5-forward-B', 'v2/v3', 'B', 'v3'); roll('S5-forward-A', 'v3/v3', 'A', 'v3');
  up('S6', 'v3/v3', '003_sync_legacy_price');
  roll('S7-A', 'v4/v3', 'A', 'v4'); roll('S7-B', 'v4/v4', 'B', 'v4');
  add('S8-gate', 'v4/v4', 'STOP; keep traffic running; present DB/PID/bridge/consistency/counter/backup evidence for explicit student approval', { approvalRequired: true });
  add('S8', 'v4/v4', 'migration ONLY AFTER specific DB approval and fresh revalidation', { approvalRequired: true, command: ['npm', 'run', 'migrate', '--', '--to', '004_drop_price'] });
  add('post-S8', 'v4/v4', 'verify both HTTP clients and orders; stop traffic exactly once; inspect one final result');
  return {
    scope: 'P5-A PLAN ONLY', executionEnabled: false, repo: resolve(repo), runDir, dbPath, ports,
    targets: ports.map((p) => `http://127.0.0.1:${p}`), releases: RELEASES,
    trafficLog: join(repo, 'traffic-log.txt'), checkLog: join(repo, 'check-log.txt'),
    shareFile: join(runDir, 'client-share.json'),
    reviewGate: 'No demonstration DB creation, instance deployment or traffic start before Gate A review. No S8 without separate explicit approval.',
    steps,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repo = resolve(fileURLToPath(new URL('../', import.meta.url)));
  console.log(JSON.stringify(buildPlan({ repo, runDir: process.env.P5_RUN_DIR, dbPath: process.env.DB_PATH }), null, 2));
}
