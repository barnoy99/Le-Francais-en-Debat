/* Le Français en Débat — a hands-free speaking gym. One IIFE, like Quotidien.
   The scheduler, mastery rule and sync merge live in core.js (testable in node). */
(function () {
  'use strict';

  var STORAGE_KEY = 'debat_state';
  var QCACHE_KEY = 'debat_qcache';
  // Own path in the shared Firebase project. NEVER progress/user1: that is Quotidien.
  var DB_PATH = 'progress/debat';
  var Q_PROGRESS_URL = 'https://francais-quotidien-default-rtdb.firebaseio.com/progress/user1.json';
  var Q_DATA_URL = 'https://barnoy99.github.io/Le-Francais-au-Quotidien/data.js';
  var Q_TTL = 6 * 3600000;
  // ?local switches off Firebase and the Quotidien read (testing without touching live data).
  var LOCAL_ONLY = /[?&]local\b/.test(location.search);

  var state = null;
  var db = null;
  var cloudReadOk = false;
  var wakeLock = null;
  var audioCtx = null;
  var framesById = {};
  var qsent = [];          // his mastered Quotidien sentences, as substitution content
  var qmastered = {};      // Quotidien phrase ids he already owns
  var qinfo = null;        // { at, count } for the Progrès note
  var session = { start: 0, items: 0 };
  var voices = [];

  var run = { active: false, paused: false, gen: 0, steps: [], idx: 0, item: null,
              timer: null, waitLeft: 0, waitIdx: -1 };

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

  // ── Persistence: save after EVERY item, never at the end ──────────

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed.version) return Core.normalize(parsed);
      }
    } catch (e) {}
    return null;
  }

  function load(callback) {
    var localState = loadLocal();
    if (db) {
      db.ref(DB_PATH).once('value').then(function (snap) {
        var cloud = snap.val();
        state = Core.normalize(Core.pickFreshest(localState, cloud && cloud.version ? Core.normalize(cloud) : null));
        cloudReadOk = true;
        saveLocal();
        saveCloud();
        callback();
      }).catch(function () {
        // Cloud unknown: writing could clobber something newer. Stay local this
        // session; updatedAt means the work still wins the merge next time.
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

  // ── Quotidien link — READ ONLY ────────────────────────
  // Plain GETs, so nothing here can write. Progress tells us which phrases he
  // masters; its data.js gives their text. Cached; the app works without either.

  function applyQuotidien(cache) {
    qmastered = {};
    (cache.ids || []).forEach(function (id) { qmastered[id] = 1; });
    qsent = cache.sent || [];
    qinfo = { at: cache.at, count: (cache.ids || []).length, sentences: qsent.length };
  }

  function refreshQuotidien() {
    var cache = null;
    try { cache = JSON.parse(localStorage.getItem(QCACHE_KEY)); } catch (e) {}
    if (cache) applyQuotidien(cache);
    if (LOCAL_ONLY || !navigator.onLine) return;
    if (cache && Date.now() - cache.at < Q_TTL) return;

    var ids = null;
    fetch(Q_PROGRESS_URL).then(function (r) { return r.json(); }).then(function (progress) {
      ids = Core.masteredIds(progress);
      return fetch(Q_DATA_URL).then(function (r) { return r.text(); }).then(function (txt) {
        // His own site, his own data file; evaluated only to read PHRASES.
        var phrases = new Function(txt + ';return PHRASES;')();
        return Core.quotidienSentences(phrases, ids);
      }).catch(function () {
        // Progress arrived but data.js did not: keep the old sentences that still apply.
        var want = {}; ids.forEach(function (id) { want[id] = 1; });
        return ((cache && cache.sent) || []).filter(function (q) { return want[parseInt(q.k, 10)]; });
      });
    }).then(function (sent) {
      var fresh = { at: Date.now(), ids: ids, sent: sent };
      try { localStorage.setItem(QCACHE_KEY, JSON.stringify(fresh)); } catch (e) {}
      applyQuotidien(fresh);
    }).catch(function () { /* offline or blocked: keep whatever we had */ });
  }

  // ── Audio: TTS, beeps, wake-lock ──────────────────────

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
  // never fires onend, so a hands-free run cannot stall at the sink.
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

  function initAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }

  // 'go' = high beep (your turn), 'stop' = low beep (time).
  function playBeep(type, cb) {
    if (!audioCtx) { setTimeout(cb, 200); return; }
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = type === 'go' ? 880 : 440;
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {}
    setTimeout(cb, 260);
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

  // ── The runner: an item is a list of steps, driven by ear ──────
  // say / beep / wait run one after another; `ui` steps only repaint the mirror.
  // Pause cancels the current step and restarts it on resume (a speech engine
  // cannot resume mid-utterance), except a countdown, which keeps its remaining time.

  var RING_LEN = 2 * Math.PI * 35;

  function view(v) {
    if (v.label !== undefined) { $('run-label').textContent = v.label; $('run-label').className = 'run-label k-' + v.kind; }
    if (v.chip !== undefined) $('run-chip').textContent = v.chip;
    if (v.main !== undefined) {
      $('run-main').textContent = v.main;
      $('run-main').className = 'run-main' + (v.en ? ' en' : '') + (v.hush ? ' hush' : '');
    }
    if (v.sub !== undefined) $('run-sub').textContent = v.sub;
    if (v.caption !== undefined) $('run-caption').textContent = v.caption;
    if (v.ring === false) hide($('run-ring'));
  }

  function ringUpdate(left, total) {
    var fg = $('ring-fg');
    fg.style.strokeDasharray = RING_LEN;
    fg.style.strokeDashoffset = RING_LEN * (1 - left / total);
    var num = $('ring-num');
    num.textContent = left;
    num.className = 'ring-num' + (left >= 10 ? ' two-digit' : '');
  }

  function stopTimers() {
    if (run.timer) { clearInterval(run.timer); run.timer = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  function startWait(sec, next) {
    var gen = run.gen;
    var left = run.waitIdx === run.idx && run.waitLeft > 0 ? run.waitLeft : sec;
    run.waitIdx = run.idx;
    show($('run-ring'));
    var fg = $('ring-fg');
    fg.style.transition = 'none';
    ringUpdate(left, sec);
    void fg.getBoundingClientRect();
    fg.style.transition = '';
    run.waitLeft = left;
    run.timer = setInterval(function () {
      if (gen !== run.gen) { clearInterval(run.timer); return; }
      left--;
      run.waitLeft = left;
      if (left <= 0) {
        clearInterval(run.timer);
        run.timer = null;
        run.waitLeft = 0;
        run.waitIdx = -1;
        hide($('run-ring'));
        next();
        return;
      }
      ringUpdate(left, sec);
    }, 1000);
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
    else if (st.t === 'say') speak(st.text, st.lang, st.rate, next);
    else if (st.t === 'beep') playBeep(st.type, next);
    else if (st.t === 'wait') startWait(st.sec, next);
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

  function restartItem() {
    if (!run.active) return;
    run.gen++;
    stopTimers();
    run.paused = false;
    run.idx = 0;
    run.waitIdx = -1;
    hide($('run-paused'));
    exec();
  }

  function stopRun() {
    run.active = false;
    run.paused = false;
    run.gen++;
    stopTimers();
    releaseWakeLock();
  }

  // ── Building an item's steps ──────────────────────────

  var LABELS = { mise: 'Mise en bouche', recon: 'Reconstruction', sub: 'Substitution',
                 chain: 'Enchaînement', comp: 'Compréhension' };

  function promptOf(item) {
    if (item.q) return { fr: item.q.fr, topic: 'quotidien' };
    var found = null;
    Object.keys(framesById).forEach(function (id) {
      framesById[id].prompts.forEach(function (p) { if (p.id === item.p) found = p; });
    });
    return found;
  }

  function buildSteps(item) {
    var W = Core.WINDOW, s = [];
    var k = item.kind;
    function ui(v) { v.kind = v.kind || k; s.push({ t: 'ui', v: v }); }
    function say(text, lang, rate) { s.push({ t: 'say', text: text, lang: lang || 'fr', rate: rate || 0.9 }); }
    function beep(type) { s.push({ t: 'beep', type: type }); }
    function wait(sec) { s.push({ t: 'wait', sec: sec }); }
    var head = { label: LABELS[k], kind: k, chip: '', ring: false };

    if (k === 'mise') {
      var f = framesById[item.f];
      head.main = f.exemplarFr; head.sub = f.form; head.caption = 'Écoute';
      ui(head);
      say(f.exemplarFr, 'fr', 0.9);
      beep('go');
      ui({ caption: 'Répète tout de suite' });
      wait(W.mise);
      beep('stop');
    } else if (k === 'recon') {
      var r = framesById[item.f];
      head.main = r.gist; head.en = true; head.sub = ''; head.caption = 'Écoute le sens';
      ui(head);
      say(r.gist, 'en', 0.95);
      beep('go');
      ui({ caption: 'Dis-le en français' });
      wait(W.recon);
      beep('stop');
      ui({ main: r.exemplarFr, en: false, sub: r.form, caption: 'Le modèle' });
      say(r.exemplarFr, 'fr', 0.9);
      ui({ caption: 'Répète' });
      wait(W.reconRepeat);
    } else if (k === 'sub') {
      var sf = framesById[item.f];
      var p = promptOf(item);
      head.main = sf.exemplarFr; head.sub = sf.form; head.caption = 'La structure';
      ui(head);
      say(sf.exemplarFr, 'fr', 0.9);
      if (item.q) {
        ui({ main: p.fr, chip: 'Tes phrases', caption: 'Redis-la avec cette structure' });
        say('Redis cette phrase avec la structure.', 'fr', 1.0);
      } else {
        ui({ main: p.fr, chip: window.TOPICS[p.topic] || '', caption: 'Écoute la situation' });
      }
      say(p.fr, 'fr', 1.0);
      beep('go');
      ui({ caption: 'À toi' });
      wait(W.sub);
      beep('stop');
    } else if (k === 'chain') {
      var a = framesById[item.f[0]], b = framesById[item.f[1]];
      var cp = promptOf(item);
      head.main = ''; head.sub = a.form + '\n' + b.form; head.caption = 'Deux structures';
      ui(head);
      say(a.exemplarFr, 'fr', 0.9);
      say(b.exemplarFr, 'fr', 0.9);
      ui({ main: cp.fr, chip: window.TOPICS[cp.topic] || '', caption: 'Relie-les' });
      say('Relie-les avec « du coup », « n\'empêche » ou « cela dit ». Parle trente secondes de : ' + cp.fr, 'fr', 1.0);
      beep('go');
      ui({ caption: 'Parle sans t\'arrêter' });
      wait(W.chain);
      beep('stop');
    } else if (k === 'comp') {
      var lui = Core.luiText(window.TEXTS, item);
      head.main = '· · ·'; head.hush = true; head.sub = ''; head.caption = 'Écoute';
      ui(head);
      say(lui.fr, 'fr', 1.1);
      beep('go');
      ui({ caption: 'Réponds en français' });
      wait(W.comp);
      beep('stop');
      ui({ main: lui.fr, hush: false, caption: lui.model ? 'Un modèle' : '' });
      if (lui.model) {
        ui({ sub: lui.model });
        say(lui.model, 'fr', 1.0);
      }
    }
    return s;
  }

  // ── Serving items ─────────────────────────────────────

  function ctx() {
    return { now: Date.now(), frames: FRAMES, texts: TEXTS, qsent: qsent, qmastered: qmastered,
             sessionStart: session.start, sessionItems: session.items, rng: Math.random };
  }

  function updateCounter() {
    Core.rollDay(state, Date.now());
    $('run-counter').innerHTML = state.dayCount + '<small>aujourd\'hui</small>';
  }

  function advance() {
    if (!run.active) return;
    var item = state.current;
    if (!item) {
      item = Core.next(state, ctx());
      if (!item) return;
      state.current = item;
      save();
    }
    run.item = item;
    run.steps = buildSteps(item);
    run.idx = 0;
    run.waitIdx = -1;
    run.gen++;
    run.paused = false;
    hide($('run-paused'));
    updateCounter();
    exec();
  }

  function finishItem() {
    Core.commit(state, run.item, ctx(), null);
    save();
    session.items++;
    updateCounter();
    advance();
  }

  function skipItem() {
    if (!run.active) return;
    stopTimers();
    run.gen++;
    Core.skip(state, run.item, ctx());
    save();
    advance();
  }

  // A persisted item can outlive the data it points at (frame or text removed).
  function itemValid(item) {
    if (!item) return false;
    if (item.kind === 'comp') return !!Core.luiText(TEXTS, item);
    var ids = item.kind === 'chain' ? item.f : [item.f];
    for (var i = 0; i < ids.length; i++) if (!framesById[ids[i]]) return false;
    return item.kind === 'sub' || item.kind === 'chain' ? !!promptOf(item) : true;
  }

  function startSession() {
    if (!itemValid(state.current)) state.current = null;
    initAudio();
    loadVoices();
    requestWakeLock();
    session = { start: Date.now(), items: 0 };
    run.active = true;
    showScreen('screen-run');
    advance();
  }

  function leaveRun() {
    // The item in flight stays in state.current: reopening resumes on it.
    stopRun();
    save();
    updateHome();
    showScreen('screen-home');
  }

  // ── Home & Progrès ────────────────────────────────────

  function mastered() {
    var n = 0;
    FRAMES.forEach(function (fr) { if (Core.mastery(Core.frameRec(state, fr.id)).mastered) n++; });
    return n;
  }

  function span(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function updateHome() {
    var now = Date.now();
    Core.rollDay(state, now);
    var yesterday = state.dayHistory[Core.dayKey(now - Core.DAY)];
    var box = $('home-stats');
    box.innerHTML = '';
    var g1 = span('splash-group', '');
    g1.appendChild(span('splash-num', String(mastered())));
    g1.appendChild(document.createTextNode(' maîtrisées sur ' + FRAMES.length));
    var g2 = span('splash-group splash-group--day', '');
    g2.appendChild(span('splash-num', yesterday === undefined ? '—' : String(yesterday)));
    g2.appendChild(document.createTextNode(' hier · '));
    g2.appendChild(span('splash-num', String(state.dayCount)));
    g2.appendChild(document.createTextNode(' aujourd\'hui'));
    box.appendChild(g1);
    box.appendChild(g2);
    if (state.cycleStart) {
      var day = Core.daysBetweenKeys(state.cycleStart, Core.dayKey(now)) + 1;
      var seen = Object.keys(state.cycleSeen).length;
      var g3 = span('splash-group', 'Cycle ' + state.cycleNo + ' · Jour ' + day + ' · ' + seen + ' / ' + FRAMES.length +
        (state.cycleLast ? ' · dernier : ' + state.cycleLast + ' j' : ''));
      box.appendChild(g3);
    }
    $('btn-start-label').textContent = state.current ? 'Reprendre' : 'Commencer';
  }

  function ago(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 2) return 'à l\'instant';
    if (m < 90) return 'il y a ' + m + ' min';
    var h = Math.round(m / 60);
    if (h < 48) return 'il y a ' + h + ' h';
    return 'il y a ' + Math.round(h / 24) + ' jours';
  }

  function tile(cls, n, label) {
    var d = document.createElement('div');
    d.className = 'tile ' + cls;
    d.innerHTML = '<b>' + n + '</b><span>' + label + '</span>';
    return d;
  }

  function renderProgress() {
    var counts = { 'maîtrisée': 0, 'solide': 0, 'en cours': 0, 'nouvelle': 0 };
    var rows = FRAMES.map(function (fr) {
      var rec = Core.frameRec(state, fr.id);
      var st = Core.frameStatus(state.frames[fr.id]);
      counts[st]++;
      return { fr: fr, rec: rec, st: st, m: Core.mastery(rec) };
    });
    var box = $('progress-summary');
    box.innerHTML = '';
    box.appendChild(tile('tile--maitrisee', counts['maîtrisée'], 'maîtrisées'));
    box.appendChild(tile('tile--solide', counts['solide'], 'solides'));
    box.appendChild(tile('tile--cours', counts['en cours'], 'en cours'));
    box.appendChild(tile('tile--nouvelle', counts['nouvelle'], 'nouvelles'));

    var q = $('progress-quotidien');
    q.textContent = qinfo
      ? 'Quotidien (lecture seule) : ' + qinfo.count + ' phrases acquises, ' + qinfo.sentences + ' phrases utilisables, lu ' + ago(qinfo.at) + '.'
      : 'Quotidien : pas encore lu (hors ligne ou premier lancement).';
    q.textContent += ' Maîtrisée = 3 sujets différents, 3 jours différents. Sans reconnaissance vocale, un essai compte dès que tu as eu le temps de parler.';

    var order = { 'en cours': 0, 'solide': 1, 'maîtrisée': 2, 'nouvelle': 3 };
    rows.sort(function (a, b) { return order[a.st] - order[b.st] || a.fr.id.localeCompare(b.fr.id); });
    var list = $('progress-list');
    list.innerHTML = '';
    rows.forEach(function (r) {
      var li = document.createElement('li');
      li.appendChild(span('pf-form', r.fr.form));
      var meta = span('pf-meta', '');
      meta.appendChild(span('pf-status s-' + (r.st === 'en cours' ? 'cours' : r.st === 'maîtrisée' ? 'maitrisee' : r.st), r.st));
      meta.appendChild(document.createTextNode(r.m.days + ' / 3 jours · ' + r.m.topics + ' / 3 sujets · ' + r.rec.n + ' fois'));
      li.appendChild(meta);
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
    try {
      if (screen.orientation && screen.orientation.lock) {
        var r = screen.orientation.lock('portrait');
        if (r && r.catch) r.catch(function () {});
      }
    } catch (e) {}
    initFirebase();
    loadVoices();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = loadVoices;

    load(function () {
      state.sessionCount++;
      save();
      updateHome();
      refreshQuotidien();
    });

    $('btn-start').addEventListener('click', startSession);
    $('btn-run-home').addEventListener('click', leaveRun);
    $('btn-repeat').addEventListener('click', restartItem);
    $('btn-skip').addEventListener('click', skipItem);
    $('run-tap').addEventListener('click', function (e) {
      if (inControl(e.target)) return;
      togglePause();
    });
    $('btn-home-progress').addEventListener('click', function () {
      renderProgress();
      show($('overlay-progress'));
      $('overlay-progress').querySelector('.overlay-content').scrollTop = 0;
    });
    $('btn-progress-close').addEventListener('click', function () { hide($('overlay-progress')); });
    $('overlay-progress').addEventListener('click', function (e) {
      if (e.target === $('overlay-progress')) hide($('overlay-progress'));
    });

    // Screen off / app switched: the OS silences speech and throttles timers, so pause
    // cleanly rather than let the countdown run over nothing.
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
