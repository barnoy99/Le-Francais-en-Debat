/* Le Français en Débat — pure logic: lesson steps, progress per text, variant rotation,
   sync merge. No DOM, no storage, no network. app.js drives it; test/core-test.js loads it. */
var Core = (function () {
  'use strict';

  var REPEAT_SENT = 3;      // the text's sentence: heard and repeated three times
  var REPEAT_VAR = 2;       // a variation seen for the first time: repeated twice
  // Speaking windows in « Mains libres », scaled to the sentence. Generous on purpose:
  // his first feedback was « too fast ».
  function repeatMs(fr) { return 1500 + words(fr) * 450; }
  function tryMs(fr) { return 3000 + words(fr) * 700; }
  function words(s) { return String(s).trim().split(/\s+/).length; }

  // ── State ─────────────────────────────────────────────
  // texts: 't<id>' -> { pos, done }. pos = next sentence to play; done = a '0'/'1'
  // string, one char per sentence (a string, because Firebase rewrites integer-keyed
  // objects into arrays). vu: frame id -> variations shown, so each visit gets the next one.

  function defaults() {
    return { version: 2, updatedAt: 0, sessionCount: 0, texts: {}, vu: {}, lastText: 0 };
  }

  function key(textId) { return 't' + textId; }

  function textRec(state, textId) {
    var r = state.texts[key(textId)];
    if (!r) { r = { pos: 0, done: '' }; state.texts[key(textId)] = r; }
    if (typeof r.pos !== 'number') r.pos = 0;
    if (typeof r.done !== 'string') r.done = '';
    return r;
  }

  function isDone(state, textId, idx) {
    var r = state.texts[key(textId)];
    return !!(r && typeof r.done === 'string' && r.done.charAt(idx) === '1');
  }

  function progress(state, textId, total) {
    var r = state.texts[key(textId)] || { pos: 0, done: '' };
    var done = 0;
    for (var i = 0; i < total; i++) if ((r.done || '').charAt(i) === '1') done++;
    var pos = Math.min(r.pos || 0, total);
    return { pos: pos, done: done, total: total, finished: pos >= total };
  }

  // A sentence's steps ran to the end: mark it, move the cursor past it.
  function complete(state, textId, idx, frameId) {
    var r = textRec(state, textId);
    var d = r.done;
    while (d.length <= idx) d += '0';
    r.done = d.substring(0, idx) + '1' + d.substring(idx + 1);
    r.pos = idx + 1;
    if (frameId) state.vu[frameId] = (state.vu[frameId] || 0) + 1;
    state.lastText = textId;
  }

  function setPos(state, textId, idx) {
    textRec(state, textId).pos = Math.max(0, idx);
    state.lastText = textId;
  }

  // Next variation of a frame, round-robin. Not consumed until complete(), so
  // « Réécouter » replays the same one.
  function pickVariant(state, frame) {
    if (!frame || !frame.prompts || !frame.prompts.length) return null;
    var n = state.vu[frame.id] || 0;
    return frame.prompts[n % frame.prompts.length];
  }

  // ── Steps for one sentence ────────────────────────────
  // ui = repaint the screen; say = speak; turn = his turn to speak (« Mains libres »:
  // a silence of `ms`; « Au calme »: wait for « Suivant »).
  // opts: { variant: prompt|null, review: bool }

  function buildSteps(sent, opts) {
    opts = opts || {};
    var s = [];
    function ui(v) { s.push({ t: 'ui', v: v }); }
    function say(text, lang, rate) { s.push({ t: 'say', text: text, lang: lang || 'fr', rate: rate || 0.85 }); }
    function turn(ms) { s.push({ t: 'turn', ms: ms }); }

    ui({ phase: 'sent', fr: sent.fr, en: sent.en, hideFr: false,
         caption: 'Écoute', hint: 'Listen.' });
    for (var i = 1; i <= REPEAT_SENT; i++) {
      if (i === REPEAT_SENT) ui({ hideFr: true, caption: 'Écoute', hint: 'Listen — this time without reading.' });
      say(sent.fr);
      ui({ caption: 'Répète (' + i + '/' + REPEAT_SENT + ')',
           hint: i === REPEAT_SENT ? 'Say it without reading.' : 'Say it out loud.' });
      turn(repeatMs(sent.fr));
    }

    var v = opts.variant;
    if (v) {
      if (!opts.review) {
        ui({ phase: 'var', fr: v.model, en: v.en, hideFr: false,
             caption: 'Même structure, autre phrase', hint: 'Same structure, a new sentence. Listen.' });
        say('Même structure.', 'fr', 0.9);
        for (var j = 1; j <= REPEAT_VAR; j++) {
          say(v.model);
          ui({ caption: 'Répète (' + j + '/' + REPEAT_VAR + ')', hint: 'Say it out loud.' });
          turn(repeatMs(v.model));
        }
      } else {
        ui({ phase: 'var', fr: v.model, en: v.en, hideFr: true,
             caption: 'Même structure : dis-le en français', hint: 'Same structure. Say this in French.' });
        say(v.en, 'en', 0.9);
        ui({ caption: 'À toi, en français', hint: 'Your turn, in French.' });
        turn(tryMs(v.model));
        ui({ hideFr: false, caption: 'La réponse', hint: 'Here is the answer.' });
        say(v.model);
        ui({ caption: 'Répète', hint: 'Say it out loud.' });
        turn(repeatMs(v.model));
      }
    }
    return s;
  }

  // ── Sync merge ────────────────────────────────────────

  function pickFreshest(local, cloud) {
    if (!cloud || cloud.version !== 2) return local || defaults();
    if (!local) return cloud;
    if ((local.updatedAt || 0) !== (cloud.updatedAt || 0)) return local.updatedAt > cloud.updatedAt ? local : cloud;
    return (local.sessionCount || 0) >= (cloud.sessionCount || 0) ? local : cloud;
  }

  // Firebase drops empty objects; put back what the code indexes without checking.
  function normalize(state) {
    var d = defaults();
    for (var k in d) if (state[k] === undefined || state[k] === null) state[k] = d[k];
    for (var id in state.texts) {
      var r = state.texts[id];
      if (!r) { delete state.texts[id]; continue; }
      if (typeof r.pos !== 'number') r.pos = 0;
      if (typeof r.done !== 'string') r.done = '';
    }
    return state;
  }

  return {
    REPEAT_SENT: REPEAT_SENT, REPEAT_VAR: REPEAT_VAR,
    repeatMs: repeatMs, tryMs: tryMs,
    defaults: defaults, normalize: normalize, pickFreshest: pickFreshest,
    textRec: textRec, isDone: isDone, progress: progress, complete: complete, setPos: setPos,
    pickVariant: pickVariant, buildSteps: buildSteps
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
