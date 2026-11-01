/*
 * Test suite for js/core.js. Runs in Node (tests/run-node.js) and in the browser (tests/index.html).
 * Kappa is checked against worked examples whose values are known in closed form.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.TPC_TESTS = factory;
})(typeof self !== 'undefined' ? self : this, function (TPC) {
  'use strict';
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function eq(actual, expected, msg) {
    var A = JSON.stringify(actual), E = JSON.stringify(expected);
    if (A !== E) throw new Error((msg || 'not equal') + '\n  expected: ' + E + '\n  actual:   ' + A);
  }
  function near(actual, expected, tol, msg) {
    if (!(Math.abs(actual - expected) <= (tol || 1e-4))) throw new Error((msg || 'not close') + ': expected ' + expected + ', got ' + actual);
  }
  function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }

  /** Expand a contingency table {"A|B": count} into two rater arrays. */
  function fromTable(table) {
    var a = [], b = [];
    Object.keys(table).forEach(function (k) {
      var p = k.split('|');
      for (var i = 0; i < table[k]; i++) { a.push(p[0]); b.push(p[1]); }
    });
    return [a, b];
  }

  // ------------------------------------------------------------ kappa
  test('kappa: Wikipedia example 1 (20/5/10/15, n=50) -> po .70, pe .50, kappa .40', function () {
    var r = fromTable({ 'Y|Y': 20, 'Y|N': 5, 'N|Y': 10, 'N|N': 15 });
    var k = TPC.cohenKappa(r[0], r[1]);
    eq(k.n, 50); near(k.po, 0.70); near(k.pe, 0.50); near(k.kappa, 0.40);
  });

  test('kappa: same po, different kappa (45/15/25/15 -> .1304; 25/35/5/35 -> .2593)', function () {
    var r1 = fromTable({ 'Y|Y': 45, 'Y|N': 15, 'N|Y': 25, 'N|N': 15 });
    var k1 = TPC.cohenKappa(r1[0], r1[1]);
    near(k1.po, 0.60); near(k1.pe, 0.54); near(k1.kappa, 0.06 / 0.46);
    near(k1.kappa, 0.1304, 1e-4);
    var r2 = fromTable({ 'Y|Y': 25, 'Y|N': 35, 'N|Y': 5, 'N|N': 35 });
    var k2 = TPC.cohenKappa(r2[0], r2[1]);
    near(k2.po, 0.60); near(k2.pe, 0.46); near(k2.kappa, 0.2593, 1e-4);
  });

  test('kappa: 3 categories, hand-computed (po .725, pe .3375, kappa .5849)', function () {
    // A\B   x   y   z   | row
    //  x   10   2   3   | 15
    //  y    1   8   1   | 10
    //  z    2   2  11   | 15
    // col  13  12  15   | 40
    // po = 29/40 = .725; pe = (15*13 + 10*12 + 15*15)/1600 = .3375; kappa = .3875/.6625
    var r = fromTable({ 'x|x': 10, 'x|y': 2, 'x|z': 3, 'y|x': 1, 'y|y': 8, 'y|z': 1, 'z|x': 2, 'z|y': 2, 'z|z': 11 });
    var k = TPC.cohenKappa(r[0], r[1], { labels: ['x', 'y', 'z'] });
    near(k.po, 0.725); near(k.pe, 0.3375); near(k.kappa, 0.3875 / 0.6625, 1e-9);
    eq(k.matrix, [[10, 2, 3], [1, 8, 1], [2, 2, 11]], 'confusion matrix');
  });

  test('kappa: perfect agreement = 1; systematic disagreement = -1', function () {
    near(TPC.cohenKappa(['a', 'b', 'c', 'a'], ['a', 'b', 'c', 'a']).kappa, 1);
    near(TPC.cohenKappa(['a', 'b'], ['b', 'a']).kappa, -1);
  });

  test('kappa: degenerate cases (single shared category, empty input)', function () {
    var k = TPC.cohenKappa(['a', 'a', 'a'], ['a', 'a', 'a']);
    eq(k.kappa, 1); near(k.pe, 1);
    ok(isNaN(TPC.cohenKappa([], []).kappa), 'empty -> NaN');
  });

  test('kappa: symmetric in raters; label order option does not change kappa', function () {
    var r = fromTable({ 'p|p': 7, 'p|q': 3, 'q|p': 1, 'q|q': 9, 'r|q': 2, 'r|r': 4 });
    var k1 = TPC.cohenKappa(r[0], r[1]), k2 = TPC.cohenKappa(r[1], r[0]);
    var k3 = TPC.cohenKappa(r[0], r[1], { labels: ['r', 'q', 'p'] });
    near(k1.kappa, k2.kappa, 1e-12); near(k1.kappa, k3.kappa, 1e-12);
  });

  test('variableAgreement: type excludes empties, marker treats empty as (none)', function () {
    var pairs = [
      { a: { type: 'new', marker: '' }, b: { type: 'new', marker: '' } },
      { a: { type: 'new', marker: 'は' }, b: { type: '', marker: 'は' } },
      { a: { type: 'maintain', marker: '' }, b: { type: 'linear', marker: 'は' } }
    ];
    var t = TPC.variableAgreement(pairs, 'type');
    eq(t.n, 2); eq(t.excluded, 1); near(t.po, 0.5);
    var m = TPC.variableAgreement(pairs, 'marker');
    eq(m.n, 3); eq(m.excluded, 0); near(m.po, 2 / 3);
    ok(m.labels.indexOf('(none)') >= 0);
  });

  // ---------------------------------------------------------- CSV
  test('CSV: BOM, quotes, escaped quotes, embedded comma/newline, CRLF', function () {
    var text = '﻿review_id,lang,text\r\nr1,ko,"안녕, 세계. ""좋다"""\r\nr2,JA,"一行目。\n二行目。"\r\n';
    var rows = TPC.parseCSV(text);
    eq(rows.length, 3);
    eq(rows[1], ['r1', 'ko', '안녕, 세계. "좋다"']);
    eq(rows[2][2], '一行目。\n二行目。');
    var res = TPC.csvToReviews(text);
    eq(res.errors, []);
    eq(res.reviews[1].lang, 'ja');
  });

  test('CSV: reports missing header, bad lang, duplicates', function () {
    eq(TPC.csvToReviews('id,text\n1,x').errors[0].msg, 'header');
    var r = TPC.csvToReviews('review_id,lang,text\na,ko,x.\na,ko,y.\nb,fr,z.\nc,zh,');
    eq(r.reviews.length, 1);
    eq(r.errors.map(function (e) { return e.msg; }), ['dup_id', 'bad_lang', 'empty_text']);
  });

  test('toCSV: UTF-8 BOM, CRLF, quoting', function () {
    var s = TPC.toCSV([['a', 'b,c'], ['他说"好"', '줄\n바꿈']]);
    eq(s.charCodeAt(0), 0xfeff);
    eq(s.slice(1), 'a,"b,c"\r\n"他说""好""","줄\n바꿈"\r\n');
    eq(TPC.toCSV([['x']], { bom: false }), 'x\r\n');
  });

  // -------------------------------------------------- segmentation
  test('split ko: . ? ! with following space; decimals and quoted endings stay', function () {
    eq(TPC.splitSentences('이 책은 재미있다. 정말 그럴까? 그렇다! 평점은 4.5점이다.', 'ko'),
      ['이 책은 재미있다.', '정말 그럴까?', '그렇다!', '평점은 4.5점이다.']);
    eq(TPC.splitSentences('그는 "좋다."라고 했다. 끝...  다음?!', 'ko'),
      ['그는 "좋다."라고 했다.', '끝...', '다음?!']);
  });

  test('split ja: 。！？ without spaces; 「」 quotes are respected', function () {
    eq(TPC.splitSentences('この本は面白い。本当に？読むべきだ！', 'ja'), ['この本は面白い。', '本当に？', '読むべきだ！']);
    eq(TPC.splitSentences('彼は「最高だ。」と言った。次。', 'ja'), ['彼は「最高だ。」と言った。', '次。']);
  });

  test('split zh: 。！？； and newlines', function () {
    eq(TPC.splitSentences('这本书很好。你读过吗？推荐！第一；第二', 'zh'), ['这本书很好。', '你读过吗？', '推荐！', '第一；', '第二']);
    eq(TPC.splitSentences('第一行\n第二行。', 'zh'), ['第一行', '第二行。']);
  });

  test('split: codebook segmentation overrides defaults', function () {
    eq(TPC.splitSentences('甲；乙。', 'zh', { zh: { terminators: '。' } }), ['甲；乙。']);
    eq(TPC.splitSentences('a\nb.', 'ko', { splitOnNewline: false }), ['a b.']);
  });

  test('merge / split sentences keep codes and indices consistent', function () {
    var s = TPC.buildSentences([{ review_id: 'r1', lang: 'ko', text: '가 나. 다 라. 마.' }, { review_id: 'r2', lang: 'ja', text: 'あ。い。' }]);
    eq(s.length, 5);
    s[1].code.type = 'maintain';
    s[1].code.topic = '다'; s[1].code.topicStart = 0; s[1].code.topicEnd = 1;
    ok(TPC.mergeWithNext(s, 0));                    // empty first takes second's code with shifted span
    eq(s[0].text, '가 나. 다 라.'); eq(s[0].code.type, 'maintain'); eq(s[0].code.topicStart, 5);
    eq(s.map(function (x) { return x.idx; }), [0, 1, 0, 1]);
    ok(!TPC.mergeWithNext(s, 1), 'cannot merge across reviews');
    ok(TPC.mergeWithNext(s, 2)); eq(s[2].text, 'あ。い。');
    ok(TPC.splitAt(s, 0, 5)); eq(s[0].text, '가 나.'); eq(s[1].text, '다 라.');
    eq(s[0].code.topicStart, null, 'span beyond split point is cleared');
    eq(s.map(function (x) { return x.review_id + x.idx; }), ['r10', 'r11', 'r12', 'r20']);
    ok(!TPC.splitAt(s, 0, 0), 'no empty halves');
  });

  // ------------------------------------------------------- sampling
  function makeReviews() {
    var out = [];
    ['ko', 'ja', 'zh'].forEach(function (l, li) {
      var n = [50, 30, 12][li];
      for (var i = 1; i <= n; i++) out.push({ review_id: l + i, lang: l, text: 'x' });
    });
    return out;
  }

  test('sample: 20% per language, deterministic for a seed', function () {
    var r = makeReviews();
    var s1 = TPC.stratifiedSample(r, 0.2, 'seed-1'), s2 = TPC.stratifiedSample(r, 0.2, 'seed-1');
    eq(s1, s2);
    eq(s1.byLang.ko.n, 10); eq(s1.byLang.ja.n, 6); eq(s1.byLang.zh.n, 2);
    eq(s1.ids.length, 18);
    s1.byLang.ko.ids.forEach(function (id) { ok(id.indexOf('ko') === 0); });
  });

  test('sample: independent of row order; differs by seed', function () {
    var r = makeReviews();
    var shuffled = r.slice().reverse();
    eq(TPC.stratifiedSample(shuffled, 0.2, 7).ids, TPC.stratifiedSample(r, 0.2, 7).ids);
    ok(JSON.stringify(TPC.stratifiedSample(r, 0.2, 7).ids) !== JSON.stringify(TPC.stratifiedSample(r, 0.2, 8).ids));
  });

  test('sample: tiny language still gets one review', function () {
    var s = TPC.stratifiedSample([{ review_id: 'a', lang: 'zh' }, { review_id: 'b', lang: 'zh' }], 0.2, 1);
    eq(s.byLang.zh.n, 1);
  });

  test('PRNG: mulberry32 is deterministic and in [0,1)', function () {
    var g1 = TPC.mulberry32(42), g2 = TPC.mulberry32(42);
    for (var i = 0; i < 1000; i++) { var x = g1(); eq(x, g2()); ok(x >= 0 && x < 1); }
  });

  // ------------------------------------------------------- alignment
  test('alignCodings: matches by review/idx, flags text mismatch, honours reviewIds', function () {
    var A = [
      { review_id: 'r1', lang: 'ko', idx: 0, text: '가.', code: { type: 'new' } },
      { review_id: 'r1', lang: 'ko', idx: 1, text: '나.', code: { type: 'maintain' } },
      { review_id: 'r2', lang: 'ko', idx: 0, text: '다.', code: {} }
    ];
    var B = [
      { review_id: 'r1', lang: 'ko', idx: 0, text: '가 .', code: { type: 'new' } },
      { review_id: 'r1', lang: 'ko', idx: 1, text: '나와 다.', code: {} }
    ];
    var al = TPC.alignCodings(A, B);
    eq(al.pairs.length, 1); eq(al.textMismatch.length, 1); eq(al.onlyA, 1); eq(al.onlyB, 0);
    eq(TPC.alignCodings(A, B, { reviewIds: ['r1'] }).onlyA, 0);
  });

  /** Runs all tests; log(line) receives output. Returns {passed, failed}. */
  return function run(log) {
    var passed = 0, failed = 0;
    tests.forEach(function (t) {
      try { t.fn(); passed++; log('ok   - ' + t.name, true); }
      catch (e) { failed++; log('FAIL - ' + t.name + '\n       ' + String(e.message).replace(/\n/g, '\n       '), false); }
    });
    log('\n' + passed + ' passed, ' + failed + ' failed', failed === 0);
    return { passed: passed, failed: failed };
  };
});
