"""Read/backup-only S8 refresh; never dispatches migration or traffic restart."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path

from p5_b_execute import ROOT, FinalRun, ReattachedProcess


def refresh(evidence):
    run = FinalRun.__new__(FinalRun)
    run.repo = ROOT
    run.run_dir = ROOT / 'data/p5-final-20261104'
    state = json.loads((run.run_dir / 'state.json').read_text())
    assert state['gate'].startswith('S8 AWAITING')
    assert state['S8_authorized'] is False and state['migration004_executed'] is False
    assert all(s['tag'] == 'v4' for s in state['instances'].values())
    run.evidence = Path(evidence).resolve()
    run.evidence.mkdir(parents=True, exist_ok=False)
    run.events = run.evidence / 'events.jsonl'
    run.db = Path(state['DB_PATH'])
    run.node = Path(state['node'])
    run.env = dict(os.environ, PATH=str(run.node.parent) + os.pathsep + os.environ['PATH'], DB_PATH=str(run.db),
                   TARGETS='http://127.0.0.1:3001,http://127.0.0.1:3002', NEW_CLIENTS_FILE=str(run.run_dir / 'client-share.json'))
    run.traffic_log = ROOT / 'traffic-log.txt'
    run.check_log = ROOT / 'check-log.txt'
    run.traffic = ReattachedProcess(state['traffic_pid'])
    run.traffic_started = True
    run.slots = {n: {'name': n, 'tag': s['tag'], 'port': s['port'], 'proc': ReattachedProcess(s['pid'])} for n, s in state['instances'].items()}
    run.stages = state['steps']
    run.saved_evidence = json.loads((ROOT / 'docs/evidence/p5-b-execution/preserved-evidence.json').read_text())
    run.saved_tags = json.loads((ROOT / 'docs/evidence/p5-b-preflight/preflight.json').read_text())[0]['tagObjects']
    suffix = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    run.event('refresh-only-NO-S8', traffic_pid=run.traffic.pid, reason='fresh approval packet; keep original traffic/instances; no migration dispatch')
    return run.s8_packet(run.run_dir / f's8-precontract-backup-{suffix}.db')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()
    refresh(args.evidence)
