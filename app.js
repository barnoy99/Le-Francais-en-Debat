/* Le Français en Débat — pick a text, then either the text alone (a sentence, a bite or
   a passage at a time, or whole) or its variations (each structure bent into a sentence of your life). One IIFE; lesson steps and progress live in core.js. */
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
                           // | 'silence' = no sound: read, guess, tap
  var SIZE_KEY = 'debat_chunk';

  // part: 'texte' (the sentences, cut at `size`: 1 phrase · 2 bouchée · 3 passage · 0 tout,
  // into run.chunks) | 'var' (the variations)
  var run = { active: false, paused: false, gen: 0, steps: [], idx: 0, text: null, part: 'texte',
              sents: [], chunks: [], vars: [], pos: 0, len: 1, size: 1, variant: null, timer: null, help: '' };

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
    if (v.fr !== undefined) {
      run.fr = v.fr;
      $('run-card').classList.toggle('run-card--long', v.fr.split(/\s+/).length > 40);
    }
    if (v.mask !== undefined) run.masked = v.mask;
    if (v.fr !== undefined || v.mask !== undefined) {
      $('run-fr').textContent = run.masked ? Core.mask(run.fr) : run.fr;
      $('run-fr').classList.toggle('masked', !!run.masked);
      $('run-card').scrollTop = 0;
    }
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
  // « Au calme » / « Silencieux »: as long as he wants, then the button.
  function startTurn(ms, next, label) {
    if (mode !== 'mains') {
      var btn = $('btn-next');
      btn.textContent = label || 'Suivant ›';
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
    if (run.idx >= run.steps.length) { finishItem(); return; }
    var st = run.steps[run.idx];
    var gen = run.gen;
    function next() {
      if (gen !== run.gen || run.paused) return;
      run.idx++;
      exec();
    }
    if (st.t === 'ui') { view(st.v); next(); }
    else if (st.t === 'say') speak(st.text, st.lang, st.rate, function () { setTimeout(next, 400); });
    else if (st.t === 'turn') startTurn(st.ms, next, st.label);
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
    if (mode === 'silence') { $('run-caption').textContent = run.help; return; }
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

  // ── Playing a part of a text ──────────────────────────
  // « Le texte »: run.pos = first sentence of the chunk, run.len = its length.
  // « Les variations »: run.pos = index in run.vars (one per structure).

  function items() { return run.part === 'var' ? run.vars : run.sents; }

  function playAt(pos) {
    if (!run.active) return;
    var list = items();
    if (pos >= list.length) { finishPart(); return; }
    pos = Math.max(0, pos);
    run.pos = pos;
    var silent = mode === 'silence';
    var who = '', count;
    if (run.part === 'texte') {
      var c = run.chunks[Core.chunkIndex(run.chunks, pos)];
      pos = run.pos = c.from;
      var chunk = run.sents.slice(c.from, c.from + c.len);
      run.len = c.len;
      Core.setPos(state, run.text.id, pos);
      run.variant = null;
      run.steps = Core.textSteps(chunk, { size: run.size, silent: silent });
      var one = chunk.every(function (x) { return x.who === chunk[0].who; });
      if (run.text.kind === 'dialogue' && one) who = chunk[0].who === 'lui' ? 'Ton ami' : 'Toi';
      count = run.len === 1 ? (pos + 1) + ' / ' + list.length : (pos + 1) + '–' + (pos + run.len) + ' / ' + list.length;
    } else {
      var entry = run.vars[pos];
      var frame = framesById[entry.f];
      run.len = 1;
      Core.setVarPos(state, run.text.id, pos);
      run.variant = Core.pickVariant(state, frame);
      run.steps = Core.varSteps(run.variant, { review: (state.vu[entry.f] || 0) > 0, silent: silent });
      who = frame.form;
      count = (pos + 1) + ' / ' + list.length;
    }
    run.idx = 0;
    run.gen++;
    run.paused = false;
    stopTimers();
    hide($('run-paused'));
    $('run-who').textContent = who;
    $('run-count').textContent = count;
    $('run-progress-fill').style.width = (100 * pos / list.length) + '%';
    $('btn-prev').disabled = pos === 0;
    exec();
  }

  function finishItem() {
    var id = run.text.id;
    if (run.part === 'texte') {
      for (var i = run.pos; i < run.pos + run.len; i++) Core.complete(state, id, i, null);
    } else {
      Core.completeVar(state, id, run.pos, run.vars[run.pos].f);
    }
    save();
    playAt(run.pos + run.len);
  }

  function prevItem() {
    if (!run.active || run.pos === 0) return;
    playAt(run.part === 'texte' ? run.chunks[Core.chunkIndex(run.chunks, run.pos) - 1].from : run.pos - 1);
  }

  function finishPart() {
    stopRun();
    save();
    $('done-title').textContent = run.text.title;
    $('done-note').textContent = run.part === 'texte'
      ? 'Quand tu le connais mieux, prends des morceaux plus longs : une bouchée, un passage, ou tout le texte.'
      : 'La prochaine fois, chaque structure revient avec une nouvelle phrase, en anglais d\'abord : c\'est toi qui la diras en français.';
    $('btn-done-again').textContent = run.part === 'texte' ? 'Relire ce texte' : 'Refaire les variations';
    showScreen('screen-done');
  }

  // part: 'texte' | 'var'. Resumes where he stopped unless fromStart (or finished).
  function openPart(part, fromStart) {
    var t = run.text;
    run.part = part;
    run.sents = SENTENCES[t.id].map(function (x) {
      return { fr: x.fr, en: x.en, f: x.f, who: t.lines[x.l].who };
    });
    run.chunks = Core.chunks(run.sents, run.size, CHUNKS[t.id]);
    run.vars = Core.varList(SENTENCES[t.id]);
    var p = part === 'texte' ? Core.progress(state, t.id, run.sents.length) : Core.varProgress(state, t.id, run.vars.length);
    var start = fromStart || p.finished ? 0 : p.pos;
    loadVoices();
    requestWakeLock();
    run.active = true;
    $('run-title').textContent = (part === 'texte' ? 'Le texte · ' : 'Variations · ') + t.title;
    $('size-toggle').classList.toggle('hidden', part !== 'texte');
    showScreen('screen-run');
    playAt(start);
  }

  function setSize(n) {
    run.size = n;
    try { localStorage.setItem(SIZE_KEY, String(n)); } catch (e) {}
    var btns = document.querySelectorAll('.size-btn');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', +btns[i].getAttribute('data-size') === n);
    // Mid-text: the chunk holding the current sentence at the new size (« Tout » = the top).
    if (run.active && run.part === 'texte') {
      run.chunks = Core.chunks(run.sents, n, CHUNKS[run.text.id]);
      playAt(run.pos);
    }
  }

  function leaveRun() {
    // The item in flight is the saved cursor (pos / vpos): reopening starts on it.
    stopRun();
    save();
    openChooser(run.text.id);
  }

  // ── One text: choose the part ─────────────────────────

  function partLine(p, unit) {
    if (p.finished) return 'Terminé · ' + p.total + ' ' + unit + ' ›';
    if (p.pos > 0) return 'Continuer · ' + (p.pos + 1) + ' / ' + p.total + ' ›';
    return 'Commencer · ' + p.total + ' ' + unit + ' ›';
  }

  function openChooser(textId) {
    var t = textsById[textId];
    run.text = t;
    state.lastText = textId;
    var pt = Core.progress(state, t.id, SENTENCES[t.id].length);
    var pv = Core.varProgress(state, t.id, Core.varList(SENTENCES[t.id]).length);
    $('choose-title').textContent = t.title;
    $('choose-text-action').textContent = partLine(pt, 'phrases');
    $('choose-var-action').textContent = partLine(pv, 'structures');
    $('choose-text-restart').classList.toggle('hidden', !(pt.pos > 0 && !pt.finished));
    $('choose-var-restart').classList.toggle('hidden', !(pv.pos > 0 && !pv.finished));
    showScreen('screen-choose');
  }

  // ── Home ──────────────────────────────────────────────

  var MODE_DESC = { mains: "Tout à l'oreille : l'appli fait une pause pour que tu répètes, puis continue toute seule.",
                    calme: "Tu lis, tu répètes à ton rythme, et tu touches « Suivant ».",
                    silence: "Aucun son : tu lis l'anglais, tu devines le français, puis tu touches « Voir »." };

  function setMode(m) {
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    $('mode-mains').classList.toggle('active', m === 'mains');
    $('mode-calme').classList.toggle('active', m === 'calme');
    $('mode-silence').classList.toggle('active', m === 'silence');
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
      var pv = Core.varProgress(state, t.id, Core.varList(SENTENCES[t.id]).length);
      main.appendChild(el('span', 'text-action', 'Texte ' + p.done + ' / ' + total + ' · Variations ' + pv.pos + ' / ' + pv.total + ' ›'));
      main.addEventListener('click', function () { openChooser(t.id); });
      li.appendChild(main);
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
    try { mode = localStorage.getItem(MODE_KEY); } catch (e) {}
    if (!MODE_DESC[mode]) mode = 'mains';
    setMode(mode);
    $('mode-mains').addEventListener('click', function () { setMode('mains'); });
    $('mode-calme').addEventListener('click', function () { setMode('calme'); });
    $('mode-silence').addEventListener('click', function () { setMode('silence'); });
    try { run.size = parseInt(localStorage.getItem(SIZE_KEY), 10); } catch (e) {}
    if (run.size === 4) run.size = 3;                    // v9 had 1·2·3·4·Tout
    if (Core.SIZES.indexOf(run.size) < 0) run.size = 1;
    setSize(run.size);
    var sizeBtns = document.querySelectorAll('.size-btn');
    for (var sb = 0; sb < sizeBtns.length; sb++) {
      sizeBtns[sb].addEventListener('click', function () { setSize(+this.getAttribute('data-size')); });
    }
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
    $('btn-replay').addEventListener('click', function () { if (run.active) playAt(run.pos); });
    $('btn-prev').addEventListener('click', prevItem);
    $('btn-skip').addEventListener('click', function () { if (run.active) playAt(run.pos + run.len); });
    $('btn-choose-home').addEventListener('click', function () { renderHome(); showScreen('screen-home'); });
    $('choose-text').addEventListener('click', function () { openPart('texte', false); });
    $('choose-var').addEventListener('click', function () { openPart('var', false); });
    $('choose-text-restart').addEventListener('click', function () { openPart('texte', true); });
    $('choose-var-restart').addEventListener('click', function () { openPart('var', true); });
    $('btn-explain').addEventListener('click', explainStep);
    $('run-tap').addEventListener('click', function (e) {
      if (inControl(e.target) || (mode !== 'mains' && !run.paused)) return;
      togglePause();
    });
    $('btn-done-again').addEventListener('click', function () { openPart(run.part, true); });
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
