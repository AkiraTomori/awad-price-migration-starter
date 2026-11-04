"""Package a clean merged checkout, then verify an independent extraction.

No application, traffic or database command is executed. The output receipt is
outside the archive, so it can describe the actual final ZIP without self-hashing.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

PINS = {
    'v1': '2b889bde433190c17744f30d3900d38ab333a756',
    'v2': 'dadb816bac9dad5ffcbf098d130d387bbbdd338c',
    'v3': 'ccd19db7c1cf14d2a5df21f38769c73dd96f27b2',
    'v4': '51669379446f8f34473a90104ea939284335e9f2',
}


def git(repo, *args):
    return subprocess.check_output(['git', *args], cwd=repo, text=True).strip()


def verify(repo, expected):
    assert (repo / '.git').is_dir(), '.git must be a real directory'
    assert not (repo / '.git/objects/info/alternates').exists(), 'external object store is forbidden'
    assert not (repo / '.git/commondir').exists(), 'external worktree is forbidden'
    assert git(repo, 'rev-parse', 'HEAD') == expected
    assert not git(repo, 'status', '--porcelain'), 'package only a clean merged checkout'
    for tag, sha in PINS.items():
        assert git(repo, 'rev-parse', tag + '^{}') == sha
        git(repo, 'show', tag + ':src/app.js')
    git(repo, 'fsck', '--full')
    required = ['README.md', 'AGENTS.md', 'package.json', 'src/app.js', 'scripts/backfill.js',
                'MIGRATION.md', 'AI-LOG.md', 'SELF_ASSESSMENT_REPORT.md', 'traffic-log.txt', 'check-log.txt',
                'test/p5.test.js', 'docs/P5_S8_RESULT.md', 'docs/evidence/p5-s8-completion/summary.json',
                'IA#2 rubric — Zero-downtime migration (23KTPM1).pdf', 'SELF_ASSESSMENT_REPORT template.pdf']
    assert all((repo / name).is_file() for name in required)
    ups = sorted((repo / 'migrations').glob('*.up.sql'))
    assert len(ups) == 4
    assert all(p.with_name(p.name.replace('.up.sql', '.down.sql')).is_file() for p in ups)
    report = (repo / 'SELF_ASSESSMENT_REPORT.md').read_text()
    rows = [line.split('|') for line in report.splitlines() if re.match(r'^\| [1-6]\. ', line)]
    assert len(rows) == 6
    total = sum(int(row[3].strip()) for row in rows)
    assert sum(int(row[2].strip()) for row in rows) == 100
    assert f'Total I claim: **{total} / 100**' in report
    assert '23127379' in report and 'Thái Minh Huy' in report
    assert total == json.loads((repo / 'docs/evidence/p5-c-canonical-verification/assessment-score.json').read_text())['total']
    traffic = (repo / 'traffic-log.txt').read_text()
    assert traffic.count('=== traffic start') == traffic.count('RESULT:') == 1
    assert len(re.findall(r'^.* FINAL ok=', traffic, re.M)) == 1
    assert 'FINAL ok=35309724 error=0 contract=0 stale=0 unavailable=0 rerouted=101' in traffic
    assert traffic.rstrip().endswith('RESULT: zero failed requests')
    for name, meta in json.loads((repo / 'docs/evidence/p5-s8-completion/final-log-manifest.json').read_text()).items():
        assert hashlib.sha256((repo / name).read_bytes()).hexdigest() == meta['sha256']
    return total, required


def package(repo, output, expected):
    repo, output = Path(repo).resolve(), Path(output).resolve()
    total, required = verify(repo, expected)
    assert output.name == f'23127379_{total}.zip'
    receipt_path = output.with_suffix('.verification.json')
    assert not output.exists() and not receipt_path.exists(), 'never overwrite an existing submission'
    tracked = git(repo, 'ls-files', '-z').split('\0')
    paths = [repo / name for name in tracked if name]
    assert all(not p.is_symlink() for p in paths)
    assert not any(p.relative_to(repo).parts[0] in ('data', 'node_modules') for p in paths)
    paths += [p for p in (repo / '.git').rglob('*') if p.is_file()]
    assert all(not p.is_symlink() for p in paths)
    original = {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for p in paths:
            archive.write(p, p.relative_to(repo).as_posix())
    extraction = Path(tempfile.mkdtemp(prefix='ia2-submission-extracted-')).resolve()
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        archive.extractall(extraction)
        # Python's ZIP extractor does not restore executable mode bits. Preserve
        # the archived Git file modes before checking the extracted worktree.
        for info in archive.infolist():
            mode = (info.external_attr >> 16) & 0o777
            if mode:
                (extraction / info.filename).chmod(mode)
    extracted_total, _ = verify(extraction, expected)
    assert extracted_total == total
    for name, digest in original.items():
        assert hashlib.sha256((extraction / name).read_bytes()).hexdigest() == digest, name
    receipt = dict(archive=str(output), bytes=output.stat().st_size,
                   sha256=hashlib.sha256(output.read_bytes()).hexdigest(), expected_merge_commit=expected,
                   extracted_to=str(extraction), student_id='23127379', proposed_score=total,
                   real_self_contained_git=True, git_fsck='PASS', tags=PINS, verified_files=len(original),
                   required_files=required, all_file_hashes_match=True, zip_integrity='PASS',
                   migration_pairs=4, log_hashes_match=True, submission='NOT UPLOADED')
    receipt_path.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(receipt, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--expected-commit', required=True)
    args = parser.parse_args()
    package(args.repo, args.output, args.expected_commit)
