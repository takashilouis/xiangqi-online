/* Kiểm thử tự động: luật + máy (AI) + luồng online (chạy: npm test) */
'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const XQ = require('./public/rules.js');

// ---- 1. Luật ----
function perft(b, c, d) { if (!d) return 1; let n = 0; for (const m of XQ.allLegalMoves(b, c)) n += perft(XQ.applyMove(b, m.from, m.to), XQ.other(c), d - 1); return n; }
const b0 = XQ.initialBoard();
assert.deepStrictEqual([perft(b0, 'r', 1), perft(b0, 'r', 2), perft(b0, 'r', 3)], [44, 1920, 79666]);
const empty = () => Array.from({ length: 10 }, () => Array(9).fill(null));
// chiếu hết bằng 2 xe
let g = new XQ.Game(); let b = empty();
b[0][3] = 'bK'; b[9][5] = 'rK'; b[1][0] = 'rR'; b[5][8] = 'rR'; g.board = b;
assert.ok(g.move([8, 5], [8, 0]).ok); assert.strictEqual(g.status, 'over'); assert.deepStrictEqual(g.result, { winner: 'r', reason: 'checkmate' });
// cấm lộ mặt tướng
b = empty(); b[0][4] = 'bK'; b[9][3] = 'rK'; b[0][0] = 'bR';
assert.ok(!XQ.isLegal(b, 'r', [3, 9], [4, 9]), 'không được đối mặt tướng');
b = empty(); b[0][4] = 'bK'; b[9][4] = 'rK'; b[5][4] = 'rN';
assert.ok(!XQ.isLegal(b, 'r', [4, 5], [2, 4]), 'mã ghim không được rời cột');
// tượng không qua sông, sĩ trong cung, tốt chưa qua sông không đi ngang
assert.ok(!XQ.pseudoMoves((() => { const q = empty(); q[5][2] = 'rB'; return q; })(), 2, 5).some(([x, y]) => y < 5));
assert.deepStrictEqual(XQ.pseudoMoves((() => { const q = empty(); q[6][4] = 'rP'; return q; })(), 4, 6), [[4, 5]]);
assert.strictEqual(XQ.pseudoMoves((() => { const q = empty(); q[4][4] = 'rP'; return q; })(), 4, 4).length, 3);
// ký hiệu
assert.strictEqual(XQ.notation(b0, [7, 7], [4, 7]), 'P2-5');
assert.strictEqual(XQ.notation(b0, [7, 9], [6, 7]), 'M2.3');
assert.strictEqual(XQ.notation(b0, [1, 0], [2, 2]), 'M2.3');
console.log('✓ Luật cờ OK');

// ---- 1b. Cờ úp ----
const START = XQ.initialBoard();
const sortStr = (a) => a.slice().sort().join('');
let nonTrivial = 0;
for (let i = 0; i < 200; i++) {
  const u = XQ.initialBoardUp();
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const p = u[y][x], s0 = START[y][x];
    if (!s0) { assert.strictEqual(p, null); continue; }
    if (s0[1] === 'K') { assert.strictEqual(p, s0, 'Tướng giữ nguyên, ngửa'); continue; }
    assert.ok(XQ.isDown(p) && p.length === 4, 'quân úp');
    assert.strictEqual(p.slice(0, 2), s0, 'màu + loại theo vị trí xuất phát');
    if (p[3] !== s0[1]) nonTrivial++;
  }
  for (const c of ['r', 'b']) {
    const types = u.flat().filter((p) => p && p[0] === c && p[1] !== 'K').map((p) => p[3]);
    assert.strictEqual(sortStr(types), sortStr([...'AABBRRNNCCPPPPP']), 'đủ 15 quân mỗi bên');
  }
}
assert.ok(nonTrivial > 1000, 'thực sự xáo trộn');
// rand xác định (đảo ngược) -> kiểm tra hàm rand được dùng
assert.ok(XQ.initialBoardUp(() => 0).flat().some((p) => p && p.length === 4 && p[1] !== p[3]));
// quân úp đi theo loại của ô đứng
const mv = (b, x, y) => XQ.pseudoMoves(b, x, y).map(String).sort();
const one = (x, y, p) => { const q = empty(); q[y][x] = p; return q; };
assert.strictEqual(XQ.pseudoMoves(one(0, 9, 'rR?P'), 0, 9).length, 17, 'ô Xe đi như Xe');
assert.deepStrictEqual(mv(one(0, 6, 'rP?R'), 0, 6), ['0,5'], 'ô Tốt đi như Tốt chưa qua sông');
assert.deepStrictEqual(mv(one(3, 9, 'rA?R'), 3, 9), ['4,8'], 'ô Sĩ: chỉ trong cung');
assert.deepStrictEqual(mv(one(2, 9, 'rB?R'), 2, 9), ['0,7', '4,7'], 'ô Tượng đi như Tượng');
assert.deepStrictEqual(mv(one(1, 9, 'rN?C'), 1, 9), ['0,7', '2,7', '3,8'], 'ô Mã đi như Mã');
b = empty(); b[7][1] = 'rC?R'; b[5][1] = 'bP'; b[2][1] = 'bC?N'; b[9][3] = 'rK'; b[0][4] = 'bK'; b[3][8] = 'bR';
assert.ok(XQ.isLegal(b, 'r', [1, 7], [1, 2]), 'ô Pháo: ăn bằng cách nhảy ngòi');
assert.ok(!XQ.isLegal(b, 'r', [1, 7], [1, 5]), 'ô Pháo: không ăn trực tiếp');
// lật khi đi + ăn quân úp lộ danh tính
g = new XQ.Game(); g.board = b;
let r = g.move([1, 7], [1, 2]); assert.ok(r.ok);
assert.strictEqual(g.board[2][1], 'rR!', 'đi xong lật thành quân thật (Xe)');
assert.deepStrictEqual(g.captured.r, ['bN'], 'ăn quân úp -> lộ là Mã');
assert.match(r.move.text, /^P.*\(Xe\)$/, 'ký hiệu ghi quân vừa lật');
assert.strictEqual(r.move.revealed, 'R');
// sau khi lật đi theo quân thật: Xe ở (1,2) đi ngang được
assert.ok(XQ.pseudoMoves(g.board, 1, 2).some(([x, y]) => y === 2 && x === 8));
// Sĩ / Tượng đã lật được qua sông, ra khỏi cung
assert.deepStrictEqual(mv(one(4, 5, 'rA!'), 4, 5), ['3,4', '3,6', '5,4', '5,6']);
assert.deepStrictEqual(mv(one(4, 5, 'rB!'), 4, 5), ['2,3', '2,7', '6,3', '6,7']);
b = one(4, 5, 'rB!'); b[4][3] = 'bP';
assert.deepStrictEqual(XQ.pseudoMoves(b, 4, 5).map(String).sort(), ['2,7', '6,3', '6,7'], 'Tượng lật vẫn bị chặn mắt');
assert.ok(XQ.pseudoMoves(one(4, 5, 'rA'), 4, 5).length === 0, 'cờ thường: Sĩ không ra khỏi cung');
b = empty(); b[0][4] = 'bK'; b[9][3] = 'rK'; b[1][3] = 'rA!';
assert.ok(XQ.inCheck(b, 'b'), 'Sĩ đã lật vào cung địch có thể chiếu');
// Tốt lật: chưa qua sông chỉ tiến, qua sông đi ngang
assert.deepStrictEqual(mv(one(4, 7, 'rP!'), 4, 7), ['4,6']);
assert.strictEqual(XQ.pseudoMoves(one(4, 4, 'rP!'), 4, 4).length, 3);
// che danh tính
assert.strictEqual(XQ.publicPiece('rC?N'), 'rC?'); assert.strictEqual(XQ.publicPiece('rN!'), 'rN!');
// chơi lại được từ cùng thế ban đầu (nút "Đi lại")
const gu = new XQ.Game({ variant: 'up' });
assert.ok(gu.move([0, 9], [0, 8]).ok);
const gu2 = new XQ.Game({ variant: 'up', board: gu.startBoard }); gu2.move([0, 9], [0, 8]);
assert.deepStrictEqual(gu2.board, gu.board);
// client chỉ thấy quân úp 3 ký tự: tính nước hợp lệ trên bản che = trên bản thật
for (let i = 0; i < 20; i++) {
  const G = new XQ.Game({ variant: 'up' });
  for (let k = 0; k < 30 && G.status === 'playing'; k++) {
    const pub = XQ.publicBoard(G.board);
    const a = XQ.allLegalMoves(G.board, G.turn).map((m) => String(m.from) + '>' + m.to).sort();
    const c = XQ.allLegalMoves(pub, G.turn).map((m) => String(m.from) + '>' + m.to).sort();
    assert.deepStrictEqual(c, a, 'client tính đúng nước hợp lệ dù không biết danh tính');
    const m = XQ.allLegalMoves(G.board, G.turn); const pick = m[Math.floor(Math.random() * m.length)];
    assert.ok(G.move(pick.from, pick.to).ok);
  }
}
console.log('✓ Luật cờ úp OK (xáo trộn, đi theo vị trí, lật, ăn lộ quân, Sĩ/Tượng qua sông)');

// ---- 1c. Chơi với máy (AI) ----
const AI = require('./public/ai.js');
const randPick = (a) => a[Math.floor(Math.random() * a.length)];
const posOf = (G) => ({ board: XQ.publicBoard(G.board), turn: G.turn, captured: G.captured, variant: G.variant, moveCount: G.history.length, prevBoards: AI.recentBoards(G) });
const isLegalMove = (G, mv) => mv && XQ.isLegal(G.board, G.turn, mv.from, mv.to);
// sinh nước của máy == luật (trên bản che danh tính)
{
  const eng = AI.createEngine(); let n = 0;
  for (const variant of ['normal', 'up']) for (let gi = 0; gi < 25; gi++) {
    const G = new XQ.Game({ variant });
    for (let k = 0; k < 80 && G.status === 'playing'; k++) {
      eng.load(posOf(G));
      const a = eng.legalRootMoves().map((m) => m.from + '>' + m.to).sort();
      const b = XQ.allLegalMoves(G.board, G.turn).map((m) => m.from + '>' + m.to).sort();
      assert.deepStrictEqual(a, b, 'bộ sinh nước của máy khớp luật'); n++;
      const m = randPick(XQ.allLegalMoves(G.board, G.turn)); G.move(m.from, m.to);
    }
  }
}
// 1) máy luôn trả về nước hợp lệ (nhiều thế cờ ngẫu nhiên, cả 3 mức, thường + cờ úp)
{
  const eng = AI.createEngine(); let n = 0;
  const lv = [['easy', {}], ['medium', { maxDepth: 2 }], ['hard', { timeMs: 40 }]];
  for (const variant of ['normal', 'up']) for (let gi = 0; gi < 30; gi++) {
    const G = new XQ.Game({ variant });
    const plies = Math.floor(Math.random() * 90);
    for (let k = 0; k < plies && G.status === 'playing'; k++) { const m = randPick(XQ.allLegalMoves(G.board, G.turn)); G.move(m.from, m.to); }
    if (G.status !== 'playing') continue;
    for (const [level, o] of lv) {
      const before = JSON.stringify(G.board);
      const r = eng.think(posOf(G), { level, ...o });
      assert.ok(isLegalMove(G, r.move), `máy (${level}, ${variant}) đi nước hợp lệ`);
      assert.strictEqual(JSON.stringify(G.board), before, 'máy không sửa bàn cờ');
      n++;
    }
  }
  // hết nước đi -> trả về null
  const em = empty(); em[0][3] = 'bK'; em[9][5] = 'rK'; em[1][0] = 'rR'; em[0][8] = 'rR';
  assert.strictEqual(eng.think({ board: em, turn: 'b', captured: { r: [], b: [] } }, { level: 'hard', timeMs: 50 }).move, null);
  console.log(`✓ Máy luôn đi nước hợp lệ (${n} thế cờ ngẫu nhiên, 3 mức, thường + cờ úp)`);
}
// 2) thấy chiếu bí 1 nước ở mức Trung bình / Khó
{
  const mates = [];
  let q = empty(); q[0][3] = 'bK'; q[9][5] = 'rK'; q[1][0] = 'rR'; q[5][8] = 'rR'; mates.push({ board: q, turn: 'r', variant: 'normal' });
  q = empty(); q[0][3] = 'bK'; q[9][5] = 'rK'; q[8][0] = 'bR'; q[4][8] = 'bR'; q[6][2] = 'rN'; mates.push({ board: q, turn: 'b', variant: 'normal' });
  // thế cờ thu thập từ các ván ngẫu nhiên có nước chiếu bí ngay (cờ úp: chỉ tính khi nước chiếu bí không do quân úp đi)
  const mateMoves = (b, c, variant) => XQ.allLegalMoves(b, c).filter((m) => {
    if (variant === 'up' && XQ.isDown(b[m.from[1]][m.from[0]])) return false;
    const nb = XQ.applyMove(b, m.from, m.to);
    return XQ.inCheck(nb, XQ.other(c)) && XQ.allLegalMoves(nb, XQ.other(c)).length === 0;
  });
  for (const variant of ['normal', 'up']) {
    let found = 0;
    for (let gi = 0; gi < 400 && found < 8; gi++) {
      const G = new XQ.Game({ variant });
      while (G.status === 'playing' && G.history.length < 200) {
        if (G.history.length > 6 && mateMoves(G.board, G.turn, variant).length) { mates.push({ board: XQ.cloneBoard(G.board), turn: G.turn, variant, captured: JSON.parse(JSON.stringify(G.captured)) }); found++; break; }
        const m = randPick(XQ.allLegalMoves(G.board, G.turn)); G.move(m.from, m.to);
      }
    }
    assert.ok(found >= 3, 'thu thập được thế chiếu bí ' + variant);
  }
  for (const level of ['medium', 'hard']) for (const M of mates) {
    assert.ok(mateMoves(M.board, M.turn, M.variant).length > 0);
    const r = AI.think({ board: XQ.publicBoard(M.board), turn: M.turn, captured: M.captured || { r: [], b: [] }, variant: M.variant }, { level });
    const G = new XQ.Game({ variant: M.variant, board: M.board }); G.turn = M.turn;
    assert.ok(G.move(r.move.from, r.move.to).ok);
    assert.deepStrictEqual([G.status, G.result && G.result.reason], ['over', 'checkmate'], `mức ${level} phải chiếu bí ngay (${M.variant})`);
  }
  console.log(`✓ Trung bình / Khó luôn thấy chiếu bí 1 nước (${mates.length} thế cờ)`);
}
// 3) cờ úp: máy không biết danh tính quân úp – hai thế chỉ khác danh tính quân úp cho cùng một nước (cùng seed)
{
  let n = 0, differ = 0;
  for (let gi = 0; gi < 24; gi++) {
    const G = new XQ.Game({ variant: 'up' });
    const plies = 4 + Math.floor(Math.random() * 30);
    for (let k = 0; k < plies && G.status === 'playing'; k++) { const m = randPick(XQ.allLegalMoves(G.board, G.turn)); G.move(m.from, m.to); }
    if (G.status !== 'playing') continue;
    // hoán đổi ngẫu nhiên danh tính các quân còn úp của mỗi bên
    const alt = XQ.cloneBoard(G.board);
    for (const c of ['r', 'b']) {
      const sq = [], ids = [];
      for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) { const p = alt[y][x]; if (p && p[0] === c && XQ.isDown(p)) { sq.push([x, y]); ids.push(p[3]); } }
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      ids.reverse();
      sq.forEach(([x, y], i) => { alt[y][x] = alt[y][x].slice(0, 3) + ids[i]; });
    }
    if (JSON.stringify(alt) !== JSON.stringify(G.board)) differ++;
    for (const [level, o] of [['easy', {}], ['medium', { timeMs: 1e9 }], ['hard', { maxDepth: 3, timeMs: 1e9 }]]) {
      const seed = 1000 + gi;
      const base = { turn: G.turn, captured: G.captured, variant: 'up', moveCount: G.history.length };
      const r1 = AI.createEngine().think({ ...base, board: G.board }, { level, seed, ...o });   // bàn có danh tính thật
      const r2 = AI.createEngine().think({ ...base, board: alt }, { level, seed, ...o });       // danh tính khác
      const r3 = AI.createEngine().think({ ...base, board: XQ.publicBoard(G.board) }, { level, seed, ...o }); // bản che
      assert.deepStrictEqual([r1.move, r1.score], [r2.move, r2.score], `máy (${level}) không phụ thuộc danh tính quân úp`);
      assert.deepStrictEqual([r1.move, r1.score], [r3.move, r3.score]);
      n++;
    }
  }
  assert.ok(differ > 10);
  assert.ok(!JSON.stringify(AI.aiView(XQ.initialBoardUp())).match(/\?[KABRNCP]/), 'aiView che danh tính');
  console.log(`✓ Cờ úp: máy không đọc danh tính quân úp (${n} cặp thế cờ cho cùng nước đi)`);
}
// 4) mức Khó tôn trọng giới hạn thời gian (~1,5 giây)
{
  const G1 = new XQ.Game(); for (const [f, t] of [[[7, 7], [4, 7]], [[7, 0], [6, 2]], [[7, 9], [6, 7]], [[8, 0], [7, 0]]]) assert.ok(G1.move(f, t).ok);
  const G2 = new XQ.Game({ variant: 'up' });
  const G3 = new XQ.Game(); for (let k = 0; k < 30 && G3.status === 'playing'; k++) { const r = AI.think(posOf(G3), { level: 'hard', timeMs: 30 }); G3.move(r.move.from, r.move.to); }
  for (const G of [G1, G2, G3]) {
    if (G.status !== 'playing') continue;
    const t0 = Date.now();
    const r = AI.think(posOf(G), { level: 'hard' });
    const dt = Date.now() - t0;
    assert.ok(isLegalMove(G, r.move));
    assert.ok(dt <= AI.LEVELS.hard.timeMs + 600, `Khó vượt thời gian: ${dt}ms`);
    assert.ok(r.depth >= 4 || r.score > 29000 || r.score < -29000, 'Khó tìm đủ sâu (độ sâu ' + r.depth + ')');
    console.log(`  Khó: ${G.variant}, độ sâu ${r.depth}, ${r.nodes} thế cờ, ${dt}ms`);
  }
  console.log('✓ Mức Khó dừng đúng giới hạn thời gian');
}

// ---- 2. Online ----
const PORT = 3999;
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, XQ_TEST: '1' }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const c = { ws, msgs: [], all: [], state: null, send: (o) => ws.send(JSON.stringify(o)) };
    c.wait = (pred, ms = 2000) => new Promise((ok, bad) => {
      const t0 = Date.now();
      (function poll() { const m = c.msgs.find(pred); if (m) { c.msgs.splice(c.msgs.indexOf(m), 1); return ok(m); } if (Date.now() - t0 > ms) return bad(new Error('timeout')); setTimeout(poll, 20); })();
    });
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'state') c.state = m; c.msgs.push(m); c.all.push(m); });
    ws.on('open', () => res(c));
  });
}
const count = (board, color) => board.flat().filter((p) => p && p[0] === color).length;

(async () => {
  await sleep(500);
  try {
    // phòng cờ úp
    const A = await client(), B = await client();
    A.send({ t: 'create', name: 'An', color: 'r', variant: 'up' });
    const j = await A.wait((m) => m.t === 'joined');
    B.send({ t: 'join', code: j.code, name: 'Bình' });
    const jb = await B.wait((m) => m.t === 'joined'); assert.strictEqual(jb.color, 'b');
    await sleep(150);
    assert.strictEqual(A.state.status, 'playing'); assert.strictEqual(A.state.variant, 'up');
    const LEAK = /[rb][KABRNCP]\?[KABRNCP]/; // quân úp kèm danh tính thật
    const noLeak = (cl) => { for (const m of cl.all) if (m.status !== 'over') assert.ok(!LEAK.test(JSON.stringify(m)), 'không lộ danh tính quân úp: ' + JSON.stringify(m).slice(0, 80)); };
    for (const S of [A.state, B.state]) {
      assert.strictEqual(count(S.board, 'r'), 16); assert.strictEqual(count(S.board, 'b'), 16, 'thấy đủ quân (úp) hai bên');
      for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
        const p = S.board[y][x], s0 = START[y][x];
        assert.strictEqual(p, s0 && (s0[1] === 'K' ? s0 : s0 + '?'), 'client chỉ thấy màu + vị trí');
      }
    }
    // đi sai lượt
    B.send({ t: 'move', from: [0, 3], to: [0, 4] }); await B.wait((m) => m.t === 'illegal');
    // server kiểm tra nước: quân úp ô Pháo không được ăn trực tiếp / quân úp ô Tốt không đi ngang
    A.send({ t: 'move', from: [0, 6], to: [1, 6] }); await A.wait((m) => m.t === 'illegal');
    // quân úp ô Pháo (7,7) ăn quân úp ô Mã (7,0)
    A.send({ t: 'move', from: [7, 7], to: [7, 0] }); await sleep(150);
    const capR = A.state.captured.r;
    assert.strictEqual(capR.length, 1); assert.match(capR[0], /^b[ABRNCP]$/, 'quân bị ăn lộ danh tính');
    const flipped = A.state.board[0][7];
    assert.match(flipped, /^r[ABRNCP]!$/, 'quân vừa đi đã lật');
    assert.strictEqual(B.state.board[0][7], flipped, 'hai bên cùng thấy quân lật');
    assert.ok(A.state.moves[0].flip && A.state.moves[0].text.includes('(' + XQ.VN_NAME[flipped[1]] + ')'));
    // Đen đi quân úp ô Xe (8,0) xuống 1
    B.send({ t: 'move', from: [8, 0], to: [8, 1] }); await sleep(150);
    assert.match(B.state.board[1][8], /^b[ABRNCP]!$/);
    noLeak(A); noLeak(B);
    // đầu hàng -> hết ván lộ toàn bộ quân còn úp
    A.send({ t: 'resign' });
    await A.wait((m) => m.t === 'gameover'); await sleep(100);
    assert.strictEqual(A.state.status, 'over'); assert.strictEqual(A.state.result.winner, 'b'); assert.strictEqual(A.state.result.reason, 'resign');
    assert.ok(A.state.board.flat().some((p) => p && p.length === 4), 'hết ván lộ danh tính');
    // ván mới (đổi màu, xáo lại)
    A.all.length = 0; B.all.length = 0;
    A.send({ t: 'rematch' }); B.send({ t: 'rematch' }); await sleep(200);
    assert.strictEqual(A.state.you, 'b'); assert.strictEqual(B.state.you, 'r'); assert.strictEqual(A.state.gameNo, 2);
    assert.ok(A.state.board.flat().filter((p) => p && p[2] === '?').length === 30, 'ván mới úp lại 30 quân');
    noLeak(A); noLeak(B);
    // cầu hoà
    B.send({ t: 'offerDraw' }); await sleep(100); assert.strictEqual(A.state.drawOffer, 'r');
    A.send({ t: 'acceptDraw' }); await sleep(150);
    assert.strictEqual(B.state.result.reason, 'agreed');
    console.log('✓ Phòng cờ úp: che danh tính, server kiểm tra nước, lật quân, ăn lộ quân, đầu hàng, ván mới, cầu hoà OK');

    // phòng thường + chiếu hết + đảo màu + reconnect
    const C = await client(), D = await client();
    C.send({ t: 'create', name: 'Cường', color: 'r' });
    const jc = await C.wait((m) => m.t === 'joined');
    C.send({ t: 'swap' }); await C.wait((m) => m.t === 'joined' && m.color === 'b');
    D.send({ t: 'join', code: jc.code }); const jd = await D.wait((m) => m.t === 'joined'); assert.strictEqual(jd.color, 'r');
    await sleep(100);
    assert.strictEqual(count(C.state.board, 'r'), 16); assert.deepStrictEqual(C.state.board, START, 'chế độ thường: thế cờ chuẩn'); assert.strictEqual(C.state.variant, 'normal');
    D.ws.close(); await sleep(150);
    assert.strictEqual(C.state.players.r.online, false);
    const D2 = await client(); D2.send({ t: 'resume', code: jc.code, token: jd.token });
    await D2.wait((m) => m.t === 'joined'); await sleep(100); assert.strictEqual(C.state.players.r.online, true);
    b = empty(); b[0][3] = 'bK'; b[9][5] = 'rK'; b[1][0] = 'rR'; b[5][8] = 'rR';
    D2.send({ t: 'debugSetBoard', board: b, turn: 'r' }); await sleep(100);
    D2.send({ t: 'move', from: [8, 5], to: [8, 0] });
    const go = await D2.wait((m) => m.t === 'gameover'); assert.match(go.msg, /THẮNG/);
    const gc = await C.wait((m) => m.t === 'gameover'); assert.match(gc.msg, /thua/);
    console.log('✓ Phòng thường, đảo màu, kết nối lại, chiếu hết OK');
    console.log('\nTẤT CẢ KIỂM THỬ ĐỀU QUA');
    process.exitCode = 0;
  } catch (e) { console.error('✗ LỖI:', e); process.exitCode = 1; }
  srv.kill(); process.exit();
})();
