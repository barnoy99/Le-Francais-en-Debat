# Le Français en Débat — conventions

French **speaking** gym, sibling of Le Français au Quotidien. Static PWA, vanilla JS, no build step,
Chrome on Android only. **Read `HANDOFF.md` first**, then the brief it names.

- Content in `data.js` (`TEXTS`, `TOPICS`, `FRAMES`, `SENTENCES`); pure logic in `core.js`; UI in `app.js` (one IIFE).
- Every text is **only his words** (monologues; objections he quotes himself, never a second speaker).
- Two home tabs: « Débat » (corpus A/B) and « Ma vie » (corpus V, texts 19+: monologues, only his words, to family on a video call). See HANDOFF « v22 »–« v24 ».
- The app = pick a text, then « Le texte » (sentences only, 1/2/3/4/Tout at a time) or « Les variations » (one per frame). Modes: Mains libres / Anglais d'abord / Au calme (+ « auto »). See HANDOFF « v20 ».
- Every asset change: bump `?v=N` in `index.html` + the same URL in `SHELL` in `sw.js` + `CACHE_VERSION`.
- Sync path is `progress/debat3`. **Never write to Quotidien's `progress/user1`** — the Quotidien link is plain GETs.
- Preview with `?local` (no Firebase); anything else writes his live database.
- Tests: `node test/core-test.js`, `node test/data-test.js`, `node test/register-test.js`. Run after touching content or `core.js`.
- Frame/prompt ids are strings and never renumbered; append `f37`+.
- UI in French, comments in English. Spoken register, never phonetic respelling (TTS).
