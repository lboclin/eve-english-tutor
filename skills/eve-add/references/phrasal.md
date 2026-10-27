# Mode: phrasal — an unfamiliar phrasal verb → 2 cards (meet + produce)

A **phrasal verb** is a verb + particle whose meaning isn't the sum of its parts (`pull off`, `put off`,
`take on`, `come up with`). The common problem is **not recognition — it's production**: a learner may
understand them when reading but reach for a Latin-root verb when writing (*postpone*, not *put off*).
Research calls this **avoidance**, and it does not go away with exposure alone — it needs deliberate
practice. So the mode is built around making the learner *produce* the particle.

## Input

- the phrasal verb, optionally with the sentence/context where it appeared (often PT).
- `/eve-add pv: pull off` · `/eve-add pull off — vi num post sobre uma demo que deu certo`
- `pv:` forces this mode.

## Two cards per sense — and the order matters

| # | Card | Trains | Front |
|---|---|---|---|
| 1 | **meet** | form → meaning | the sentence with the PV **visible**, + "What does X mean here?" |
| 2 | **produce** | meaning → form | a **new** sentence with `___ ___`, + the PT hint |

**Card 1 must be created first** so Eve introduces it first. This is the one well-evidenced
phrasal-verb-specific finding (Strong & Boers 2019): learners who *guessed* a particle before studying it
did worse than learners who studied first, and ~70% of their later errors were repeats of that first wrong
guess. **Wrong particles stick.** Never let a produce card be the learner's first contact with a phrasal verb.

## Card shape

JSON: `{"kind": "phrasal", "pv": "<kebab-slug>", "front": "...", "back": "...", "tags": [...]}`

`pv` is the kebab-case slug of the verb itself (`pull-off`, `come-up-with`) — both cards of a sense share
it, and every sense of that verb shares it too, so `pv::pull-off` counts how much of the verb is carded.

**Card 1 — meet**
```
front: They somehow <b>pulled off</b> the demo with a broken API.<br>What does "pull off" mean here?
back:  to succeed at sth difficult<br>separable: pull it off (never "pull off it")
```
**Card 2 — produce**
```
front: She ___ ___ the funding round in three weeks.<br>(PT: conseguiu fechar, contra todas as chances)
back:  She <b>pulled off</b> the funding round in three weeks.<br>pull sth off = succeed at sth difficult
```

## Rules

1. **One sense per card pair.** Cap at **2 senses per verb**, and only when both are genuinely common —
   for most phrasal verbs 2 senses cover 75%+ of real usage. Never list all senses on one card; that's
   the overload that makes a card unlearnable. Start with the sense the learner actually met.
2. **Card 1 keeps the learner's real sentence** when one was provided — it is memorable because it is
   where the phrase appeared. Otherwise, use a domain from the learner's context or interests.
3. **Card 2 must be a different sentence** from card 1 — different subject, tense or domain. Otherwise
   the learner memorizes the card, not the verb.
4. **The PT hint on card 2 is mandatory** and must force the answer. Write it the way the learner
   would *think* it in Portuguese. `___ ___` = one blank per word (three for `come up with`).
5. **Separability line only when verified** in an authoritative dictionary or supplied reference — the
   verb must be transitive *and* commonly split.
   `put it off` yes; `come up` (1.4% separated) no. When included, show the pronoun form, because the
   pronoun rule is the categorical one: *pull it off*, never *pull off it*.
6. **Register only at sense level.** Do NOT blanket-tag phrasal verbs "informal" — corpus evidence shows
   expert academic writers use them freely. Note register only when *that specific sense* is bound to one
   (`hang out` = informal only).
7. **Particle note is optional**, one short line, back of card only (`off = away, detached`). Add it only
   when it genuinely makes the meaning feel motivated. The evidence for particle metaphors is real but
   small and fades fast — it's an encoding aid, never the point of the card.
8. **Do not add exact frequency percentages from memory.** Include one only when it was retrieved from
   a named corpus or supplied reference during the current task; otherwise omit it.
9. **Check existing cards before adding**, so senses are not duplicated. Use the script's event count
   rather than dividing raw log lines.
10. **Don't card transparent ones** (`sit down`, `stand up`, `go back`) unless the user asks — if the parts
    give you the meaning, it isn't a phrasal-verb problem.
11. Cards are English except the PT hint on card 2.
12. **Never reuse the learner's example sentence verbatim on a card.** Write a new one that fits the sense, in the same domain when possible. Use the learner's sentence only if they explicitly ask to keep it.

## Not a phrasal verb?

Verb + particle where the meaning *is* literal and the difficulty is which words pair up
(`raise concerns about`, `depend on`) → that's **collocation** mode. A single word whose difficulty is its
meaning → **word** mode. Phrasal = the particle changes the meaning.
