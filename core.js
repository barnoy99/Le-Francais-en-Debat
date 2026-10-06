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
  // texts: 't<id>' -> { pos, done, vpos }. pos = next sentence to play; vpos = next variation; done = a '0'/'1'
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
    if (typeof r.vpos !== 'number') r.vpos = 0;
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

  // « Les variations » keeps its own cursor (vpos) over varList(); each one shown
  // moves that frame's rotation on, so the next visit meets a new sentence.
  function completeVar(state, textId, idx, frameId) {
    textRec(state, textId).vpos = idx + 1;
    if (frameId) state.vu[frameId] = (state.vu[frameId] || 0) + 1;
    state.lastText = textId;
  }

  function setVarPos(state, textId, idx) {
    textRec(state, textId).vpos = Math.max(0, idx);
    state.lastText = textId;
  }

  function varProgress(state, textId, total) {
    var r = state.texts[key(textId)] || {};
    var pos = Math.min(r.vpos || 0, total);
    return { pos: pos, total: total, finished: pos >= total };
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

  // ── The two parts of a text ───────────────────────────
  // « Le texte »: the sentences alone, in chunks of `size` (0 = the whole text).
  // « Les variations »: one per structure the text carries, in order of first use.

  function chunkAt(sents, from, size) {
    return sents.slice(from, size ? from + size : sents.length);
  }

  // Bigger chunks = he already knows the text: fewer repeats; the whole text is listen-only.
  function repeatsFor(size) { return size === 1 ? REPEAT_SENT : size === 2 ? 2 : size ? 1 : 0; }

  function varList(sents) {
    var seen = {}, out = [];
    sents.forEach(function (s, i) {
      if (s.f && !seen[s.f]) { seen[s.f] = 1; out.push({ f: s.f, s: i }); }
    });
    return out;
  }

  // Display text of a chunk. Sentences carry `who`; when a chunk spans both
  // speakers of a dialogue, each turn gets its own line and a label.
  function chunkText(chunk, field) {
    var turns = [], cur = null;
    chunk.forEach(function (x) {
      if (!cur || cur.who !== x.who) { cur = { who: x.who, parts: [] }; turns.push(cur); }
      cur.parts.push(x[field]);
    });
    var labels = turns.length > 1 ? (field === 'en' ? { lui: 'Friend: ', moi: 'You: ' } : { lui: 'Ton ami : ', moi: 'Toi : ' }) : null;
    return turns.map(function (t) { return (labels ? labels[t.who] || '' : '') + t.parts.join(' '); }).join('\n');
  }

  // « Silencieux » guessing aid: each word keeps its first letter, the rest is blanked.
  // A speaker label from chunkText stays readable.
  function mask(fr) {
    return String(fr).split('\n').map(function (line) {
      var m = /^(Ton ami : |Toi : )?([\s\S]*)$/.exec(line);
      return (m[1] || '') + m[2].replace(/([A-Za-zÀ-ÖØ-öø-ÿœŒ])([A-Za-zÀ-ÖØ-öø-ÿœŒ]*)/g, function (w, a, b) {
        return a + new Array(b.length + 1).join('_');
      });
    }).join('\n');
  }

  // ── Steps ─────────────────────────────────────────────
  // ui = repaint the screen; say = speak; turn = his turn (« Mains libres »: a silence
  // of `ms`; « Au calme » / « Silencieux »: a button, labelled `label` or « Suivant »).
  // Silent steps never say anything: the English and the first letters are the cue.

  function stepper() {
    var s = [];
    return {
      s: s,
      ui: function (v) { s.push({ t: 'ui', v: v }); },
      say: function (text, lang, rate) { s.push({ t: 'say', text: text, lang: lang || 'fr', rate: rate || 0.85 }); },
      turn: function (ms, label) { var st = { t: 'turn', ms: ms }; if (label) st.label = label; s.push(st); }
    };
  }

  // opts: { size, silent }
  function textSteps(chunk, opts) {
    opts = opts || {};
    var k = stepper();
    var fr = chunkText(chunk, 'fr'), en = chunkText(chunk, 'en');
    if (opts.silent) {
      k.ui({ phase: 'sent', fr: fr, en: en, hideFr: false, mask: true,
             caption: 'Devine en français', hint: 'Guess the French from the English and the first letters.' });
      k.turn(0, 'Voir');
      k.ui({ mask: false, caption: 'Relis-le', hint: 'Read it once more, then go on.' });
      k.turn(0);
      return k.s;
    }
    var reps = repeatsFor(opts.size === undefined ? 1 : opts.size);
    k.ui({ phase: 'sent', fr: fr, en: en, hideFr: false, mask: false, caption: 'Écoute', hint: 'Listen.' });
    if (!reps) {
      chunk.forEach(function (x) { k.say(x.fr); });
      return k.s;
    }
    var all = chunk.map(function (x) { return x.fr; }).join(' ');
    for (var i = 1; i <= reps; i++) {
      if (i === reps && reps > 1) k.ui({ hideFr: true, caption: 'Écoute', hint: 'Listen — this time without reading.' });
      chunk.forEach(function (x) { k.say(x.fr); });
      k.ui({ caption: reps > 1 ? 'Répète (' + i + '/' + reps + ')' : 'Répète',
             hint: i === reps && reps > 1 ? 'Say it without reading.' : 'Say it out loud.' });
      k.turn(repeatMs(all));
    }
    return k.s;
  }

  // opts: { review, silent }. review = he has met a variation of this structure before.
  function varSteps(v, opts) {
    opts = opts || {};
    var k = stepper(), ui = k.ui, say = k.say, turn = k.turn;
    if (opts.silent) {
      ui({ phase: 'var', fr: v.model, en: v.en, hideFr: false, mask: true,
           caption: 'Devine en français', hint: 'Same structure. Guess the French from the English and the first letters.' });
      turn(0, 'Voir');
      ui({ mask: false, caption: 'La réponse', hint: 'Here is the answer.' });
      turn(0);
      return k.s;
    }
    if (!opts.review) {
      ui({ phase: 'var', fr: v.model, en: v.en, hideFr: false, mask: false,
           caption: 'Même structure, autre phrase', hint: 'Same structure, a new sentence. Listen.' });
      for (var j = 1; j <= REPEAT_VAR; j++) {
        say(v.model);
        ui({ caption: 'Répète (' + j + '/' + REPEAT_VAR + ')', hint: 'Say it out loud.' });
        turn(repeatMs(v.model));
      }
    } else {
      ui({ phase: 'var', fr: v.model, en: v.en, hideFr: true, mask: false,
           caption: 'Dis-le en français', hint: 'Same structure. Say this in French.' });
      say(v.en, 'en', 0.9);
      ui({ caption: 'À toi, en français', hint: 'Your turn, in French.' });
      turn(tryMs(v.model));
      ui({ hideFr: false, caption: 'La réponse', hint: 'Here is the answer.' });
      say(v.model);
      ui({ caption: 'Répète', hint: 'Say it out loud.' });
      turn(repeatMs(v.model));
    }
    return k.s;
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
      if (typeof r.vpos !== 'number') r.vpos = 0;
    }
    return state;
  }

  return {
    REPEAT_SENT: REPEAT_SENT, REPEAT_VAR: REPEAT_VAR,
    repeatMs: repeatMs, tryMs: tryMs,
    defaults: defaults, normalize: normalize, pickFreshest: pickFreshest,
    textRec: textRec, isDone: isDone, progress: progress, complete: complete, setPos: setPos,
    completeVar: completeVar, setVarPos: setVarPos, varProgress: varProgress,
    pickVariant: pickVariant, chunkAt: chunkAt, repeatsFor: repeatsFor, varList: varList,
    chunkText: chunkText, mask: mask, textSteps: textSteps, varSteps: varSteps
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
