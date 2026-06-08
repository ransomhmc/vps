#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

WORKER_URL = os.environ.get('VPS_WORKER_URL', 'https://vps-api.selfcloud.workers.dev')
API_KEY = os.environ.get('VPS_WORKER_API_KEY', '')
HOSTS = [f'ipcam-{i}' for i in range(74, 82)]
PORT = 2222


def check_host(host, port, timeout=1):
    start = time.time()
    try:
        result = subprocess.run(
            ['nc', '-z', '-w', str(timeout), host, str(port)],
            capture_output=True, timeout=timeout + 2,
        )
        elapsed = time.time() - start
        ms = round(elapsed * 1000) if result.returncode == 0 else -1
        return {'hostname': host, 'response_time_ms': ms, 'checked_at': datetime.now(timezone.utc).isoformat()}
    except subprocess.TimeoutExpired:
        return {'hostname': host, 'response_time_ms': -1, 'checked_at': datetime.now(timezone.utc).isoformat()}


def send_to_d1(records):
    url = f'{WORKER_URL}/api/batch'
    payload = {
        'collection': 'host_monitor',
        'records': [
            {'collection': 'host_monitor', 'data': r}
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
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            return result.get('inserted', 0)
    except Exception as e:
        print(f'  Error sending to D1: {e}', file=sys.stderr)
        return 0


def main():
    records = []

    for host in HOSTS:
        r = check_host(host, PORT)
        status = '✓' if r['response_time_ms'] >= 0 else '✗'
        print(f'  {host}:{PORT} {status} ({r["response_time_ms"]}ms)')
        records.append(r)

    inserted = send_to_d1(records)
    print(f'Stored {inserted} records in D1.')

    if inserted > 0:
        cleanup_d1('host_monitor', datetime.now(timezone.utc) - timedelta(hours=24))


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


if __name__ == '__main__':
    main()
