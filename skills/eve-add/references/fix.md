# Mode: fix — a recurring learner error → 2 fix-it cards + 1 produce card

Corrections from the learner's real writing (for example, `wrong → right, why`) are
real, recurring errors. They often slip out when the learner writes
fast. So each correction becomes **three cards around one rule**:

| # | Type | Trains | Front |
|---|---|---|---|
| 1 | fix-it | noticing | `✏️ Fix: <the learner's own sentence, containing ONLY this error>` |
| 2 | fix-it | noticing (the rule, not the card) | `✏️ Fix: <a NEW sentence, different context, same rule>` |
| 3 | produce | producing the right form | `<new sentence with ___>` + `<br>(PT: <the learner's PT cue>)` |

Two different wrong sentences stop the learner from memorizing *the card* instead of the *rule*; the
produce card prevents practice from consisting only of wrong forms.

## Input

- A correction, e.g. `/eve-add fix: I think I were better → I was`, or several.
- `fix` / "add the corrections" with no text → the latest clearly labeled correction block in recent
  assistant replies. If none exists, ask the user for the correction text.

## Card shape

All three: `{"kind": "fix", "rule": "<rule>", "front": "...", "back": "..."}`

**Back** (all three) = the corrected sentence with the fix in `<b>`, then a one-line rule, then an
optional `⚠` for calques:
```
I think I <b>was</b> better than that.<br>I / he / she / it → was · you / we / they → were
```
```
I need to clear my Anki <b>reviews</b> every morning.<br>Anki's due cards = reviews<br>⚠ calque of PT "pendências"
```

## Rules

1. **Exactly one error per fix-it front.** When reusing the learner's sentence, silently repair every other
   grammar, word-choice, collocation, reference and repetition problem first, so the card tests only this
   rule. Keep the learner's meaning and as much natural wording as possible.
2. **The back never repeats the wrong form** — correct sentence + rule only. The only exception is the
   PT source word inside `⚠` for calques.
3. **Card 2 and 3 must differ from card 1** in context *and* structure (different subject, tense or
   domain), otherwise they're the same card twice.
4. **The produce card's PT hint** must force the target form (e.g. `(PT: eu estava)` for was/were;
   `(PT: o que "calque" significa)` for embedded-question order).
5. **Rule slug** (kebab-case): before choosing, list the existing ones and **reuse** a match so
   recurrence counts stay true:
   Inspect the configured log directory's `error-log.tsv` and count its second column.
   Families: `calque-<pt-word>` (calque-pendencias, calque-cometer-erros), `prep-<case>`
   (prep-in-location), plain grammar names (was-were-agreement, embedded-question-order,
   either-vs-too, capitalize-languages). Report the rule's count after the push (count ÷ 3 = times it
   was carded).
6. **Don't card pure typos** (`god` for `got`) unless the user asks — only real, recurring errors.
7. **No hints on the front.** Fix-it fronts are plain text: no `<i>`, `<b>`, `<u>` or any other markup around the error. Marking where the mistake is gives away the answer; the learner must find it.

## Whole-sentence quality gate

Before writing the JSON, read every front and back as a complete sentence:

1. The fix-it front must be natural English except for the one deliberate target error.
2. The corrected back must be fully grammatical and idiomatic. The highlighted text marks the target
   fix; surrounding repairs stay unbolded.
3. Remove accidental repetition and incomplete references (`help someone who doesn't want help`,
   `let me know` with no recoverable object) when they make the standalone card awkward.
4. Preserve the learner's intended meaning. If that meaning is unclear, ask one short question instead
   of inventing a cleaner sentence.
5. Compare front and back once more before pushing. If the front contains a second teachable error,
   clean it first or create a separate correction event for that rule.
