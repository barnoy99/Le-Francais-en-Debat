/* Le Français en Débat — pure logic: lesson steps, progress per text, variant rotation,
   sync merge. No DOM, no storage, no network. app.js drives it; test/core-test.js loads it. */
var Core = (function () {
  'use strict';

  var REPEAT_SENT = 3;      // a chunk of the text, any size but « Tout »: heard and repeated three times
  var REPEAT_VAR = 3;       // a variation: heard and repeated three times (Quotidien-style)
  var REPEAT_EN = 3;        // « Anglais d'abord »: the English once, then the French three times, any size
  // A text's first readings: the French four times, not three (his ask, v18).
  var REPEAT_NEW = 4, NEW_READS = 3;
  // Speaking windows in « Mains libres », scaled to the sentence. Generous on purpose:
  // his first feedback was « too fast ». Since v19 a repeat gets as long as a try after
  // the English (his ask: it was ~60–75% shorter).
  function tryMs(fr) { return 3000 + words(fr) * 700; }
  function repeatMs(fr) { return tryMs(fr); }
  function words(s) { return String(s).trim().split(/\s+/).length; }

  // ── State ─────────────────────────────────────────────
  // texts: 't<id>' -> { pos, done, vpos, reads }. pos = next sentence to play; vpos = next variation;
  // reads = times « Le texte » was played to its end; done = a '0'/'1'
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
    if (typeof r.reads !== 'number') r.reads = 0;
    return r;
  }

  // « Le texte » reached its last chunk: one more reading (shown on home).
  function finishRead(state, textId) { textRec(state, textId).reads++; }
  function reads(state, textId) { var r = state.texts[key(textId)]; return (r && r.reads) || 0; }

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
  // « Le texte »: the sentences alone, cut by meaning. size 1 = « Phrase » (one
  // sentence, with its comma-split half or a few words that can't stand alone), 2 = « Bouchée », 3 = « Passage »
  // (both from CHUNKS in data.js), 0 = « Tout ».
  // « Les variations »: one per structure the text carries, in order of first use.

  var SIZES = [1, 2, 3, 0];

  // « Phrase »: a sentence ending on a comma, or listed in `join`, carries on into the next one.
  function units(sents, join) {
    var out = [], n = 0;
    sents.forEach(function (x, i) {
      n++;
      var on = /,\s*$/.test(x.fr) || (join && join.indexOf(i) >= 0);
      if (!on || i === sents.length - 1) { out.push(n); n = 0; }
    });
    return out;
  }

  // The chunks of a text at a size: [{ from, len }], in order, covering every sentence once.
  function chunks(sents, size, plan) {
    var lens = size === 1 ? units(sents, plan && plan.join)
             : size === 2 && plan ? plan.small
             : size === 3 && plan ? plan.big
             : [sents.length];
    var out = [], from = 0;
    lens.forEach(function (len) { out.push({ from: from, len: len }); from += len; });
    return out;
  }

  // Index of the chunk holding sentence `pos` (so a size change mid-text starts
  // the chunk he is in, never half of it).
  function chunkIndex(list, pos) {
    for (var i = list.length - 1; i > 0; i--) if (list[i].from <= pos) return i;
    return 0;
  }

  // Any chunk: three repeats, four during the first readings; the whole text is listen-only.
  function repeatsFor(size, nReads) {
    if (!size) return 0;                                   // « Tout » = listen only
    return (nReads || 0) < NEW_READS ? REPEAT_NEW : REPEAT_SENT;
  }

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

  // ── Steps ─────────────────────────────────────────────
  // ui = repaint the screen; say = speak; turn = his turn (« Mains libres »: a silence
  // of `ms`; « Au calme » / « Silencieux »: a button, labelled `label` or « Suivant »).
  // Silent steps never say anything. The French is always on screen (his ask, v18).

  function stepper() {
    var s = [];
    return {
      s: s,
      ui: function (v) { s.push({ t: 'ui', v: v }); },
      say: function (text, lang, rate) { s.push({ t: 'say', text: text, lang: lang || 'fr', rate: rate || 0.85 }); },
      turn: function (ms, label) { var st = { t: 'turn', ms: ms }; if (label) st.label = label; s.push(st); }
    };
  }

  // opts: { size, reads, silent, enFirst }. reads = times this text was already played to its end.
  function textSteps(chunk, opts) {
    opts = opts || {};
    var k = stepper();
    var fr = chunkText(chunk, 'fr'), en = chunkText(chunk, 'en');
    var frs = chunk.map(function (x) { return x.fr; });
    if (opts.silent) {
      k.ui({ phase: 'sent', fr: fr, en: en, caption: 'Lis-le', hint: 'Read it, then go on.' });
      k.turn(0);
      return k.s;
    }
    var reps = repeatsFor(opts.size === undefined ? 1 : opts.size, opts.reads);
    if (opts.enFirst) {
      // « Anglais d'abord »: the meaning first, then the French repeated (« Tout » too).
      k.ui({ phase: 'sent', fr: fr, en: en, caption: "En anglais d'abord", hint: 'First the English. Listen.' });
      chunk.forEach(function (x) { k.say(x.en, 'en', 0.9); });
      // His try in French before hearing it: longer than a repeat window.
      k.ui({ caption: 'À toi, en français', hint: 'Your turn: say it in French.' });
      k.turn(tryMs(frs.join(' ')));
      repeatFr(k, frs, Math.max(repeatsFor(1, opts.reads), REPEAT_EN));
      return k.s;
    }
    k.ui({ phase: 'sent', fr: fr, en: en, caption: 'Écoute', hint: 'Listen.' });
    if (!reps) {
      chunk.forEach(function (x) { k.say(x.fr); });
      return k.s;
    }
    repeatFr(k, frs, reps);
    return k.s;
  }

  // The French heard and repeated n times.
  function repeatFr(k, frs, n) {
    var all = frs.join(' ');
    for (var i = 1; i <= n; i++) {
      k.ui({ caption: 'Écoute', hint: 'Listen.' });
      frs.forEach(function (fr) { k.say(fr); });
      k.ui({ caption: 'Répète (' + i + '/' + n + ')', hint: 'Say it out loud.' });
      k.turn(repeatMs(all));
    }
  }

  // opts: { review, silent, enFirst }. review = he has met a variation of this structure before.
  function varSteps(v, opts) {
    opts = opts || {};
    var k = stepper(), ui = k.ui, say = k.say, turn = k.turn;
    if (opts.silent) {
      ui({ phase: 'var', fr: v.model, en: v.en, caption: 'Lis-la', hint: 'Same structure, a new sentence. Read it, then go on.' });
      turn(0);
      return k.s;
    }
    if (opts.enFirst) {
      ui({ phase: 'var', fr: v.model, en: v.en, caption: "En anglais d'abord", hint: 'Same structure, a new sentence. First the English.' });
      say(v.en, 'en', 0.9);
      ui({ caption: 'À toi, en français', hint: 'Your turn: say it in French.' });
      turn(tryMs(v.model));
      repeatFr(k, [v.model], REPEAT_EN);
      return k.s;
    }
    if (!opts.review) {
      ui({ phase: 'var', fr: v.model, en: v.en, caption: 'Même structure, autre phrase', hint: 'Same structure, a new sentence. Listen.' });
    } else {
      // He meets the structure again: the English first, his try, then the answer.
      ui({ phase: 'var', fr: v.model, en: v.en, caption: 'Dis-le en français', hint: 'Same structure. Say this in French.' });
      say(v.en, 'en', 0.9);
      ui({ caption: 'À toi, en français', hint: 'Your turn, in French.' });
      turn(tryMs(v.model));
    }
    // Either way: heard and repeated three times.
    repeatFr(k, [v.model], REPEAT_VAR);
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
      if (typeof r.reads !== 'number') r.reads = 0;
    }
    return state;
  }

  return {
    REPEAT_SENT: REPEAT_SENT, REPEAT_VAR: REPEAT_VAR, REPEAT_NEW: REPEAT_NEW, NEW_READS: NEW_READS,
    repeatMs: repeatMs, tryMs: tryMs,
    defaults: defaults, normalize: normalize, pickFreshest: pickFreshest,
    textRec: textRec, finishRead: finishRead, reads: reads, isDone: isDone, progress: progress, complete: complete, setPos: setPos,
    completeVar: completeVar, setVarPos: setVarPos, varProgress: varProgress,
    pickVariant: pickVariant, SIZES: SIZES, units: units, chunks: chunks, chunkIndex: chunkIndex, repeatsFor: repeatsFor, varList: varList,
    chunkText: chunkText, textSteps: textSteps, varSteps: varSteps
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
