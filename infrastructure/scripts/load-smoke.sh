#!/usr/bin/env bash
# R17-WP24 — quick load smoke.
#
# Spawns N concurrent workers (default 5) that each fire M GET
# requests (default 10) to the same endpoint, measures p50/p95
# latency and 5xx error rate. Total = N*M should stay below the
# api ThrottlerModule limit (300/min per IP) — set N*M <= 250 for
# a clean smoke.
#
# No wrk/ab dependency — just bash + curl, available everywhere.

set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8080}"
WORKERS="${WORKERS:-5}"
REQS="${REQS:-10}"
PATH_="${PATH_:-/api/v1/health/live}"
LABEL="${LABEL:-load-smoke}"

# Cap concurrency to avoid NestJS ThrottlerModule (300 req/min/IP).
MAX_TOTAL=250
if [ $((WORKERS * REQS)) -gt "$MAX_TOTAL" ]; then
  echo "[$LABEL] ERROR: WORKERS*REQS=$((WORKERS * REQS)) exceeds throttler cap ($MAX_TOTAL/min)" >&2
  exit 2
fi

OUT="/tmp/${LABEL}-results.txt"
: > "$OUT"

start=$(date +%s)
for w in $(seq 1 "$WORKERS"); do
  (
    for r in $(seq 1 "$REQS"); do
      t0=$(date +%s%N)
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${BASE}${PATH_}" || echo 000)
      t1=$(date +%s%N)
      ms=$(( (t1 - t0) / 1000000 ))
      printf '%s %s\n' "$ms" "$code" >> "$OUT"
    done
  ) &
done
wait
elapsed=$(( $(date +%s) - start ))

total=$(wc -l < "$OUT")
ok=$(awk '$2==200' "$OUT" | wc -l)
err=$(awk '$2!=200' "$OUT" | wc -l)
err5xx=$(awk '$2>=500 && $2<600' "$OUT" | wc -l)

# Percentiles from latency column.
sort -n "$OUT" -o "$OUT"
p50=$(awk -v n="$total" 'NR==int(n*0.50)' "$OUT" | awk '{print $1}')
p95=$(awk -v n="$total" 'NR==int(n*0.95)' "$OUT" | awk '{print $1}')
p99=$(awk -v n="$total" 'NR==int(n*0.99)' "$OUT" | awk '{print $1}')

cat <<EOF
[$LABEL] $WORKERS workers × $REQS reqs = $total total in ${elapsed}s
  ok=$ok err=$err 5xx=$err5xx
  p50=${p50}ms p95=${p95}ms p99=${p99}ms
  throughput=$(( total / (elapsed > 0 ? elapsed : 1) )) req/s
EOF
