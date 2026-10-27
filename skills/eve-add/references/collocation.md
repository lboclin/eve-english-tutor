# Mode: collocation — words that go together → 1 produce card

A **collocation** is a combination native speakers use naturally (`make a mistake`, `raise concerns
about`, `depend on`). A Portuguese-speaking learner's collocation errors often come from **calques** — translating Portuguese word by
word ("cometer erros" → ~~commit mistakes~~). The card trains the exact moment the error is born:
**Portuguese idea in → natural English combination out.** The learner must *produce* it, not recognize it.

## Input

- the collocation(s), optionally with a source (book unit, video, paper) or PT context.
- `/eve-add col: raise concerns about` · `/eve-add make a decision, reach a decision — unit 12`

## Card shape

JSON: `{"kind": "collocation", "front": "...", "back": "...", "tags": [...]}`

**Front** = a natural sentence with `___` where the collocation goes, then the PT hint:
```
She ___ concerns about the budget in the meeting.<br>(PT: levantou preocupações)
```
**Back** = the full sentence with the collocation in bold, the pattern, and optionally the calque:
```
She <b>raised concerns about</b> the budget in the meeting.<br>raise concerns about sth<br>⚠ PT "levantar preocupações" → raise, not "lift" / "put"
```

## Rules

1. **The PT hint is mandatory.** Write it the way the learner would *think* it
   in Portuguese — natural PT, not a gloss. It must make the answer **unambiguous**: without it,
   "She ___ concerns" accepts raised / expressed / voiced / had.
2. **Gap = the part a calque would get wrong** — usually the verb (+ its preposition). Keep enough of
   the sentence visible to anchor the meaning. Never gap a single article/letter.
3. **Pattern line** uses `sth` / `sb` placeholders (`depend on sb/sth`, `make a mistake`).
4. **`⚠` calque line only when a real Portuguese trap exists** — name the PT source and the right word.
   Don't invent a trap for collocations with no PT pull.
5. **One card per collocation.** Use the learner's context or interests when known; otherwise write a
   concrete, natural sentence. Vary the examples and avoid textbook blandness.
6. Source tag when known: `src::collocations-in-use-u<N>` (book unit) — otherwise no source tag.
7. The card is English except the PT hint (and the PT name inside `⚠`).
8. **Never reuse the learner's example sentence verbatim on a card.** Write a new one that fits the sense, in the same domain when possible. Use the learner's sentence only if they explicitly ask to keep it.
