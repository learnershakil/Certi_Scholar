# M6 Integration Guide

This document describes how the Academic Engine can be integrated with the other CertiScholar modules.

## Module Boundary

M6 owns:

- Academic mark validation.
- Academic total calculation.
- Maximum-mark calculation.
- Percentage calculation.
- Comparison with printed academic values.
- Consistency status.
- Academic calculation issues.

M6 does not own:

- OCR.
- Document classification.
- Human correction UI.
- Scholarship eligibility rules.
- Scholarship recommendations.
- Persistent storage.

## Data Flow

The intended academic processing flow is:

```text
Document
   |
   v
M2 OCR
   |
   v
M3 Classification
   |
   v
M4 Field Extraction
   |
   v
M5 Human Review / Correction
   |
   v
M6 Academic Calculation & Consistency
   |
   v
M8 Scholarship Rule Engine