# Vagueness Guard

Hybrid heuristic + LLM system to detect vague answers during participant interviews.

---

## Purpose

Prevent participants from giving vague, evasive, or non-concrete answers by automatically generating follow-up probes. Ensures interviews collect actual behavior data instead of opinions or hypotheticals.

---

## Architecture

```
User Answer → isLikelyVagueWithConfidence() →
  ├─ Confidently Concrete (HIGH) → No LLM, No Probe
  ├─ Confidently Vague (HIGH) → No LLM, Probe  
  └─ Ambiguous (LOW) → checkAnswerIsVague() (LLM) → Probe Decision
```

---

## Three-Category Logic

### Confidently Concrete (HIGH confidence)
- **Condition:** Has concreteness signals (numbers, dates, time expressions, currency, frequency, people counts)
- **Result:** `vague: false, confidence: 'high'`
- **Action:** No probe, continue conversation
- **Examples:** "3 times last month", "Last Tuesday", "15-01-2024"

### Confidently Vague (HIGH confidence)  
- **Condition:** Very short (<12 chars) + evasive pattern match
- **Result:** `vague: true, confidence: 'high'`
- **Action:** Generate probe immediately (no LLM call)
- **Examples:** "evet", "hayır", "bilmiyorum", "sanırım"

### Ambiguous (LOW confidence)
- **Condition:** Everything else
- **Result:** `vague: true, confidence: 'low'`
- **Action:** Send to isolated LLM check → Probe if vague
- **Examples:** "bilmiyorum sanırım", "genelde sorun yok", "açıkçası pek takip etmedim"

---

## Implementation

**Core file:** `lib/answer-vagueness-checker.ts`

**Key functions:**
- `isLikelyVagueWithConfidence()` — Three-category heuristic check
- `checkAnswerIsVague()` — Isolated LLM check with meaning-only evaluation
- `hasConcretenessSignals()` — Detects numbers, dates, time expressions
- `hasEvasivePattern()` — Typo-tolerant pattern matching
- `countRecentProbes()` — Enforces probe limit

**Supporting files:**
- `lib/constants.ts` — EVASIVE_PATTERNS, CONCRETENESS_PATTERNS
- `lib/typo-tolerant-match.ts` — Fuzzy matching for evasive phrases

---

## Integration Points

**PM Intake:** `/api/intake/[projectId]/route.ts`
- Uses same logic with `[Intake/vagueness]` log prefix

**Participant Interview:** `/api/interview/[interviewId]/route.ts`
- Uses same logic with `[Interview/vagueness]` log prefix

---

## Probe Limit

Max 2 probes per question (`MAX_PROBES_PER_QUESTION = 2`)

Prevents infinite probing and ensures conversation progress.

---

## LLM Prompt

The isolated LLM check uses a meaning-only evaluation prompt that explicitly instructs the model to ignore keywords and focus on semantic content:

```
CRITICAL: Evaluate based on MEANING ONLY. Do NOT look for specific keywords or predefined word lists.
```

---

## Logging Format

```
[Vagueness] answer=vague, confidence=high/low, source=intake/interview, reason=...
```

---

## Testing

**Unit tests:** `tests/unit/answer-vagueness-checker.test.ts`
- 25 tests covering all three categories
- Tests for typo-tolerant matching
- Tests for meaning-based phrases

**Calibration tests:** `tests/unit/vagueness-guard-calibration.test.ts`
- 19 real-world answer examples
- Flag rate: ~50% (9/18)
- 0 false positives, 0 false negatives

---

## Performance

**LLM call reduction:** High-confidence cases bypass LLM check
- Confidently concrete: No LLM call
- Confidently vague: No LLM call  
- Ambiguous: LLM call required

**Accuracy:** 100% on calibration test set (0 false positives/negatives)
