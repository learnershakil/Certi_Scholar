# What CertiScholar does and does not establish about a document

*For scholarship committees and student services staff.*

## In one sentence

CertiScholar reads documents, checks that they agree with themselves, and applies your scholarship rules to what it read. **It cannot tell whether a document is genuine.** Only the organisation that issued the document can confirm that.

## What the system does

| Step | What it tells you | What it does not tell you |
|---|---|---|
| **Security scan** | The file contained no known malware. | Anything about the content. |
| **Reading (OCR)** | The text the software recognised, with a confidence score per value. | That the reading is correct. Values below the confidence threshold are always sent to an officer; the system never guesses. |
| **Classification** | Which kind of document it appears to be. | That it is a real document of that kind. |
| **Consistency checks** | Whether the document agrees with itself: the subject marks add up to the printed total, the printed percentage matches the marks, the ID number's check digit is valid, the income certificate is recent. | Whether it is genuine. A forged document can be perfectly consistent. A failed check usually means a misreading or a typing error on the document. Sometimes it means tampering, but the system cannot tell which. |
| **Officer review** | An officer has compared the values with the document image and corrected or confirmed them. Every change is recorded with the officer's name and reason. | Authenticity. The officer is checking the reading, not the source. |
| **Verification** | Only here is authenticity addressed. See below. | — |
| **Recommendation** | Which scholarship conditions are met, not met, or undetermined, and which value each decision used. | A decision. The scholarship officer decides. |

## Verification states

| Shown as | Meaning | Counts as authentic? |
|---|---|---|
| **Confirmed by the issuing authority** | An authorised source (university records, examination board, a DigiLocker gateway) responded and the details matched. | Yes |
| **Confirmed by an officer with the issuing authority** | An officer contacted the issuer directly and recorded who confirmed it and the reference. | Yes |
| **Authority reported a mismatch / no record** | The issuer responded and did not confirm the document. | No |
| **SIMULATED** | A demonstration provider was used. It is labelled everywhere and cannot be enabled in production. | **Never** |
| **Not verified** | Only reading and consistency checks were done. | No |

A recommendation states, for every attached document, which of these applies. A scholarship rule can require that authenticity is established (the Merit-cum-Means rule does).

## What we deliberately do not do

We do not use AI "fraud detection" to judge authenticity. Pattern-based models can flag an unusual image for an officer to look at first, but they cannot confirm or reject a document. Treating them as if they could would be unfair to applicants and would give the committee false assurance.

## Your safeguards

- Every value used in a decision can be traced to the region of the document it came from.
- Every correction, verification and decision is in the audit log with who, when and why.
- Every view of a document is logged separately.
- Documents and extracted personal data are deleted after the retention period. The audit trail of what was decided is kept.
