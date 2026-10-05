# Handoff — Le Français en Débat (working name)

Sibling of `Le-Francais-au-Quotidien`. A French **speaking** gym: frames mined from
argument texts, drilled with unrelated content. Read the brief first:
`C:\Users\User\.claude\plans\crispy-baking-pillow.md` (§2 governing rule, §4 build order).
Also read the sibling's `HANDOFF.md` and `CORPUS.md` before writing code or content.

**Stack (Phase 3+):** static PWA, vanilla JS, one IIFE in `app.js`, content in `data.js`,
`?v=N` + `SHELL` + `CACHE_VERSION` cache-busting on every asset change, French UI,
English code comments, Chrome on Android only, Firebase for sync (own path, never write
to Quotidien's `progress/user1`).

## v6 redesign (2026-10-05) — READ THIS FIRST; it supersedes the Phase 3 sections below

His feedback on v5: « I use the app and don't know what to do or say. It's over complicated. »
The scheduler + five activity types + French "situation" prompts asked him to invent French
from nothing. Settled with him: **text first, sentence by sentence.**

- **Home** = the six texts, each with progress; tap to continue, « ↺ Depuis le début » to restart.
  Mains libres / Au calme switch kept (his choice).
- **Per sentence** (`Core.buildSteps`): French + English shown, heard 3×, he repeats after each;
  the French fades on the 3rd. If the sentence carries a frame (`f`), « À ta façon »: one of that
  frame's prompt models (same structure, his life). **First time**: French + English, heard 2×,
  repeated. **Sentence already done** (review): English only, spoken in en-GB → his try →
  French revealed → repeat once.
- Variations rotate per frame (`state.vu[frameId]`, consumed on completion), so every visit
  meets a new one.
- Mains libres: silences sized to the sentence (`Core.repeatMs` / `tryMs`), thin bar, tap to
  pause. Au calme: « Suivant » button at each turn. Buttons: ⏮ ↺ ? ⏭.
- **Content added:** `SENTENCES` in `data.js` (205 sentences, `{ l, fr, en, f? }`); the
  sentences of a line joined with spaces must equal the line (`data-test.js`). Every frame is
  carried by at least one sentence. `en` on all 252 prompts (English of `model`, brackets for
  missing context) — **written by Claude, not yet reviewed by him**, same as the models.
  f29 `sources` gained text 10.
- **Gone:** scheduler, mastery, Compréhension/Enchaînement/Reconstruction, the French prompt
  situations (`prompts[].fr` stays in data, unused), the Quotidien link, Progrès overlay.
- **State** v2 shape: `{ version: 2, texts: { t<id>: { pos, done: '0101…' } }, vu, lastText }`,
  localStorage `debat_state3`, Firebase **`progress/debat3`** (fresh; old paths abandoned).
- Assets `?v=6`, `CACHE_VERSION = 'v6'`.

Open: no STT (he self-checks against the reveal). If he wants it, Phase 4 can grade the review
try against `model`. More texts = more lessons; a new text needs its `SENTENCES` entry.

## Status: Phase 3 built (2026-09-30, Sonnet) — not deployed yet; next is Phase 4 (STT + matcher)

| Phase | State | Model |
|---|---|---|
| 1 — six texts | **done**; all six approved on register (dialogues and monologues, 2026-09-30) | Opus |
| 2 — frames + prompts, `data.js` | **done** — 36 frames, 252 prompts, all accepted by the user as listed | Opus |
| 3 — core app, no STT | **built**; tested in node and in the Chrome pane; **not deployed, not on his phone yet** | Sonnet |
| 4 — STT + matcher + tests | not started | Opus (French normaliser + matcher is the subtle part) |
| 5 — « Au calme » + ingest | not started | Sonnet for the UI; Opus if ingest needs frame-mining logic |

### How the dialogues work in the app (settled with the user, 2026-09-30)

Not a live debate — no LLM in the loop (offline, gradable, no drift back to comfortable
French). **Lui** lines are the cue for Compréhension: played at speed, answered aloud,
French only. **Moi** lines are a model answer to shadow, never a script to match — any
answer using the target frame counts. Lui lines also serve as content for Enchaînement.

Phase 3 is uncommitted in the working tree (Phase 1–2 is the only commit). No remote, no GitHub Pages yet.

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

- **Compréhension material is thin**: 19 Lui lines + 4 monologue cues = 23 items. It will
  repeat within days. Don't pad it with invented lines in Phase 3; flag it to the user —
  the fix is more texts (from real use) or ingest.
- A frame's `form` slots are free text (`{N / que P}`, `{il / elle}`): display only, don't
  parse them. Phase 4 will need its own invariant-token list per frame for the matcher.
- Read-only Quotidien GET works (`progress/user1.json`, ~57 KB); `phrases` came back as an
  **array** and `hfPass` as an **object** this time — handle both shapes for each.

## Phase 3 — what was built

**Versions:** all assets `?v=3`, `CACHE_VERSION = 'v3'` (cache `debat-v3`). Same triple-bump rule as Quotidien on every asset change:
`?v=N` in `index.html` + the same URL in `SHELL` in `sw.js` + `CACHE_VERSION`.

```
core.js             pure logic, no DOM: scheduler, mastery, sync merge, Quotidien parsing (global `Core`)
app.js              one IIFE: state/Firebase, TTS, beeps, wake-lock, the step runner, home, Progrès
index.html style.css sw.js manifest.json firebase-config.js icon-192/512.png
test/core-test.js   node test/core-test.js   (74k checks; simulates 2/5/20/30-min sessions × 40 days)
.claude/launch.json preview server `debat` on :8098 (gitignored)
```

**`core.js` is a deliberate deviation** from "one IIFE in app.js": a separate pure file means the
scheduler is tested directly instead of being extracted from `app.js`.

**State** — localStorage `debat_state`, Firebase **`progress/debat2`** (`progress/debat` holds test junk — abandoned, not deleted). His rules only allow
`progress/*` (root and `debat/` are `Permission denied`; `progress/` also holds other apps' keys).
Never `progress/user1`. Verified writable. Merge = last write wins by `updatedAt`, `sessionCount`
breaks ties, local-only if the cloud read fails (Quotidien's rule). `Core.normalize` restores what
Firebase strips (empty arrays/objects). Shape: `frames{id:{m,r,s,n,due,last,reps[[day,topic,promptId,verdict]],md}}`,
`pu` (prompt use), `lui` (Compréhension last heard), `hist` (last 12 served — constraints hold across
sessions), `since`, `current` (item in flight), day counters, cycle counters.
**`?local` in the URL turns Firebase and the Quotidien read off — use it for every preview.**
(The Browser pane's first auto-open is at `/`, without `?local`, and does write.)

**Queue + cursor:** items are pulled one at a time (`Core.next`), not pre-built. `state.current` is the
item in flight, saved when it starts and cleared on commit; reopening replays it from the top
(button reads « Reprendre »). Every item is atomic; `save()` runs after every commit and every skip.
"Cycle" (home line) = every frame touched once, then it rolls and banks `dernier : N j`.

**Scheduler** (`Core.next`): one score ranks all frames — `0.15·yield + days overdue`, new frames
+0.6; not-yet-due frames go negative, so when nothing is due the nearest-to-due wins (no second
path). Rules: a frame never twice within 10 min; never two items from the same `textId` in a row;
never the same prompt topic twice in a row; ≤ 2 mises in a row; ≤ 5 new frames/day and ≤ 8 still
learning; Enchaînement only after ≥ 4 items **and** ≥ 3 min, at most every 7 items, needs two
« solid » frames (2 reps on 2 days) from different texts; Compréhension every ~5 items. When a rule
leaves nothing it relaxes in order (comp filler → lift new caps → mise runs → gap 10→3 min →
same-text → gap), so a 30-minute session never runs dry; `item.relaxed` records the level. Prompt
choice: fresh before repeated, then a topic this frame hasn't been proven on (so the mastery reps
land on three topics). Intervals after each substitution: 1, 3, 7, 14, 30, 60 days × `1.4 − 0.1·yield`;
mastered frames floor at 30 days.

**Mastery** (`Core.mastery`) = three counted substitution reps on three **different days AND three
different topics** (a system of distinct representatives — tested). Mise/recon/chain/comp never count.
**Phase 3 cannot grade anything**, so a rep counts once the 15-second window has run to its end
(Passer / Accueil count nothing). « Maîtrisée » therefore currently means *showed up*; the simulation
masters all 36 frames within ~3 weeks. Phase 4 must set `verdict` (`'fail'` already withdraws a rep) —
this is the single most important thing it changes.

**Five activity types** (`buildSteps` in `app.js`, windows in `Core.WINDOW`): Mise en bouche (hear the
exemplar, 8 s shadow) · Reconstruction (spoken English `gist` in en-GB, 12 s, then the model, 4 s
repeat) · Substitution (exemplar → French prompt → 15 s) · Enchaînement (both exemplars, « du coup /
n'empêche / cela dit », prompt, 30 s) · Compréhension (Lui line at rate 1.1, 15 s answer, then the Moi
line as model; text hidden until after the window so it stays listening). All driven by ear; the screen
only mirrors. One tap anywhere pauses/resumes; ↺ Répéter and Passer ⏭ are optional buttons. A silent
TTS engine cannot stall a run (fallback timer per utterance). Screen off pauses the run.

**Quotidien link (read-only, plain `fetch` GETs — cannot write):** `progress/user1.json` → mastered ids
(`Core.masteredIds` handles array and object shapes, nulls, `deletedIds`), then Quotidien's `data.js`
from GitHub Pages (CORS open) → his mastered sentences of 4–14 words, cached in localStorage
`debat_qcache` for 6 h. Verified live: 330 mastered, 615 usable sentences. Used for ~1 in 5
substitutions (« Redis cette phrase avec la structure », chip « Tes phrases », topic `quotidien`).
Hook (a) « never drill a frame he owns as a phrase there » exists as an optional `quotidienIds: []`
on a frame, but **no frame sets it** (f27 vs Quotidien #123 was kept on purpose).

## Phase 3 — first feedback (2026-09-30) and what changed (v2)

His first try: « most are too fast, and I don't get the idea » — and why do prompts mention the kids /
« ma femme »? The app never said what to do. Fixes: every item now *speaks* its instruction
(« Répète », « Dis-le en français », « La situation… Réponds, avec la structure », « Réponds-lui »);
captions number the substitution steps; TTS slowed (exemplars 0.8, prompts 0.9, Lui line 0.95); a 600 ms
breath after every utterance; windows lengthened (mise 10, recon 15, sub 25, chain 40, comp 25 s);
a « Comment ça marche ? » screen, shown automatically on first launch. The prompts are situations *about
his life* that he answers aloud with the frame (addressed to his wife/friends, by design of Phase 2).
Pacing tradeoff: a 2-minute session now yields ~3 items, not 4 (test thresholds lowered to match).

**v4 (his answer « yes, all three »):** (1) an English `hint` line under every caption (Compréhension
shows none — its English lives only behind « ? »); (2) a « ? » button that pauses, speaks the current
instruction in English (en-GB) and resumes; (3) a **model answer after every substitution window** —
`model` on all 252 prompts in `data.js` (written in Phase 3, **not yet reviewed by him**; `data-test.js`
requires one per prompt and runs the register check on it). Not played for Quotidien-sentence
substitutions (`item.q`) or Enchaînement. All assets `?v=5`, `CACHE_VERSION = 'v5'`.

**Incident, resolved (v5):** `preview_start` opens `/` without `?local`, so a preview wrote fake test
state to `progress/debat`. Deleting it was blocked; he said to ignore his progress and start from zero.
So v5 uses a fresh local key `debat_state2` and sync path `progress/debat2`; the old node is abandoned,
not deleted. Test on the live URL with `?local`, never via `preview_start`.

## Phase 3 — not done / open

- **Two modes (v3, his request):** launch-screen toggle « Mains libres » | « Au calme », remembered per
  device (`localStorage debat_mode`). Same scheduler, items and counting. Au calme = self-paced: no
  countdown or stop-beep, a « J'ai fini › » button ends each speaking window, the Compréhension text is
  visible from the start, tap-to-pause is off. Mains libres = unchanged. Phase 5's review screens
  (discrimination, transcripts, deferred verdicts, triage) still belong under « Au calme » later.
- No STT, no `attempts` / `calques` logs, no override (Phase 4).
- **Quotidien recombination fits unevenly**: a random mastered sentence poured into a random frame is
  sometimes awkward (« Je vais lui dire, quitte à le vexer » into *Je dis pas que… je dis juste que*).
  `Q_SHARE = 0.2` in `core.js`; lower it, or tag frames it suits, after he has tried it.
- **Compréhension is 23 items**, each resting a week: it runs dry after about a week of daily use and
  the scheduler then serves frames only. More texts or ingest is the fix.
- Icons are generated placeholders (two speech bubbles, bordeaux/gold).
- **Not checked on a real phone:** the fr-FR / en-GB voices on his Android, wake-lock, behaviour with
  the screen off, the installed-PWA look. The Browser pane has one voice and no wake-lock.
- Deploy: create the GitHub repo, enable Pages from `master`, then confirm the live URL serves
  `app.js?v=1` (Quotidien's Pages once sat « building » after a 503; `gh run list` shows the truth).

## Next session — do this first

1. Read the brief (§4, Phase 4) and this file. Phase 4 = `webkitSpeechRecognition`, the French
   normaliser, the frame-integrity matcher (needs a per-frame invariant-token list), the three
   verdict tiers, `calques`, deferred overrides, matcher tests. Follow the `core.js` /
   `test/core-test.js` pattern (`match.js` + its own test).
2. Run `node test/core-test.js`, `data-test.js`, `register-test.js` after any touch.
3. Ask how the first days of real use went (prompt register, window lengths, Compréhension
   repetition) before building on assumptions.

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
