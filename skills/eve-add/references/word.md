# Mode: word — unknown word + context → 1 card

The learner gives a new English **word** and,
optionally, the **context** where it appeared — often in **Portuguese**.

## Input

- **word(s)** — one or more English words/phrases to add.
- **context** — optional, often Portuguese ("vi num vídeo sobre leilão de arte", "num paper de RL",
  "o Bruno falou numa call").

Examples:
- `/eve-add auction` → word only, no context.
- `/eve-add auction — vi num vídeo sobre leilão de arte da Sotheby's` → word + PT context.
- `/eve-add bid, highest bidder — mesmo vídeo do leilão` → two words, shared context.

If the word is genuinely ambiguous **and** no context was given, ask one short question to pin the
sense. Otherwise, proceed — do not over-ask.

## What the context is for

1. **Sense selection (primary).** The context tells you *which* meaning the learner actually met, so the
   card defines THAT sense, not a generic one.
2. **Tailoring the example.** Prefer an example sentence in the same domain as the supplied context.

The context is an **input**, not card content. Do **not** print the raw Portuguese context on the
card — the card stays monolingual. (If the user explicitly asks to keep the source note, honor it.)

## Card style

JSON: `{"word": "<word>", "back": "<back>"}` (kind defaults to `word`).

- **Front** = the word/phrase exactly.
- **Back** = English-first, built from these pieces, joined with `<br>`:
  1. A concise **English definition** of the correct sense (monolingual, Cambridge/Longman flavor).
  2. Optionally a **`(PT: <gloss>)`** — ONLY for **concrete physical nouns** where an English
     definition alone is clumsy (panela → `pot`, chaleira → `kettle`, íngreme → `steep`).
     Do NOT add PT for abstract/functional words — those stay English-only.
  3. One **natural example sentence in quotes**, tailored to the context's domain when possible.
  4. Optionally a small **usage note in parens** — verb/noun form, register, collocation
     (`(verb: "to auction sth off")`, `(informal, AmE)`).
  5. Optionally a **`⚠ ` warning** for a false friend or a near-miss contrast
     (`⚠ "everyday" (one word) ≠ "every day" (each day)`).

Keep it tight. When an existing `vocab-log.tsv` is available, inspect a few entries to match the
learner's established style.

For an obscure sense, uncertain register label, or close synonym distinction, verify the claim against
an authoritative learner dictionary when retrieval is available. Omit uncertain usage notes instead of
inventing them.

**Never reuse the learner's example sentence verbatim on a card.** Write a new one that fits the sense, in the same domain when possible. Use the learner's sentence only if they explicitly ask to keep it.
