// ─────────────────────────────────────────────────────────────────────────
// Groq-specific three-stage pipeline for concept graph generation.
//
// Why Groq gets its own pipeline:
//   · Llama 3.3 70B (Groq's strongest) is a *reasoning-good / structure-weak*
//     model. Asking it to emit a ~10-node nested JSON in one shot fails ~70%
//     of the time: truncation, bracket mismatches, lazy 2-node output.
//   · BUT Groq is obscenely fast (500-800 tok/s) with a huge free tier, so we
//     can afford 5-6 small calls where other providers would hit rate limits.
//   · Strategy: "use Groq's speed to compensate for its imprecision" — split
//     the work into tiny, well-defined sub-tasks, each with an example and a
//     strict JSON shape, then stitch locally.
//
// Pipeline:
//   Stage 1 (8b-instant, ~200 tok):   pick 4-5 dimensions for the concept
//   Stage 2 (70b-versatile, ~400 tok * N in parallel): 2-3 nodes per dimension
//   Stage 3 (70b-versatile, ~800 tok): edges over the finalized node list
//   Local stitch → single graph object matching the rest of the system.
//
// Rationale for specific knobs:
//   · response_format: json_object — Groq supports OpenAI-style JSON mode,
//     but it only activates when the prompt literally contains the token
//     "JSON". Every stage's prompt says "return JSON" to satisfy this.
//   · temperature: 0.2 — structured tasks need low randomness
//   · max_tokens capped tight per stage — keeps each call in the
//     "structured-stable" regime (<1200 out tokens)
// ─────────────────────────────────────────────────────────────────────────

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const SKELETON_MODEL   = "llama-3.1-8b-instant";      // fast, enough for 3-line JSON
const EXPANSION_MODEL  = "llama-3.3-70b-versatile";   // quality for node labels
const EDGE_MODEL       = "llama-3.3-70b-versatile";

const STAGE_TIMEOUT_MS  = 12000;
const TOTAL_BUDGET_MS   = 22000; // keep headroom under Vercel 25s timeout

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function callGroqJson({ apiKey, model, prompt, maxTokens, temperature = 0.2, timeoutMs = STAGE_TIMEOUT_MS }) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    // Groq's JSON mode requires the literal word "JSON" somewhere in the
    // prompt — all our stage prompts include "返回 JSON" so this is safe.
    response_format: { type: "json_object" },
    temperature,
    top_p: 0.9,
    max_tokens: maxTokens,
    stream: false,
  };
  const res = await fetchWithTimeout(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`groq_http_${res.status}:${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("groq_empty_response");
  try {
    return JSON.parse(text);
  } catch (e) {
    // json_object mode should guarantee parsable JSON, but a tiny % of
    // responses still come back with a leading ```json fence. Strip it.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(cleaned); }
    catch { throw new Error(`groq_parse_failed:${e?.message || "?"}`); }
  }
}

// ── Stage 1: skeleton (which dimensions to cover) ─────────────────────────
async function generateSkeleton({ concept, context, apiKey }) {
  const prompt = `你在为数学学习系统设计一张知识图谱的**骨架**。
现在只决定"这个概念应该从哪几个维度展开"，**不要**展开具体节点。

核心概念: ${concept}
${context ? `学习上下文: ${String(context).slice(0, 400)}\n` : ""}
必须从以下维度里挑 **4-5 个**覆盖：
- definition    定义与直觉
- formula       核心公式
- construction  构造方法
- property      关键性质
- error         误差 / 限制
- application   应用场景
- related       关联概念

返回严格 JSON（不要 markdown 代码块，不要多余文字）：
{
  "_reasoning": "用 1 句话说明为什么挑这 4-5 个维度（你会真的被这个字段影响后续决策）",
  "central": "${concept}",
  "summary": "1 句话总览这个概念，不超过 40 字",
  "dimensions": ["definition", "formula", "...", "..."]
}`;
  return callGroqJson({ apiKey, model: SKELETON_MODEL, prompt, maxTokens: 220 });
}

// ── Stage 2: per-dimension expansion ──────────────────────────────────────
const DIMENSION_HINTS = {
  definition: `列出 "%CONCEPT%" 的 **2 个** 核心定义要素（是什么 / 直观解释）。
Few-shot 示例（Lagrange 插值）：
{"items":[
  {"label":"通过 n+1 个点的唯一 n 次多项式"},
  {"label":"基函数线性组合"}
]}`,
  formula: `列出 "%CONCEPT%" 的 **2-3 个**核心公式组件，每个带 LaTeX（反斜杠双写）。
Few-shot 示例（Lagrange 插值）：
{"items":[
  {"label":"基函数 Lᵢ(x)","latex":"L_i(x)=\\\\prod_{j\\\\ne i}\\\\frac{x-x_j}{x_i-x_j}"},
  {"label":"插值多项式","latex":"P(x)=\\\\sum_{i=0}^n y_i L_i(x)"}
]}`,
  property: `列出 "%CONCEPT%" 的 **2-3 个**关键性质。
Few-shot 示例（Lagrange 插值）：
{"items":[
  {"label":"唯一性定理"},
  {"label":"Kronecker δ 性质 L_i(x_j)=δ_{ij}"},
  {"label":"精确性 P(xᵢ)=yᵢ"}
]}`,
  error: `列出 "%CONCEPT%" 的 **2-3 个**典型误差源或限制。
Few-shot 示例（Lagrange 插值）：
{"items":[
  {"label":"余项 R(x)","latex":"R(x)=\\\\frac{f^{(n+1)}(\\\\xi)}{(n+1)!}\\\\omega(x)"},
  {"label":"Runge 现象"},
  {"label":"高次振荡"}
]}`,
  construction: `列出 "%CONCEPT%" 构造过程中的 **2-3 个**关键步骤或对象。`,
  application: `列出 "%CONCEPT%" 的 **2-3 个**典型应用。
Few-shot 示例（Lagrange 插值）：
{"items":[
  {"label":"数值积分"},
  {"label":"Gauss 求积公式"},
  {"label":"有限元基函数"}
]}`,
  related: `列出与 "%CONCEPT%" 紧密相关的 **2-3 个**数学概念。
Few-shot 示例（Lagrange 插值）：
{"items":[
  {"label":"Newton 插值"},
  {"label":"Chebyshev 节点"},
  {"label":"样条插值"}
]}`,
};

async function expandDimension({ concept, dimension, apiKey }) {
  const hint = (DIMENSION_HINTS[dimension] || DIMENSION_HINTS.related).replace(/%CONCEPT%/g, concept);
  const prompt = `${hint}

现在对概念 "${concept}" 在 "${dimension}" 维度下产出节点。

返回严格 JSON（不要 markdown，不要解释）：
{
  "items": [
    {"label": "精确术语（数学符号保留英文）", "latex": "可选的LaTeX"}
  ]
}

【禁止清单】label 绝不能是以下空洞词：公式、方法、性质、应用、概念、原理、特点、属性、定义。
违反则整条节点作废，必须换成具体术语（例如 "基函数 Lᵢ(x)" 而不是 "基函数"）。

【硬指标】
- items 长度 2-3
- 每个 label 中文为主 + 必要的数学符号，不超过 18 字
- 涉及公式的维度优先带 latex 字段（反斜杠双写：\\\\frac 而不是 \\frac）`;
  return callGroqJson({ apiKey, model: EXPANSION_MODEL, prompt, maxTokens: 420 });
}

// ── Stage 3: edges ────────────────────────────────────────────────────────
async function generateEdges({ concept, nodes, apiKey }) {
  const nodeList = nodes
    .map((n) => `- ${n.id}: ${n.name}${n.dimension ? ` (${n.dimension})` : ""}`)
    .join("\n");
  const targetCount = Math.max(nodes.length - 1, Math.round(nodes.length * 1.3));

  const prompt = `你在为一张知识图谱生成**连接关系**。中心节点是 n_center (${concept})。

已有节点列表：
- n_center: ${concept} (中心)
${nodeList}

任务：为这些节点生成边。

【硬指标】
1. 每个非中心节点至少有 1 条边（直接或间接连到 n_center）
2. 至少 2 条**跨维度**边（from / to 所属 dimension 不同）
3. 每条边都要有 label 说明关系语义（示例词："由...构成"、"导致..."、"是...的特例"、"与...等价"、"应用于..."、"在...时退化为..."）
4. 目标边数约 ${targetCount} 条（允许 ±2）
5. edge.type 从 ["contains","derives","causes","example_of","related_to"] 中选一个（可选但推荐）

返回严格 JSON（不要 markdown，不要解释）：
{
  "_reasoning": "用 1 句话说明你挑的跨维度连接（会影响你的 edges 质量）",
  "edges": [
    {"from": "n_center", "to": "n_xxx", "label": "由...构成", "type": "contains"}
  ]
}

【合法性约束】from 和 to 必须严格来自上面列出的节点 ID（不要写不存在的 ID）。`;
  return callGroqJson({ apiKey, model: EDGE_MODEL, prompt, maxTokens: 900, timeoutMs: 14000 });
}

// ── Top-level pipeline ────────────────────────────────────────────────────
export async function buildGraphWithGroq({ concept, context, apiKey, onStage }) {
  if (!apiKey) throw new Error("no_groq_key");
  const t0 = Date.now();
  const log = (stage, extra) => onStage && onStage({ stage, elapsed: Date.now() - t0, ...extra });
  const withinBudget = () => Date.now() - t0 < TOTAL_BUDGET_MS;

  // ── Stage 1 ──
  log("skeleton:start");
  const skeleton = await generateSkeleton({ concept, context, apiKey });
  log("skeleton:done", { dimensions: skeleton?.dimensions });
  const rawDims = Array.isArray(skeleton?.dimensions) ? skeleton.dimensions : [];
  const validDimensions = rawDims
    .map((d) => String(d || "").trim().toLowerCase())
    .filter((d) => Object.prototype.hasOwnProperty.call(DIMENSION_HINTS, d));
  // Backfill to at least 4 dimensions if skeleton was lazy
  const defaultDims = ["definition", "formula", "property", "error", "application", "related"];
  for (const d of defaultDims) {
    if (validDimensions.length >= 4) break;
    if (!validDimensions.includes(d)) validDimensions.push(d);
  }
  const dimensions = validDimensions.slice(0, 5); // cap at 5 to keep parallel fanout sane
  log("skeleton:normalized", { dimensions });

  if (!withinBudget()) throw new Error("pipeline_budget_exhausted_after_skeleton");

  // ── Stage 2 (parallel) ──
  log("expand:start", { dimensions });
  const dimResults = await Promise.all(
    dimensions.map((dim) =>
      expandDimension({ concept, dimension: dim, apiKey })
        .then((raw) => ({ dim, raw, ok: true }))
        .catch((err) => ({ dim, err: String(err?.message || err), ok: false })),
    ),
  );
  log("expand:done", { okCount: dimResults.filter((r) => r.ok).length });

  // Stitch nodes
  const centerId = "n_center";
  const nodes = [{
    id: centerId,
    name: String(skeleton?.central || concept).trim(),
    primary: true,
    level: 0,
    dimension: "definition",
    importance: "core",
  }];
  const usedIds = new Set([centerId]);
  const makeId = (dim, i) => {
    let id = `n_${dim}_${i}`;
    let n = 1;
    while (usedIds.has(id)) { id = `n_${dim}_${i}_${n++}`; }
    usedIds.add(id);
    return id;
  };
  for (const r of dimResults) {
    if (!r.ok) continue;
    const items = Array.isArray(r.raw?.items) ? r.raw.items : [];
    items.forEach((it, i) => {
      const label = String(it?.label || "").trim();
      if (!label) return;
      // Drop vague labels that slipped past the prompt's ban-list
      const vague = new Set(["公式", "方法", "性质", "应用", "概念", "原理", "特点", "属性", "定义"]);
      if (vague.has(label)) return;
      nodes.push({
        id: makeId(r.dim, i),
        name: label,
        level: 1,
        dimension: r.dim,
        importance: i === 0 ? "main" : "detail",
        ...(it?.latex ? { latex: String(it.latex) } : {}),
      });
    });
  }

  // Promote some level-1 nodes to level-2 to give the graph a layered look.
  // Heuristic: each dimension keeps at most 1 "main" (level 1); rest drop to
  // level 2. This matches the multi-ring layout in InteractiveLab.
  {
    const seenMainByDim = {};
    for (const n of nodes) {
      if (n.level !== 1) continue;
      if (!seenMainByDim[n.dimension]) { seenMainByDim[n.dimension] = true; continue; }
      n.level = 2;
      n.importance = "detail";
    }
  }

  if (nodes.length < 4) throw new Error(`pipeline_too_few_nodes:${nodes.length}`);
  if (!withinBudget()) throw new Error("pipeline_budget_exhausted_after_expand");

  // ── Stage 3 (edges) ──
  log("edges:start", { nodeCount: nodes.length });
  let edgesRaw;
  try {
    edgesRaw = await generateEdges({ concept, nodes, apiKey });
  } catch (e) {
    // Edges failed — fall back to a rule-based star + cross-dim linker so
    // the user still sees a connected graph instead of total failure.
    log("edges:failed_falling_back", { err: String(e?.message || e) });
    edgesRaw = { edges: synthesizeEdgesFallback(nodes) };
  }
  const rawEdges = Array.isArray(edgesRaw?.edges) ? edgesRaw.edges : [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = rawEdges
    .map((e) => {
      if (!e || !nodeIds.has(e.from) || !nodeIds.has(e.to) || e.from === e.to) return null;
      return {
        from: e.from,
        to: e.to,
        label: String(e.label || "关联").trim() || "关联",
        ...(e.type ? { type: String(e.type) } : {}),
      };
    })
    .filter(Boolean);

  // Ensure every non-center node has at least one edge (synthesize to center if orphaned)
  const touched = new Set();
  for (const e of edges) { touched.add(e.from); touched.add(e.to); }
  for (const n of nodes) {
    if (n.id === centerId) continue;
    if (!touched.has(n.id)) {
      edges.push({ from: centerId, to: n.id, label: "相关于", type: "related_to" });
      touched.add(n.id);
    }
  }
  log("edges:done", { edgeCount: edges.length });

  return {
    centralConcept: String(skeleton?.central || concept).trim(),
    summary: String(skeleton?.summary || "").trim().slice(0, 120),
    nodes,
    edges,
  };
}

// Rule-based fallback: star from center + one cross-dim link per dimension pair
function synthesizeEdgesFallback(nodes) {
  const centerId = nodes[0]?.id || "n_center";
  const edges = [];
  for (const n of nodes) {
    if (n.id === centerId) continue;
    edges.push({ from: centerId, to: n.id, label: "包含", type: "contains" });
  }
  // Add a couple of cross-dim edges between first nodes of each dimension
  const firstOfDim = {};
  for (const n of nodes) {
    if (n.id === centerId) continue;
    if (!firstOfDim[n.dimension]) firstOfDim[n.dimension] = n.id;
  }
  const dimIds = Object.values(firstOfDim);
  for (let i = 0; i + 1 < dimIds.length && edges.length < nodes.length + 3; i++) {
    edges.push({ from: dimIds[i], to: dimIds[i + 1], label: "关联", type: "related_to" });
  }
  return edges;
}
