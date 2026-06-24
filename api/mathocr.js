// 专业手写数学 OCR 端点：把框选裁剪图交给 Mathpix 或 SimpleTex（哪个配了 key 用哪个），
// 返回 LaTeX/带 $ 的文本，比通用视觉模型对矩阵/上下标准得多。
// 前端 extractRegion 会先调它；没配 key 或失败时前端再回退到 qwen 视觉链。
//
// Vercel 环境变量（任选一家配置）：
//   Mathpix:  MATHPIX_APP_ID + MATHPIX_APP_KEY
//   SimpleTex: SIMPLETEX_TOKEN（控制台的 UAT 个人令牌）
const MATHPIX_APP_ID  = process.env.MATHPIX_APP_ID  || process.env.mathpix_app_id  || "";
const MATHPIX_APP_KEY = process.env.MATHPIX_APP_KEY || process.env.mathpix_app_key || process.env.MATHPIX_KEY || "";
const SIMPLETEX_TOKEN = process.env.SIMPLETEX_TOKEN || process.env.simpletex_token || process.env.SIMPLETEX_UAT || "";

const fetchWithTimeout = async (url, opts, ms = 30000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
};

// Mathpix /v3/text：手写数学 → 带 $...$ 的文本（多行用 \n），直接喂给前端渲染。
async function callMathpix(dataUri) {
  const res = await fetchWithTimeout("https://api.mathpix.com/v3/text", {
    method: "POST",
    headers: { app_id: MATHPIX_APP_ID, app_key: MATHPIX_APP_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      src: dataUri,
      formats: ["text"],
      math_inline_delimiters: ["$", "$"],
      math_display_delimiters: ["$$", "$$"],
      rm_spaces: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `mathpix HTTP ${res.status}`);
  return String(data.text || data.latex_styled || "").trim();
}

// SimpleTex latex_ocr（UAT 令牌模式）：multipart 上传图片，返回 res.latex。
async function callSimpleTex(dataUri) {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUri);
  if (!m) throw new Error("bad dataURI");
  const buf = Buffer.from(m[2], "base64");
  const form = new FormData();
  form.append("file", new Blob([buf], { type: m[1] }), "region.jpg");
  const res = await fetchWithTimeout("https://server.simpletex.cn/api/latex_ocr", {
    method: "POST",
    headers: { token: SIMPLETEX_TOKEN },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new Error((data.res && data.res.err_info) || `simpletex HTTP ${res.status}`);
  const latex = String((data.res && data.res.latex) || "").trim();
  // SimpleTex 只回纯 LaTeX，没带 $；包一层 $ 让前端按公式渲染
  return latex ? `$${latex}$` : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const image = req.body && req.body.image;
  if (!image || typeof image !== "string") return res.status(400).json({ error: "missing image" });

  const provider = MATHPIX_APP_ID && MATHPIX_APP_KEY ? "mathpix" : SIMPLETEX_TOKEN ? "simpletex" : null;
  if (!provider) return res.status(200).json({ latex: "", provider: null, note: "no math OCR key configured" });

  try {
    const latex = provider === "mathpix" ? await callMathpix(image) : await callSimpleTex(image);
    return res.status(200).json({ latex, provider });
  } catch (err) {
    return res.status(200).json({ latex: "", provider, error: String(err && err.message || err) });
  }
}
