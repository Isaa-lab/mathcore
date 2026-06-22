// 限并发的 map：保留输入顺序，最多同时跑 limit 个 worker。
// 用于把"逐张图 OCR / 逐题批改"从串行改成限并发，明显提速又不至于把上游打爆。
export async function mapLimit(items, limit, fn) {
  const arr = Array.from(items || []);
  const out = new Array(arr.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit || 1, arr.length || 1));
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = next++;
      if (i >= arr.length) break;
      out[i] = await fn(arr[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
