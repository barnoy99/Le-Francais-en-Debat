# Handoff — Le Français en Débat (working name)

Sibling of `Le-Francais-au-Quotidien`. A French **speaking** gym: frames mined from
argument texts, drilled with unrelated content. Read the brief first:
`C:\Users\User\.claude\plans\crispy-baking-pillow.md` (§2 governing rule, §4 build order).
Also read the sibling's `HANDOFF.md` and `CORPUS.md` before writing code or content.

**Stack (Phase 3+):** static PWA, vanilla JS, one IIFE in `app.js`, content in `data.js`,
`?v=N` + `SHELL` + `CACHE_VERSION` cache-busting on every asset change, French UI,
English code comments, Chrome on Android only, Firebase for sync (own path, never write
to Quotidien's `progress/user1`).

## Status: Phase 2 done (2026-09-30, Opus) — next is Phase 3 (core app, no STT)

| Phase | State | Model |
|---|---|---|
| 1 — six texts | **done**; all six approved on register (dialogues and monologues, 2026-09-30) | Opus |
| 2 — frames + prompts, `data.js` | **done** — 36 frames, 252 prompts, all accepted by the user as listed | Opus |
| 3 — core app, no STT | not started | Sonnet (volume of conventional code, pattern set by Quotidien) |
| 4 — STT + matcher + tests | not started | Opus (French normaliser + matcher is the subtle part) |
| 5 — « Au calme » + ingest | not started | Sonnet for the UI; Opus if ingest needs frame-mining logic |

### How the dialogues work in the app (settled with the user, 2026-09-30)

Not a live debate — no LLM in the loop (offline, gradable, no drift back to comfortable
French). **Lui** lines are the cue for Compréhension: played at speed, answered aloud,
French only. **Moi** lines are a model answer to shadow, never a script to match — any
answer using the target frame counts. Lui lines also serve as content for Enchaînement.

No app code exists yet. No git commit, no remote, no deploy.

## What exists

```
data.js                                 # TEXTS (6), TOPICS (12), FRAMES (36 × 7 prompts)
texts/*.md                              # the six texts — human-readable source of TEXTS
test/register-test.js                   # node test/register-test.js   (texts: banned words, respelling, ≤32 words)
test/data-test.js                       # node test/data-test.js       (everything below)
```

### `data.js` shape

- `TEXTS[]` — `{ id, corpus:'A'|'B', kind:'dialogue'|'monologue', title, file, lines:[{who:'lui'|'moi', fr}], cues? }`.
  Generated from the markdown and **must stay in sync** — `data-test.js` diffs every line.
  If a text is edited, edit the `.md` and the matching `lines` entry together.
  Monologues carry `cues`: the friend's objection quoted inside the text (4 total) —
  the only Compréhension material a monologue has.
- `TOPICS{}` — 12 prompt topics: enfants, couple, cours, collegues, sante, films, argent,
  politique (Israeli domestic politics, never the war), voisins, tech, **dieu**, **israel**.
- `FRAMES[]` — the brief's schema plus two fields:
  - `sources[]` — every text the frame appears in; `textId` is the primary one (used for
    "never two frames from the same text in a row").
  - `gist` — English meaning cue for **Reconstruction**, deliberately not in the target's
    word order (`exemplarEn` mirrors the French, so it can't be the cue). Needs an
    English TTS voice (`en-GB`/`en-US`) in Phase 3.
  - `prompts[]` — `{ id:'f07-3', topic, fr }`, exactly 7 per frame.
- Frame and prompt ids are strings (`f01`…`f36`, `f01-1`…) — SRS state will key on them;
  **never renumber**, append `f37`+.

### Prompt rules (enforced by `data-test.js`)

- **Prompts are French**, phrased as a situation + his stance, never already in the
  frame's shape — an English prompt would re-train translate-then-emit. The user approved.
- 6 life-topic prompts + **exactly one from the other corpus** (Corpus A frame → one
  `israel` prompt; Corpus B frame → one `dieu` prompt), **never** one from its own corpus.
  That single cross prompt is the visible cross-pollination the brief asks for.
- ≥ 4 distinct topics per frame, so the three mastery reps can come from three topics.
- Prompts talk *about* the kids, addressed to his wife or a friend — never to a child.
  **His three kids: « le grand » (boy), « la grande » (girl), « la petite » (girl).**
  There is no « le petit » — use these three, with the right agreement (il/elle).
  No invented relatives (no sister, no mother-in-law story).

### Frames at a glance (the list the user accepted, 2026-09-30)

A. Concéder: f01 *Des N, oui, y en a* · f02 *je te l'accorde* · f03 *Sauf que* · f04 *Je dis
pas que… je dis juste que* · f05 *C'est pas parce que… que* · f06 *Je vois venir ta réponse*
B. Changer la question: f07 *La vraie question, c'est pas…* · f08 *On parle pas de… on parle
de* · f09 *C'est moins une question de… qu'une question de* · f10 *…c'est deux questions
différentes* · f11 *…c'est une chose, …c'en est une autre* · f12 *Le choix, il a jamais été
entre* · f13 *Ça montre que… ça dit rien sur* · f14 *« X », ça veut dire une chose précise*
C. Logique: f15 *Plus…, moins* · f16 *Tu pars de… t'arrives direct à* · f17 *Tu fais comme si*
· f18 *Pourquoi lui, il aurait le droit, et pas…* · f19 *Si X voulait vraiment…, pourquoi*
· f20 *X aurait pp ? C'est un peu gros* · f21 *C'est pas à moi de* · f22 *Même en partant de*
· f23 *Prenons même… ça reste* · f24 *…qui aurait pu* · f25 *Si t'étais né…, tu serais*
D. Rétablir: f26 *c'est pas ce qu'il a dit* · f27 *C'est pas moi qui* (Quotidien #123 is one
fixed sentence of it, mastered — kept anyway, user agreed) · f28 *Ce qui m'a frappé, c'est*
· f29 *C'est là que* · f30 *Si, justement* · f31 *X, il tombe pas du ciel*
E. Renvoyer: f32 *…, toi ?* · f33 *Je préfère A à B* · f34 *X, parlons-en* · f35 *Tu veux…,
ou tu veux… ?* · f36 *Je vais même plus loin*

Left out on purpose because he already masters them in Quotidien: *n'empêche* (#303),
*je veux bien…, mais* (#71). They remain fair game as **Enchaînement connectors**
(the brief's « du coup / n'empêche / cela dit »).

### For Phase 3 — things this phase learned

- **Compréhension material is thin**: 18 Lui lines + 4 monologue cues = 22 items. It will
  repeat within days. Don't pad it with invented lines in Phase 3; flag it to the user —
  the fix is more texts (from real use) or ingest.
- A frame's `form` slots are free text (`{N / que P}`, `{il / elle}`): display only, don't
  parse them. Phase 4 will need its own invariant-token list per frame for the matcher.
- Read-only Quotidien GET works (`progress/user1.json`, ~57 KB); `phrases` came back as an
  **array** and `hfPass` as an **object** this time — handle both shapes for each.

## Next session — do this first

1. Read the brief (§4, Phase 3) and Quotidien's `HANDOFF.md` (architecture, SW, sync).
2. Build Phase 3 only. Run both tests after any content touch.

## Facts — checked on the web 2026-09-30

- #14 Ghazi Hamad, LBC (Lebanon), 24 Oct 2023: "…the first time, and there will be a
  second, a third, a fourth" (MEMRI translation; Times of Israel, Haaretz). ✔
- #14 tunnels: Israeli officials to the NYT, Jan 2024: 350–450 miles ≈ 560–720 km; no
  independent measurement. Text says "500 à 700 km", then halves it. ✔
- #17 Gaza MoH toll: 74,016 on 27 Sept 2026 (Boston Globe) → "plus de soixante-dix
  mille". Re-check if the text is revised later. ✔
- #17 Pillay commission (UN CoI) concluded genocide, 16 Sept 2025 (OHCHR). ✔
- #17 Donoghue, BBC HARDtalk, April 2024: the ICJ found a plausible *right* to
  protection, not a plausible *case* of genocide. ✔ Merits still undecided — **not
  re-checked; verify before any revision.**
- #17 Ra'am in the 2021 coalition, Arab Supreme Court justice (Kabub) — from memory, solid.
- #10 850,000 Jews from Arab/Muslim lands; 45% self-identify Mizrahi/Sephardi (2018),
  >50% with partial descent → "à peu près la moitié". ✔ Nakba ~700,000 — standard range
  700–750k.
- #14 Art. 51 / non-state actor from controlled territory (ICJ Wall opinion, 2004) —
  conceded as a live debate, not argued.

## Content conventions (carried over + decided this session)

- Spoken register: dropped `ne`, `y a`, `faut que`, `du coup`, `en fait`, `n'empêche`,
  tag-`quoi`. Never respell phonetically. Banned list is in `test/register-test.js`.
- Arguments to one friend, `tu`/`on`. Dialogues: **Lui** / **Moi**.
- Corpus B: steelman first, disputed figures given with source and argued from the
  conservative end, narrower claim preferred over the louder one. #14 deliberately ends
  by conceding necessity ≠ proportionality and hands off to #15.
- Speaker is the user: Israeli, speaks to a French-speaking friend (not a hostile crowd).
- Avoid anglicisms in copy (a "sur la fence" slipped in and was fixed).
- Write `qu'il y a` after `que`, not `qu'y a` — TTS safety; bare `y a` is fine.
- No unsourced statistics, even in Corpus A (the "neuf sur dix" in #6 was cut).
- The user reads chat in **English**; texts and UI stay French.
- Show numbered lists for his judgement, not summaries.
- `personne` / `rien` / `aucun` as **subject keep their `ne`** (Quotidien rule, applied
  2026-09-30: five texts fixed). Object `personne` drops it normally.
- **Bare `plus` without `ne` is ambiguous in TTS** (/ply/ vs /plys/): keep a disambiguator —
  `plus du tout`, `plus vraiment`, `plus rien`, `plus aucun`. Three texts fixed.
- Folder name is provisional; the user may rename it.
