#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

WORKER_URL = os.environ.get('VPS_WORKER_URL', 'https://vps-api.selfcloud.workers.dev')
API_KEY = os.environ.get('VPS_WORKER_API_KEY', '')
SPEED_CMD = os.environ.get('SPEED_CMD', '')
HOSTS = [f'ipcam-{i}' for i in range(74, 82)]
SSH_OPTS = [
    '-p', '2222',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
]
DAYNAMES = {'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'}
IP_RE = re.compile(r'^\d+\.\d+\.\d+\.\d+$')
USER_RE = re.compile(r'^[a-zA-Z0-9][-a-zA-Z0-9._]*$')
SKIP_USERS = {'mesh', 'reboot', 'wtmp', 'shutdown', 'halt', 'guest'}
SKIP_NETS = ('100.',)

DEMO_DATA = """
1. ipcam-77 — 6.42 MiB/s
2. ipcam-76 — 5.11 MiB/s
3. ipcam-75 — 4.41 MiB/s
4. ipcam-79 — 3.29 MiB/s
5. ipcam-74 — 3.10 MiB/s
6. ipcam-80 — 3.00 MiB/s
7. ipcam-78 — 2.60 MiB/s
8. ipcam-81 — 1.93 MiB/s
"""


def parse_speed_output(text):
    records = []
    for line in text.strip().split('\n'):
        m = re.match(r'^\d+\.\s+(ipcam-\d+)\s+[—\-–]\s+([\d.]+)\s+MiB/s', line)
        if m:
            records.append({
                'hostname': m.group(1),
                'download_mbps': float(m.group(2)),
            })
    return records


def ssh_run(host, cmd):
    try:
        result = subprocess.run(
            ['ssh', *SSH_OPTS, f'mesh@{host}', cmd],
            capture_output=True, text=True, timeout=60,
        )
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return '', 'timeout', -1
    except FileNotFoundError:
        print('Error: ssh not found', file=sys.stderr)
        sys.exit(1)


def parse_last_output(text, host, cutoff):
    records = []
    now = datetime.now()

    for line in text.strip().split('\n'):
        line = line.strip()
        if not line:
            continue

        parts = line.split()
        if len(parts) < 7:
            continue

        username = parts[0]
        if username in SKIP_USERS or not USER_RE.match(username):
            continue

        source_ip = ''
        date_fields = []

        if parts[2] in DAYNAMES:
            source_ip = 'local'
            date_fields = parts[2:7]
        elif IP_RE.match(parts[2]) or ':' in parts[2]:
            source_ip = parts[2]
            date_fields = parts[3:8]
        else:
            continue

        if len(date_fields) < 5:
            continue

        try:
            login_time = datetime.strptime(' '.join(date_fields), '%a %b %d %H:%M:%S %Y')
        except ValueError:
            continue

        if login_time < cutoff or login_time > now + timedelta(days=1):
            continue

        if source_ip.startswith(SKIP_NETS):
            continue

        records.append({
            'hostname': host,
            'username': username,
            'source_ip': source_ip,
            'login_time': login_time.isoformat(),
        })

    return records


def send_batch(collection, records):
    if not records:
        return 0

    url = f'{WORKER_URL}/api/batch'
    payload = {
        'collection': collection,
        'records': [
            {'collection': collection, 'data': r}
            for r in records
        ],
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            'Content-Type': 'application/json',
            'User-Agent': 'vps-script/1.0',
            'X-API-Key': API_KEY,
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return result.get('inserted', 0)
    except Exception as e:
        print(f'  Error: {e}', file=sys.stderr)
        return 0


def cleanup_d1(collection, cutoff):
    url = f'{WORKER_URL}/api/cleanup'
    payload = {'collection': collection, 'cutoff': cutoff.isoformat()}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'X-API-Key': API_KEY, 'User-Agent': 'vps-script/1.0'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            print(f'Cleaned up {result.get("deleted", 0)} old {collection} records.')
    except Exception as e:
        print(f'  Cleanup error: {e}', file=sys.stderr)


def main():
    if not API_KEY:
        print('Error: VPS_WORKER_API_KEY not set', file=sys.stderr)
        sys.exit(1)

    tested_at = datetime.now(timezone.utc).isoformat()

    # ── Speed test ──
    if SPEED_CMD:
        result = subprocess.run(SPEED_CMD, shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            print(f'Error: speed test failed:\n{result.stderr}', file=sys.stderr)
            sys.exit(1)
        raw = result.stdout
    else:
        print('Demo mode (SPEED_CMD not set, using demo data)')
        raw = DEMO_DATA

    speed_records = parse_speed_output(raw)
    if not speed_records:
        print('Error: no speed records parsed', file=sys.stderr)
        print(f'Raw output:\n{raw}', file=sys.stderr)
        sys.exit(1)

    print(f'Speed test — {len(speed_records)} host(s):')
    for r in speed_records:
        print(f'  {r["hostname"]}: {r["download_mbps"]} MiB/s')

    inserted = send_batch('speed_test', [
        {**r, 'tested_at': tested_at} for r in speed_records
    ])
    print(f'  → {inserted} records stored')

    if inserted > 0:
        cleanup_d1('speed_test', datetime.now(timezone.utc) - timedelta(days=7))

    # ── Login check (past 7 days, exclude 100.x) ──
    print(f'Login check — scanning {len(HOSTS)} host(s) (not 100.x, past 7 days) ...')
    cutoff = datetime.now() - timedelta(days=7)
    total_login = 0

    for host in HOSTS:
        print(f'  {host} ...', end=' ', flush=True)
        cmd = 'last -i -F -s "-7 days" 2>/dev/null || last -i -F -n 10000 2>/dev/null || echo "FAIL"'
        stdout, stderr, rc = ssh_run(host, cmd)
        if rc != 0 or 'FAIL' in stdout or not stdout.strip():
            print('no data')
            continue

        login_records = parse_last_output(stdout, host, cutoff)
        if not login_records:
            print('none')
            continue

        n = send_batch('login_record', login_records)
        print(f'{len(login_records)} found, {n} stored')
        total_login += n

    print(f'Done. Total login records stored: {total_login}')


if __name__ == '__main__':
    main()
