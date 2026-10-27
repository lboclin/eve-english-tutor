---
name: eve-add
description: "Add English flashcards to Eve (a self-hosted English voice tutor) through its local inbox webhook. Routes each item to one of five card designs: vocabulary word, collocation, phrasal verb, correction of a recurring English error, or pronunciation. Use when the user asks to add or save English learning material as cards."
---

# eve-add — word / collocation / phrasal verb / correction / pronunciation → Eve cards

The learner feeds English into Eve from several sources, and each needs a different card. This skill is a
**router**: it detects the mode, loads that mode's reference file, builds the cards and sends them to
Eve's inbox. One command handles every mode.

## 1. Detect the mode

`$ARGUMENTS` is free-form (may mix English and Portuguese). A prefix **forces** the mode:
`word:` · `col:` · `pv:` · `fix:` · `pron:`. Without a prefix, classify:

| Mode | Input looks like | Reference |
|---|---|---|
| **word** | a single unknown word + optional PT context (`auction — vi num vídeo de leilão`) | [references/word.md](references/word.md) |
| **collocation** | a combination of words that go together (`raise concerns about`, `make a mistake`), often from the book *English Collocations in Use: Advanced* (a unit number may be given) | [references/collocation.md](references/collocation.md) |
| **phrasal** | a verb + particle whose meaning isn't the sum of its parts (`pull off`, `put off`, `come up with`) | [references/phrasal.md](references/phrasal.md) |
| **fix** | a wrong → right correction of the user's own English (`I were → I was`), or a request like "add the corrections" / `fix` with no text | [references/fix.md](references/fix.md) |
| **pronunciation** | a sound or stress problem (`think` said as "tink", com-for-TA-ble) | [references/pronunciation.md](references/pronunciation.md) |

- `fix` with no correction text → use the latest clearly labeled English-correction block from recent
  assistant replies. If none exists, ask for the correction text.
- A batch may mix modes (e.g. two corrections + one word) — route each item separately.
- Genuinely unsure between word and collocation? A multi-word combination whose difficulty is *which
  words go together* → collocation; a single word whose difficulty is *its meaning* → word. Only ask
  if an item is truly ambiguous; never ask just to confirm the mode.
- **phrasal vs collocation**: verb + **particle** that changes the meaning (`put off` = postpone) →
  phrasal; verb + its normal partner words, meaning intact (`raise concerns about`) → collocation.

**Read the reference file of every mode present in the batch before composing cards.**

## 2. Compose the cards

Follow the reference file. Cards are HTML: join pieces with `<br>`, highlight with `<b>`, `<i>` sparingly
(Eve keeps only `<b> <i> <br>`). Write them to a JSON list in the session scratchpad
(e.g. `<scratchpad>/eve-cards.json`):

```json
[
  {"word": "auction", "back": "…"},
  {"kind": "collocation", "front": "…___…<br>(PT: …)", "back": "…"},
  {"kind": "phrasal", "pv": "pull-off", "front": "…<br>What does \"pull off\" mean here?", "back": "…"},
  {"kind": "fix", "rule": "was-were-agreement", "front": "✏️ Fix: …", "back": "…"},
  {"kind": "pronunciation", "rule": "pron-th-voiceless", "front": "🗣️ Say it out loud: …", "back": "…"}
]
```

`kind` defaults to `word` (`{"word", "back"}`: the word is the front). `fix` and `pronunciation` require a
kebab-case `rule`; `phrasal` requires a kebab-case `pv`. Optional `tags` adds extra tags
(e.g. `src::collocations-in-use-u12`). Event sizes: each fix event is exactly **3** consecutive cards
with the same `rule`; each phrasal sense **2** consecutive cards with the same `pv` (meet card first);
each pronunciation item **2** cards with the same `rule`. Reuse an existing rule when the same mistake
comes back, so Eve counts the recurrence. Eve shows the cards of one rule / pv on different days.

**Example-sentence rule.** Never reuse the learner's example sentence verbatim on a card. Write a new one that fits the sense, in the same domain when possible. Use the learner's sentence only if they explicitly ask to keep it.

## 3. Send

```bash
python3 <installed-skill-dir>/scripts/eve_add.py <scratchpad>/eve-cards.json
```

The script POSTs `{"cards": [...]}` to `http://127.0.0.1:8790/api/inbox/cards`. Eve validates every card
(same event rules as above), skips exact front/back duplicates and stores the rest in its database
(`source = claude`), which is now the only record — there are no log files. Add `--dry-run` to validate
and preview without saving.

(Eve's webhook also accepts `{"text": "fix: I were → I was\nword: auction"}` and writes the cards with
its own card engine — a paid model call. This skill composes the cards itself instead.)

## 4. Report

For each item: the **mode chosen** (so a wrong classification is visible), and the front/back of each
card so the user can inspect them. For fixes, phrasal verbs and pronunciation, report the event count
the script prints (`err::<rule>: event #N`). Surface duplicates and errors.

## Preconditions

- **Eve must be running** (`npm run dev` in Eve's repo). If the script says Eve
  isn't running, tell the user to start it (or start it yourself if you have the repo open).
