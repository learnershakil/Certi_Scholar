# Extraction accuracy benchmark

Generated 2026-11-04T03:57:32.356Z against samples\labels.json

- Documents: 8 · classification accuracy: 100.0%
- Field-level accuracy: **100.0%** (54/54) — acceptance target ≥ 90% on standard marksheets
- Wrong values that were NOT routed to review (silent errors): **0**
- Consistency checks matching labels: 8/8

| Field | Correct | Total | Accuracy | Wrong but flagged for review |
|---|---:|---:|---:|---:|
| marksheet.student_name | 2 | 2 | 100.0% | 0/0 |
| marksheet.roll_number | 2 | 2 | 100.0% | 0/0 |
| marksheet.board | 2 | 2 | 100.0% | 0/0 |
| marksheet.exam_year | 2 | 2 | 100.0% | 0/0 |
| marksheet.total_obtained | 4 | 4 | 100.0% | 0/0 |
| marksheet.total_max | 2 | 2 | 100.0% | 0/0 |
| marksheet.percentage | 4 | 4 | 100.0% | 0/0 |
| marksheet.subjects.*.name | 10 | 10 | 100.0% | 0/0 |
| marksheet.subjects.*.obtained | 10 | 10 | 100.0% | 0/0 |
| income_certificate.certificate_number | 2 | 2 | 100.0% | 0/0 |
| income_certificate.holder_name | 2 | 2 | 100.0% | 0/0 |
| income_certificate.annual_income | 2 | 2 | 100.0% | 0/0 |
| income_certificate.issue_date | 2 | 2 | 100.0% | 0/0 |
| income_certificate.issuing_authority | 2 | 2 | 100.0% | 0/0 |
| identity.full_name | 2 | 2 | 100.0% | 0/0 |
| identity.date_of_birth | 2 | 2 | 100.0% | 0/0 |
| identity.id_number | 2 | 2 | 100.0% | 0/0 |

## Mismatches

| File | Field | Expected | Extracted | Confidence | Status |
|---|---|---|---|---:|---|
