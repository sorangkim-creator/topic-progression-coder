/*
 * core.js — pure logic for the Topic Progression Coder.
 * No DOM access here, so the same file runs in the browser (window.TPC)
 * and in Node for tests (require('./js/core.js')).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TPC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LANGS = ['ko', 'ja', 'zh'];
  var LANG_ALIASES = { ko: 'ko', kr: 'ko', kor: 'ko', korean: 'ko', ja: 'ja', jp: 'ja', jpn: 'ja', japanese: 'ja', zh: 'zh', cn: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh' };

  // Used only when codebook.json has no "segmentation" block.
  var DEFAULT_SEGMENTATION = {
    ko: { terminators: '.?!', requireSpaceAfter: true, joiner: ' ' },
    ja: { terminators: '。！？', requireSpaceAfter: false, joiner: '' },
    zh: { terminators: '。！？；', requireSpaceAfter: false, joiner: '' }
  };
  var OPEN_BRACKETS = '「『（(“‘《〈【[';
  var CLOSE_BRACKETS = '」』）)”’》〉】]';
  var TRAILING_CLOSERS = '"\'”’」』）)》〉】]';

  // ---------------------------------------------------------------- CSV

  /** RFC 4180 CSV parser. Handles BOM, quoted fields, "" escapes, CRLF/LF/CR. */
  function parseCSV(text) {
    text = String(text || '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [], row = [], field = '', inQ = false, i = 0, c;
    while (i < text.length) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = ''; i++; continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
  }

  function normalizeLang(v) {
    var k = String(v || '').trim().toLowerCase();
    return LANG_ALIASES[k] || null;
  }

  /** CSV text -> { reviews:[{review_id, lang, text}], errors:[{row, msg, ...}] } */
  function csvToReviews(text) {
    var rows = parseCSV(text), errors = [], reviews = [], seen = {};
    if (!rows.length) return { reviews: [], errors: [{ row: 0, msg: 'empty' }] };
    var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var iId = header.indexOf('review_id'), iLang = header.indexOf('lang'), iText = header.indexOf('text');
    if (iId < 0 || iLang < 0 || iText < 0) {
      return { reviews: [], errors: [{ row: 1, msg: 'header', detail: 'review_id, lang, text' }] };
    }
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var id = (row[iId] || '').trim();
      var lang = normalizeLang(row[iLang]);
      var body = (row[iText] || '').trim();
      if (!id) { errors.push({ row: r + 1, msg: 'missing_id' }); continue; }
      if (!lang) { errors.push({ row: r + 1, msg: 'bad_lang', detail: row[iLang] }); continue; }
      if (!body) { errors.push({ row: r + 1, msg: 'empty_text', detail: id }); continue; }
      if (seen[id]) { errors.push({ row: r + 1, msg: 'dup_id', detail: id }); continue; }
      seen[id] = true;
      reviews.push({ review_id: id, lang: lang, text: body });
    }
    return { reviews: reviews, errors: errors };
  }

  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** rows (array of arrays) -> CSV string. bom:true prepends U+FEFF so Excel reads UTF-8. */
  function toCSV(rows, opts) {
    opts = opts || {};
    var body = rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\r\n') + '\r\n';
    return (opts.bom === false ? '' : '﻿') + body;
  }

  // ------------------------------------------------------- Segmentation

  function segConfig(lang, seg) {
    var base = DEFAULT_SEGMENTATION[lang] || DEFAULT_SEGMENTATION.ko;
    var c = (seg && seg[lang]) || {};
    return {
      terminators: c.terminators != null ? c.terminators : base.terminators,
      requireSpaceAfter: c.requireSpaceAfter != null ? !!c.requireSpaceAfter : base.requireSpaceAfter,
      joiner: c.joiner != null ? c.joiner : base.joiner,
      splitOnNewline: c.splitOnNewline != null ? !!c.splitOnNewline : (seg && seg.splitOnNewline != null ? !!seg.splitOnNewline : true),
      respectBrackets: c.respectBrackets != null ? !!c.respectBrackets : true
    };
  }

  /**
   * Split text into sentences.
   * - A run of terminators (e.g. "?!" or "...") ends one sentence; closing quotes/brackets
   *   right after it stay attached to that sentence.
   * - ko: a boundary also requires whitespace/end after it (so "3.5점", "다."라고 do not split).
   * - Terminators inside 「」『』（）“” etc. do not split (respectBrackets).
   * - Line breaks are boundaries unless splitOnNewline is false.
   */
  function splitSentences(text, lang, seg) {
    var cfg = segConfig(lang, seg), term = cfg.terminators;
    var out = [], buf = '', depth = 0, i, c;
    text = String(text || '');
    function push() { var s = buf.trim(); if (s) out.push(s); buf = ''; }
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (c === '\n' || c === '\r') {
        if (cfg.splitOnNewline) { push(); depth = 0; } else buf += ' ';
        continue;
      }
      buf += c;
      if (cfg.respectBrackets) {
        if (OPEN_BRACKETS.indexOf(c) >= 0) { depth++; continue; }
        if (CLOSE_BRACKETS.indexOf(c) >= 0) { if (depth > 0) depth--; continue; }
      }
      if (term.indexOf(c) < 0 || depth > 0) continue;
      var j = i + 1;
      while (j < text.length && term.indexOf(text[j]) >= 0) buf += text[j++];
      while (j < text.length && TRAILING_CLOSERS.indexOf(text[j]) >= 0) {
        if (cfg.respectBrackets && CLOSE_BRACKETS.indexOf(text[j]) >= 0 && depth > 0) depth--;
        buf += text[j++];
      }
      i = j - 1;
      if (cfg.requireSpaceAfter && j < text.length && !/\s/.test(text[j])) continue;
      push();
    }
    push();
    return out;
  }

  function emptyCode() {
    return { topic: '', topicStart: null, topicEnd: null, type: '', stage: '', marker: '', memo: '' };
  }

  /** reviews -> flat sentence list [{review_id, lang, idx, text, code}] */
  function buildSentences(reviews, seg) {
    var out = [];
    reviews.forEach(function (r) {
      splitSentences(r.text, r.lang, seg).forEach(function (s, k) {
        out.push({ review_id: r.review_id, lang: r.lang, idx: k, text: s, code: emptyCode() });
      });
    });
    return out;
  }

  function sentenceKey(s) { return s.review_id + '#' + s.idx; }

  function reindex(sentences, reviewId) {
    var k = 0;
    sentences.forEach(function (s) { if (s.review_id === reviewId) s.idx = k++; });
  }

  function isCodeEmpty(c) {
    return !c || (!c.topic && !c.type && !c.stage && !c.marker && !c.memo);
  }

  /** Merge sentence at array position i with the next sentence of the same review (in place). */
  function mergeWithNext(sentences, i, seg) {
    var a = sentences[i], b = sentences[i + 1];
    if (!a || !b || a.review_id !== b.review_id) return false;
    var joiner = segConfig(a.lang, seg).joiner;
    var offset = a.text.length + joiner.length;
    var code;
    if (isCodeEmpty(a.code) && !isCodeEmpty(b.code)) {
      code = JSON.parse(JSON.stringify(b.code));
      if (code.topicStart != null) { code.topicStart += offset; code.topicEnd += offset; }
    } else {
      code = a.code;
      if (b.code && b.code.memo) code.memo = code.memo ? code.memo + ' | ' + b.code.memo : b.code.memo;
    }
    a.text = a.text + joiner + b.text;
    a.code = code;
    sentences.splice(i + 1, 1);
    reindex(sentences, a.review_id);
    return true;
  }

  /** Split sentence at array position i at character offset (in place). Code stays with the first part. */
  function splitAt(sentences, i, offset) {
    var s = sentences[i];
    if (!s) return false;
    var left = s.text.slice(0, offset), right = s.text.slice(offset);
    var lt = left.replace(/\s+$/, ''), rt = right.replace(/^\s+/, '');
    if (!lt.trim() || !rt.trim()) return false;
    var c = s.code;
    if (c.topicStart != null && c.topicEnd > lt.length) { c.topicStart = null; c.topicEnd = null; }
    s.text = lt;
    sentences.splice(i + 1, 0, { review_id: s.review_id, lang: s.lang, idx: s.idx + 1, text: rt, code: emptyCode() });
    reindex(sentences, s.review_id);
    return true;
  }

  // ------------------------------------------------------------ Sampling

  /** String -> 32-bit unsigned seed (cyrb53-style mixing, truncated). */
  function hashString(str) {
    str = String(str);
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  }

  /** Deterministic PRNG in [0,1). */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var collator = (typeof Intl !== 'undefined') ? new Intl.Collator('en', { numeric: true }) : null;
  function compareIds(a, b) { return collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0); }

  /**
   * Stratified random sample of reviews (unit = review), per language.
   * Each language gets round(n * rate) reviews (at least 1 if the language has any).
   * IDs are sorted before shuffling, and each language has its own PRNG stream
   * (seed + ":" + lang), so the result is independent of CSV row order and of other languages.
   */
  function stratifiedSample(reviews, rate, seed) {
    var groups = {};
    reviews.forEach(function (r) { (groups[r.lang] = groups[r.lang] || []).push(r.review_id); });
    var res = { seed: String(seed), rate: rate, unit: 'review', byLang: {}, ids: [] };
    Object.keys(groups).sort().forEach(function (lang) {
      var ids = groups[lang].slice().sort(compareIds);
      var rng = mulberry32(hashString(String(seed) + ':' + lang));
      for (var i = ids.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
      }
      var k = ids.length ? Math.max(1, Math.round(ids.length * rate)) : 0;
      var chosen = ids.slice(0, k).sort(compareIds);
      res.byLang[lang] = { total: ids.length, n: k, ids: chosen };
      res.ids = res.ids.concat(chosen);
    });
    return res;
  }

  // --------------------------------------------------------- Reliability

  /**
   * Cohen's kappa for two raters' nominal labels.
   * a, b: equal-length arrays of labels. opts.labels: optional category order.
   * Returns { n, agree, po, pe, kappa, labels, matrix } where matrix[i][j] = count(A=labels[i], B=labels[j]).
   * If pe === 1 (both raters used one identical category) kappa is reported as 1 when po === 1.
   */
  function cohenKappa(a, b, opts) {
    if (a.length !== b.length) throw new Error('rater arrays differ in length');
    opts = opts || {};
    var labels = (opts.labels || []).slice(), seen = {};
    labels.forEach(function (l) { seen[l] = true; });
    a.concat(b).forEach(function (l) { if (!seen[l]) { seen[l] = true; labels.push(l); } });
    var k = labels.length, n = a.length, idx = {};
    labels.forEach(function (l, i) { idx[l] = i; });
    var m = [], i, j;
    for (i = 0; i < k; i++) { m.push([]); for (j = 0; j < k; j++) m[i].push(0); }
    for (i = 0; i < n; i++) m[idx[a[i]]][idx[b[i]]]++;
    if (n === 0) return { n: 0, agree: 0, po: NaN, pe: NaN, kappa: NaN, labels: labels, matrix: m };
    var agree = 0, pe = 0;
    for (i = 0; i < k; i++) {
      agree += m[i][i];
      var row = 0, col = 0;
      for (j = 0; j < k; j++) { row += m[i][j]; col += m[j][i]; }
      pe += (row / n) * (col / n);
    }
    var po = agree / n;
    var kappa = Math.abs(1 - pe) < 1e-12 ? (po === 1 ? 1 : NaN) : (po - pe) / (1 - pe);
    return { n: n, agree: agree, po: po, pe: pe, kappa: kappa, labels: labels, matrix: m };
  }

  /**
   * Align two coders' sentence lists by (review_id, idx) and check the text matches.
   * opts.reviewIds: optional array restricting the comparison (e.g. the sample).
   */
  function alignCodings(sentA, sentB, opts) {
    opts = opts || {};
    var only = opts.reviewIds ? {} : null;
    if (only) opts.reviewIds.forEach(function (id) { only[id] = true; });
    var mapB = {};
    sentB.forEach(function (s) { if (!only || only[s.review_id]) mapB[sentenceKey(s)] = s; });
    var norm = function (t) { return String(t).replace(/\s+/g, ''); };
    var pairs = [], textMismatch = [], onlyA = 0, usedB = {};
    sentA.forEach(function (s) {
      if (only && !only[s.review_id]) return;
      var key = sentenceKey(s), t = mapB[key];
      if (!t) { onlyA++; return; }
      usedB[key] = true;
      if (norm(s.text) !== norm(t.text)) { textMismatch.push({ key: key, review_id: s.review_id, idx: s.idx, a: s.text, b: t.text }); return; }
      pairs.push({ key: key, review_id: s.review_id, lang: s.lang, idx: s.idx, text: s.text, a: s.code || emptyCode(), b: t.code || emptyCode() });
    });
    var onlyB = Object.keys(mapB).filter(function (k) { return !usedB[k]; }).length;
    return { pairs: pairs, textMismatch: textMismatch, onlyA: onlyA, onlyB: onlyB };
  }

  var NONE = '(none)';
  /**
   * Agreement statistics for one variable over aligned pairs.
   * variable: 'type' | 'stage' | 'marker'.
   * For type/stage, pairs where either coder left the field empty are excluded (reported as "excluded").
   * For marker, an empty value is a real category "(none)".
   */
  function variableAgreement(pairs, variable, opts) {
    opts = opts || {};
    var a = [], b = [], excluded = 0;
    pairs.forEach(function (p) {
      var va = (p.a && p.a[variable]) || '', vb = (p.b && p.b[variable]) || '';
      if (variable === 'marker') { va = va || NONE; vb = vb || NONE; }
      else if (!va || !vb) { excluded++; return; }
      a.push(va); b.push(vb);
    });
    var res = cohenKappa(a, b, { labels: opts.labels });
    res.excluded = excluded;
    res.variable = variable;
    return res;
  }

  return {
    LANGS: LANGS,
    NONE: NONE,
    DEFAULT_SEGMENTATION: DEFAULT_SEGMENTATION,
    parseCSV: parseCSV,
    csvToReviews: csvToReviews,
    toCSV: toCSV,
    normalizeLang: normalizeLang,
    splitSentences: splitSentences,
    segConfig: segConfig,
    buildSentences: buildSentences,
    emptyCode: emptyCode,
    sentenceKey: sentenceKey,
    mergeWithNext: mergeWithNext,
    splitAt: splitAt,
    hashString: hashString,
    mulberry32: mulberry32,
    stratifiedSample: stratifiedSample,
    compareIds: compareIds,
    cohenKappa: cohenKappa,
    alignCodings: alignCodings,
    variableAgreement: variableAgreement
  };
});
