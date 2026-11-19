#!/usr/bin/env python3
"""Publish WEB850 session UX, preserving WEB846 as return; no import effects."""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import time
import urllib.parse

ROOT = Path('/var/lib/fom-issue-850-web-contracts')
STATE = Path('/opt/fom/state/prod')
RELEASE = Path('/var/www/fom-web/releases/issue-850-session-f38e025')
OLD_ROOT = Path('/var/www/fom-web/releases/issue-846-gps-review-eb29917')
RETAIN_ROOTS = (OLD_ROOT,)
SITE = Path('/etc/nginx/sites-available/fom-mobile.conf')
MOBILE = Path('/etc/nginx/fom-mobile-lifecycle-locations.conf')
SOURCE = 'f38e02548e25d2476eb155ad37b5ac047bd5cc01'
API_HEAD = 'b76a20c89c45541cd2fd599f4bbdaa77ecd976c1'
OLD_CONFIG = 'c4b25c2dc28e1ad46ee8f26b658ffd4505fa2f8a578466c02d50887f0cfcc964'
OLD_INDEX = '99ee4f409acef0eab583bc25bf142692e5a153b076fbe3fc703d87a94ce5624f'
MOBILE_SHA = '796e853c4fea379d2be037bc27ddb9fa3c87b68a277209f2d766bff30d4674b0'
TEST = 'e523de689e78878a1152fe45c3da6eda3801c9f87bc0992b3705d2978e8ace05'
ARCHIVE = ROOT/'session-f38e025.tar.gz'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(65536), b''):
            h.update(block)
    return h.hexdigest()


def file_gate(path, private=False, maximum=2*1024**3):
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and path.resolve() == path
            and not s.st_mode & 0o022 and 0 < s.st_size <= maximum, 'file_gate')
    if private:
        require(s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600, 'private_file_gate')
    return s


def write_private(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())


def relative(name):
    p = PurePosixPath(name)
    require(type(name) is str and name == str(p) and not p.is_absolute()
            and '..' not in p.parts and '\\' not in name and not any(x.startswith('.env') for x in p.parts),
            'artifact_path_gate')
    require(len(p.parts) >= 2 and p.parts[0] == 'dist', 'artifact_prefix_gate')
    return p.relative_to('dist')


def manifest_gate(value):
    require(set(value) == {'version', 'issue', 'source', 'files'} and value['version'] == 1
            and value['issue'] == 850 and value['source'] == SOURCE, 'manifest_identity')
    require(type(value['files']) is list and 1000 <= len(value['files']) <= 2000, 'manifest_count')
    names = set()
    for item in value['files']:
        require(set(item) == {'path', 'bytes', 'sha256'} and type(item['path']) is str, 'manifest_item')
        relative(item['path'])
        require(item['path'] not in names and type(item['bytes']) is int and 0 < item['bytes'] <= 256*1024**2
                and re.fullmatch('[a-f0-9]{64}', item['sha256']), 'manifest_file')
        names.add(item['path'])
    require('dist/fom-build-profile.json' in names and 'dist/index.html' in names and sum(i['bytes'] for i in value['files']) <= 2*1024**3, 'manifest_budget')


def archive_members(archive):
    indexed = {}
    total = 0
    for item in archive:
        require(len(indexed) < 2500, 'archive_count')
        total += item.size
        require(0 <= item.size <= 256*1024**2 and total <= 512*1024**2, 'archive_unpacked_budget')
        p = PurePosixPath(item.name)
        name = str(p)
        require(not p.is_absolute() and '..' not in p.parts and '\\' not in item.name
                and not item.issym() and not item.islnk() and (item.isfile() or item.isdir())
                and name not in indexed, 'archive_entry')
        require(name in ('.', 'manifest.json', 'dist') or name.startswith('dist/'), 'archive_scope')
        indexed[name] = item
    require('manifest.json' in indexed and indexed['manifest.json'].isfile()
            and indexed['manifest.json'].size <= 512000, 'manifest_archive_gate')
    return indexed


def config_delta(raw):
    require(hashlib.sha256(raw).hexdigest() == OLD_CONFIG, 'old_config_pin')
    old = ('root '+str(OLD_ROOT)+';').encode()
    require(raw.count(old) == 1, 'root_occurrences')
    return raw.replace(old, ('root '+str(RELEASE)+';').encode())


def index_readiness(fetch, expected, previous, pause=time.sleep):
    """One reload, bounded GET observations; never retry a mutation.

    Nginx reload returns before old workers stop answering. Only the exact old
    or new index may appear, and two complete consecutive new passes are needed.
    """
    routes = ('/panel/seleccionar-empresa', '/panel/admin/transferencias', '/entrar', '/panel/admin/funciones', '/panel/funciones', '/panel/admin/ciclo-datos', '/panel/mapa',
              '/panel/admin/gps', '/panel/admin/hardware/pruebas', '/panel/admin/hardware/perfiles',
              '/panel/admin/etiquetas', '/panel/etiquetas')
    stable, old_count = 0, 0
    for attempt in range(1, 21):
        observed = [hashlib.sha256(fetch(route)).hexdigest() for route in routes]
        require(all(value in (expected, previous) for value in observed), 'unexpected_served_index')
        old_count += observed.count(previous)
        stable = stable+1 if all(value == expected for value in observed) else 0
        if stable == 2:
            return {'indexReadinessAttempts': attempt, 'previousIndexResponses': old_count, 'stableIndexPasses': stable}
        if attempt < 20:
            pause(0.5)
    raise RuntimeError('served_index_never_stable')


def verify_files(manifest):
    for item in manifest['files']:
        path = RELEASE.joinpath(*relative(item['path']).parts)
        info = file_gate(path)
        require(info.st_size == item['bytes'] and sha(path) == item['sha256'], 'release_file_hash')
    profile = json.loads((RELEASE/'fom-build-profile.json').read_text())
    require(profile == {'version':1,'application':'fom-panel','mode':'connected','apiBase':'/fom-api','mapboxConfigured':True,'gpsReceiverConfigured':True,'gpsFlowVerified':True,'publicConfigSha256':'b1470891795093611bbca035faf86d5c84bb8e14ccc606e87b4c98d29a931ee8'}, 'connected_profile_gate')


def retained_source(item):
    require(type(item) is dict and set(item) == {'path', 'sha256', 'sourceRoot'}
            and item['sourceRoot'] in [str(root) for root in RETAIN_ROOTS]
            and type(item['path']) is str and re.fullmatch('[a-f0-9]{64}', item['sha256']), 'retained_source_scope')
    rel = relative('dist/'+item['path'])
    require(rel.parts[0] == 'assets', 'retained_assets_only')
    return Path(item['sourceRoot'])/rel


def validate_api_receipt(value):
    require(value.get('issue') == 846 and value.get('result') == 'PASS'
            and re.fullmatch(r'issue-846-publish-[0-9]{8}T[0-9]{6}Z', value.get('runId',''))
            and value.get('head') == API_HEAD and value.get('commandExecutionEnabled') is False
            and value.get('mfaRuntimeConfigVerified') is True and value.get('mfaKeyRetained') is True
            and value.get('compatibleReturnReady') is True
            and re.fullmatch(r'[a-f0-9]{64}',value.get('containerId',''))
            and re.fullmatch(r'sha256:[a-f0-9]{64}',value.get('imageId','')), 'api_scope')


def main():
    os.umask(0o077)
    require(os.geteuid() == 0 and os.environ.get('SUDO_USER') == 'fom-codex'
            and socket.gethostname().split('.')[0] == 'fom-app-01', 'host_caller_gate')
    require(len(sys.argv) >= 6, 'arguments_gate')
    mode, run, self_sha = sys.argv[1:4]
    require(mode in ('stage', 'activate'), 'mode_gate')
    match = re.fullmatch('issue-850-web-'+mode+r'-([0-9]{8}T[0-9]{6}Z)', run)
    require(match is not None, 'run_gate')
    issued = dt.datetime.strptime(match.group(1), '%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc)
    require(0 <= (dt.datetime.now(dt.timezone.utc)-issued).total_seconds() <= 120, 'start_window_gate')
    for directory in (ROOT, STATE):
        info = directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700
                and directory.resolve() == directory, 'directory_gate')
    require(Path(__file__).parent == ROOT, 'helper_path_gate')
    file_gate(Path(__file__), True, 40000)
    require(sha(Path(__file__)) == self_sha, 'helper_sha_gate')
    fd = os.open('/run/lock/fom-issue-850-web.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    require(os.fstat(fd).st_uid == 0 and os.fstat(fd).st_nlink == 1, 'lock_gate')
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    file_gate(SITE);file_gate(MOBILE)
    require(sha(SITE) == OLD_CONFIG and sha(MOBILE) == MOBILE_SHA and sha(OLD_ROOT/'index.html') == OLD_INDEX,
            'web_baseline_gate')
    work = STATE/run
    require(not work.exists() and not work.is_symlink(), 'run_exists_no_replay')
    work.mkdir(mode=0o700)
    deadline, restoring = time.monotonic()+900, False
    report = {'issue': 850, 'mode': mode, 'runId': run, 'helperSha256': self_sha, 'source': SOURCE,
              'result': 'FAIL', 'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'databaseWrites': False, 'apiRestart': False, 'firewallChanges': False,
              'physicalCertification': False, 'restoration': 'NOT_NEEDED'}
    def command(args):
        left = deadline-time.monotonic()
        require(left > (0 if restoring else 120), 'budget_gate')
        p = subprocess.run(args, env=ENV, stdin=subprocess.DEVNULL, capture_output=True, timeout=min(30, left))
        if p.returncode:
            with (work/'command.private.log').open('ab') as output:
                output.write(p.stderr)
            raise RuntimeError('command_unconfirmed_'+Path(args[0]).name)
        require(len(p.stdout) <= 8*1024**2, 'output_budget')
        return p.stdout
    def curl(path):
        return command(['curl', '--fail', '--silent', '--show-error', '--max-time', '10',
                        '--max-filesize', '8388608', '--header', 'Accept-Encoding: identity',
                        '--resolve', '15.204.105.201:443:10.20.30.10',
                        'https://15.204.105.201'+urllib.parse.quote(path, safe='/')])
    def status(path, method='GET'):
        return command(['curl', '--silent', '--show-error', '--max-time', '10', '--output', '/dev/null',
                        '--write-out', '%{http_code}', '--request', method,
                        *(['--header', 'Content-Type: application/json', '--data', '{}'] if method == 'POST' else []),
                        '--resolve', '15.204.105.201:443:10.20.30.10', 'https://15.204.105.201'+path]).decode()
    def atomic(raw):
        temporary = SITE.with_name('.fom-mobile.issue850-'+mode+'.tmp')
        write_private(temporary, raw)
        os.chmod(temporary, 0o644)
        os.replace(temporary, SITE)
    changed = False
    old = SITE.read_bytes()
    try:
        if mode == 'stage':
            require(len(sys.argv) == 6, 'stage_arguments')
            archive_sha, manifest_sha = sys.argv[4:]
            file_gate(ARCHIVE, True, 32*1024**2)
            require(sha(ARCHIVE) == archive_sha, 'archive_sha_gate')
            require(not RELEASE.exists() and not RELEASE.is_symlink(), 'release_exists_no_replay')
            with tarfile.open(ARCHIVE, 'r:gz') as archive:
                entries = archive_members(archive)
                raw = archive.extractfile(entries['manifest.json']).read(512001)
                require(hashlib.sha256(raw).hexdigest() == manifest_sha, 'manifest_sha_gate')
                manifest = json.loads(raw);manifest_gate(manifest)
                allowed = {i['path'] for i in manifest['files']}
                require(all(not item.isfile() or name == 'manifest.json' or name in allowed for name, item in entries.items()),
                        'archive_unlisted_file')
                require(shutil.disk_usage(RELEASE.parent).free >= 2*sum(i.size for i in entries.values())+128*1024**2, 'disk_gate')
                RELEASE.mkdir(mode=0o755);os.chmod(RELEASE, 0o755)
                reused, unpacked = 0, 0
                for item in manifest['files']:
                    rel = relative(item['path']);dest = RELEASE.joinpath(*rel.parts);prior = OLD_ROOT.joinpath(*rel.parts)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    for parent in (dest.parent, *dest.parent.parents):
                        if parent == RELEASE.parent:break
                        os.chmod(parent, 0o755)
                    if prior.exists():
                        info = file_gate(prior)
                        if info.st_size == item['bytes'] and sha(prior) == item['sha256']:
                            os.link(prior, dest);reused += 1;continue
                    member = entries.get(item['path'])
                    require(member is not None and member.isfile() and member.size == item['bytes'], 'missing_delta_file')
                    data = archive.extractfile(member).read(item['bytes']+1)
                    require(len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], 'delta_file_hash')
                    write_private(dest, data);os.chmod(dest, 0o644);unpacked += 1
            retained = []
            for source_root in RETAIN_ROOTS:
                for prior in (source_root/'assets').rglob('*'):
                    if prior.is_dir():
                        require(not prior.is_symlink(), 'retained_symlink');continue
                    file_gate(prior)
                    rel = prior.relative_to(source_root);dest = RELEASE/rel
                    if dest.exists():
                        file_gate(dest)
                        require(sha(dest) == sha(prior), 'retained_asset_collision')
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    for parent in (dest.parent, *dest.parent.parents):
                        if parent == RELEASE.parent:break
                        os.chmod(parent, 0o755)
                    os.link(prior, dest)
                    retained.append({'path': str(rel), 'sha256': sha(prior), 'sourceRoot': str(source_root)})
            verify_files(manifest)
            require(sha(SITE) == OLD_CONFIG and sha(MOBILE) == MOBILE_SHA, 'stage_runtime_changed')
            write_private(work/'manifest.json', raw)
            write_private(work/'retained.json', json.dumps(retained).encode())
            report.update(result='PASS', archiveSha256=archive_sha, manifestSha256=manifest_sha,
                          release=str(RELEASE), filesVerified=len(manifest['files']), reusedFiles=reused,
                          unpackedFiles=unpacked, retainedAssets=len(retained), indexSha256=sha(RELEASE/'index.html'),
                          retainedManifestSha256=sha(work/'retained.json'),
                          targetConfigSha256=hashlib.sha256(config_delta(old)).hexdigest(), runtimeUnchanged=True)
        else:
            require(len(sys.argv) == 8, 'activate_arguments')
            stage_run, stage_sha, app_run, app_sha = sys.argv[4:]
            require(re.fullmatch(r'issue-850-web-stage-[0-9]{8}T[0-9]{6}Z', stage_run)
                    and re.fullmatch(r'issue-846-publish-[0-9]{8}T[0-9]{6}Z',app_run) and re.fullmatch(r'[a-f0-9]{64}',app_sha), 'references_gate')
            def receipt(reference, expected):
                path = STATE/reference/'receipt.json';file_gate(path, True, 30000)
                require(sha(path) == expected, 'receipt_pin')
                value = json.loads(path.read_text())
                require(value['issue'] == (846 if reference == app_run else 850)
                        and value['runId'] == reference and value['result'] == 'PASS', 'receipt_result')
                # The previous API contract is consumed, never replayed. Its exact receipt
                # is a baseline; the unchanged live container/image/health is checked below.
                age = (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(value['finishedAt'])).total_seconds()
                require(age >= 0 and (reference == app_run or age <= 21600), 'receipt_age')
                return value
            staged, app = receipt(stage_run, stage_sha), receipt(app_run, app_sha)
            require(staged['mode'] == 'stage' and staged['source'] == SOURCE and staged['release'] == str(RELEASE)
                    and staged['runtimeUnchanged'] is True, 'stage_scope')
            validate_api_receipt(app)
            def api_gate():
                projection='{"Id":{{json .Id}},"Image":{{json .Image}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"State":{"Health":{"Status":{{json .State.Health.Status}}}},"RestartCount":{{.RestartCount}}}'
                api, test = [json.loads(line) for line in command(['docker','inspect','--format',projection,'fom-core-api','fom-test-api']).splitlines()]
                require(api['Id'] == app['containerId'] and api['Image'] == app['imageId']
                        and api['revision'] == API_HEAD
                        and test['Id'] == TEST, 'api_identity')
                require(all(i['State']['Health']['Status'] == 'healthy' and i['RestartCount'] == 0 for i in (api, test)), 'runtime_health')
            api_gate()
            path = STATE/stage_run/'manifest.json';file_gate(path, True, 512000)
            require(sha(path) == staged['manifestSha256'], 'staged_manifest_pin')
            manifest = json.loads(path.read_text());manifest_gate(manifest);verify_files(manifest)
            path = STATE/stage_run/'retained.json';file_gate(path, True, 2*1024**2)
            require(sha(path) == staged['retainedManifestSha256'], 'retained_manifest_pin')
            retained = json.loads(path.read_text())
            require(len(retained) == staged['retainedAssets'], 'retained_count')
            for item in retained:
                rel = relative('dist/'+item['path']);a, b = RELEASE/rel, retained_source(item)
                sa, sb = file_gate(a), file_gate(b)
                require(sa.st_ino == sb.st_ino and sha(a) == item['sha256'], 'retained_hash')
            candidate = config_delta(old)
            require(hashlib.sha256(candidate).hexdigest() == staged['targetConfigSha256'], 'target_config_gate')
            write_private(work/'nginx.before.conf', old)
            write_private(work/'mobile.before.conf', MOBILE.read_bytes())
            require(sha(SITE) == OLD_CONFIG and sha(MOBILE) == MOBILE_SHA, 'locked_baseline_changed')
            atomic(candidate);changed = True
            command(['nginx', '-t']);command(['systemctl', 'reload', 'nginx'])
            report['phase'] = 'index_readiness'
            report.update(index_readiness(curl, staged['indexSha256'], OLD_INDEX))
            assets = [i for i in manifest['files'] if i['path'].startswith('dist/assets/')
                      and PurePosixPath(i['path']).suffix in ('.js', '.css')]
            for item in assets:
                raw = curl('/'+str(relative(item['path'])))
                require(len(raw) == item['bytes'] and hashlib.sha256(raw).hexdigest() == item['sha256'], 'served_asset_gate')
            for path, method, expected in (
                ('/fom-api/api/v1/console/gps-managed-catalog', 'GET', '401'),
                ('/fom-api/api/v1/console/gps-managed-catalog', 'POST', '401'),
                ('/fom-api/api/v1/console/gps-installations/00000000-0000-4000-8000-000000000792/commands', 'GET', '401'),
                ('/fom-api/api/v1/console/command-mfa', 'GET', '401'),
                ('/fom-api/api/v1/console/command-mfa/enrollment', 'POST', '401'),
                ('/fom-api/api/v1/console/lifecycle/global', 'GET', '401'),
                ('/api/v1/mobile/lifecycle/global', 'GET', '401'),
                ('/api/v1/mobile/lifecycle/unknown-route', 'GET', '404'),
                ('/fom-api/api/v1/console/vehicle-transfers', 'GET', '401'),
                ('/fom-api/api/v1/console/vehicle-transfers', 'POST', '401'),
                ('/gps-console-internal', 'GET', '404')):
                require(status(path, method) == expected, 'anonymous_guard_gate')
            require(sha(MOBILE) == MOBILE_SHA and sha(SITE) == staged['targetConfigSha256'], 'published_config_gate')
            api_gate()
            report.update(result='PASS', stageRunId=stage_run, appRunId=app_run, indexSha256=staged['indexSha256'],
                          configSha256=sha(SITE), fragmentUnchanged=True, filesVerified=len(manifest['files']),
                          assetsVerifiedHttps=len(assets), retainedAssets=len(retained), independentHttpReadback=True)
    except Exception as error:
        report['failureCode'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        if changed:
            restoring = True
            try:
                require(sha(SITE) == staged['targetConfigSha256'], 'return_target_changed')
                atomic(old);command(['nginx', '-t']);command(['systemctl', 'reload', 'nginx'])
                report['returnIndexReadiness'] = index_readiness(curl, OLD_INDEX, staged['indexSha256'])
                require(sha(SITE) == OLD_CONFIG and sha(MOBILE) == MOBILE_SHA
                        and hashlib.sha256(curl('/panel/admin/ciclo-datos')).hexdigest() == OLD_INDEX, 'return_readback')
                report['restoration'] = 'PASS_OLD_WEB'
            except Exception:
                report['restoration'] = 'UNKNOWN_STOP_NO_RETRY'
    finally:
        report['finishedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        write_private(work/'receipt.json', (json.dumps(report, indent=2)+'\n').encode())
        print(json.dumps(report))
    return 0 if report['result'] == 'PASS' else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'issue': 850, 'result': 'FAIL', 'failureCode': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        sys.exit(1)
