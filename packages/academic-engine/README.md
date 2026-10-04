# Academic Engine — M6

## Academic Calculation & Consistency Module

The **Academic Engine** implements **M6: Academic Calculation & Consistency** for the CertiScholar document verification and scholarship recommendation system.

It independently recalculates academic results from extracted subject-wise marks and compares them with the values printed on the academic document.

The module is implemented as a **pure business-logic package**, independent of the frontend, database, OCR service, and external APIs.

---

## Features

- Validate subject-wise academic marks.
- Calculate total obtained marks.
- Calculate total maximum marks.
- Calculate academic percentage.
- Compare calculated values with printed total and percentage.
- Detect inconsistencies in academic documents.
- Handle missing or invalid academic data.
- Return clear verification statuses.
- Provide reusable APIs for integration with other CertiScholar modules.

---

## Example

Given:

```text
Mathematics       85 / 100
Physics           78 / 100
Computer Science  82 / 100

Printed Total:       245
Printed Percentage:  85%
```

M6 calculates:

```text
Total Obtained = 245
Total Maximum = 300
Percentage = 81.67%
```

Since the printed percentage is `85%` while the calculated percentage is `81.67%`, the result is:

```text
INCONSISTENT
```

The original printed value is preserved and reported as an inconsistency rather than being silently changed.

---

## Architecture

```text
Extracted Academic Data
          |
          v
      Validation
          |
          v
      Calculation
          |
          v
  Consistency Checking
          |
          v
   Academic Result
```

M6 is intended to receive structured academic data from upstream modules such as M4/M5.

---

## Project Structure

```text
packages/academic-engine/
├── src/
│   ├── calculation.ts
│   ├── consistency.ts
│   ├── engine.ts
│   ├── index.ts
│   ├── types.ts
│   └── validation.ts
│
├── tests/
│   ├── calculation.test.ts
│   ├── consistency.test.ts
│   ├── engine.test.ts
│   └── validation.test.ts
│
├── INTEGRATION.md
├── README.md
├── package.json
└── tsconfig.json
```

---

## Data Model

### SubjectMark

```ts
interface SubjectMark {
  subject: string;
  obtained: number;
  maximum: number;
}
```

### AcademicRecord

```ts
interface AcademicRecord {
  subjects: SubjectMark[];
  printedTotal?: number;
  printedPercentage?: number;
}
```

---

## Validation

The engine validates:

- Empty subject lists.
- Negative obtained marks.
- Maximum marks less than or equal to zero.
- Obtained marks greater than maximum marks.

Invalid or incomplete academic data is routed to:

```text
NEEDS_REVIEW
```

The engine does not guess or silently correct invalid values.

---

## Calculation

The percentage is calculated using:

```text
Percentage = (Total Obtained / Total Maximum) × 100
```

The result is rounded to two decimal places.

Example:

```text
245 / 300 × 100 = 81.67%
```

---

## Consistency Checking

M6 compares:

```text
Calculated Total       ↔ Printed Total
Calculated Percentage  ↔ Printed Percentage
```

The comparison uses a default tolerance of `0.01`.

Possible results are:

| Status | Meaning |
|---|---|
| `CONSISTENT` | Printed values match calculated values |
| `INCONSISTENT` | One or more printed values do not match |
| `NEEDS_REVIEW` | Required or valid information is missing |

---

## Public API

The main entry point is:

```ts
import { runAcademicCheck } from "@repo/academic-engine";

const result = runAcademicCheck(record);
```

The engine internally performs validation, calculation, and consistency checking.

---

## Integration with CertiScholar

M6 fits into the larger pipeline as:

```text
M2 OCR
   ↓
M3 Classification
   ↓
M4 Field Extraction
   ↓
M5 Human Review
   ↓
M6 Academic Calculation & Consistency
   ↓
M8 Scholarship Rule Engine
   ↓
M9 Recommendation
```

M6 provides verified/calculated academic information that can be consumed by the scholarship rule engine.

---

## Testing

The module includes tests for:

- Academic calculations.
- Input validation.
- Total and percentage consistency.
- Missing printed values.
- Invalid academic data.
- Complete M6 workflow.

Run tests from the package directory:

```bash
bun run test
```

Run TypeScript checking:

```bash
bun run typecheck
```

Current test status:

```text
18 tests passed
0 tests failed
```

---

## Design Principles

- **Pure business logic** — no database or frontend dependency.
- **No silent corrections** — printed document values are preserved.
- **No guessing** — missing information results in `NEEDS_REVIEW`.
- **Separation of concerns** — validation, calculation, and consistency checking are independent.
- **Reusable module** — designed to be consumed by the CertiScholar application/API layer.

---

## Related Documentation

See [`INTEGRATION.md`](./INTEGRATION.md) for integration details and usage within the CertiScholar system.