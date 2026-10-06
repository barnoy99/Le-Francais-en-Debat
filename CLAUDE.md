# Le Français en Débat — conventions

French **speaking** gym, sibling of Le Français au Quotidien. Static PWA, vanilla JS, no build step,
Chrome on Android only. **Read `HANDOFF.md` first**, then the brief it names.

- Content in `data.js` (`TEXTS`, `TOPICS`, `FRAMES`, `SENTENCES`); pure logic in `core.js`; UI in `app.js` (one IIFE).
- The app = pick a text, then « Le texte » (sentences only, 1/2/3/4/Tout at a time) or « Les variations » (one per frame). Modes: Mains libres / Au calme / Silencieux. See HANDOFF « v7 ».
- Every asset change: bump `?v=N` in `index.html` + the same URL in `SHELL` in `sw.js` + `CACHE_VERSION`.
- Sync path is `progress/debat3`. **Never write to Quotidien's `progress/user1`** — the Quotidien link is plain GETs.
- Preview with `?local` (no Firebase); anything else writes his live database.
- Tests: `node test/core-test.js`, `node test/data-test.js`, `node test/register-test.js`. Run after touching content or `core.js`.
- Frame/prompt ids are strings and never renumbered; append `f37`+.
- UI in French, comments in English. Spoken register, never phonetic respelling (TTS).
