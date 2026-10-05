/* Le Français en Débat — learn a text sentence by sentence, and bend each structure
   into a sentence of your own life. One IIFE; lesson steps and progress live in core.js. */
(function () {
  'use strict';

  var STORAGE_KEY = 'debat_state3';   // v3 = the sentence-by-sentence redesign (2026-10-05)
  // Own path in the shared Firebase project. NEVER progress/user1: that is Quotidien.
  var DB_PATH = 'progress/debat3';
  // ?local switches Firebase off (testing without touching live data).
  var LOCAL_ONLY = /[?&]local\b/.test(location.search);
  var MODE_KEY = 'debat_mode';

  var state = null;
  var db = null;
  var cloudReadOk = false;
  var wakeLock = null;
  var voices = [];
  var framesById = {};
  var textsById = {};
  var mode = 'mains';      // 'mains' = hands-free, paced by silences | 'calme' = tap « Suivant »

  var run = { active: false, paused: false, gen: 0, steps: [], idx: 0,
              text: null, sents: [], sidx: 0, variant: null, timer: null, help: '' };

  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function showScreen(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('screen--active');
    $(id).classList.add('screen--active');
  }

  // ── Firebase ──────────────────────────────────────────

  function initFirebase() {
    if (LOCAL_ONLY) return false;
    try {
      if (typeof firebase !== 'undefined' && typeof FIREBASE_CONFIG !== 'undefined') {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        return true;
      }
    } catch (e) { /* offline or blocked — local only */ }
    return false;
  }

  // ── Persistence: save after every sentence ────────────

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed.version === 2) return Core.normalize(parsed);
      }
    } catch (e) {}
    return null;
  }

  function load(callback) {
    var localState = loadLocal();
    if (db) {
      db.ref(DB_PATH).once('value').then(function (snap) {
        var cloud = snap.val();
        state = Core.normalize(Core.pickFreshest(localState, cloud && cloud.version === 2 ? Core.normalize(cloud) : null));
        cloudReadOk = true;
        saveLocal();
        saveCloud();
        callback();
      }).catch(function () {
        // Cloud unknown: writing could clobber something newer. Stay local this session.
        cloudReadOk = false;
        state = localState || Core.defaults();
        callback();
      });
    } else {
      state = localState || Core.defaults();
      callback();
    }
  }

  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function saveCloud() {
    if (db && cloudReadOk) {
      try { db.ref(DB_PATH).set(state); } catch (e) {}
    }
  }

  function save() {
    state.updatedAt = Date.now();
    saveLocal();
    saveCloud();
  }

  // ── Audio: TTS, wake-lock ─────────────────────────────

  function loadVoices() {
    if ('speechSynthesis' in window) voices = speechSynthesis.getVoices() || [];
  }

  function pickVoice(prefix) {
    var best = null;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].lang.replace('_', '-').indexOf(prefix) === 0) {
        if (!best) best = voices[i];
        if (voices[i].lang.replace('_', '-') === (prefix === 'fr' ? 'fr-FR' : 'en-GB')) return voices[i];
      }
    }
    return best;
  }

  // Speaks `text`, then calls cb once. A fallback timer covers a silent engine that
  // never fires onend, so a hands-free run cannot stall.
  function speak(text, lang, rate, cb) {
    if (!('speechSynthesis' in window)) { setTimeout(cb, 1500); return; }
    var done = false;
    var fallback = null;
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      cb();
    }
    var u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'en' ? 'en-GB' : 'fr-FR';
    u.rate = rate;
    var v = pickVoice(lang === 'en' ? 'en' : 'fr');
    if (v) u.voice = v;
    u.onend = finish;
    u.onerror = finish;
    var words = text.split(/\s+/).length;
    fallback = setTimeout(finish, Math.max(3000, words * 650 / rate + 2500));
    speechSynthesis.speak(u);
  }

  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (wl) {
      wakeLock = wl;
      wl.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }

  // ── The runner: one sentence = a list of steps ────────
  // Pause cancels the current step and restarts it on resume (a speech engine
  // cannot resume mid-utterance).

  function view(v) {
    if (v.phase !== undefined) {
      var isVar = v.phase === 'var';
      $('run-card').className = 'run-card' + (isVar ? ' run-card--var' : '');
      $('run-tag').textContent = isVar ? 'À ta façon' : 'Le texte';
    }
    if (v.fr !== undefined) $('run-fr').textContent = v.fr;
    if (v.en !== undefined) $('run-en').textContent = v.en;
    if (v.hideFr !== undefined) $('run-fr').classList.toggle('faded', v.hideFr);
    if (v.caption !== undefined) {
      $('run-caption').textContent = v.caption;
      run.help = v.hint || '';
    }
  }

  function stopTimers() {
    hide($('btn-next'));
    hide($('run-bar-time'));
    if (run.timer) { clearTimeout(run.timer); run.timer = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  // His turn. « Mains libres »: a silence sized to the sentence, with a thin bar.
  // « Au calme »: as long as he wants, then « Suivant ».
  function startTurn(ms, next) {
    if (mode === 'calme') {
      var btn = $('btn-next');
      show(btn);
      btn.onclick = function () { hide(btn); btn.onclick = null; next(); };
      return;
    }
    var bar = $('run-bar-time');
    var fill = $('run-bar-fill');
    show(bar);
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.getBoundingClientRect();
    fill.style.transition = 'width ' + ms + 'ms linear';
    fill.style.width = '100%';
    run.timer = setTimeout(function () { run.timer = null; hide(bar); next(); }, ms);
  }

  function exec() {
    if (!run.active || run.paused) return;
    if (run.idx >= run.steps.length) { finishSentence(); return; }
    var st = run.steps[run.idx];
    var gen = run.gen;
    function next() {
      if (gen !== run.gen || run.paused) return;
      run.idx++;
      exec();
    }
    if (st.t === 'ui') { view(st.v); next(); }
    else if (st.t === 'say') speak(st.text, st.lang, st.rate, function () { setTimeout(next, 400); });
    else if (st.t === 'turn') startTurn(st.ms, next);
  }

  function pauseRun() {
    if (!run.active || run.paused) return;
    run.paused = true;
    run.gen++;
    stopTimers();
    show($('run-paused'));
  }

  function resumeRun() {
    if (!run.active || !run.paused) return;
    run.paused = false;
    hide($('run-paused'));
    exec();
  }

  function togglePause() { if (run.paused) resumeRun(); else pauseRun(); }

  // « ? »: say the current instruction in English, then carry on.
  function explainStep() {
    if (!run.active || !run.help) return;
    var wasPaused = run.paused;
    if (!wasPaused) pauseRun();
    speak(run.help, 'en', 0.9, function () { if (!wasPaused && run.paused) resumeRun(); });
  }

  function stopRun() {
    run.active = false;
    run.paused = false;
    run.gen++;
    stopTimers();
    releaseWakeLock();
  }

  // ── Sentences ─────────────────────────────────────────

  function playSentence(idx) {
    if (!run.active) return;
    if (idx >= run.sents.length) { finishText(); return; }
    run.sidx = idx;
    Core.setPos(state, run.text.id, idx);
    var sent = run.sents[idx];
    var frame = sent.f ? framesById[sent.f] : null;
    run.variant = Core.pickVariant(state, frame);
    var review = Core.isDone(state, run.text.id, idx);
    run.steps = Core.buildSteps(sent, { variant: run.variant, review: review });
    run.idx = 0;
    run.gen++;
    run.paused = false;
    stopTimers();
    hide($('run-paused'));
    var line = run.text.lines[sent.l];
    $('run-who').textContent = run.text.kind === 'dialogue' ? (line.who === 'lui' ? 'Ton ami' : 'Toi') : '';
    $('run-count').textContent = (idx + 1) + ' / ' + run.sents.length;
    $('run-progress-fill').style.width = (100 * idx / run.sents.length) + '%';
    $('btn-prev').disabled = idx === 0;
    exec();
  }

  function finishSentence() {
    Core.complete(state, run.text.id, run.sidx, run.variant ? run.sents[run.sidx].f : null);
    save();
    playSentence(run.sidx + 1);
  }

  function finishText() {
    stopRun();
    save();
    $('done-title').textContent = run.text.title;
    showScreen('screen-done');
  }

  function openText(textId, fromStart) {
    var t = textsById[textId];
    if (!t) return;
    run.text = t;
    run.sents = SENTENCES[t.id];
    var p = Core.progress(state, t.id, run.sents.length);
    var start = fromStart || p.finished ? 0 : p.pos;
    loadVoices();
    requestWakeLock();
    run.active = true;
    $('run-title').textContent = t.title;
    showScreen('screen-run');
    playSentence(start);
  }

  function leaveRun() {
    // The sentence in flight is state.texts[..].pos: reopening starts on it.
    stopRun();
    save();
    renderHome();
    showScreen('screen-home');
  }

  // ── Home ──────────────────────────────────────────────

  var MODE_DESC = { mains: "Tout à l'oreille : l'appli fait une pause pour que tu répètes, puis continue toute seule.",
                    calme: "Tu lis, tu répètes à ton rythme, et tu touches « Suivant »." };

  function setMode(m) {
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    $('mode-mains').classList.toggle('active', m === 'mains');
    $('mode-calme').classList.toggle('active', m === 'calme');
    $('mode-desc').textContent = MODE_DESC[m];
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderHome() {
    var list = $('text-list');
    list.innerHTML = '';
    TEXTS.forEach(function (t) {
      var total = SENTENCES[t.id].length;
      var p = Core.progress(state, t.id, total);
      var li = el('li', 'text-card' + (t.id === state.lastText ? ' text-card--last' : ''));
      var main = el('button', 'text-main');
      main.appendChild(el('span', 'text-kind', (t.corpus === 'A' ? 'Dieu' : 'Israël') + ' · ' + (t.kind === 'dialogue' ? 'dialogue' : 'monologue')));
      main.appendChild(el('span', 'text-title', t.title));
      var bar = el('span', 'text-bar');
      var fill = el('span', 'text-bar-fill');
      fill.style.width = (100 * p.done / total) + '%';
      bar.appendChild(fill);
      main.appendChild(bar);
      var action = p.finished ? 'Réviser ›' : p.pos > 0 ? 'Continuer · ' + (p.pos + 1) + ' / ' + total + ' ›' : 'Commencer ›';
      main.appendChild(el('span', 'text-action', action));
      main.addEventListener('click', function () { openText(t.id, false); });
      li.appendChild(main);
      if (p.pos > 0 && !p.finished) {
        var again = el('button', 'text-restart', '↺ Depuis le début');
        again.addEventListener('click', function () { openText(t.id, true); });
        li.appendChild(again);
      }
      list.appendChild(li);
    });
  }

  // ── Setup ─────────────────────────────────────────────

  function inControl(node) {
    while (node && node !== document.body) {
      if (node.tagName === 'BUTTON' || node.tagName === 'A') return true;
      node = node.parentNode;
    }
    return false;
  }

  function setup() {
    FRAMES.forEach(function (fr) { framesById[fr.id] = fr; });
    TEXTS.forEach(function (t) { textsById[t.id] = t; });
    try {
      if (screen.orientation && screen.orientation.lock) {
        var r = screen.orientation.lock('portrait');
        if (r && r.catch) r.catch(function () {});
      }
    } catch (e) {}
    try { mode = localStorage.getItem(MODE_KEY) === 'calme' ? 'calme' : 'mains'; } catch (e) {}
    setMode(mode);
    $('mode-mains').addEventListener('click', function () { setMode('mains'); });
    $('mode-calme').addEventListener('click', function () { setMode('calme'); });
    initFirebase();
    loadVoices();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = loadVoices;

    load(function () {
      state.sessionCount++;
      save();
      renderHome();
      var seen = false;
      try { seen = !!localStorage.getItem('debat_help3_seen'); localStorage.setItem('debat_help3_seen', '1'); } catch (e) {}
      if (!seen) show($('overlay-help'));
    });

    $('btn-help').addEventListener('click', function () { show($('overlay-help')); });
    $('btn-help-close').addEventListener('click', function () { hide($('overlay-help')); });
    $('btn-run-home').addEventListener('click', leaveRun);
    $('btn-replay').addEventListener('click', function () { if (run.active) playSentence(run.sidx); });
    $('btn-prev').addEventListener('click', function () { if (run.active && run.sidx > 0) playSentence(run.sidx - 1); });
    $('btn-skip').addEventListener('click', function () { if (run.active) playSentence(run.sidx + 1); });
    $('btn-explain').addEventListener('click', explainStep);
    $('run-tap').addEventListener('click', function (e) {
      if (inControl(e.target) || (mode === 'calme' && !run.paused)) return;
      togglePause();
    });
    $('btn-done-again').addEventListener('click', function () { openText(run.text.id, true); });
    $('btn-done-home').addEventListener('click', function () { renderHome(); showScreen('screen-home'); });

    // Screen off / app switched: the OS silences speech and throttles timers, so pause.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (run.active) pauseRun(); }
      else if (run.active) requestWakeLock();
    });

    if ('serviceWorker' in navigator && !LOCAL_ONLY) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  document.addEventListener('DOMContentLoaded', setup);
})();
