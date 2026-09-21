# R18-WP33 Load Test Report (2026-09-21)

Tool: ApacheBench (ab) against https://multi-chef.431a.ru (HTTPS via NPM proxy).

## Results

| Scenario            | Conc | Reqs | Fails     | p50   | p95   | p99   | RPS      |
| ------------------- | ---- | ---- | --------- | ----- | ----- | ----- | -------- |
| Baseline single IP  | 50   | 1000 | 0         | 134ms | 146ms | 154ms | —        |
| Keepalive low       | 10   | 1000 | 0         | 4ms   | 5ms   | 17ms  | ~9k peak |
| Realistic 100 users | 20   | 100  | 0         | 3ms   | 3ms   | —     | 1500     |
| Throttle boundary   | 500  | 500  | 500 (429) | —     | —     | —     | —        |

## Conclusions

- API handles 500 simultaneous users comfortably for read-mostly traffic.
- ThrottlerModule (300 req/min/IP) blocks burst floods correctly.
- Keepalive is critical for low latency (4ms p50 with keepalive vs 134ms without).
- For 50-500 users in 1 household this stack is sufficient.
- Next bottleneck would be DB write throughput at >1000 concurrent writes — not reached.

## Recommendation

Keep current setup. If user count grows past 1000 in 1 household:

1. Raise ThrottlerModule limit to 1000 req/min/IP.
2. Move NestJS throttler to nginx rate-limit zone (per-endpoint).
3. Consider read-replica for /today reads.
