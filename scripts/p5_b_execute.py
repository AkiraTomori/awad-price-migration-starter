"""Authorized P5-B execution through S7 only. No Contract execution path.

Detached Node children intentionally remain running at S8 or a blocker; never
restart the generator, delete a run, or run this entry point twice on one run.
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'v1': '2b889bde433190c17744f30d3900d38ab333a756',
    'v2': 'dadb816bac9dad5ffcbf098d130d387bbbdd338c',
    'v3': 'ccd19db7c1cf14d2a5df21f38769c73dd96f27b2',
    'v4': '51669379446f8f34473a90104ea939284335e9f2',
}
ALLOWED_UP = frozenset({'001_init', '002_add_price_vnd', '003_sync_legacy_price'})
COUNTERS = re.compile(r'(?P<seconds>[\d.]+)s (?:FINAL )?ok=(?P<ok>\d+) error=(?P<error>\d+) contract=(?P<contract>\d+) stale=(?P<stale>\d+) unavailable=(?P<unavailable>\d+) rerouted=(?P<rerouted>\d+)')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def latest_counters(raw):
    matches = list(COUNTERS.finditer(raw))
    if not matches:
        raise RuntimeError('no actual traffic counter snapshot yet')
    for match in matches:
        if any(int(match[k]) for k in ('error', 'contract', 'stale', 'unavailable')):
            raise RuntimeError('nonzero traffic failure counter; preserve and stop')
    if re.search(r'\b(ERROR|CONTRACT|STALE|UNAVAILABLE) ', raw):
        raise RuntimeError('traffic failure detail found; preserve and stop')
    return matches[-1].groupdict()


def table_proof(db):
    result = {}
    for table, order in [('menu_items', 'id'), ('orders', 'id'), ('order_items', 'order_id, menu_item_id, rowid'), ('schema_migrations', 'version')]:
        digest = hashlib.sha256()
        count = 0
        for row in db.execute(f'SELECT * FROM {table} ORDER BY {order}'):
            digest.update((json.dumps(list(row), ensure_ascii=False, separators=(',', ':')) + '\n').encode())
            count += 1
        result[table] = {'rows': count, 'sha256': digest.hexdigest()}
    return result


def verified_backup(source_path, destination, restore_location):
    """Compare backup contents with the SAME pinned source read snapshot."""
    source_path, destination = Path(source_path), Path(destination)
    if destination.exists():
        raise RuntimeError('backup destination already exists; never overwrite')
    started = now()
    with contextlib.closing(sqlite3.connect(source_path.as_uri() + '?mode=ro', uri=True, timeout=30)) as source:
        source.execute('BEGIN')
        source.execute('SELECT count(*) FROM menu_items').fetchone()  # Pin WAL snapshot.
        with contextlib.closing(sqlite3.connect(destination)) as dest:
            source.backup(dest, pages=1024, sleep=0.005)
            assert dest.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert dest.execute('PRAGMA foreign_key_check').fetchall() == []
            original, copied = table_proof(source), table_proof(dest)
            assert original == copied, 'backup must match source read snapshot exactly'
            schema = 'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name'
            assert source.execute(schema).fetchall() == dest.execute(schema).fetchall()
            triggers = [r[0] for r in dest.execute("SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name")]
            versions = [r[0] for r in dest.execute('SELECT version FROM schema_migrations ORDER BY version')]
            assert versions[-1] == '003_sync_legacy_price'
            assert set(triggers) == {'menu_price_vnd_insert', 'menu_price_vnd_update'}
        source.rollback()
    return {'started_at': started, 'verified_at': now(), 'source': str(source_path), 'backup': str(destination),
            'method': 'SQLite backup API from one pinned read transaction; writers continue',
            'integrity_check': 'ok', 'foreign_key_check': [], 'tables': copied, 'schema_identical': True,
            'versions': versions, 'triggers': triggers, 'bytes': destination.stat().st_size,
            'file_sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
            'intended_restore_location': str(restore_location), 'restored': False}


class ReattachedProcess:
    """Observe an existing PID without pretending to recover its exit status."""
    def __init__(self, pid):
        self.pid = pid

    def poll(self):
        r = subprocess.run(['ps', '-p', str(self.pid), '-o', 'stat='], text=True, capture_output=True)
        return None if r.returncode == 0 and r.stdout.strip() and not r.stdout.strip().startswith('Z') else 'EXITED_STATUS_UNAVAILABLE'

    def send_signal(self, sig):
        os.kill(self.pid, sig)

    def wait(self, timeout):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.poll() is not None:
                return None
            time.sleep(0.025)
        raise RuntimeError('original instance did not terminate')


class FinalRun:
    def __init__(self, source_node, evidence):
        self.repo = ROOT
        self.run_dir = ROOT / 'data/p5-final-20261104'
        self.db = self.run_dir / 'app.db'
        self.evidence = Path(evidence).resolve()
        self.traffic_log = ROOT / 'traffic-log.txt'
        self.check_log = ROOT / 'check-log.txt'
        for path in (self.run_dir, self.traffic_log, self.check_log, self.evidence):
            if path.exists() or path.is_symlink():
                raise RuntimeError(f'preserve existing path: {path}')
        self.evidence.mkdir(parents=True)
        self.events = self.evidence / 'events.jsonl'
        self.slots = {}
        self.children = []
        self.traffic = None
        self.traffic_started = False
        self.stages = []
        self.sequence = 0
        self.saved_evidence = self.hash_previous_evidence()
        self.saved_tags = {t: self.git('rev-parse', t) for t in PINS}
        for tag, sha in PINS.items():
            assert self.git('rev-parse', tag + '^{}') == sha
        assert not self.git('ls-tree', '-r', '--name-only', 'v4', 'migrations/004_drop_price.up.sql')
        self.run_dir.mkdir(parents=True)
        (self.run_dir / 'runtime').mkdir()
        self.node = self.run_dir / 'runtime/node'
        shutil.copy2(source_node, self.node)
        self.env = dict(os.environ, PATH=str(self.node.parent) + os.pathsep + os.environ['PATH'], DB_PATH=str(self.db),
                        TARGETS='http://127.0.0.1:3001,http://127.0.0.1:3002', NEW_CLIENTS_FILE=str(self.run_dir / 'client-share.json'))
        assert self.command([str(self.node), '--version']).stdout.strip().startswith('v22.')
        self.command([str(self.node), '-e', "require('node:sqlite')"])
        (self.run_dir / 'client-share.json').write_text('0\n')
        self.check_log.touch(exist_ok=False)
        self.event('authorization', scope='user-authorized S0–S7 only', S8='NOT AUTHORIZED', root=str(ROOT), db=str(self.db))

    def event(self, kind, **data):
        with self.events.open('a') as log:
            log.write(json.dumps({'at': now(), 'event': kind, **data}, ensure_ascii=False) + '\n')
        print(kind + ' ' + json.dumps(data, ensure_ascii=False)[:500], flush=True)

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, text=True).strip()

    def hash_previous_evidence(self):
        paths = self.git('ls-files', 'docs/evidence').splitlines()
        return {p: hashlib.sha256((self.repo / p).read_bytes()).hexdigest() for p in paths}

    def command(self, args, cwd=None, allow_failure=False, append_to=None):
        cwd = cwd or self.repo
        self.event('command', argv=args, cwd=str(cwd), DB_PATH=str(self.db))
        result = subprocess.run(args, cwd=cwd, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.event('command-result', argv=args, exit=result.returncode, output=result.stdout)
        if append_to:
            with Path(append_to).open('a') as log:
                log.write('$ ' + ' '.join(args) + '\n' + result.stdout)
        if result.returncode and not allow_failure:
            raise RuntimeError(f'command failed, exit {result.returncode}: {args}')
        return result

    def raw_traffic(self):
        if not self.traffic_log.exists():
            return ''
        return self.traffic_log.read_text()

    def traffic_guard(self, require_tick=False):
        if not self.traffic:
            return None
        assert self.traffic.poll() is None, 'original traffic PID must remain alive'
        raw = self.raw_traffic()
        starts = raw.count('=== traffic start')
        if starts == 0 and not self.traffic_started and not require_tick:
            return None
        assert starts == 1
        assert 'FINAL ' not in raw and 'RESULT:' not in raw
        if require_tick:
            return latest_counters(raw)
        if list(COUNTERS.finditer(raw)):
            return latest_counters(raw)
        if re.search(r'\b(ERROR|CONTRACT|STALE|UNAVAILABLE) ', raw):
            raise RuntimeError('traffic failure before first tick')

    def wait_for(self, predicate, description, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.traffic_guard()
            if predicate():
                return
            time.sleep(0.025)
        raise RuntimeError('timed out: ' + description)

    def spawn(self, argv, cwd, extra, label):
        self.sequence += 1
        output = self.run_dir / f'{self.sequence:02}-{label}.log'
        with output.open('xb') as stream:
            proc = subprocess.Popen(argv, cwd=cwd, env=dict(self.env, **extra), stdin=subprocess.DEVNULL,
                                    stdout=stream, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
        self.children.append(proc)
        self.event('start-detached', pid=proc.pid, argv=argv, cwd=str(cwd), env={**{k: self.env[k] for k in ('DB_PATH', 'TARGETS', 'NEW_CLIENTS_FILE')}, **extra}, output=str(output))
        return proc

    def health(self, slot):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{slot["port"]}/health', timeout=1) as res:
                return json.load(res)
        except OSError:
            return None

    def identity(self, slot):
        assert slot['proc'].poll() is None
        assert self.health(slot) == ({'ok': True} if slot['tag'] == 'v1' else {'ok': True, 'version': slot['tag']})
        cwd = self.run_dir / 'releases' / slot['tag']
        assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cwd, text=True).strip() == PINS[slot['tag']]
        assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=cwd, text=True).strip() == ''
        pid = slot['proc'].pid
        ps = subprocess.check_output(['ps', '-p', str(pid), '-o', 'pid=,command='], text=True).strip()
        cwd_info = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], text=True).strip()
        assert 'n' + str(cwd) in cwd_info
        handle = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-Fn', '--', str(self.db)], text=True).strip()
        assert f'p{pid}\n' in handle and 'n' + str(self.db) in handle
        listener = subprocess.check_output(['lsof', '-nP', '-a', '-p', str(pid), f'-iTCP:{slot["port"]}', '-sTCP:LISTEN', '-Fpn'], text=True).strip()
        assert f'p{pid}\n' in listener
        info = {'slot': slot['name'], 'pid': pid, 'tag': slot['tag'], 'sha': PINS[slot['tag']], 'port': slot['port'],
                'health': self.health(slot), 'ps': ps, 'cwd_lsof': cwd_info, 'db_lsof': handle, 'listener_lsof': listener,
                'DB_PATH': str(self.db), 'db_device': self.db.stat().st_dev, 'db_inode': self.db.stat().st_ino}
        self.event('verified-instance', **info)
        return info

    def verify_writers(self):
        identities = [self.identity(s) for s in self.slots.values()]
        holders = set(subprocess.check_output(['lsof', '-t', '--', str(self.db)], text=True).split())
        expected = {str(s['proc'].pid) for s in self.slots.values()}
        assert holders == expected, f'unexpected DB holder/writer: {holders - expected}'
        self.event('all-db-holders-verified', pids=sorted(holders), DB_PATH=str(self.db))
        return identities

    def start_slot(self, name, tag, port):
        cwd = self.run_dir / 'releases' / tag
        proc = self.spawn([str(self.node), 'src/server.js'], cwd, {'PORT': str(port)}, f'instance-{name}-{tag}')
        slot = {'name': name, 'tag': tag, 'port': port, 'proc': proc}
        self.slots[name] = slot
        def healthy():
            if proc.poll() is not None:
                raise RuntimeError(f'{name} startup failed')
            return self.health(slot) == ({'ok': True} if tag == 'v1' else {'ok': True, 'version': tag})
        self.wait_for(healthy, name + '/' + tag + ' health')
        self.identity(slot)

    def check(self, label, plain=False, pre_backfill=False):
        with self.check_log.open('a') as log:
            log.write(f'\n=== {label} {now()} DB_PATH={self.db} states={self.state()} traffic_pid={self.traffic.pid if self.traffic else "NOT STARTED"} ===\n')
        self.command(['npm', 'run', 'migrate:status'], append_to=self.check_log)
        check = self.command(['npm', 'run', 'check'], allow_failure=pre_backfill, append_to=self.check_log)
        if check.returncode:
            assert re.search(r'^INCONSISTENT$', check.stdout, re.M), 'unexpected check failure is not a pre-backfill data diagnosis'
            # A v1 writer may reprice a row after v2 filled its new value. This
            # diagnosed pre-S3 condition is precisely why backfill reconciles
            # disagreements as well as NULL. Keep the actual exit=1/output.
            with contextlib.closing(sqlite3.connect(self.db.as_uri() + '?mode=ro', uri=True)) as db:
                invalid = db.execute("SELECT count(*) FROM menu_items WHERE price IS NULL OR price<=0 OR price_vnd IS NOT NULL AND (typeof(price_vnd)<>'integer' OR price_vnd<=0 OR price_vnd>100000000)").fetchone()[0]
                disagree = db.execute('SELECT count(*) FROM menu_items WHERE price_vnd IS NOT NULL AND price_vnd<>CAST(round(price*1000) AS INTEGER)').fetchone()[0]
            assert pre_backfill and invalid == 0 and disagree > 0 and {s['tag'] for s in self.slots.values()} <= {'v1', 'v2'}
            self.event('diagnosed-before-S3', label=label, raw_check_exit=check.returncode, disagree=disagree,
                       reason='v1 legacy-only writes left filled VND stale during mixed v1/v2; no new-column reader, clients share remains 0; reconcile at S3 after v1 retirement')
        elif plain:
            assert re.search(r'^CONSISTENT$', check.stdout, re.M)
            assert re.search(r'price_vnd_null\s+0', check.stdout)
            assert re.search(r'disagree\s+0', check.stdout)
        self.traffic_guard()
        entry = {'label': label, 'at': now(), 'state': self.state(), 'check_exit': check.returncode, 'plain_required': plain}
        self.stages.append(entry)
        self.event('step-recorded', **entry)
        self.save_state()

    def state(self):
        return '/'.join(self.slots[n]['tag'] if n in self.slots else '-' for n in ('A', 'B'))

    def save_state(self, gate='S0-S7 IN PROGRESS'):
        value = {'at': now(), 'gate': gate, 'S8_authorized': False, 'migration004_executed': False, 'repo': str(self.repo),
                 'run_dir': str(self.run_dir), 'DB_PATH': str(self.db), 'node': str(self.node),
                 'traffic_pid': self.traffic.pid if self.traffic else None,
                 'instances': {n: {'pid': s['proc'].pid, 'tag': s['tag'], 'port': s['port']} for n, s in self.slots.items()},
                 'steps': self.stages}
        temp = self.run_dir / 'state.json.next'
        temp.write_text(json.dumps(value, indent=2) + '\n')
        temp.replace(self.run_dir / 'state.json')

    def migrate(self, target):
        if target not in ALLOWED_UP:
            raise RuntimeError('P5-B forbids Contract and non-whitelisted migration targets')
        self.command(['npm', 'run', 'migrate', '--', '--to', target])

    def roll(self, name, tag, label, pre_backfill=False):
        standby = self.slots['B' if name == 'A' else 'A']
        self.identity(standby)
        slot = self.slots[name]
        needle = f'http://127.0.0.1:{slot["port"]}'
        down = self.raw_traffic().count(needle + ' down')
        back = self.raw_traffic().count(needle + ' back')
        self.event('roll-stop-one', label=label, pid=slot['proc'].pid, old=slot['tag'], new=tag)
        slot['proc'].send_signal(signal.SIGTERM)
        exit_status = slot['proc'].wait(timeout=15)
        assert exit_status in (0, None)
        self.event('old-instance-ended', pid=slot['proc'].pid, exit_status=exit_status, note='None means reattached non-child: termination observed, exit code unavailable')
        self.wait_for(lambda: self.raw_traffic().count(needle + ' down') > down, 'actual down event')
        self.start_slot(name, tag, slot['port'])
        self.wait_for(lambda: self.raw_traffic().count(needle + ' back') > back, 'actual back event')
        self.verify_writers()
        self.check(label, plain=not pre_backfill, pre_backfill=pre_backfill)

    def execute(self):
        try:
            (self.run_dir / 'releases').mkdir()
            for tag in PINS:
                self.command(['git', 'worktree', 'add', '--detach', str(self.run_dir / 'releases' / tag), tag])
            self.migrate('001_init'); self.check('S0-schema-001')
            self.command([str(self.node), str(self.run_dir / 'releases/v1/scripts/seed.js'), '20000'])
            with contextlib.closing(sqlite3.connect(self.db)) as db:
                assert db.execute('SELECT count(*) FROM menu_items').fetchone()[0] == 20000
            self.check('S0-seed-20000')
            self.start_slot('A', 'v1', 3001); self.check('S0-A-v1')
            self.start_slot('B', 'v1', 3002); self.verify_writers(); self.check('S0-B-v1')
            self.traffic = self.spawn([str(self.node), 'scripts/traffic.js'], self.repo,
                                      {'LOG': str(self.traffic_log), 'NEW_CLIENTS': '0', 'DURATION': '0', 'IDS': '2000'}, 'traffic-stdout')
            self.wait_for(lambda: '=== traffic start' in self.raw_traffic(), 'one traffic start')
            self.traffic_started = True
            return self.continue_after_start()
        except Exception as error:
            self.event('BLOCKED-no-auto-cleanup', error=repr(error), traffic_pid=self.traffic.pid if self.traffic else None)
            self.save_state('BLOCKED; preserve running processes and logs; no automatic restart')
            raise

    def continue_after_start(self):
        self.check('S0-one-traffic-start-share-0')
        self.migrate('002_add_price_vnd'); self.check('S1-expand')
        self.roll('A', 'v2', 'S2-A-v2/v1', pre_backfill=True)
        self.roll('B', 'v2', 'S2-B-v2/v2', pre_backfill=True)
        self.verify_writers()
        result = self.command(['npm', 'run', 'backfill'])
        self.check('S3-backfill-complete', plain=True)
        rerun = self.command(['npm', 'run', 'backfill'])
        assert '"updated":0' in rerun.stdout.split('COMPLETE ')[-1]
        self.check('S3-idempotent-rerun', plain=True)
        share = self.run_dir / 'client-share.json'
        share.with_suffix('.json.next').write_text('0.3\n'); share.with_suffix('.json.next').replace(share)
        self.wait_for(lambda: 'CLIENT_MIX 0 -> 0.3' in self.raw_traffic(), 'accepted client share in original PID')
        self.check('S3-clients-0.3-same-PID', plain=True)
        for name, tag, label in [('A','v3','S4-A-v3/v2'),('B','v3','S4-B-v3/v3'),
                                 ('B','v2','S5-rollback-B-v3/v2'),('A','v2','S5-rollback-A-v2/v2'),
                                 ('B','v3','S5-restore-B-v2/v3'),('A','v3','S5-restore-A-v3/v3')]:
            self.roll(name, tag, label)
        self.verify_writers(); self.migrate('003_sync_legacy_price'); self.check('S6-bridge-v3/v3', plain=True)
        self.roll('A', 'v4', 'S7-A-v4/v3'); self.roll('B', 'v4', 'S7-B-v4/v4')
        return self.s8_packet()

    @classmethod
    def resume_s0_traffic(cls, evidence):
        self = cls.__new__(cls)
        self.repo = ROOT
        self.run_dir = ROOT / 'data/p5-final-20261104'
        state = json.loads((self.run_dir / 'state.json').read_text())
        assert state['gate'].startswith('BLOCKED')
        assert [s['label'] for s in state['steps']] == ['S0-schema-001', 'S0-seed-20000', 'S0-A-v1', 'S0-B-v1']
        assert {s['tag'] for s in state['instances'].values()} == {'v1'}
        self.db = Path(state['DB_PATH'])
        self.evidence = Path(evidence).resolve()
        self.events = self.evidence / 'events.jsonl'
        self.traffic_log = ROOT / 'traffic-log.txt'
        self.check_log = ROOT / 'check-log.txt'
        self.node = Path(state['node'])
        self.env = dict(os.environ, PATH=str(self.node.parent) + os.pathsep + os.environ['PATH'], DB_PATH=str(self.db),
                        TARGETS='http://127.0.0.1:3001,http://127.0.0.1:3002', NEW_CLIENTS_FILE=str(self.run_dir / 'client-share.json'))
        self.slots = {n: {'name': n, 'tag': s['tag'], 'port': s['port'], 'proc': ReattachedProcess(s['pid'])} for n,s in state['instances'].items()}
        self.traffic = ReattachedProcess(state['traffic_pid'])
        self.traffic_started = True
        self.children = []
        self.stages = state['steps']
        self.sequence = max(int(p.name.split('-')[0]) for p in self.run_dir.glob('*.log'))
        self.saved_evidence = json.loads((ROOT / 'docs/evidence/p5-b-preflight/preserved-evidence.json').read_text())
        first = json.loads((ROOT / 'docs/evidence/p5-b-preflight/preflight.json').read_text())[0]
        self.saved_tags = first['tagObjects']
        with contextlib.closing(sqlite3.connect(self.db.as_uri() + '?mode=ro', uri=True)) as db:
            assert db.execute('SELECT version FROM schema_migrations').fetchall() == [('001_init',)]
        self.traffic_guard(require_tick=True)
        self.verify_writers()
        self.event('RESUME-SAME-TRAFFIC-PID', traffic_pid=self.traffic.pid, reason='fixed controller readiness race before first start line; no traffic restart or counter reset')
        try:
            return self.continue_after_start()
        except Exception as error:
            self.event('BLOCKED-no-auto-cleanup', error=repr(error), traffic_pid=self.traffic.pid)
            self.save_state('BLOCKED; preserve processes and raw logs')
            raise

    def s8_packet(self, backup_path=None):
        identities = self.verify_writers()
        assert self.state() == 'v4/v4'
        self.check('S8-GATE-before-backup-NO-004', plain=True)
        self.wait_for(lambda: bool(list(COUNTERS.finditer(self.raw_traffic()))), 'first actual traffic counters')
        before = self.traffic_guard(require_tick=True)
        backup_path = Path(backup_path) if backup_path else self.run_dir / 's8-precontract-backup.db'
        assert backup_path.parent == self.run_dir
        backup = verified_backup(self.db, backup_path, self.run_dir / 'recovery/app-restored.db')
        self.event('verified-backup', **backup)
        identities = self.verify_writers()
        self.check('S8-GATE-after-backup-NO-004', plain=True)
        last_at_backup = self.traffic_guard(require_tick=True)['seconds']
        self.wait_for(lambda: float(self.traffic_guard(require_tick=True)['seconds']) > float(last_at_backup), 'fresh zero counters after backup verification', timeout=15)
        counters = self.traffic_guard(require_tick=True)
        with contextlib.closing(sqlite3.connect(self.db.as_uri() + '?mode=ro', uri=True)) as db:
            schema = [list(r) for r in db.execute('PRAGMA table_info(menu_items)')]
            versions = [r[0] for r in db.execute('SELECT version FROM schema_migrations ORDER BY version')]
            triggers = [list(r) for r in db.execute("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name")]
        assert versions[-1] == '003_sync_legacy_price' and any(r[1] == 'price' for r in schema)
        assert all(hashlib.sha256((self.repo / name).read_bytes()).hexdigest() == digest for name, digest in self.saved_evidence.items())
        assert {t: self.git('rev-parse', t) for t in PINS} == self.saved_tags
        raw = self.traffic_log.read_bytes()
        checks = self.check_log.read_bytes()
        (self.evidence / 'traffic-through-s7.snapshot.txt').write_bytes(raw)
        (self.evidence / 'checks-through-s7.snapshot.txt').write_bytes(checks)
        packet = {'at': now(), 'gate': 'S8 AWAITING EXPLICIT STUDENT APPROVAL; 004 NOT EXECUTED', 'DB_PATH': str(self.db),
                  'runtime': str(self.node), 'runtime_sha256': hashlib.sha256(self.node.read_bytes()).hexdigest(),
                  'traffic_pid': self.traffic.pid, 'traffic_running': self.traffic.poll() is None, 'traffic_counters': counters,
                  'traffic_log_prefix_bytes': len(raw), 'traffic_log_prefix_sha256': hashlib.sha256(raw).hexdigest(),
                  'traffic_starts': raw.count(b'=== traffic start'), 'traffic_final_results': raw.count(b'RESULT:'),
                  'down_events': len(re.findall(rb' down \(', raw)), 'back_events': len(re.findall(rb' back\n', raw)),
                  'instances': identities, 'versions': versions, 'schema': schema, 'triggers': triggers, 'backup': backup,
                  'stages': self.stages, 'previous_evidence_files_verified': len(self.saved_evidence),
                  'tags_unchanged': True, 'approval': 'NOT GIVEN', 'final_submission': 'NOT PREPARED'}
        (self.evidence / 's8-packet.json').write_text(json.dumps(packet, indent=2) + '\n')
        (self.evidence / 'preserved-evidence.json').write_text(json.dumps(self.saved_evidence, indent=2) + '\n')
        self.save_state('S8 AWAITING APPROVAL; leave original traffic and v4/v4 alive')
        self.event('S8-STOP-original-traffic-continues', packet=str(self.evidence / 's8-packet.json'), traffic_pid=self.traffic.pid)
        return packet


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node')
    parser.add_argument('--resume-s0-traffic', action='store_true')
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()
    if args.resume_s0_traffic:
        FinalRun.resume_s0_traffic(args.evidence)
    else:
        if not args.node:
            parser.error('--node is required for a fresh run')
        run = FinalRun(Path(args.node).resolve(), args.evidence)
        run.execute()
