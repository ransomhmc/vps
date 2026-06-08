#!/usr/bin/env python3
import json
import os
import sys
import urllib.request

WORKER_URL = os.environ.get('VPS_WORKER_URL', 'https://vps-api.selfcloud.workers.dev')


def _fail(msg):
    print(f'Error: {msg}', file=sys.stderr)
    sys.exit(1)


API_KEY = os.environ.get('VPS_WORKER_API_KEY')
if not API_KEY:
    _fail('VPS_WORKER_API_KEY 未設定。請透過 ./infisical-run.sh python3 query.py ... 執行')


def api_get(path):
    url = f'{WORKER_URL}{path}'
    req = urllib.request.Request(url, headers={'User-Agent': 'vps-script/1.0', 'X-API-Key': API_KEY})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


PREFERRED_KEYS = ['hostname', 'reachable', 'response_time_ms', 'username', 'source_ip', 'login_time', 'download_mbps', 'upload_mbps', 'latency_ms', 'tested_at', 'created_at']


def print_records(records, title=None):
    if not records:
        print('No data')
        return

    # Determine which keys to display (present in data, in preferred order)
    keys = [k for k in PREFERRED_KEYS if any(k in r for r in records)]
    widths = {}
    for k in keys:
        max_val = max(len(str(r.get(k, ''))) for r in records)
        widths[k] = max(len(k), min(max_val, 24)) + 2

    if title:
        print(title)

    header = ' '.join(f'{k:<{widths[k]}}' for k in keys)
    print(header)
    print('-' * len(header))

    for r in records:
        row = ' '.join(f'{str(r.get(k, "-")):<{widths[k]}}' for k in keys)
        print(row)


def cmd_latest(collection):
    data = api_get(f'/api/latest?collection={collection}')
    records = data.get('records', [])
    print_records(records, f'Latest records (collection: {collection}):')


def cmd_list(collection, limit=10):
    data = api_get(f'/api/list?collection={collection}&limit={limit}')
    records = data.get('records', [])
    print_records(records, f'Last {len(records)} records (collection: {collection}):')


def cmd_trend(hostname, limit=10):
    data = api_get(f'/api/list?collection=speed_test&limit={limit * 10}')
    records = [r for r in data.get('records', []) if r.get('hostname') == hostname]
    print_records(records, f'Trend for {hostname} (last {len(records)} records):')


def cmd_collections():
    data = api_get('/api/collections')
    collections = data.get('collections', [])
    if not collections:
        print('No collections')
        return
    print(f"{'Collection':<20} {'Records':<10}")
    print('-' * 30)
    for c in collections:
        print(f"{c['collection']:<20} {c['count']:<10}")


def cmd_export(collection, filename=None):
    data = api_get(f'/api/list?collection={collection}&limit=10000')
    records = data.get('records', [])

    if filename:
        with open(filename, 'w') as f:
            for r in records:
                f.write(json.dumps(r) + '\n')
        print(f'Exported {len(records)} records to {filename}')
    else:
        for r in records:
            print(json.dumps(r))


def print_usage():
    print('Usage:')
    print('  query.py collections')
    print('  query.py latest [collection]')
    print('  query.py list [collection] [limit]')
    print('  query.py trend <hostname> [limit]')
    print('  query.py export <collection> [filename]')
    print()
    print('Examples:')
    print('  query.py collections')
    print('  query.py latest')
    print('  query.py latest speed_test')
    print('  query.py list speed_test 20')
    print('  query.py trend ipcam-77 7')
    print('  query.py export speed_test data.jsonl')


def main():
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'latest':
        cmd_latest(sys.argv[2] if len(sys.argv) > 2 else 'speed_test')
    elif cmd == 'list':
        col = sys.argv[2] if len(sys.argv) > 2 else 'speed_test'
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 10
        cmd_list(col, limit)
    elif cmd == 'trend':
        if len(sys.argv) < 3:
            print('Error: hostname required\n', file=sys.stderr)
            print_usage()
            sys.exit(1)
        hostname = sys.argv[2]
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 10
        cmd_trend(hostname, limit)
    elif cmd == 'collections':
        cmd_collections()
    elif cmd == 'export':
        col = sys.argv[2] if len(sys.argv) > 2 else 'speed_test'
        filename = sys.argv[3] if len(sys.argv) > 3 else None
        cmd_export(col, filename)
    else:
        print(f'Unknown command: {cmd}')
        print_usage()
        sys.exit(1)


if __name__ == '__main__':
    main()
