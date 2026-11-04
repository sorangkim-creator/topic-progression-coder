/*
 * app.js — UI for the Topic Progression Coder.
 * Everything runs locally in the browser; data is kept in localStorage and
 * exported through Blob downloads. No network requests except loading the
 * static files of this site (codebook.json, the sample CSV).
 */
(function () {
  'use strict';

  var APP_VERSION = '1.0.0';
  // Optional per-site settings (set window.TPC_CONFIG in index.html). Copies of this tool on the same
  // github.io domain share browser storage, so each copy must use its own storePrefix.
  var CFG = window.TPC_CONFIG || {};
  var PFX = CFG.storePrefix || 'tpc';
  var STORE = { project: PFX + '.project.v1', codebook: PFX + '.codebook.v1', ui: PFX + '.ui.v1', consensus: PFX + '.consensus.v1' };
  var RESERVED_KEYS = ['j', 'k', 's', 't', 'm', 'f', '[', ']', '?', 'arrowup', 'arrowdown'];
  var EMPTY_CODEBOOK = { codebookId: '', version: '', progressionTypes: [], genreStages: [], topicMarkers: {}, principles: [], segmentation: null };

  var S = {
    cb: EMPTY_CODEBOOK, cbSource: 'none',
    p: null,
    ui: { lang: 'en', view: 'code', review: null, active: 0, filterLang: '', filterScope: 'all', autoAdvance: false },
    keymap: {},
    idx: {},           // review_id -> array of global sentence indices
    lastSel: null,     // {key, start, end} — last text selection inside the active sentence
    rel: { A: null, B: null, result: null },
    cons: null,
    saveTimer: null
  };

  // ------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  function t(key, vars) { return window.I18N.t(S.ui.lang, key, vars); }
  function L(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[S.ui.lang] || obj.en || obj.ko || obj[Object.keys(obj)[0]] || '';
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') e[k] = !!v;
      else e.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function loadJSON(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { banner(t('err.storage', { msg: e.message }), true); return false; }
  }
  function toast(msg) {
    var n = $('toast'); n.textContent = msg; n.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(function () { n.classList.add('hidden'); }, 2600);
  }
  function banner(msg, isError) {
    var b = $('banner');
    if (!msg) { b.classList.add('hidden'); return; }
    b.textContent = msg; b.className = 'banner' + (isError ? ' error' : '');
  }
  function today() { var d = new Date(); return d.toISOString().slice(0, 10); }
  function safeName(s) { return String(s || '').replace(/[^\w.-]+/g, '_') || 'coder'; }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function readFile(input, cb) {
    var f = input.files && input.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { cb(String(r.result), f.name); input.value = ''; };
    r.onerror = function () { toast(t('err.read')); input.value = ''; };
    r.readAsText(f, 'utf-8');
  }
  function fmt(x, d) { return (x == null || isNaN(x)) ? '—' : x.toFixed(d == null ? 3 : d); }
  function pct(x) { return (x == null || isNaN(x)) ? '—' : (x * 100).toFixed(1) + '%'; }
  function isCoded(s) { return !!(s.code && s.code.type && s.code.stage); }

  // ------------------------------------------------------------ codebook
  function validateCodebook(cb) {
    var errors = [], warnings = [], keys = {};
    if (!cb || typeof cb !== 'object') return { errors: ['not an object'], warnings: [] };
    ['progressionTypes', 'genreStages', 'principles'].forEach(function (f) {
      if (!Array.isArray(cb[f])) errors.push('"' + f + '" must be an array');
    });
    if (errors.length) return { errors: errors, warnings: warnings };
    function checkList(name, list) {
      var ids = {};
      list.forEach(function (o, i) {
        if (!o || !o.id) { errors.push(name + '[' + i + '] has no id'); return; }
        if (ids[o.id]) errors.push(name + ': duplicate id "' + o.id + '"');
        ids[o.id] = true;
        if (o.key) {
          var k = String(o.key).toLowerCase();
          if (RESERVED_KEYS.indexOf(k) >= 0) warnings.push(name + ' "' + o.id + '": key "' + o.key + '" is reserved and ignored');
          else if (keys[k]) warnings.push('key "' + o.key + '" used twice (' + keys[k] + ', ' + o.id + ')');
          else keys[k] = o.id;
        }
      });
    }
    checkList('progressionTypes', cb.progressionTypes);
    checkList('genreStages', cb.genreStages);
    var markers = cb.topicMarkers || {};
    TPC.LANGS.forEach(function (l) { if (Array.isArray(markers[l])) checkList('topicMarkers.' + l, markers[l]); });
    if (cb.principles.length !== 4) warnings.push('expected 4 principles, found ' + cb.principles.length);
    return { errors: errors, warnings: warnings };
  }

  function setCodebook(cb, source) {
    var v = validateCodebook(cb);
    if (v.errors.length) { banner(t('err.codebook', { msg: v.errors.join('; ') }), true); return false; }
    S.cb = cb; S.cbSource = source;
    saveJSON(STORE.codebook, cb);
    buildKeymap();
    var msgs = v.warnings.slice();
    if (S.p && S.p.codebookVersion && cb.version && S.p.codebookVersion !== cb.version) {
      msgs.unshift(t('warn.cbVersion', { p: S.p.codebookVersion, c: cb.version }));
    }
    banner(msgs.length ? msgs.join(' · ') : '');
    return true;
  }

  function loadCodebookFromServer(silent) {
    // codebookUrl lets a language copy read the shared codebook of the main site; the local copy is the fallback.
    var getLocal = function () { return fetch('codebook.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); };
    var first = CFG.codebookUrl
      ? fetch(CFG.codebookUrl, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(getLocal)
      : getLocal();
    return first
      .then(function (cb) { if (setCodebook(cb, 'server') && !silent) toast(t('ok.codebook', { v: cb.version })); })
      .catch(function () {
        var cached = loadJSON(STORE.codebook);
        if (cached && setCodebook(cached, 'cache')) {
          if (!silent) toast(t('warn.cbCached'));
        } else {
          banner(t('warn.cbMissing'), true);
        }
      });
  }

  function buildKeymap() {
    var m = {};
    function add(list, variable) {
      (list || []).forEach(function (o) {
        if (!o.key) return;
        var k = String(o.key).toLowerCase();
        if (RESERVED_KEYS.indexOf(k) >= 0 || m[k]) return;
        m[k] = { variable: variable, id: o.id };
      });
    }
    add(S.cb.progressionTypes, 'type');
    add(S.cb.genreStages, 'stage');
    S.keymap = m;
  }
  function markersFor(lang) { return (S.cb.topicMarkers && Array.isArray(S.cb.topicMarkers[lang])) ? S.cb.topicMarkers[lang] : []; }
  function labelOf(variable, id, lang) {
    if (!id) return '';
    var list = variable === 'type' ? S.cb.progressionTypes : variable === 'stage' ? S.cb.genreStages : markersFor(lang);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return L(list[i].label) || id;
    if (variable === 'marker') {
      for (var j = 0; j < TPC.LANGS.length; j++) {
        var ml = markersFor(TPC.LANGS[j]);
        for (var q = 0; q < ml.length; q++) if (ml[q].id === id) return L(ml[q].label) || id;
      }
      return id;
    }
    return id + ' (?)';
  }

  // ------------------------------------------------------------ project
  function newProject(reviews) {
    return {
      schema: 'tpc-project', schemaVersion: 1, appVersion: APP_VERSION,
      coderId: S.p ? S.p.coderId : '',
      codebookId: S.cb.codebookId || '', codebookVersion: S.cb.version || '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      reviews: reviews,
      sentences: TPC.buildSentences(reviews, S.cb.segmentation),
      sample: null, origin: null
    };
  }
  function rebuildIndex() {
    S.idx = {};
    if (!S.p) return;
    S.p.sentences.forEach(function (s, i) { (S.idx[s.review_id] = S.idx[s.review_id] || []).push(i); });
  }
  function hasData() { return !!(S.p && S.p.reviews && S.p.reviews.length); }
  function inSample(rid) { return !!(S.p && S.p.sample && S.p.sample.ids.indexOf(rid) >= 0); }

  function touch() {
    if (!S.p) return;
    S.p.updatedAt = new Date().toISOString();
    $('saveState').textContent = t('save.pending');
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveNow, 400);
  }
  function saveNow() {
    clearTimeout(S.saveTimer);
    if (S.p && saveJSON(STORE.project, S.p)) {
      $('saveState').textContent = t('save.saved', { time: new Date().toLocaleTimeString() });
    }
    saveJSON(STORE.ui, S.ui);
  }

  function validateProject(obj) {
    if (!obj || obj.schema !== 'tpc-project' || !Array.isArray(obj.reviews) || !Array.isArray(obj.sentences)) return false;
    return obj.sentences.every(function (s) { return s && s.review_id != null && typeof s.text === 'string' && typeof s.idx === 'number'; });
  }
  function normalizeProject(obj) {
    obj.sentences.forEach(function (s) { s.code = Object.assign(TPC.emptyCode(), s.code || {}); });
    return obj;
  }

  // ------------------------------------------------------------ filtering
  function reviewProgress(rid) {
    var ids = S.idx[rid] || [], done = 0;
    ids.forEach(function (i) { if (isCoded(S.p.sentences[i])) done++; });
    return { done: done, total: ids.length };
  }
  function filteredReviews() {
    if (!hasData()) return [];
    return S.p.reviews.filter(function (r) {
      if (S.ui.filterLang && r.lang !== S.ui.filterLang) return false;
      if (S.ui.filterScope === 'sample' && !inSample(r.review_id)) return false;
      if (S.ui.filterScope === 'todo') { var pr = reviewProgress(r.review_id); if (pr.done === pr.total) return false; }
      return true;
    });
  }
  function currentReview() {
    if (!hasData()) return null;
    var r = S.p.reviews.filter(function (x) { return x.review_id === S.ui.review; })[0];
    if (!r) { var f = filteredReviews(); r = f[0] || S.p.reviews[0]; S.ui.review = r.review_id; S.ui.active = 0; }
    return r;
  }
  function currentSentences() { var r = currentReview(); return r ? (S.idx[r.review_id] || []) : []; }
  function activeGlobalIndex() {
    var ids = currentSentences();
    if (!ids.length) return -1;
    if (S.ui.active >= ids.length) S.ui.active = ids.length - 1;
    if (S.ui.active < 0) S.ui.active = 0;
    return ids[S.ui.active];
  }

  // ------------------------------------------------------------ i18n
  function applyI18n() {
    document.documentElement.lang = S.ui.lang;
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (n) { n.placeholder = t(n.getAttribute('data-i18n-ph')); });
    document.querySelectorAll('[data-ui-lang]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-ui-lang') === S.ui.lang); });
    document.title = t('app.title');
  }

  // ------------------------------------------------------------ render: top
  function renderTop() {
    $('cbVersion').textContent = S.cb.version ? t('cb.versionShort', { v: S.cb.version }) : t('cb.none');
    var c = $('coderId');
    if (document.activeElement !== c) c.value = S.p ? (S.p.coderId || '') : '';
    c.classList.toggle('missing', hasData() && !c.value.trim());
    var total = 0, done = 0, perLang = {};
    if (S.p) S.p.sentences.forEach(function (s) {
      total++; var ok = isCoded(s); if (ok) done++;
      var pl = perLang[s.lang] = perLang[s.lang] || { d: 0, n: 0 }; pl.n++; if (ok) pl.d++;
    });
    $('progressFill').style.width = total ? (done / total * 100).toFixed(1) + '%' : '0';
    $('progressText').textContent = t('progress.text', { done: done, total: total, pct: total ? Math.round(done / total * 100) : 0 });
    $('progressWrap').title = Object.keys(perLang).map(function (l) { return l + ': ' + perLang[l].d + '/' + perLang[l].n; }).join('  ') + '\n' + t('progress.rule');
    var ptxt = S.cb.principles.map(function (p) { return L(p.title) + ': ' + L(p.text); }).join('\n\n');
    $('principleChip').title = ptxt || t('cb.none');
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === S.ui.view); });
    ['code', 'double', 'data'].forEach(function (v) { $('view-' + v).classList.toggle('hidden', v !== S.ui.view); });
  }

  // ------------------------------------------------------------ render: coding
  function renderSidePanel() {
    var pl = clear($('principleList'));
    S.cb.principles.forEach(function (p) { pl.appendChild(el('li', { title: L(p.text) }, [el('b', { text: L(p.title) }), L(p.text)])); });

    var dl = clear($('defList'));
    function section(title, list) {
      dl.appendChild(el('h4', { text: title }));
      var d = el('dl');
      list.forEach(function (o) {
        d.appendChild(el('dt', {}, [o.key ? el('kbd', { text: String(o.key).toUpperCase() }) : null, ' ', L(o.label)]));
        d.appendChild(el('dd', { text: L(o.definition) }));
        if (o.example && L(o.example)) d.appendChild(el('dd', { text: t('defs.example') + ' ' + L(o.example) }));
      });
      dl.appendChild(d);
    }
    section(t('field.type'), S.cb.progressionTypes);
    section(t('field.stage'), S.cb.genreStages);
    var r = currentReview();
    if (r) {
      var ms = markersFor(r.lang);
      dl.appendChild(el('h4', { text: t('field.marker') + ' (' + r.lang + ')' }));
      dl.appendChild(el('div', { class: 'small', text: ms.map(function (m) { return L(m.label); }).join(' · ') || '—' }));
    }

    var kh = clear($('keyHelp'));
    function line(keys, label) { kh.appendChild(el('div', {}, keys.map(function (k) { return el('kbd', { text: k }); }).concat([' ' + label]))); }
    line(['1'].concat(S.cb.progressionTypes.length > 1 ? ['…'] : []), t('keys.type'));
    line(S.cb.genreStages.filter(function (s) { return s.key; }).map(function (s) { return s.key.toUpperCase(); }), t('keys.stage'));
    line(['↓', 'J'], t('keys.next')); line(['↑', 'K'], t('keys.prev'));
    line(['['], t('keys.prevReview')); line([']'], t('keys.nextReview'));
    line(['S'], t('keys.selection')); line(['T'], t('keys.topic')); line(['F'], t('keys.marker')); line(['M'], t('keys.memo'));
    line(['Esc'], t('keys.esc'));
    var auto = el('label', { class: 'small' }, [
      el('input', { type: 'checkbox', checked: S.ui.autoAdvance, onchange: function (e) { S.ui.autoAdvance = e.target.checked; saveJSON(STORE.ui, S.ui); } }),
      ' ' + t('keys.autoAdvance')
    ]);
    kh.appendChild(auto);
  }

  function renderReviewList() {
    var ul = clear($('reviewList'));
    filteredReviews().forEach(function (r) {
      var pr = reviewProgress(r.review_id);
      ul.appendChild(el('li', {
        class: r.review_id === S.ui.review ? 'active' : '',
        onclick: function () { S.ui.review = r.review_id; S.ui.active = 0; renderCoding(); saveJSON(STORE.ui, S.ui); }
      }, [
        el('span', {}, [el('span', { class: 'rid', text: r.review_id }), el('span', { class: 'lang', text: r.lang }),
          inSample(r.review_id) ? el('span', { class: 'sample-dot', title: t('review.inSample'), text: '●' }) : null]),
        el('span', { class: 'cnt' + (pr.done === pr.total ? ' done' : ''), text: pr.done + '/' + pr.total })
      ]));
    });
  }

  function textWithTopic(s) {
    var c = s.code, txt = s.text, start = c.topicStart, end = c.topicEnd;
    if ((start == null || txt.slice(start, end) !== c.topic) && c.topic) {
      start = txt.indexOf(c.topic); end = start + c.topic.length;
    }
    if (start == null || start < 0 || !c.topic) return [txt];
    return [txt.slice(0, start), el('mark', { text: txt.slice(start, end) }), txt.slice(end)];
  }

  function chipsFor(s) {
    var c = s.code, out = [];
    if (c.topic) out.push(el('span', { class: 'chip topic', text: c.topic }));
    if (c.type) out.push(el('span', { class: 'chip type', text: labelOf('type', c.type) }));
    if (c.stage) out.push(el('span', { class: 'chip stage', text: labelOf('stage', c.stage) }));
    if (c.marker) out.push(el('span', { class: 'chip marker', text: labelOf('marker', c.marker, s.lang) }));
    if (c.memo) out.push(el('span', { class: 'chip memo', title: c.memo, text: '✎ ' + (c.memo.length > 24 ? c.memo.slice(0, 24) + '…' : c.memo) }));
    return out.length ? el('div', { class: 'chips' }, out) : null;
  }

  function renderCoding() {
    renderTop();
    var empty = !hasData();
    $('emptyState').classList.toggle('hidden', !empty);
    renderReviewList();
    renderSidePanel();
    var list = clear($('sentenceList')), head = clear($('reviewHeader'));
    if (empty) return;
    var r = currentReview(), ids = currentSentences(), pr = reviewProgress(r.review_id);
    head.appendChild(el('h2', { text: r.review_id }));
    head.appendChild(el('span', { class: 'meta', text: r.lang + ' · ' + t('review.progress', { done: pr.done, total: pr.total }) + (inSample(r.review_id) ? ' · ' + t('review.inSample') : '') }));
    var activeG = activeGlobalIndex();
    ids.forEach(function (g, pos) {
      var s = S.p.sentences[g], active = g === activeG;
      var textNode = el('div', { class: 'sent-text', 'data-key': TPC.sentenceKey(s) }, textWithTopic(s));
      var li = el('li', { class: 'sent' + (active ? ' active' : '') + (isCoded(s) ? ' coded' : ''), 'data-pos': pos }, [
        el('div', { class: 'sent-head' }, [el('span', { class: 'sent-no', text: '#' + (s.idx + 1) }), textNode]),
        active ? codingForm(s, g) : chipsFor(s)
      ]);
      if (!active) li.addEventListener('click', function () { S.ui.active = pos; S.lastSel = null; renderCoding(); });
      list.appendChild(li);
    });
    var act = list.querySelector('.sent.active');
    if (act && renderCoding.scroll !== false) act.scrollIntoView({ block: 'nearest' });
  }

  function setCode(g, field, value, rerender) {
    var s = S.p.sentences[g];
    s.code[field] = value;
    touch();
    if (rerender !== false) {
      if (S.ui.autoAdvance && (field === 'type' || field === 'stage') && isCoded(s)) { move(1); return; }
      renderCoding();
    }
  }

  function optionButtons(s, g, variable, list) {
    return el('div', { class: 'opts' }, list.map(function (o) {
      var on = s.code[variable] === o.id;
      return el('button', {
        class: 'opt ' + variable + (on ? ' on' : ''), type: 'button',
        title: L(o.definition) || '',
        onclick: function () { setCode(g, variable, on ? '' : o.id); }
      }, [o.key ? el('kbd', { text: String(o.key).toUpperCase() }) : null, L(o.label) || o.id]);
    }));
  }

  function codingForm(s, g) {
    var c = s.code;
    var topicInput = el('input', {
      type: 'text', id: 'inTopic', value: c.topic, placeholder: t('field.topicPh'),
      oninput: function (e) {
        var v = e.target.value;
        c.topic = v;
        if (c.topicStart != null && s.text.slice(c.topicStart, c.topicEnd) !== v) { c.topicStart = null; c.topicEnd = null; }
        touch();
      },
      onchange: function () { renderCoding.scroll = false; renderCoding(); renderCoding.scroll = true; }
    });
    var selBtn = el('button', { type: 'button', title: t('field.useSelectionTip'), onclick: useSelection }, [el('kbd', { text: 'S' }), t('field.useSelection')]);
    selBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });

    var markers = markersFor(s.lang);
    var known = markers.some(function (m) { return m.id === c.marker; });
    var markerOpts = markers.map(function (m) {
      var on = c.marker === m.id;
      return el('button', { class: 'opt marker' + (on ? ' on' : ''), type: 'button', title: L(m.definition) || '', onclick: function () { setCode(g, 'marker', on ? '' : m.id); } }, [L(m.label) || m.id]);
    });
    markerOpts.unshift(el('button', { class: 'opt marker' + (!c.marker ? ' on' : ''), type: 'button', onclick: function () { setCode(g, 'marker', ''); } }, [t('field.markerNone')]));
    if (S.cb.allowCustomMarkers !== false) {
      markerOpts.push(el('input', {
        type: 'text', id: 'inMarker', class: 'marker-custom', placeholder: t('field.markerCustom'),
        value: (!known && c.marker) ? c.marker : '',
        onchange: function (e) { setCode(g, 'marker', e.target.value.trim()); }
      }));
    }

    var memo = el('textarea', { id: 'inMemo', rows: 1, placeholder: t('field.memoPh'), oninput: function (e) { c.memo = e.target.value; touch(); } });
    memo.value = c.memo || '';

    var ids = currentSentences(), pos = ids.indexOf(g);
    var splitBtn = el('button', { type: 'button', title: t('seg.splitTip'), onclick: function () { splitActive(); } }, [t('seg.split')]);
    splitBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    var segTools = el('div', { class: 'seg-tools' }, [
      el('button', { type: 'button', disabled: pos <= 0, onclick: function () { mergeAt(ids[pos - 1], -1); } }, [t('seg.mergePrev')]),
      el('button', { type: 'button', disabled: pos >= ids.length - 1, onclick: function () { mergeAt(g, 0); } }, [t('seg.mergeNext')]),
      splitBtn
    ]);

    return el('div', { class: 'coding-form' }, [
      el('span', { class: 'lbl', text: t('field.topic') }), el('div', { class: 'topic-row' }, [topicInput, selBtn]),
      el('span', { class: 'lbl', text: t('field.type') }), optionButtons(s, g, 'type', S.cb.progressionTypes),
      el('span', { class: 'lbl', text: t('field.stage') }), optionButtons(s, g, 'stage', S.cb.genreStages),
      el('span', { class: 'lbl', text: t('field.marker') }), el('div', { class: 'opts' }, markerOpts),
      el('span', { class: 'lbl', text: t('field.memo') }), memo,
      el('span', { class: 'lbl', text: t('seg.label') }), segTools
    ]);
  }

  // Track selection inside the active sentence text (character offsets).
  function selectionOffsets() {
    var sel = window.getSelection();
    var node = document.querySelector('.sent.active .sent-text');
    if (!sel || !sel.rangeCount || !node) return null;
    var range = sel.getRangeAt(0);
    if (!node.contains(range.startContainer) || !node.contains(range.endContainer)) return null;
    var pre = document.createRange();
    pre.selectNodeContents(node);
    pre.setEnd(range.startContainer, range.startOffset);
    var start = pre.toString().length;
    return { key: node.getAttribute('data-key'), start: start, end: start + range.toString().length };
  }
  document.addEventListener('selectionchange', function () {
    var o = selectionOffsets();
    if (o) S.lastSel = o;
  });

  function useSelection() {
    var g = activeGlobalIndex(); if (g < 0) return;
    var s = S.p.sentences[g], sel = selectionOffsets() || S.lastSel;
    if (!sel || sel.key !== TPC.sentenceKey(s) || sel.end <= sel.start) { toast(t('field.noSelection')); return; }
    var raw = s.text.slice(sel.start, sel.end), lead = raw.length - raw.replace(/^\s+/, '').length;
    var txt = raw.trim();
    s.code.topic = txt; s.code.topicStart = sel.start + lead; s.code.topicEnd = sel.start + lead + txt.length;
    touch(); window.getSelection().removeAllRanges(); S.lastSel = null;
    renderCoding();
  }

  function confirmSegEdit(rid) {
    if (inSample(rid)) return window.confirm(t('seg.warnSample'));
    return true;
  }
  function mergeAt(g, activeShift) {
    var s = S.p.sentences[g];
    if (!confirmSegEdit(s.review_id)) return;
    if (TPC.mergeWithNext(S.p.sentences, g, S.cb.segmentation)) {
      rebuildIndex(); S.ui.active = Math.max(0, S.ui.active + activeShift); S.lastSel = null; touch(); renderCoding();
    }
  }
  function splitActive() {
    var g = activeGlobalIndex(); if (g < 0) return;
    var s = S.p.sentences[g], sel = selectionOffsets() || S.lastSel;
    if (!sel || sel.key !== TPC.sentenceKey(s)) { toast(t('seg.noCaret')); return; }
    if (!confirmSegEdit(s.review_id)) return;
    if (TPC.splitAt(S.p.sentences, g, sel.start)) { rebuildIndex(); S.lastSel = null; touch(); renderCoding(); }
    else toast(t('seg.badSplit'));
  }

  function move(delta) {
    var ids = currentSentences(), next = S.ui.active + delta;
    if (next >= 0 && next < ids.length) { S.ui.active = next; }
    else {
      var f = filteredReviews(), i = f.map(function (r) { return r.review_id; }).indexOf(S.ui.review);
      var nr = f[i + (delta > 0 ? 1 : -1)];
      if (!nr) { toast(delta > 0 ? t('nav.end') : t('nav.start')); return; }
      S.ui.review = nr.review_id;
      S.ui.active = delta > 0 ? 0 : (S.idx[nr.review_id] || []).length - 1;
    }
    S.lastSel = null;
    renderCoding(); saveJSON(STORE.ui, S.ui);
  }
  function moveReview(delta) {
    var f = filteredReviews(), i = f.map(function (r) { return r.review_id; }).indexOf(S.ui.review);
    var nr = f[i + delta];
    if (!nr) return;
    S.ui.review = nr.review_id; S.ui.active = 0; renderCoding(); saveJSON(STORE.ui, S.ui);
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape' || (e.key === 'Enter' && tag === 'input' && S.ui.view === 'code' && e.target.closest('.coding-form'))) {
        e.target.blur();
        if (e.target.id === 'inMarker' || e.target.id === 'inTopic') e.target.dispatchEvent(new Event('change'));
      }
      return;
    }
    if (S.ui.view !== 'code' || !hasData() || e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    var g = activeGlobalIndex(), handled = true;
    if (k === 'arrowdown' || k === 'j') move(1);
    else if (k === 'arrowup' || k === 'k') move(-1);
    else if (k === ']') moveReview(1);
    else if (k === '[') moveReview(-1);
    else if (k === 's') useSelection();
    else if (k === 't') focusField('inTopic');
    else if (k === 'm') focusField('inMemo');
    else if (k === 'f') focusField('inMarker');
    else if (k === 'escape') { window.getSelection().removeAllRanges(); S.lastSel = null; }
    else if (S.keymap[k] && g >= 0) {
      var km = S.keymap[k], cur = S.p.sentences[g].code[km.variable];
      setCode(g, km.variable, cur === km.id ? '' : km.id);
    } else handled = false;
    if (handled) e.preventDefault();
  });
  function focusField(id) { var n = $(id); if (n) { n.focus(); if (n.select) n.select(); } }

  // ------------------------------------------------------------ data view
  function renderData() {
    renderTop();
    var st = clear($('cbStatus'));
    var srcLabel = t('cb.src.' + S.cbSource);
    st.appendChild(el('p', {}, [
      el('b', { text: L(S.cb.title) || S.cb.codebookId || t('cb.none') }), ' ',
      S.cb.version ? t('cb.versionShort', { v: S.cb.version }) : '', ' · ', srcLabel, ' · ',
      t('cb.counts', { types: S.cb.progressionTypes.length, stages: S.cb.genreStages.length, principles: S.cb.principles.length })
    ]));
    var todo = JSON.stringify(S.cb).match(/TODO/g);
    if (todo) st.appendChild(el('p', { class: 'hint', text: t('cb.todo', { n: todo.length }) }));
  }

  function importCSV(text, name) {
    var res = TPC.csvToReviews(text), rep = clear($('csvReport'));
    if (!res.reviews.length) {
      rep.appendChild(el('p', { class: 'err', text: t('csv.none') }));
    } else {
      if (hasData() && !window.confirm(t('csv.confirmReplace'))) return;
      S.p = newProject(res.reviews); rebuildIndex();
      S.ui.review = null; S.ui.active = 0;
      saveNow();
      var counts = {};
      res.reviews.forEach(function (r) { counts[r.lang] = (counts[r.lang] || 0) + 1; });
      rep.appendChild(el('p', { text: t('csv.loaded', { name: name || '', n: res.reviews.length, s: S.p.sentences.length, langs: Object.keys(counts).map(function (l) { return l + ' ' + counts[l]; }).join(', ') }) }));
    }
    if (res.errors.length) {
      var ul = el('ul', { class: 'err' });
      res.errors.slice(0, 50).forEach(function (er) {
        ul.appendChild(el('li', { text: t('csv.row', { row: er.row }) + ': ' + t('csv.err.' + er.msg) + (er.detail ? ' (' + er.detail + ')' : '') }));
      });
      rep.appendChild(ul);
    }
    renderTop();
  }

  function exportProjectJSON() {
    if (!hasData()) { toast(t('err.noData')); return; }
    if (!S.p.coderId) { toast(t('err.noCoder')); $('coderId').focus(); return; }
    saveNow();
    var out = Object.assign({}, S.p, { exportedAt: new Date().toISOString(), appVersion: APP_VERSION, codebookAtExport: { id: S.cb.codebookId, version: S.cb.version } });
    download('tpc_' + safeName(S.p.coderId) + '_' + today() + '.json', JSON.stringify(out, null, 2), 'application/json');
  }

  function importProjectJSON(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { toast(t('err.json')); return; }
    if (!validateProject(obj)) { toast(t('err.notProject')); return; }
    if (hasData() && !window.confirm(t('json.confirmReplace'))) return;
    S.p = normalizeProject(obj); rebuildIndex(); S.ui.review = null; S.ui.active = 0;
    saveNow();
    if (S.cb.version && obj.codebookVersion && obj.codebookVersion !== S.cb.version) banner(t('warn.cbVersion', { p: obj.codebookVersion, c: S.cb.version }));
    toast(t('json.loaded', { n: obj.sentences.length }));
    renderAll();
  }

  function exportCSV() {
    if (!hasData()) { toast(t('err.noData')); return; }
    var rows = [['review_id', 'lang', 'sentence_no', 'sentence_id', 'text', 'topic_expression', 'topic_start', 'topic_end',
      'progression_type', 'progression_type_label', 'genre_stage', 'genre_stage_label', 'topic_marker', 'memo',
      'coded', 'in_sample', 'coder_id', 'codebook_version']];
    S.p.sentences.forEach(function (s) {
      var c = s.code;
      rows.push([s.review_id, s.lang, s.idx + 1, s.review_id + '_s' + (s.idx + 1), s.text, c.topic,
        c.topicStart == null ? '' : c.topicStart, c.topicEnd == null ? '' : c.topicEnd,
        c.type, labelOf('type', c.type), c.stage, labelOf('stage', c.stage), c.marker, c.memo,
        isCoded(s) ? 1 : 0, inSample(s.review_id) ? 1 : 0, S.p.coderId || '', S.cb.version || S.p.codebookVersion || '']);
    });
    download('tpc_' + safeName(S.p.coderId) + '_' + today() + '.csv', TPC.toCSV(rows, { bom: true }), 'text/csv;charset=utf-8');
  }

  // ------------------------------------------------------------ double coding
  function renderDouble() {
    renderTop();
    var box = clear($('sampleResult'));
    var smp = S.p && S.p.sample;
    if (smp) {
      $('sampleSeed').value = smp.seed; $('sampleRate').value = Math.round(smp.rate * 100);
      var tb = el('tbody');
      Object.keys(smp.byLang).forEach(function (l) {
        var b = smp.byLang[l];
        tb.appendChild(el('tr', {}, [el('td', { text: l }), el('td', { class: 'num', text: b.total }), el('td', { class: 'num', text: b.n }), el('td', { class: 'small', text: b.ids.join(', ') })]));
      });
      box.appendChild(el('p', { class: 'hint', text: t('sample.info', { seed: smp.seed, rate: Math.round(smp.rate * 100), n: smp.ids.length, date: (smp.drawnAt || '').slice(0, 10) }) }));
      box.appendChild(el('table', {}, [el('thead', {}, [el('tr', {}, [el('th', { text: t('sample.lang') }), el('th', { class: 'num', text: t('sample.total') }), el('th', { class: 'num', text: t('sample.n') }), el('th', { text: t('sample.ids') })])]), tb]));
    }
    renderRelStatus();
    renderRelResults();
    renderConsensus();
  }

  function drawSample() {
    if (!hasData()) { toast(t('err.noData')); return; }
    var seed = $('sampleSeed').value.trim(), rate = Number($('sampleRate').value) / 100;
    if (!seed || !(rate > 0 && rate <= 1)) { toast(t('sample.bad')); return; }
    if (S.p.sample && (S.p.sample.seed !== seed || S.p.sample.rate !== rate) && !window.confirm(t('sample.confirmReplace'))) return;
    var smp = TPC.stratifiedSample(S.p.reviews, rate, seed);
    smp.drawnAt = new Date().toISOString();
    S.p.sample = smp; touch(); renderDouble();
  }

  function exportPackage() {
    if (!S.p || !S.p.sample) { toast(t('sample.none')); return; }
    var ids = {}; S.p.sample.ids.forEach(function (id) { ids[id] = true; });
    var pkg = {
      schema: 'tpc-project', schemaVersion: 1, appVersion: APP_VERSION, coderId: '',
      codebookId: S.cb.codebookId || S.p.codebookId, codebookVersion: S.cb.version || S.p.codebookVersion,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      origin: { type: 'double-coding-package', fromCoder: S.p.coderId || '', seed: S.p.sample.seed, rate: S.p.sample.rate },
      reviews: S.p.reviews.filter(function (r) { return ids[r.review_id]; }),
      sentences: S.p.sentences.filter(function (s) { return ids[s.review_id]; }).map(function (s) {
        return { review_id: s.review_id, lang: s.lang, idx: s.idx, text: s.text, code: TPC.emptyCode() };
      }),
      sample: S.p.sample
    };
    download('tpc_package_seed-' + safeName(S.p.sample.seed) + '_' + today() + '.json', JSON.stringify(pkg, null, 2), 'application/json');
  }

  function loadCoder(which, text, name) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { toast(t('err.json')); return; }
    if (!validateProject(obj)) { toast(t('err.notProject')); return; }
    S.rel[which] = normalizeProject(obj); S.rel[which]._file = name; S.rel.result = null;
    renderRelStatus(); renderRelResults();
  }

  function renderRelStatus() {
    var st = clear($('relStatus'));
    ['A', 'B'].forEach(function (w) {
      var p = S.rel[w];
      st.appendChild(el('div', { text: w + ': ' + (p ? t('rel.loaded', { coder: p.coderId || '?', file: p._file || '', n: p.sentences.length, v: p.codebookVersion || '?' }) : t('rel.notLoaded')) }));
    });
  }

  function computeAgreement() {
    var A = S.rel.A, B = S.rel.B;
    if (!A || !B) { toast(t('rel.needBoth')); return; }
    var reviewIds = ($('relSampleOnly').checked && A.sample) ? A.sample.ids : null;
    var al = TPC.alignCodings(A.sentences, B.sentences, { reviewIds: reviewIds });
    var lang = $('relLang').value;
    var pairs = lang ? al.pairs.filter(function (p) { return p.lang === lang; }) : al.pairs;
    var markerLabels = [TPC.NONE];
    TPC.LANGS.forEach(function (l) { if (!lang || l === lang) markersFor(l).forEach(function (m) { if (markerLabels.indexOf(m.id) < 0) markerLabels.push(m.id); }); });
    var res = {
      align: al, pairs: pairs, lang: lang,
      type: TPC.variableAgreement(pairs, 'type', { labels: S.cb.progressionTypes.map(function (o) { return o.id; }) }),
      stage: TPC.variableAgreement(pairs, 'stage', { labels: S.cb.genreStages.map(function (o) { return o.id; }) }),
      marker: TPC.variableAgreement(pairs, 'marker', { labels: markerLabels })
    };
    var norm = function (x) { return String(x || '').replace(/\s+/g, ''); }, both = 0, same = 0;
    pairs.forEach(function (p) { if (p.a.topic || p.b.topic) { both++; if (norm(p.a.topic) === norm(p.b.topic)) same++; } });
    res.topic = { n: both, po: both ? same / both : NaN };
    S.rel.result = res;
    S.cons = loadJSON(STORE.consensus) || newConsensus();
    S.cons.coderA = A.coderId || ''; S.cons.coderB = B.coderId || '';
    S.cons.codebookVersion = S.cb.version || '';
    saveJSON(STORE.consensus, S.cons);
    renderRelResults(); renderConsensus();
  }

  // Landis & Koch (1977) descriptive bands.
  function kappaBand(k) {
    if (isNaN(k)) return '';
    var b = k < 0 ? 'poor' : k <= 0.2 ? 'slight' : k <= 0.4 ? 'fair' : k <= 0.6 ? 'moderate' : k <= 0.8 ? 'substantial' : 'almost';
    return t('kappa.' + b);
  }

  function renderRelResults() {
    var box = clear($('relResults')), res = S.rel.result;
    if (!res) return;
    var al = res.align, warn = [];
    if (al.textMismatch.length) warn.push(t('rel.textMismatch', { n: al.textMismatch.length }));
    if (al.onlyA || al.onlyB) warn.push(t('rel.unmatched', { a: al.onlyA, b: al.onlyB }));
    if (S.rel.A.codebookVersion !== S.rel.B.codebookVersion) warn.push(t('rel.cbDiff', { a: S.rel.A.codebookVersion || '?', b: S.rel.B.codebookVersion || '?' }));
    if (S.rel.A.coderId && S.rel.A.coderId === S.rel.B.coderId) warn.push(t('rel.sameCoder'));
    warn.forEach(function (w) { box.appendChild(el('p', { class: 'err', text: w })); });
    if (al.textMismatch.length) {
      var d = el('details', {}, [el('summary', { text: t('rel.showMismatch') })]);
      var tb = el('tbody');
      al.textMismatch.slice(0, 200).forEach(function (m) { tb.appendChild(el('tr', {}, [el('td', { text: m.review_id + ' #' + (m.idx + 1) }), el('td', { text: m.a }), el('td', { text: m.b })])); });
      d.appendChild(el('table', {}, [el('thead', {}, [el('tr', {}, [el('th', { text: t('cons.sentence') }), el('th', { text: 'A' }), el('th', { text: 'B' })])]), tb]));
      box.appendChild(d);
    }

    box.appendChild(el('p', { class: 'stat-big', text: t('rel.pairs', { n: res.pairs.length }) + (res.lang ? ' (' + res.lang + ')' : '') }));
    var tb2 = el('tbody');
    ['type', 'stage', 'marker'].forEach(function (v) {
      var r = res[v];
      tb2.appendChild(el('tr', {}, [el('td', { text: t('field.' + v) }), el('td', { class: 'num', text: r.n }), el('td', { class: 'num', text: r.excluded }),
        el('td', { class: 'num', text: pct(r.po) }), el('td', { class: 'num', text: fmt(r.pe) }), el('td', { class: 'num', text: fmt(r.kappa) }), el('td', { text: kappaBand(r.kappa) })]));
    });
    tb2.appendChild(el('tr', {}, [el('td', { text: t('field.topic') + ' ' + t('rel.topicNote') }), el('td', { class: 'num', text: res.topic.n }), el('td', { class: 'num', text: '' }),
      el('td', { class: 'num', text: pct(res.topic.po) }), el('td', { text: '' }), el('td', { text: '' }), el('td', { text: '' })]));
    box.appendChild(el('table', {}, [el('thead', {}, [el('tr', {}, [t('rel.variable'), 'n', t('rel.excluded'), t('rel.agreement'), 'pₑ', 'κ', t('rel.interp')].map(function (h, i) { return el('th', { class: i > 0 && i < 6 ? 'num' : '', text: h }); }))]), tb2]));
    box.appendChild(el('p', { class: 'hint', text: t('rel.note') }));

    var wrap = el('div', { class: 'cm-wrap' });
    ['type', 'stage', 'marker'].forEach(function (v) {
      var r = res[v], labels = r.labels;
      var keep = labels.map(function (l, i) {
        var tot = 0; for (var j = 0; j < labels.length; j++) tot += r.matrix[i][j] + r.matrix[j][i];
        return tot > 0 || v !== 'marker';
      });
      var vis = labels.map(function (l, i) { return i; }).filter(function (i) { return keep[i]; });
      var name = function (id) { return id === TPC.NONE ? t('field.markerNone') : labelOf(v, id, res.lang || null); };
      var thead = el('tr', {}, [el('th', { text: 'A \\ B' })].concat(vis.map(function (i) { return el('th', { class: 'num', text: name(labels[i]) }); })).concat([el('th', { class: 'num', text: 'Σ' })]));
      var body = el('tbody');
      vis.forEach(function (i) {
        var rowSum = 0;
        var cells = vis.map(function (j) { rowSum += r.matrix[i][j]; return el('td', { class: 'num' + (i === j ? ' diag' : ''), text: r.matrix[i][j] }); });
        body.appendChild(el('tr', {}, [el('th', { text: name(labels[i]) })].concat(cells).concat([el('td', { class: 'num', text: rowSum })])));
      });
      var colRow = [el('th', { text: 'Σ' })];
      vis.forEach(function (j) { var cs = 0; vis.forEach(function (i) { cs += r.matrix[i][j]; }); colRow.push(el('td', { class: 'num', text: cs })); });
      colRow.push(el('td', { class: 'num', text: r.n }));
      body.appendChild(el('tr', {}, colRow));
      wrap.appendChild(el('div', {}, [el('h4', { text: t('rel.matrix', { v: t('field.' + v) }) }), el('table', {}, [el('thead', {}, [thead]), body])]));
    });
    box.appendChild(wrap);
  }

  // ------------------------------------------------------------ consensus
  function newConsensus() { return { schema: 'tpc-consensus', schemaVersion: 1, createdAt: new Date().toISOString(), coderA: '', coderB: '', codebookVersion: '', items: {} }; }
  var VARS = ['type', 'stage', 'marker'];
  function differs(p, v) { return (p.a[v] || '') !== (p.b[v] || ''); }
  function finalValue(p, v) {
    var it = S.cons && S.cons.items[p.key];
    if (it && it[v] != null) return it[v];
    return differs(p, v) ? null : (p.a[v] || '');
  }
  function isResolved(p) {
    return VARS.every(function (v) { return !differs(p, v) || finalValue(p, v) !== null; });
  }
  function setCons(p, field, value) {
    var it = S.cons.items[p.key] = S.cons.items[p.key] || { review_id: p.review_id, idx: p.idx, lang: p.lang, text: p.text };
    it[field] = value; it.updatedAt = new Date().toISOString();
    saveJSON(STORE.consensus, S.cons);
  }

  function renderConsensus() {
    var box = clear($('consList')), res = S.rel.result;
    if (!res) { box.appendChild(el('p', { class: 'hint', text: t('cons.needCompute') })); return; }
    if (!S.cons) S.cons = loadJSON(STORE.consensus) || newConsensus();
    var dis = res.pairs.filter(function (p) { return VARS.some(function (v) { return differs(p, v); }); });
    var resolvedN = dis.filter(isResolved).length;
    box.appendChild(el('p', { class: 'stat-big', text: t('cons.count', { n: dis.length, r: resolvedN }) }));
    if ($('consUnresolved').checked) dis = dis.filter(function (p) { return !isResolved(p); });
    if (!dis.length) return;

    var tb = el('tbody');
    dis.forEach(function (p) {
      var row = el('tr', { class: isResolved(p) ? 'resolved' : '' });
      row.appendChild(el('td', { class: 'small', text: p.review_id + ' #' + (p.idx + 1) + ' ' + p.lang }));
      row.appendChild(el('td', { class: 'text', text: p.text }));
      VARS.forEach(function (v) {
        var list = v === 'type' ? S.cb.progressionTypes : v === 'stage' ? S.cb.genreStages : markersFor(p.lang);
        var fv = finalValue(p, v);
        var sel = el('select', { onchange: function (e) { setCons(p, v, e.target.value === '__unset' ? null : e.target.value); renderConsensus(); } });
        sel.appendChild(el('option', { value: '__unset', text: '—', selected: fv === null }));
        if (v === 'marker') sel.appendChild(el('option', { value: '', text: t('field.markerNone'), selected: fv === '' }));
        var ids = list.map(function (o) { return o.id; });
        [p.a[v], p.b[v]].forEach(function (x) { if (x && ids.indexOf(x) < 0) ids.push(x); });
        ids.forEach(function (id) { sel.appendChild(el('option', { value: id, text: labelOf(v, id, p.lang), selected: fv === id })); });
        var d = differs(p, v);
        row.appendChild(el('td', { class: 'small' }, [
          el('div', { class: d ? 'diff' : '', text: 'A: ' + (labelOf(v, p.a[v], p.lang) || '—') }),
          el('div', { class: d ? 'diff' : '', text: 'B: ' + (labelOf(v, p.b[v], p.lang) || '—') }),
          sel
        ]));
      });
      var it = S.cons.items[p.key] || {};
      row.appendChild(el('td', { class: 'small' }, [
        el('div', { text: 'A: ' + (p.a.topic || '—') }), el('div', { text: 'B: ' + (p.b.topic || '—') }),
        el('input', { type: 'text', value: it.topic != null ? it.topic : '', placeholder: t('cons.topicFinal'), onchange: function (e) { setCons(p, 'topic', e.target.value); } })
      ]));
      row.appendChild(el('td', {}, [
        el('textarea', { rows: 2, placeholder: t('cons.notePh'), onchange: function (e) { setCons(p, 'note', e.target.value); } }, [it.note || '']),
        el('div', {}, [
          el('button', { type: 'button', class: 'small', onclick: function () { copyAll(p, 'a'); } }, [t('cons.takeA')]), ' ',
          el('button', { type: 'button', class: 'small', onclick: function () { copyAll(p, 'b'); } }, [t('cons.takeB')])
        ])
      ]));
      tb.appendChild(row);
    });
    var heads = [t('cons.sentence'), t('cons.text'), t('field.type'), t('field.stage'), t('field.marker'), t('field.topic'), t('cons.note')];
    box.appendChild(el('table', { class: 'cons-table' }, [el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]), tb]));
  }
  function copyAll(p, side) {
    VARS.forEach(function (v) { setCons(p, v, p[side][v] || ''); });
    setCons(p, 'topic', p[side].topic || '');
    renderConsensus();
  }
  function exportConsensusJSON() {
    if (!S.cons) S.cons = loadJSON(STORE.consensus) || newConsensus();
    download('tpc_consensus_' + today() + '.json', JSON.stringify(Object.assign({}, S.cons, { exportedAt: new Date().toISOString() }), null, 2), 'application/json');
  }
  function exportConsensusCSV() {
    var res = S.rel.result;
    if (!res) { toast(t('cons.needCompute')); return; }
    var rows = [['review_id', 'lang', 'sentence_no', 'text',
      'type_A', 'type_B', 'type_final', 'stage_A', 'stage_B', 'stage_final', 'marker_A', 'marker_B', 'marker_final',
      'topic_A', 'topic_B', 'topic_final', 'status', 'note', 'coder_A', 'coder_B']];
    res.pairs.forEach(function (p) {
      var it = (S.cons && S.cons.items[p.key]) || {};
      var anyDiff = VARS.some(function (v) { return differs(p, v); });
      var status = !anyDiff ? 'agreed' : isResolved(p) ? 'resolved' : 'unresolved';
      var topicFinal = it.topic != null && it.topic !== '' ? it.topic : ((p.a.topic || '') === (p.b.topic || '') ? (p.a.topic || '') : '');
      var row = [p.review_id, p.lang, p.idx + 1, p.text];
      VARS.forEach(function (v) { var f = finalValue(p, v); row.push(p.a[v] || '', p.b[v] || '', f == null ? '' : f); });
      row.push(p.a.topic || '', p.b.topic || '', topicFinal, status, it.note || '', S.rel.A.coderId || '', S.rel.B.coderId || '');
      rows.push(row);
    });
    download('tpc_consensus_' + today() + '.csv', TPC.toCSV(rows, { bom: true }), 'text/csv;charset=utf-8');
  }
  function importConsensus(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { toast(t('err.json')); return; }
    if (!obj || obj.schema !== 'tpc-consensus' || typeof obj.items !== 'object') { toast(t('err.notConsensus')); return; }
    S.cons = obj; saveJSON(STORE.consensus, obj); renderConsensus(); toast(t('cons.imported', { n: Object.keys(obj.items).length }));
  }

  // ------------------------------------------------------------ wiring
  function renderAll() {
    applyI18n();
    if (S.ui.view === 'code') renderCoding();
    else if (S.ui.view === 'double') renderDouble();
    else renderData();
  }
  function setView(v) { S.ui.view = v; saveJSON(STORE.ui, S.ui); renderAll(); }

  function wire() {
    document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
    document.querySelectorAll('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-goto')); }); });
    document.querySelectorAll('[data-ui-lang]').forEach(function (b) {
      b.addEventListener('click', function () { S.ui.lang = b.getAttribute('data-ui-lang'); saveJSON(STORE.ui, S.ui); renderAll(); });
    });
    $('coderId').addEventListener('input', function (e) {
      if (!S.p) return;
      S.p.coderId = e.target.value.trim(); touch();
      e.target.classList.toggle('missing', !S.p.coderId);
    });
    $('filterLang').addEventListener('change', function (e) { S.ui.filterLang = e.target.value; renderCoding(); saveJSON(STORE.ui, S.ui); });
    $('filterScope').addEventListener('change', function (e) { S.ui.filterScope = e.target.value; renderCoding(); saveJSON(STORE.ui, S.ui); });

    $('fileCSV').addEventListener('change', function (e) { readFile(e.target, importCSV); });
    $('btnSample').addEventListener('click', function () {
      fetch('sample/sample_reviews.csv', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
        .then(function (txt) { importCSV(txt, 'sample_reviews.csv'); })
        .catch(function () { toast(t('err.sampleFetch')); });
    });
    $('btnExportJSON').addEventListener('click', exportProjectJSON);
    $('fileJSON').addEventListener('change', function (e) { readFile(e.target, importProjectJSON); });
    $('btnReset').addEventListener('click', function () {
      if (!window.confirm(t('data.confirmReset'))) return;
      S.p = null; S.idx = {}; localStorage.removeItem(STORE.project); renderAll(); toast(t('data.resetDone'));
    });
    $('btnExportCSV').addEventListener('click', exportCSV);
    $('fileCB').addEventListener('change', function (e) {
      readFile(e.target, function (txt) {
        var obj; try { obj = JSON.parse(txt); } catch (er) { toast(t('err.json')); return; }
        if (setCodebook(obj, 'file')) { toast(t('ok.codebook', { v: obj.version })); renderAll(); }
      });
    });
    $('btnCBReload').addEventListener('click', function () { loadCodebookFromServer(false).then(renderAll); });

    $('btnDrawSample').addEventListener('click', drawSample);
    $('btnExportPackage').addEventListener('click', exportPackage);
    $('fileA').addEventListener('change', function (e) { readFile(e.target, function (txt, n) { loadCoder('A', txt, n); }); });
    $('fileB').addEventListener('change', function (e) { readFile(e.target, function (txt, n) { loadCoder('B', txt, n); }); });
    $('btnUseCurrentA').addEventListener('click', function () {
      if (!hasData()) { toast(t('err.noData')); return; }
      S.rel.A = normalizeProject(JSON.parse(JSON.stringify(S.p))); S.rel.A._file = t('rel.current'); S.rel.result = null;
      renderRelStatus(); renderRelResults();
    });
    $('btnCompute').addEventListener('click', computeAgreement);
    $('consUnresolved').addEventListener('change', renderConsensus);
    $('btnConsJSON').addEventListener('click', exportConsensusJSON);
    $('btnConsCSV').addEventListener('click', exportConsensusCSV);
    $('fileCons').addEventListener('change', function (e) { readFile(e.target, importConsensus); });
    $('btnConsClear').addEventListener('click', function () {
      if (!window.confirm(t('cons.confirmClear'))) return;
      S.cons = newConsensus(); localStorage.removeItem(STORE.consensus); renderConsensus();
    });
    window.addEventListener('beforeunload', saveNow);
  }

  function init() {
    var ui = loadJSON(STORE.ui);
    if (ui) Object.assign(S.ui, ui);
    else if (CFG.uiLang) { S.ui.lang = CFG.uiLang; if (CFG.filterLang) S.ui.filterLang = CFG.filterLang; }
    else {
      var nav = (navigator.language || '').toLowerCase().slice(0, 2);
      if (window.I18N.languages.indexOf(nav) >= 0) S.ui.lang = nav;
    }
    // Per-language links: ?ui=ja|zh|ko|en sets the interface language, ?lang=ko|ja|zh filters the review list.
    var qs = new URLSearchParams(window.location.search);
    var qUi = (qs.get('ui') || '').toLowerCase(), qLang = (qs.get('lang') || '').toLowerCase();
    if (window.I18N.languages.indexOf(qUi) >= 0) S.ui.lang = qUi;
    if (['ko', 'ja', 'zh'].indexOf(qLang) >= 0) S.ui.filterLang = qLang;
    var p = loadJSON(STORE.project);
    if (p && validateProject(p)) { S.p = normalizeProject(p); rebuildIndex(); }
    S.cons = loadJSON(STORE.consensus);
    $('filterLang').value = S.ui.filterLang || '';
    $('filterScope').value = S.ui.filterScope || 'all';
    wire();
    applyI18n();
    loadCodebookFromServer(true).then(renderAll);
  }

  // Exposed for debugging in the console only.
  window.TPC_APP = { state: S };
  init();
})();
