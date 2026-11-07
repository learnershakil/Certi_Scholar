# Performance report

Generated 2026-11-07T12:46:56.095Z by `scripts/load-test.mjs` against http://localhost:4000.

| Setting | Value |
|---|---|
| Documents | 6 (from 8 sample files in `.\samples\documents`) |
| Concurrency | 3 uploads at a time |
| Wall-clock time | 5.9 s |

## Results

| Check | Result | Measured |
|---|---|---|
| Each document processed within 60 s (p95) | Pass | 3.1 s |
| Throughput at least 500 documents/hour | Pass | 3674/hour |
| No document failed or timed out | Pass | 0 failed |

| Upload to settled | p50 | p95 | max |
|---|---|---|---|
| End to end | 2.7 s | 3.1 s | 3.1 s |
| ocr stage | 1.1 s | 1.3 s | 1.3 s |
| classify stage | 0.0 s | 0.0 s | 0.0 s |
| extract stage | 0.0 s | 0.0 s | 0.0 s |
| consistency stage | 0.0 s | 0.0 s | 0.0 s |

Throughput: **3674 documents/hour** (6 settled in 5.9 s).

"Settled" means the document finished processing: `processed`, or `needs_review` when a field or a profile
detail needs an officer. Times include the malware scan, encrypted storage, OCR, classification, extraction,
consistency checks and the profile match.
