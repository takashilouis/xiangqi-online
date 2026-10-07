/* Máy chơi cờ tướng (thường + cờ úp) – chạy trong Web Worker trên trình duyệt (và trong Node để kiểm thử).
 *
 * Tìm kiếm: alpha-beta negamax + PVS, iterative deepening có giới hạn thời gian, bảng chuyển vị (Zobrist),
 * quiescence (chỉ xét nước ăn), gia hạn khi bị chiếu, null-move, LMR, sắp xếp nước (TT / MVV-LVA / killer / history),
 * bảng điểm vị trí (piece-square tables).
 *
 * CỜ ÚP – CÔNG BẰNG: máy KHÔNG biết danh tính quân úp (của mình lẫn của người chơi).
 *   - Đầu vào được che bằng aiView(): quân úp chỉ còn 'rC?' (màu + loại theo ô đứng); ký tự thứ 4 (danh tính) bị bỏ.
 *   - Giá trị một quân úp = trung bình giá trị các quân CHƯA LỘ của bên đó (15 quân ban đầu − quân đã lật − quân đã bị ăn).
 *   - Trong cây tìm kiếm, quân úp vừa đi sẽ "lật" thành quân chưa biết: giữ giá trị kỳ vọng, không đi tiếp/không chiếu được
 *     (máy không đoán danh tính). Chỉ dùng danh tính thật sau khi quân đã lật trên bàn thật.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XQAI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;
  const TYPE = { K, A, B, N, R, C, P };
  const NORMAL = 0, HIDDEN = 1, FREE = 2, UNKNOWN = 3;
  const BASE = [0, 0, 200, 200, 400, 900, 450, 100];
  const BASE_FREE = [0, 0, 220, 240, 400, 900, 450, 100]; // Sĩ/Tượng đã lật (cờ úp) đi khắp bàn -> đáng giá hơn
  const POOL = { A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 };
  const MATE = 30000, MATE_BOUND = 29000, INF = 32000, MAXPLY = 64;
  const NOW = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

  const LEVELS = {
    easy: { name: 'Dễ', maxDepth: 1, timeMs: 300, noise: 160, randomMove: 0.15 },
    medium: { name: 'Trung bình', maxDepth: 4, timeMs: 800, noise: 0, randomMove: 0 },
    hard: { name: 'Khó', maxDepth: 32, timeMs: 1500, noise: 0, randomMove: 0 },
  };

  /* PRNG có seed (mulberry32) */
  function rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* ===== Bảng điểm vị trí (góc nhìn Đỏ: hàng 0 = đáy bên Đen, hàng 9 = đáy bên Đỏ) ===== */
  const PST = [];
  PST[P] = [
    0, 3, 6, 9, 12, 9, 6, 3, 0,
    18, 36, 56, 80, 120, 80, 56, 36, 18,
    14, 26, 42, 60, 80, 60, 42, 26, 14,
    10, 20, 30, 34, 40, 34, 30, 20, 10,
    6, 12, 18, 18, 20, 18, 18, 12, 6,
    2, 0, 8, 0, 8, 0, 8, 0, 2,
    0, 0, -2, 0, 4, 0, -2, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0];
  PST[N] = [
    4, 8, 16, 12, 4, 12, 16, 8, 4,
    4, 10, 28, 16, 8, 16, 28, 10, 4,
    12, 14, 16, 20, 18, 20, 16, 14, 12,
    8, 24, 18, 24, 20, 24, 18, 24, 8,
    6, 16, 14, 18, 16, 18, 14, 16, 6,
    4, 12, 16, 14, 12, 14, 16, 12, 4,
    2, 6, 8, 6, 10, 6, 8, 6, 2,
    4, 2, 8, 8, 4, 8, 8, 2, 4,
    0, 2, 4, 4, -2, 4, 4, 2, 0,
    0, -4, 0, 0, 0, 0, 0, -4, 0];
  PST[R] = [
    14, 14, 12, 18, 16, 18, 12, 14, 14,
    16, 20, 18, 24, 26, 24, 18, 20, 16,
    12, 12, 12, 18, 18, 18, 12, 12, 12,
    12, 18, 16, 22, 22, 22, 16, 18, 12,
    12, 14, 12, 18, 18, 18, 12, 14, 12,
    12, 16, 14, 20, 20, 20, 14, 16, 12,
    6, 10, 8, 14, 14, 14, 8, 10, 6,
    4, 8, 6, 14, 12, 14, 6, 8, 4,
    8, 4, 8, 16, 8, 16, 8, 4, 8,
    -2, 10, 6, 14, 12, 14, 6, 10, -2];
  PST[C] = [
    6, 4, 0, -10, -12, -10, 0, 4, 6,
    2, 2, 0, -4, -14, -4, 0, 2, 2,
    2, 2, 0, -10, -8, -10, 0, 2, 2,
    0, 0, -2, 4, 10, 4, -2, 0, 0,
    0, 0, 0, 2, 8, 2, 0, 0, 0,
    -2, 0, 4, 2, 6, 2, 4, 0, -2,
    0, 0, 0, 2, 4, 2, 0, 0, 0,
    4, 0, 8, 6, 10, 6, 8, 0, 4,
    0, 2, 4, 6, 6, 6, 4, 2, 0,
    0, 0, 2, 6, 6, 6, 2, 0, 0];
  const z90 = () => new Array(90).fill(0);
  PST[K] = z90(); PST[A] = z90(); PST[B] = z90();
  const setp = (t, x, y, v) => { PST[t][y * 9 + x] = v; };
  setp(K, 4, 9, 6); setp(K, 3, 9, 2); setp(K, 5, 9, 2); setp(K, 4, 8, -4); setp(K, 3, 8, -8); setp(K, 5, 8, -8);
  setp(K, 3, 7, -18); setp(K, 4, 7, -15); setp(K, 5, 7, -18);
  setp(A, 4, 8, 3); setp(A, 3, 7, -1); setp(A, 5, 7, -1);
  setp(B, 4, 7, 3); setp(B, 0, 7, -2); setp(B, 8, 7, -2); setp(B, 2, 5, -1); setp(B, 6, 5, -1);
  // Sĩ/Tượng đã lật (đi khắp bàn): thưởng nhẹ khi tiến lên / vào trung tâm
  const PST_FREE_AB = z90();
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) PST_FREE_AB[y * 9 + x] = Math.round((9 - y) * 1.5 + (4 - Math.abs(4 - x)) * 2);

  const XS = new Int8Array(90), YS = new Int8Array(90);
  for (let s = 0; s < 90; s++) { XS[s] = s % 9; YS[s] = (s / 9) | 0; }
  const inPal = (side, x, y) => x >= 3 && x <= 5 && (side === 0 ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
  const own = (side, y) => (side === 0 ? y >= 5 : y <= 4);

  /* Zobrist: mã quân = side*32 + flag*8 + type (< 64) */
  const Z1 = new Int32Array(64 * 90), Z2 = new Int32Array(64 * 90);
  { const r = rng(20261007); for (let i = 0; i < Z1.length; i++) { Z1[i] = (r() * 4294967296) | 0; Z2[i] = (r() * 4294967296) | 0; } }
  const ZS1 = 0x2f1a7c3b, ZS2 = 0x5bd1e995 | 0;

  /* Che danh tính: chỉ giữ tối đa 3 ký tự ('rC?' / 'rA!' / 'rK'). Máy chỉ được xem bàn cờ qua hàm này. */
  const maskPiece = (p) => (p ? String(p).slice(0, 3) : null);
  const aiView = (board) => board.map((row) => row.map(maskPiece));

  const TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const EXACT = 1, LOWER = 2, UPPER = 3;

  function createEngine() {
    const T = new Int8Array(90), S = new Int8Array(90), F = new Int8Array(90);
    const kpos = [0, 0];
    let side = 0, h1 = 0, h2 = 0, score = 0;
    const VAL = new Int32Array(64 * 90);
    const ABSV = new Int32Array(64 * 90);
    const ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE), ttScore = new Int16Array(TT_SIZE);
    const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE);
    const moveBuf = new Int32Array(MAXPLY * 192), scoreBuf = new Int32Array(MAXPLY * 192);
    const killers = new Int32Array(MAXPLY * 2);
    const hist = new Int32Array(90 * 90);
    const pathHash = new Int32Array(MAXPLY + 8);
    // ngăn xếp make/unmake
    const stCapT = new Int8Array(MAXPLY + 8), stCapS = new Int8Array(MAXPLY + 8), stCapF = new Int8Array(MAXPLY + 8), stMovF = new Int8Array(MAXPLY + 8);
    const stH1 = new Int32Array(MAXPLY + 8), stH2 = new Int32Array(MAXPLY + 8), stSc = new Int32Array(MAXPLY + 8);
    let sp = 0;
    let nodes = 0, deadline = Infinity, aborted = false, canAbort = false;
    let gameHashes = new Set(); // các thế cờ đã xuất hiện trong ván (tránh / tìm hoà do lặp thế)

    const code = (s) => S[s] * 32 + F[s] * 8 + T[s];

    function load(pos) {
      const board = aiView(pos.board);
      T.fill(0); S.fill(0); F.fill(0); h1 = 0; h2 = 0;
      for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
        const p = board[y][x]; if (!p) continue;
        const s = y * 9 + x;
        S[s] = p[0] === 'r' ? 0 : 1; T[s] = TYPE[p[1]];
        F[s] = p[2] === '?' ? HIDDEN : p[2] === '!' ? FREE : NORMAL;
        if (T[s] === K) kpos[S[s]] = s;
      }
      side = pos.turn === 'b' ? 1 : 0;
      // giá trị kỳ vọng quân úp: trung bình các quân chưa lộ của mỗi bên (chỉ dùng thông tin công khai)
      const E = [0, 0];
      for (let sd = 0; sd < 2; sd++) {
        const c = sd === 0 ? 'r' : 'b';
        const cnt = Object.assign({}, POOL);
        for (let s = 0; s < 90; s++) if (T[s] && S[s] === sd && F[s] === FREE) { const L = 'KABNRCP'[T[s] - 1]; if (cnt[L] > 0) cnt[L]--; }
        const caps = pos.captured ? [].concat(pos.captured.r || [], pos.captured.b || []) : [];
        for (const q of caps) if (q && q[0] === c && cnt[q[1]] > 0) cnt[q[1]]--;
        let n = 0, sum = 0;
        for (const L in cnt) { n += cnt[L]; sum += cnt[L] * BASE_FREE[TYPE[L]]; }
        if (n === 0) { for (const L in POOL) { n += POOL[L]; sum += POOL[L] * BASE_FREE[TYPE[L]]; } }
        E[sd] = Math.round(sum / n);
      }
      for (let sd = 0; sd < 2; sd++) for (let f = 0; f < 4; f++) for (let t = 1; t <= 7; t++) {
        const cd = sd * 32 + f * 8 + t;
        for (let s = 0; s < 90; s++) {
          const ps = sd === 0 ? s : (9 - YS[s]) * 9 + XS[s]; // lật dọc cho Đen
          let v;
          if (f === HIDDEN || f === UNKNOWN) v = t === K ? 0 : E[sd];
          else if (f === FREE && (t === A || t === B)) v = BASE_FREE[t] + PST_FREE_AB[ps];
          else v = BASE[t] + PST[t][ps];
          ABSV[cd * 90 + s] = v;
          VAL[cd * 90 + s] = sd === 0 ? v : -v;
        }
      }
      score = 0;
      for (let s = 0; s < 90; s++) if (T[s]) { const cd = code(s); score += VAL[cd * 90 + s]; h1 ^= Z1[cd * 90 + s]; h2 ^= Z2[cd * 90 + s]; }
      if (side) { h1 ^= ZS1; h2 ^= ZS2; }
    }

    /* Ô s (Tướng của bên sd) có bị bên kia tấn công không – gồm cả lộ mặt tướng */
    function attacked(s, sd) {
      const e = sd ^ 1, x = XS[s], y = YS[s];
      // hàng/cột: Xe, Tướng (lộ mặt), Pháo
      for (let d = 0; d < 4; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        let nx = x + dx, ny = y + dy, screen = false;
        while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
          const q = ny * 9 + nx;
          if (T[q]) {
            if (!screen) {
              if (S[q] === e && F[q] !== UNKNOWN && (T[q] === R || T[q] === K)) return true;
              screen = true;
            } else {
              if (S[q] === e && F[q] !== UNKNOWN && T[q] === C) return true;
              break;
            }
          }
          nx += dx; ny += dy;
        }
      }
      // Mã: mã ở K+(dx,dy), chân mã ở ô chéo cạnh Tướng
      for (let i = 0; i < 8; i++) {
        const dx = NDX[i], dy = NDY[i];
        const hx = x + dx, hy = y + dy;
        if (hx < 0 || hx > 8 || hy < 0 || hy > 9) continue;
        const h = hy * 9 + hx;
        if (T[h] !== N || S[h] !== e || F[h] === UNKNOWN) continue;
        // chân mã nằm cạnh con mã theo hướng đi 2 ô
        const legX = Math.abs(dx) === 2 ? hx - Math.sign(dx) : hx;
        const legY = Math.abs(dy) === 2 ? hy - Math.sign(dy) : hy;
        if (!T[legY * 9 + legX]) return true;
      }
      // Tốt
      const pf = e === 0 ? -1 : 1; // hướng tiến của tốt bên e
      const by = y - pf;
      if (by >= 0 && by <= 9) { const q = by * 9 + x; if (T[q] === P && S[q] === e && F[q] !== UNKNOWN) return true; }
      for (const dx of [-1, 1]) {
        const nx = x + dx; if (nx < 0 || nx > 8) continue;
        const q = y * 9 + nx;
        if (T[q] === P && S[q] === e && F[q] !== UNKNOWN && !own(e, y)) return true;
      }
      // Sĩ / Tượng đã lật (cờ úp)
      for (let i = 0; i < 4; i++) {
        const dx = DDX[i], dy = DDY[i];
        let nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) { const q = ny * 9 + nx; if (T[q] === A && S[q] === e && F[q] === FREE) return true; }
        nx = x + 2 * dx; ny = y + 2 * dy;
        if (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) { const q = ny * 9 + nx; if (T[q] === B && S[q] === e && F[q] === FREE && !T[(y + dy) * 9 + x + dx]) return true; }
      }
      return false;
    }
    const inCheckSide = (sd) => attacked(kpos[sd], sd);

    /* Sinh nước giả hợp lệ cho bên sd, ghi vào moveBuf từ vị trí start. Trả về số nước. */
    function gen(sd, start, capOnly) {
      let n = start;
      const add = (f, t) => { if (!T[t]) { if (!capOnly) moveBuf[n++] = (f << 8) | t; } else if (S[t] !== sd) moveBuf[n++] = (f << 8) | t; };
      for (let s = 0; s < 90; s++) {
        if (!T[s] || S[s] !== sd || F[s] === UNKNOWN) continue;
        const x = XS[s], y = YS[s], t = T[s], free = F[s] === FREE;
        switch (t) {
          case K:
            for (let d = 0; d < 4; d++) { const nx = x + ODX[d], ny = y + ODY[d]; if (inPal(sd, nx, ny)) add(s, ny * 9 + nx); }
            break;
          case A:
            for (let d = 0; d < 4; d++) {
              const nx = x + DDX[d], ny = y + DDY[d];
              if (free ? (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) : inPal(sd, nx, ny)) add(s, ny * 9 + nx);
            }
            break;
          case B:
            for (let d = 0; d < 4; d++) {
              const nx = x + 2 * DDX[d], ny = y + 2 * DDY[d];
              if (nx >= 0 && nx < 9 && ny >= 0 && ny < 10 && (free || own(sd, ny)) && !T[(y + DDY[d]) * 9 + x + DDX[d]]) add(s, ny * 9 + nx);
            }
            break;
          case N:
            for (let i = 0; i < 8; i++) {
              const nx = x + NDX[i], ny = y + NDY[i];
              if (nx < 0 || nx > 8 || ny < 0 || ny > 9) continue;
              const lx = Math.abs(NDX[i]) === 2 ? x + Math.sign(NDX[i]) : x;
              const ly = Math.abs(NDY[i]) === 2 ? y + Math.sign(NDY[i]) : y;
              if (!T[ly * 9 + lx]) add(s, ny * 9 + nx);
            }
            break;
          case R:
            for (let d = 0; d < 4; d++) {
              let nx = x + ODX[d], ny = y + ODY[d];
              while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
                const q = ny * 9 + nx;
                if (!T[q]) { if (!capOnly) moveBuf[n++] = (s << 8) | q; } else { if (S[q] !== sd) moveBuf[n++] = (s << 8) | q; break; }
                nx += ODX[d]; ny += ODY[d];
              }
            }
            break;
          case C:
            for (let d = 0; d < 4; d++) {
              let nx = x + ODX[d], ny = y + ODY[d], jumped = false;
              while (nx >= 0 && nx < 9 && ny >= 0 && ny < 10) {
                const q = ny * 9 + nx;
                if (!jumped) { if (!T[q]) { if (!capOnly) moveBuf[n++] = (s << 8) | q; } else jumped = true; }
                else if (T[q]) { if (S[q] !== sd) moveBuf[n++] = (s << 8) | q; break; }
                nx += ODX[d]; ny += ODY[d];
              }
            }
            break;
          case P: {
            const ny = y + (sd === 0 ? -1 : 1);
            if (ny >= 0 && ny <= 9) add(s, ny * 9 + x);
            if (!own(sd, y)) { if (x > 0) add(s, y * 9 + x - 1); if (x < 8) add(s, y * 9 + x + 1); }
            break;
          }
        }
      }
      return n - start;
    }

    function make(m) {
      const f = m >> 8, t = m & 255;
      stCapT[sp] = T[t]; stCapS[sp] = S[t]; stCapF[sp] = F[t]; stMovF[sp] = F[f];
      stH1[sp] = h1; stH2[sp] = h2; stSc[sp] = score; sp++;
      let cd = code(f);
      score -= VAL[cd * 90 + f]; h1 ^= Z1[cd * 90 + f]; h2 ^= Z2[cd * 90 + f];
      if (T[t]) { const cc = code(t); score -= VAL[cc * 90 + t]; h1 ^= Z1[cc * 90 + t]; h2 ^= Z2[cc * 90 + t]; }
      T[t] = T[f]; S[t] = S[f]; F[t] = F[f] === HIDDEN ? UNKNOWN : F[f]; // quân úp đi -> lật thành "chưa biết"
      T[f] = 0; S[f] = 0; F[f] = 0;
      cd = code(t);
      score += VAL[cd * 90 + t]; h1 ^= Z1[cd * 90 + t]; h2 ^= Z2[cd * 90 + t];
      if (T[t] === K) kpos[S[t]] = t;
      side ^= 1; h1 ^= ZS1; h2 ^= ZS2;
    }
    function unmake(m) {
      const f = m >> 8, t = m & 255;
      sp--;
      T[f] = T[t]; S[f] = S[t]; F[f] = stMovF[sp];
      T[t] = stCapT[sp]; S[t] = stCapS[sp]; F[t] = stCapF[sp];
      if (T[f] === K) kpos[S[f]] = f;
      h1 = stH1[sp]; h2 = stH2[sp]; score = stSc[sp];
      side ^= 1;
    }
    const evaluate = () => (side === 0 ? score : -score);

    function checkTime() {
      if ((nodes & 1023) === 0 && canAbort && NOW() > deadline) aborted = true;
    }

    function orderScore(m, ply, ttm) {
      if (m === ttm) return 10000000;
      const f = m >> 8, t = m & 255;
      if (T[t]) return 1000000 + ABSV[code(t) * 90 + t] * 16 - ABSV[code(f) * 90 + f] / 16;
      if (m === killers[ply * 2]) return 900000;
      if (m === killers[ply * 2 + 1]) return 800000;
      return hist[f * 90 + t];
    }
    function pickNext(i, end) { // selection sort từng bước
      let bi = i, bs = scoreBuf[i];
      for (let j = i + 1; j < end; j++) if (scoreBuf[j] > bs) { bs = scoreBuf[j]; bi = j; }
      if (bi !== i) {
        const tm = moveBuf[i]; moveBuf[i] = moveBuf[bi]; moveBuf[bi] = tm;
        const ts = scoreBuf[i]; scoreBuf[i] = scoreBuf[bi]; scoreBuf[bi] = ts;
      }
      return moveBuf[i];
    }

    function qsearch(alpha, beta, ply) {
      nodes++; checkTime(); if (aborted) return 0;
      const stand = evaluate();
      if (ply >= MAXPLY - 1) return stand;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      const start = ply * 192, n = gen(side, start, true), end = start + n;
      for (let i = start; i < end; i++) scoreBuf[i] = orderScore(moveBuf[i], ply, 0);
      const me = side;
      for (let i = start; i < end; i++) {
        const m = pickNext(i, end);
        make(m);
        if (attacked(kpos[me], me)) { unmake(m); continue; }
        const sc = -qsearch(-beta, -alpha, ply + 1);
        unmake(m);
        if (aborted) return 0;
        if (sc > alpha) { alpha = sc; if (sc >= beta) return sc; }
      }
      return alpha;
    }

    function hasPieces(sd) {
      for (let s = 0; s < 90; s++) if (T[s] && S[s] === sd && F[s] !== UNKNOWN && (T[s] === R || T[s] === N || T[s] === C)) return true;
      return false;
    }

    function search(depth, alpha, beta, ply, nullOk) {
      if (aborted) return 0;
      nodes++; checkTime(); if (aborted) return 0;
      pathHash[ply] = h1;
      if (ply > 0) {
        for (let i = ply - 2; i >= 0; i -= 2) if (pathHash[i] === h1) return 0; // lặp thế trên đường đi -> hoà
        if (gameHashes.has(h1)) return 0;
        // cắt tỉa theo khoảng cách chiếu bí
        const ma = Math.max(alpha, -MATE + ply), mb = Math.min(beta, MATE - ply - 1);
        if (ma >= mb) return ma;
      }
      if (ply >= MAXPLY - 2) return evaluate();
      const me = side;
      const inCheck = attacked(kpos[me], me);
      if (inCheck) depth++;
      if (depth <= 0) return qsearch(alpha, beta, ply);
      const pv = beta - alpha > 1;
      const idx = h1 & TT_MASK;
      let ttm = 0;
      if (ttKey[idx] === h2 && ttFlag[idx]) {
        ttm = ttMove[idx];
        if (!pv && ttDepth[idx] >= depth && ply > 0) {
          let sc = ttScore[idx];
          if (sc > MATE_BOUND) sc -= ply; else if (sc < -MATE_BOUND) sc += ply;
          const fl = ttFlag[idx];
          if (fl === EXACT || (fl === LOWER && sc >= beta) || (fl === UPPER && sc <= alpha)) return sc;
        }
      }
      // null move
      if (!pv && !inCheck && nullOk && depth >= 3 && Math.abs(beta) < MATE_BOUND && hasPieces(me) && evaluate() >= beta) {
        stH1[sp] = h1; stH2[sp] = h2; sp++;
        side ^= 1; h1 ^= ZS1; h2 ^= ZS2;
        const sc = -search(depth - 3, -beta, -beta + 1, ply + 1, false);
        sp--; side ^= 1; h1 = stH1[sp]; h2 = stH2[sp];
        if (aborted) return 0;
        if (sc >= beta) return beta;
      }
      const start = ply * 192, n = gen(me, start, false), end = start + n;
      for (let i = start; i < end; i++) scoreBuf[i] = orderScore(moveBuf[i], ply, ttm);
      const alpha0 = alpha;
      let best = -INF, bestMove = 0, legal = 0;
      for (let i = start; i < end; i++) {
        const m = pickNext(i, end);
        const isCap = T[m & 255] !== 0;
        make(m);
        if (attacked(kpos[me], me)) { unmake(m); continue; }
        legal++;
        let sc;
        if (legal === 1) sc = -search(depth - 1, -beta, -alpha, ply + 1, true);
        else {
          let red = 0;
          if (depth >= 3 && legal > 4 && !isCap && !inCheck && m !== killers[ply * 2] && m !== killers[ply * 2 + 1]) red = legal > 12 ? 2 : 1;
          sc = -search(depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
          if (!aborted && sc > alpha && red) sc = -search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
          if (!aborted && sc > alpha && sc < beta) sc = -search(depth - 1, -beta, -alpha, ply + 1, true);
        }
        unmake(m);
        if (aborted) return 0;
        if (sc > best) {
          best = sc; bestMove = m;
          if (sc > alpha) {
            alpha = sc;
            if (sc >= beta) {
              if (!isCap) {
                if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
                hist[(m >> 8) * 90 + (m & 255)] += depth * depth;
                if (hist[(m >> 8) * 90 + (m & 255)] > 700000) for (let k = 0; k < hist.length; k++) hist[k] >>= 1;
              }
              break;
            }
          }
        }
      }
      if (legal === 0) return -MATE + ply; // bị chiếu bí hoặc hết nước đi: đều thua
      let st = best;
      if (st > MATE_BOUND) st += ply; else if (st < -MATE_BOUND) st -= ply;
      ttKey[idx] = h2; ttMove[idx] = bestMove; ttScore[idx] = st; ttDepth[idx] = depth;
      ttFlag[idx] = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
      return best;
    }

    function legalRootMoves() {
      const n = gen(side, 0, false), out = [], me = side;
      for (let i = 0; i < n; i++) {
        const m = moveBuf[i];
        make(m); const ok = !attacked(kpos[me], me); unmake(m);
        if (ok) out.push(m);
      }
      return out;
    }

    const toObj = (m) => ({ from: [XS[m >> 8], YS[m >> 8]], to: [XS[m & 255], YS[m & 255]] });

    /* Sách khai cuộc nhỏ (chỉ cờ thường, nước đầu của mỗi bên) để các ván không giống hệt nhau */
    const BOOK_R = [[7, 7, 4, 7], [1, 7, 4, 7], [7, 7, 4, 7], [1, 7, 4, 7], [7, 9, 6, 7], [1, 9, 2, 7], [6, 9, 4, 7], [2, 9, 4, 7], [2, 6, 2, 5], [6, 6, 6, 5]];
    const BOOK_B = [[7, 0, 6, 2], [1, 0, 2, 2], [7, 2, 4, 2], [1, 2, 4, 2], [2, 0, 4, 2], [6, 0, 4, 2], [2, 3, 2, 4], [6, 3, 6, 4]];
    function bookMove(pos, rand, rootMoves) {
      if (pos.variant === 'up' || !(pos.moveCount === 0 || pos.moveCount === 1)) return 0;
      const list = side === 0 ? BOOK_R : BOOK_B;
      const cand = list.map(([a, b, c, d]) => ((b * 9 + a) << 8) | (d * 9 + c)).filter((m) => rootMoves.includes(m));
      if (!cand.length) return 0;
      const before = evaluate();
      for (let tries = 0; tries < 4; tries++) {
        const m = cand[Math.floor(rand() * cand.length)];
        make(m); const after = -qsearch(-INF, INF, 1); unmake(m); // không được để mất quân
        if (after >= before - 40) return m;
      }
      return 0;
    }

    /* pos: {board, turn, captured, variant, moveCount}; opts: {level, timeMs, maxDepth, seed} */
    function think(pos, opts = {}) {
      const lv = LEVELS[opts.level] || LEVELS.medium;
      const timeMs = opts.timeMs != null ? opts.timeMs : lv.timeMs;
      const maxDepth = Math.min(opts.maxDepth != null ? opts.maxDepth : lv.maxDepth, MAXPLY - 8);
      const rand = rng(opts.seed != null ? opts.seed : (Math.random() * 4294967296) >>> 0);
      const t0 = NOW();
      load(pos);
      gameHashes = new Set((pos.prevBoards || []).map((pb) => hashOf(pb.board, pb.turn)));
      gameHashes.delete(h1);
      ttKey.fill(0); ttFlag.fill(0); killers.fill(0); hist.fill(0); sp = 0;
      nodes = 0; aborted = false; canAbort = false; deadline = t0 + timeMs;
      const root = legalRootMoves();
      const done = (m, extra) => Object.assign({ move: m ? toObj(m) : null, nodes, timeMs: Math.round(NOW() - t0) }, extra);
      if (!root.length) return done(0, { score: -MATE, depth: 0 });
      if (root.length === 1) return done(root[0], { score: 0, depth: 0, forced: true });

      // Dễ: 1 nước + quiescence, cộng nhiễu ngẫu nhiên, đôi khi đi bừa
      if (lv.noise || lv.randomMove) {
        if (rand() < lv.randomMove) return done(root[Math.floor(rand() * root.length)], { score: 0, depth: 0, random: true });
        let best = -INF, bm = root[0];
        for (const m of root) {
          make(m);
          const mated = legalRootMoves().length === 0;
          let sc = mated ? MATE : -qsearch(-INF, INF, 1);
          unmake(m);
          sc += Math.round((rand() * 2 - 1) * lv.noise);
          if (sc > best) { best = sc; bm = m; }
        }
        return done(bm, { score: best, depth: 1 });
      }

      const bm0 = bookMove(pos, rand, root);
      if (bm0) return done(bm0, { score: 0, depth: 0, book: true });

      // sắp xếp ban đầu: nước ăn trước
      const rs = root.map((m) => ({ m, s: orderScore(m, 0, 0) })).sort((a, b) => b.s - a.s);
      let order = rs.map((o) => o.m);
      let bestMove = order[0], bestScore = 0, depthDone = 0;
      for (let d = 1; d <= maxDepth; d++) {
        canAbort = d > 1;
        let alpha = -INF, iterBest = 0, iterScore = -INF;
        const scores = [];
        for (let i = 0; i < order.length; i++) {
          const m = order[i];
          make(m);
          let sc;
          if (i === 0) sc = -search(d - 1, -INF, -alpha, 1, true);
          else {
            sc = -search(d - 1, -alpha - 1, -alpha, 1, true);
            if (!aborted && sc > alpha) sc = -search(d - 1, -INF, -alpha, 1, true);
          }
          unmake(m);
          if (aborted) break;
          scores.push([m, sc]);
          if (sc > iterScore) { iterScore = sc; iterBest = m; }
          if (sc > alpha) alpha = sc;
        }
        if (aborted) {
          // dùng kết quả dở dang nếu nước tốt nhất mới đã được tìm đầy đủ và tốt hơn
          if (iterBest && iterScore > bestScore && scores.length > 1) { bestMove = iterBest; bestScore = iterScore; }
          break;
        }
        bestMove = iterBest; bestScore = iterScore; depthDone = d;
        order = [iterBest].concat(order.filter((m) => m !== iterBest));
        if (bestScore > MATE_BOUND) break;                       // đã thấy chiếu bí
        if (NOW() - t0 > timeMs * 0.45) break;                   // vòng sau chắc chắn quá giờ
      }
      return done(bestMove, { score: bestScore, depth: depthDone });
    }

    return { think, load, legalRootMoves: () => legalRootMoves().map(toObj), _evaluate: () => evaluate() };
  }
  const ODX = [1, -1, 0, 0], ODY = [0, 0, 1, -1];
  const DDX = [1, 1, -1, -1], DDY = [1, -1, 1, -1];
  const NDX = [1, -1, 1, -1, 2, 2, -2, -2], NDY = [2, 2, -2, -2, 1, -1, 1, -1];

  /* Khoá Zobrist của một thế cờ (đã che) – để nhận ra thế cờ lặp lại trong lịch sử ván */
  function hashOf(board, turn) {
    let h = 0;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = maskPiece(board[y][x]); if (!p) continue;
      const cd = (p[0] === 'r' ? 0 : 32) + (p[2] === '?' ? HIDDEN : p[2] === '!' ? FREE : NORMAL) * 8 + TYPE[p[1]];
      h ^= Z1[cd * 90 + y * 9 + x];
    }
    return turn === 'b' ? h ^ ZS1 : h;
  }

  /* Các thế cờ (đã che) từ lần ăn quân gần nhất tới trước nước hiện tại – truyền cho máy qua pos.prevBoards.
   * game: XQ.Game (dùng startBoard + history; quân lật lấy từ rec.revealed – thông tin công khai). */
  function recentBoards(game, limit = 60) {
    let b = aiView(game.startBoard), turn = 'r';
    const out = [];
    for (const rec of game.history) {
      out.push({ board: b, turn });
      if (rec.captured) out.length = 0; // trước lần ăn quân thì không thể lặp lại
      b = b.map((r) => r.slice());
      const p = b[rec.from[1]][rec.from[0]];
      b[rec.from[1]][rec.from[0]] = null;
      b[rec.to[1]][rec.to[0]] = rec.revealed ? p[0] + rec.revealed + '!' : p;
      turn = turn === 'r' ? 'b' : 'r';
    }
    return out.slice(-limit);
  }

  let shared = null;
  /* API tiện dụng: XQAI.think(pos, opts) dùng một engine dùng chung */
  function think(pos, opts) { shared = shared || createEngine(); return shared.think(pos, opts); }

  return { LEVELS, createEngine, think, aiView, recentBoards, hashOf, MATE };
});
