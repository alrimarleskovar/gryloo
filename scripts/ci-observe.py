#!/usr/bin/env python3
"""CI stage timings and system counters, without commands, environment or secrets."""

import argparse
import json
import os
from pathlib import Path
import time
import uuid


def resources():
    memory = {line.split(':')[0]: int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()}
    cpu = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    vm = {key: int(value) for key, value in (line.split() for line in Path('/proc/vmstat').read_text().splitlines())}
    return {'available_kib': memory['MemAvailable'], 'total_kib': memory['MemTotal'],
            'swap_used_kib': memory['SwapTotal'] - memory['SwapFree'],
            'cpu_total': sum(cpu), 'cpu_idle': cpu[3], 'cpu_iowait': cpu[4],
            'swap_in': vm['pswpin'], 'swap_out': vm['pswpout'],
            'io_in_kib': vm['pgpgin'], 'io_out_kib': vm['pgpgout']}


def root():
    path = Path(os.environ['RUNNER_TEMP']) / 'flofi-ci-metrics'
    path.mkdir(exist_ok=True)
    return path


def begin(name):
    identity = uuid.uuid4().hex
    record = {'name': name, 'start': time.monotonic(), 'before': resources(), 'outcome': 'incomplete'}
    (root() / (identity + '.json')).write_text(json.dumps(record))
    return identity


def finish(identity, status):
    if len(identity) != 32 or any(c not in '0123456789abcdef' for c in identity):
        raise ValueError('Invalid stage identity')
    path = root() / (identity + '.json')
    record = json.loads(path.read_text())
    record.update(duration=time.monotonic() - record['start'], after=resources(),
                  outcome='success' if status == 0 else ('cancelled/interrupted' if status in {130, 143} else 'failure'),
                  exit_code=status)
    path.write_text(json.dumps(record))
    print(f"CI stage: {record['name']}: {record['outcome']} ({record['duration']:.2f}s)", flush=True)


def summary():
    records = sorted((json.loads(path.read_text()) for path in root().glob('*.json')), key=lambda row: row['start'])
    lines = ['### CI stage timings', '', '| Stage | Seconds | Outcome | System CPU busy / I/O wait |',
             '| --- | ---: | --- | --- |']
    for row in records:
        duration = f"{row['duration']:.2f}" if 'duration' in row else 'NOT COMPLETED'
        cpu = 'NOT MEASURED'
        if 'after' in row:
            before, after = row['before'], row['after']
            ticks = after['cpu_total'] - before['cpu_total']
            if ticks > 0:
                idle = after['cpu_idle'] - before['cpu_idle']
                wait = after['cpu_iowait'] - before['cpu_iowait']
                cpu = f'{100 * (ticks - idle - wait) / ticks:.1f}% / {100 * wait / ticks:.1f}%'
        # Stage labels are repository constants; never include command arguments or env.
        label = row['name'].replace('|', '/').replace('\n', ' ')
        lines.append(f"| {label} | {duration} | {row['outcome']} | {cpu} |")
    if records:
        elapsed = time.monotonic() - records[0]['start']
        completed = [row for row in records if 'duration' in row]
        lines += ['', f'Observed elapsed after checkout: {elapsed:.2f}s. Job initialization, checkout, queue time and post-job cleanup are in native Actions timings.',
                  f"Raw archive Actions cache exact hit: {os.environ.get('FLOFI_ARCHIVE_CACHE_HIT', 'NOT MEASURED') or 'false'}; actual archive HIT/DOWNLOAD/REJECTED results are in bootstrap logs."]
        if completed:
            slowest = max(completed, key=lambda row: row['duration'])
            snapshots = [row[point] for row in completed for point in ('before', 'after')]
            lines += [f"Slowest completed stage: {slowest['name']} ({slowest['duration']:.2f}s).",
                      f"Endpoint resource observations: minimum available RAM {min(s['available_kib'] for s in snapshots) / 1048576:.2f} GiB; maximum swap used {max(s['swap_used_kib'] for s in snapshots) / 1048576:.2f} GiB.",
                      f"System swap pages in/out during stages: {sum(row['after']['swap_in'] - row['before']['swap_in'] for row in completed)}/{sum(row['after']['swap_out'] - row['before']['swap_out'] for row in completed)}.",
                      f"System disk input/output during stages: {sum(row['after']['io_in_kib'] - row['before']['io_in_kib'] for row in completed) / 1024:.1f}/{sum(row['after']['io_out_kib'] - row['before']['io_out_kib'] for row in completed) / 1024:.1f} MiB.",
                      'Counters include other activity on this shared machine. Endpoint snapshots do not measure peak process RAM. Incomplete/cancelled stages are never successes.']
    content = '\n'.join(lines) + '\n'
    print(content)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(content)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['begin', 'finish', 'summary'])
    parser.add_argument('value', nargs='?')
    parser.add_argument('status', nargs='?', type=int)
    args = parser.parse_args()
    if args.operation == 'begin':
        print(begin(args.value))
    elif args.operation == 'finish':
        finish(args.value, args.status)
    else:
        summary()
