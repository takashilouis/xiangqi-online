/* Web Worker: chạy máy tính nước đi ngoài luồng giao diện (không làm đơ trang, máy chủ không phải tính gì). */
importScripts('ai.js');
const engine = XQAI.createEngine();
self.onmessage = (e) => {
  const { id, pos, opts } = e.data || {};
  try {
    // pos.board đã được che ở luồng chính; che thêm lần nữa cho chắc: máy không bao giờ thấy danh tính quân úp
    const res = engine.think({ ...pos, board: XQAI.aiView(pos.board) }, opts);
    self.postMessage({ id, ok: true, res });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
