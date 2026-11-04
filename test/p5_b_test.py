"""Disposable tests for the actual-run controller's safety boundaries."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('p5_b_execute', ROOT / 'scripts/p5_b_execute.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SafetyTests(unittest.TestCase):
    def test_startup_wait_does_not_require_a_log_line_before_the_generator_writes_it(self):
        fake = SimpleNamespace(traffic=SimpleNamespace(poll=lambda: None), traffic_started=False, raw_traffic=lambda: '')
        self.assertIsNone(module.FinalRun.traffic_guard(fake))
        fake.traffic_started = True
        with self.assertRaises(AssertionError):
            module.FinalRun.traffic_guard(fake)

    def test_contract_is_not_an_executable_target(self):
        calls = []
        fake = SimpleNamespace(command=lambda args: calls.append(args))
        with self.assertRaisesRegex(RuntimeError, 'forbids Contract'):
            module.FinalRun.migrate(fake, '004_drop_price')
        self.assertEqual(calls, [])
        self.assertEqual(len(module.ALLOWED_UP), 3)

    def test_nonzero_counter_and_failure_details_stop_progression(self):
        line = ' 5.0s ok=10 error=0 contract=0 stale=0 unavailable=0 rerouted=2'
        self.assertEqual(module.latest_counters(line)['rerouted'], '2')
        with self.assertRaisesRegex(RuntimeError, 'nonzero'):
            module.latest_counters(line.replace('stale=0', 'stale=1'))
        with self.assertRaisesRegex(RuntimeError, 'failure detail'):
            module.latest_counters('1.0s CONTRACT bad\n' + line)

    def test_backup_compares_one_snapshot_while_an_independent_writer_commits(self):
        with tempfile.TemporaryDirectory(prefix='ia2-p5-b-backup-test-') as directory:
            path = Path(directory) / 'disposable.db'
            db = sqlite3.connect(path)
            db.execute('PRAGMA journal_mode=WAL')
            for version in ['001_init', '002_add_price_vnd', '003_sync_legacy_price']:
                db.executescript((ROOT / 'migrations' / (version + '.up.sql')).read_text())
            db.execute('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
            db.executemany('INSERT INTO schema_migrations VALUES (?,?)', [(v, 'fixture') for v in ['001_init','002_add_price_vnd','003_sync_legacy_price']])
            db.execute("INSERT INTO menu_items VALUES (1, 'Tea', 5, 5000)")
            db.commit(); db.close()
            stop = threading.Event()
            def writer():
                connection = sqlite3.connect(path, timeout=10)
                try:
                    i = 1
                    while not stop.is_set():
                        connection.execute('UPDATE menu_items SET price=?,price_vnd=? WHERE id=1', (i, i * 1000))
                        connection.commit()
                        i = i % 100 + 1
                finally: connection.close()
            thread = threading.Thread(target=writer)
            thread.start()
            try:
                backup = Path(directory) / 'verified-backup.db'
                result = module.verified_backup(path, backup, Path(directory) / 'recovery.db')
                self.assertEqual(result['integrity_check'], 'ok')
                self.assertTrue(result['schema_identical'])
                self.assertEqual(result['tables']['menu_items']['rows'], 1)
                with self.assertRaisesRegex(RuntimeError, 'never overwrite'):
                    module.verified_backup(path, backup, Path(directory) / 'recovery.db')
            finally: stop.set(); thread.join(timeout=10)
            self.assertFalse(thread.is_alive())


if __name__ == '__main__':
    unittest.main()
