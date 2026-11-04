"""One-shot operator record for the student's explicit S8 authorization.

Requires a freshly verified packet; refuses an already contracted/completed run.
No process start, restart, migration down, or release-tag mutation is provided.
"""
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import sys
import time
import urllib.request

ROOT = Path.cwd().resolve()
sys.path.insert(0, str(ROOT / 'scripts'))
from p5_b_execute import FinalRun, ReattachedProcess, latest_counters, now


def execute():
    assert sys.argv[1:] == ['--resume-post-contract']
    evidence = ROOT / 'docs/evidence/p5-s8-completion'
    assert evidence.is_dir()
    packet = json.loads((ROOT / 'docs/evidence/p5-s8-approved-precontract/s8-packet.json').read_text())
    state_path = ROOT / 'data/p5-final-20261104/state.json'
    state = json.loads(state_path.read_text())
    assert state['gate'].startswith('BLOCKED') and state['migration004_executed'] and state['S8_authorized']
    assert 0 <= (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(packet['at'])).total_seconds() < 300
    assert hashlib.sha256(Path(packet['backup']['backup']).read_bytes()).hexdigest() == packet['backup']['file_sha256']
    run = FinalRun.__new__(FinalRun)
    run.repo, run.run_dir = ROOT, state_path.parent
    run.db, run.node = Path(state['DB_PATH']), Path(state['node'])
    assert str(run.db) == packet['DB_PATH'] and state['traffic_pid'] == packet['traffic_pid'] == 29850
    run.evidence, run.events = evidence, evidence / 'events.jsonl'
    run.env = dict(os.environ, PATH=str(run.node.parent) + os.pathsep + os.environ['PATH'], DB_PATH=str(run.db))
    run.traffic_log, run.check_log = ROOT / 'traffic-log.txt', ROOT / 'check-log.txt'
    run.traffic, run.traffic_started = ReattachedProcess(state['traffic_pid']), True
    run.slots = {n: dict(name=n, tag=s['tag'], port=s['port'], proc=ReattachedProcess(s['pid'])) for n, s in state['instances'].items()}
    run.stages = state['steps']
    tracked = run.hash_previous_evidence()
    tags = {tag: run.git('rev-parse', tag) for tag in ('v1', 'v2', 'v3', 'v4')}
    contract_done = True

    def save(gate='S8 approved; original traffic running'):
        state.update(at=now(), gate=gate, S8_authorized=True, migration004_executed=contract_done, steps=run.stages)
        temporary = state_path.with_suffix('.json.next')
        temporary.write_text(json.dumps(state, indent=2) + '\n')
        temporary.replace(state_path)

    run.save_state = save
    run.event('explicit-student-authorization', quote='Hãy thực hiện S8 và thực hiện thao tác như nãy giờ thực hiện', DB_PATH=str(run.db), scope='S8 and post-S8 verification; end original traffic once after successful checks; no merge/submission')
    try:
        run.event('RESUME-post-contract-same-traffic', reason='S0-S7 checker wrapper required disagree=0 even after price was absent; raw checker exited 0 CONSISTENT; skip migration, no traffic restart')
        run.verify_writers()
        run.traffic_guard(require_tick=True)
        run.check('S8-contract-004-verified-after-controller-assertion', plain=False)
        with contextlib.closing(sqlite3.connect(run.db)) as db:
            assert 'price' not in [r[1] for r in db.execute('PRAGMA table_info(menu_items)')]
            assert db.execute("SELECT name FROM sqlite_schema WHERE type='trigger'").fetchall() == []
            assert db.execute('SELECT max(version) FROM schema_migrations').fetchone()[0] == '004_drop_price'
            assert db.execute("SELECT count(*) FROM menu_items WHERE price_vnd IS NULL OR typeof(price_vnd)<>'integer' OR price_vnd<=0 OR price_vnd>100000000").fetchone()[0] == 0
        proofs = []

        def request(port, method, path, body=None):
            raw = json.dumps(body).encode() if body is not None else None
            req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=raw, method=method, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=10) as res:
                value = json.load(res)
                run.event('post-contract-http', port=port, method=method, path=path, request=body, status=res.status, response=value)
                assert res.status == (201 if method == 'POST' else 200)
                return value

        for port in (3001, 3002):
            for payload in ({'price': 45.501}, {'priceVnd': 45501}):
                made = request(port, 'POST', '/menu', {'name': 'S8 approved HTTP proof', **payload})
                item = made['id']
                assert made['price'] == 45.501 and made['priceVnd'] == 45501
                for patch, vnd in (({'price': 12.345}, 12345), ({'priceVnd': 45501}, 45501)):
                    changed = request(port, 'PATCH', f'/menu/{item}', patch)
                    assert changed['priceVnd'] == vnd and changed['price'] == vnd / 1000
                for read_port in (3001, 3002):
                    got = request(read_port, 'GET', f'/menu/{item}')
                    assert got == dict(id=item, name='S8 approved HTTP proof', price=45.501, priceVnd=45501)
                    with contextlib.closing(sqlite3.connect(run.db)) as db:
                        offset = db.execute('SELECT count(*) FROM menu_items WHERE id < ?', (item,)).fetchone()[0]
                    page = request(read_port, 'GET', f'/menu?limit=1&offset={offset}')
                    assert page == [got]
                order = request(port, 'POST', '/orders', {'items': [{'menuItemId': item, 'qty': 2}]})
                assert order['total'] == 91.002
                with contextlib.closing(sqlite3.connect(run.db)) as db:
                    line = db.execute('SELECT qty,unit_price FROM order_items WHERE order_id=?', (order['id'],)).fetchall()
                    assert line == [(2, 45.501)]
                proofs.append(dict(port=port, payload=payload, item=item, order=order, unit_price=45.501))
        run.check('post-S8-both-clients-both-instances-orders', plain=False)
        identities = run.verify_writers()
        previous = float(run.traffic_guard(require_tick=True)['seconds'])
        run.wait_for(lambda: float(run.traffic_guard(require_tick=True)['seconds']) > previous, 'post-contract fresh zero-failure tick', timeout=15)
        run.event('stop-original-traffic-once', pid=run.traffic.pid, signal='SIGINT', counters=run.traffic_guard(require_tick=True))
        run.traffic.send_signal(signal.SIGINT)
        run.traffic.wait(timeout=30)
        raw = run.raw_traffic()
        counters = latest_counters(raw)
        assert raw.count('=== traffic start') == 1 and raw.count('RESULT:') == 1
        assert len(re.findall(r'^.* FINAL ok=', raw, re.M)) == 1
        assert 'RESULT: zero failed requests' in raw
        assert {tag: run.git('rev-parse', tag) for tag in tags} == tags
        assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest for name, digest in tracked.items())
        save('S8 and post-S8 COMPLETE; original traffic stopped once; submission review required')
        state.update(traffic_running=False, traffic_exit_status='UNAVAILABLE: reattached non-child; actual FINAL/RESULT and termination verified')
        state_path.write_text(json.dumps(state, indent=2) + '\n')
        summary = dict(at=now(), DB_PATH=str(run.db), completed=True, migration004_executed=True, approval='explicit student instruction in current conversation', traffic_pid=run.traffic.pid, traffic_running=False, traffic_exit_status=state['traffic_exit_status'], counters=counters, starts=1, final_results=1, down_events=len(re.findall(r' down \(', raw)), back_events=len(re.findall(r' back\n', raw)), instances=identities, backup=packet['backup'], http_proofs=proofs, tags_unchanged=True, tracked_evidence_files_verified=len(tracked), submission='NOT PREPARED')
        (evidence / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        (evidence / 'preserved-evidence.json').write_text(json.dumps(tracked, indent=2) + '\n')
        (evidence / 'traffic-final.snapshot.txt').write_bytes(run.traffic_log.read_bytes())
        (evidence / 'checks-final.snapshot.txt').write_bytes(run.check_log.read_bytes())
        run.event('COMPLETE', **summary)
    except Exception as error:
        run.event('BLOCKED-preserve-actual-state-no-restart-no-down', error=repr(error), migration004_executed=contract_done)
        save('BLOCKED; preserve actual processes/logs; no automatic rollback or restart')
        raise


if __name__ == '__main__':
    execute()
