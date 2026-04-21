// ─────────────────────────────────────────────────────────────────────────
// /api/concept-graph — independent pipeline for high-quality knowledge graphs.
//
// Problem with the old inline [VIZ:{structure:"concept",...}] approach:
//  · Concept graph was a byproduct of the chat stream → model spent few tokens
//    on structure and often produced 2-node, 1-edge "graphs"
//  · JSON nested in [VIZ:...] inside free-form text is fragile
//  · No caching → same concept regenerated on every request, inconsistent too
//
// This route is called by <ConceptGraphCard> when the chat contains a
// [GRAPH_REF:slug|label] marker. The graph is generated with a dedicated
// prompt (full richness spec + 7-point self-check) and a higher token budget.
// The frontend caches successful results in localStorage keyed by slug+provider;
// server-side Redis/KV caching can be bolted on later without touching the wire
// format.
// ─────────────────────────────────────────────────────────────────────────

import { callAI, HAS_ANY_SERVER_KEY } from "./_lib/ai-call.js";

// ── JSON repair utilities (same logic as frontend's repairVizJson) ──
// LLMs drift on JSON all the time: smart quotes, trailing commas, unescaped
// LaTeX backslashes, truncated payloads. We fix the common cases server-side
// so the client doesn't have to duplicate the logic.
function repairJson(raw) {
  if (typeof raw !== "string") return raw;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/,\s*([}\]])/g, "$1");
  // Double-escape lone backslashes inside strings (LaTeX killer)
  {
    let out = "";
    let inStr = false;
    let quote = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (!inStr) {
        if (ch === '"' || ch === "'") { inStr = true; quote = ch; }
        out += ch;
        continue;
      }
      if (ch === "\\") {
        const next = s[i + 1];
        if (next === undefined) { out += "\\\\"; continue; }
        if ('"\\/bfnrtu'.indexOf(next) >= 0) {
          out += ch + next;
          i++;
        } else {
          out += "\\\\" + next;
          i++;
        }
        continue;
      }
      if (ch === quote) { inStr = false; quote = null; }
      out += ch;
    }
    s = out;
  }
  // Balance brackets if truncated
  {
    let depthCurly = 0, depthSquare = 0;
    let inStr = false, quote = null, esc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (ch === "\\") { esc = true; continue; }
        if (ch === quote) { inStr = false; quote = null; }
        continue;
      }
      if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
      if (ch === "{") depthCurly++;
      else if (ch === "}") depthCurly--;
      else if (ch === "[") depthSquare++;
      else if (ch === "]") depthSquare--;
    }
    s = s.replace(/,\s*$/, "");
    while (depthSquare > 0) { s += "]"; depthSquare--; }
    while (depthCurly > 0) { s += "}"; depthCurly--; }
  }
  return s;
}

// ── Extract JSON object from an LLM response that may contain prose/fences ──
function extractGraphJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  // Direct parse (happens when prompt is tight enough)
  try { return JSON.parse(trimmed); } catch {}
  // Try repair
  try { return JSON.parse(repairJson(trimmed)); } catch {}
  // Extract first {...} balanced block
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, quote = null, esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === "\\") { esc = true; continue; }
      if (ch === quote) { inStr = false; quote = null; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch {}
        try { return JSON.parse(repairJson(candidate)); } catch {}
        return null;
      }
    }
  }
  // Truncated — try to repair whatever we have from `start`
  try { return JSON.parse(repairJson(trimmed.slice(start))); } catch {}
  return null;
}

// ── Quality validator: enforces the "this is a knowledge graph, not two nodes" bar ──
// score 0-100; below 50 triggers retry; below 70 tags the response as warn.
function validateGraph(g) {
  const issues = [];
  let score = 100;
  if (!g || typeof g !== "object") {
    return { ok: false, score: 0, issues: ["not an object"], shouldRetry: true };
  }
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];

  // Node count
  if (nodes.length < 5) { issues.push(`nodes.length=${nodes.length} < 5`); score -= 45; }
  else if (nodes.length < 8) { issues.push(`nodes.length=${nodes.length} < 8 (target 10-12)`); score -= 15; }

  // Edge count
  const needEdges = Math.max(nodes.length - 1, 4);
  if (edges.length < needEdges) { issues.push(`edges.length=${edges.length} < ${needEdges}`); score -= 25; }

  // Exactly one primary (or one level 0)
  const primaryCount = nodes.filter((n) => n && n.primary === true).length;
  const level0Count  = nodes.filter((n) => n && Number(n.level) === 0).length;
  if (primaryCount === 0 && level0Count === 0) {
    issues.push("no primary / level=0 center node");
    score -= 10;
  } else if (primaryCount > 1) {
    issues.push(`multiple primary=true nodes (${primaryCount})`);
    score -= 8;
  }

  // Dimension coverage
  const dims = new Set(nodes.map((n) => n && n.dimension).filter(Boolean));
  if (dims.size < 3) { issues.push(`dimensions covered=${dims.size} < 3`); score -= 20; }
  else if (dims.size < 4) { issues.push(`dimensions covered=${dims.size} < 4 (prefer ≥4)`); score -= 8; }

  // Level layers
  const levels = new Set(nodes.map((n) => n && Number(n.level)).filter((v) => v === 0 || v === 1 || v === 2));
  if (levels.size < 2) { issues.push("levels: only one layer, need 0 and 1 at minimum"); score -= 12; }

  // Edge reference integrity
  const nodeIds = new Set(nodes.map((n) => n && n.id).filter(Boolean));
  const broken = edges.filter((e) => !e || !nodeIds.has(e.from) || !nodeIds.has(e.to));
  if (broken.length > 0) {
    issues.push(`${broken.length} edge(s) reference missing node ids`);
    score -= Math.min(30, broken.length * 8);
  }

  // Edges without labels (relationship semantics)
  const unlabeled = edges.filter((e) => !e || !e.label || String(e.label).trim().length === 0);
  if (unlabeled.length > edges.length / 2) {
    issues.push(`${unlabeled.length}/${edges.length} edges lack labels`);
    score -= 10;
  }

  // Vague labels (the "concept/formula/method/property" anti-pattern)
  const vague = new Set(["公式", "方法", "性质", "应用", "概念", "定义", "属性"]);
  const vagueNodes = nodes.filter((n) => n && typeof n.name === "string" && vague.has(n.name.trim()));
  if (vagueNodes.length > 0) {
    issues.push(`${vagueNodes.length} node(s) use vague labels`);
    score -= Math.min(15, vagueNodes.length * 5);
  }

  score = Math.max(0, score);
  return {
    ok: score >= 70,
    score,
    issues,
    shouldRetry: score < 50,
  };
}

// ── Prompt builder ──
function buildGraphPrompt({ concept, context, issuesFromPrevious }) {
  const retryHeader = issuesFromPrevious && issuesFromPrevious.length
    ? `⚠️ 上一次生成的图谱有以下问题，本次必须全部修正：\n${issuesFromPrevious.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\n\n`
    : "";

  return `${retryHeader}你正在为数学学习系统构建一个**知识图谱**，用于帮助学生深度理解一个核心概念。
这不是"画两个节点画条线糊弄"，而是一张**结构化、分层、多维度**的概念网络。

## 核心概念
${concept}

## 学习上下文
${context || "（未提供额外上下文）"}

## 产出要求（硬性，全部必须满足）

### 1. 结构丰度
- nodes 数量：**8 ~ 15 个**，少于 5 个为严重不合格
- edges 数量：**≥ nodes.length − 1**，且至少包含 2 条跨维度连接
- 必须有 **2-3 个层级**：level 0（中心概念，1 个）→ level 1（主分支 3-6 个）→ level 2（细节/延伸 2-8 个）

### 2. 维度覆盖（7 选 ≥4）
每个节点的 dimension 字段必须取自：
- \`definition\`   定义/直觉（这个概念"是什么"）
- \`formula\`      核心公式/数学表达
- \`construction\` 构造方法（"怎么造出来"）
- \`property\`     关键性质（"有什么特点"）
- \`error\`        误差/限制/边界条件
- \`application\`  应用场景
- \`related\`      关联概念（可引申到的其它知识点）

### 3. 命名精确性
节点标签必须是**精确数学术语**：
- ❌ 差："公式"、"方法"、"性质"、"应用"、"概念"、"定义"、"属性"
- ✅ 好："基函数 Lᵢ(x)"、"唯一性定理"、"Runge 现象"、"Chebyshev 节点"、"Kronecker δ 性质"

### 4. 连接语义化
每条 edge 必须有 label（关系说明）：
- "由...构造而成"、"导致..."、"是...的特例"、"与...等价"、"应用于..."、"在...时退化为..."
- edge.type 可取 ["contains","derives","causes","example_of","related_to"] 之一（可选但推荐）

### 5. 可选增强
- 节点可带 \`latex\` 字段（对应的 LaTeX 公式，反斜杠双写），用户悬停节点时会被 KaTeX 渲染
- 节点可带 \`importance\`：\`core\` / \`main\` / \`detail\`，用于节点大小分级
- 节点可带 \`desc\`：一句话说明，用于悬停展开

## 参考示例（Lagrange 插值多项式 — 这就是合格图谱的量级）
{
  "centralConcept": "Lagrange 插值多项式",
  "summary": "通过 n+1 个离散点的唯一 n 次多项式，由基函数线性组合而成",
  "nodes": [
    {"id":"n_center","name":"Lagrange 插值多项式","primary":true,"level":0,"dimension":"definition","importance":"core"},
    {"id":"n_basis","name":"基函数 Lᵢ(x)","level":1,"dimension":"construction","importance":"main","latex":"L_i(x)=\\\\prod_{j\\\\ne i}\\\\frac{x-x_j}{x_i-x_j}"},
    {"id":"n_formula","name":"插值公式","level":1,"dimension":"formula","importance":"main","latex":"P(x)=\\\\sum_{i=0}^n y_i L_i(x)"},
    {"id":"n_unique","name":"唯一性定理","level":1,"dimension":"property","importance":"main"},
    {"id":"n_error","name":"余项 R(x)","level":1,"dimension":"error","importance":"main","latex":"R(x)=\\\\frac{f^{(n+1)}(\\\\xi)}{(n+1)!}\\\\omega(x)"},
    {"id":"n_runge","name":"Runge 现象","level":2,"dimension":"error","importance":"detail"},
    {"id":"n_cheby","name":"Chebyshev 节点","level":2,"dimension":"construction","importance":"detail"},
    {"id":"n_newton","name":"Newton 插值","level":2,"dimension":"related","importance":"detail"},
    {"id":"n_delta","name":"Kronecker δ 性质","level":2,"dimension":"property","importance":"detail"},
    {"id":"n_quad","name":"Gauss 数值积分","level":2,"dimension":"application","importance":"detail"}
  ],
  "edges": [
    {"from":"n_center","to":"n_basis","label":"由其线性组合而成","type":"contains"},
    {"from":"n_center","to":"n_formula","label":"有显式表达","type":"contains"},
    {"from":"n_center","to":"n_unique","label":"满足","type":"derives"},
    {"from":"n_center","to":"n_error","label":"误差由此刻画","type":"derives"},
    {"from":"n_basis","to":"n_delta","label":"关键性质","type":"derives"},
    {"from":"n_basis","to":"n_formula","label":"装配进","type":"contains"},
    {"from":"n_error","to":"n_runge","label":"高次时表现为","type":"causes"},
    {"from":"n_runge","to":"n_cheby","label":"通过...改善","type":"related_to"},
    {"from":"n_newton","to":"n_center","label":"等价表示","type":"related_to"},
    {"from":"n_center","to":"n_quad","label":"应用于","type":"example_of"}
  ]
}

## 输出格式（严格遵守）
严格返回一个 JSON 对象，**不要任何 Markdown 代码块包裹（不要 \`\`\`json），不要前后文字解释**。
顶层字段：
- centralConcept: string（概念中文名）
- summary: string（1-2 句总览）
- nodes: array（节点数组）
- edges: array（边数组）

## JSON 逃逸铁律
LaTeX 反斜杠必须双写：\\frac → "\\\\frac"、\\int → "\\\\int"、\\sum → "\\\\sum"、\\alpha → "\\\\alpha"。
合法转义只有 \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX，其它都要双写。
禁止尾逗号、智能引号、未闭合的括号。

## 输出前自检（逐项打勾后才输出）
[ ] nodes.length 在 8-15 之间？
[ ] edges.length ≥ nodes.length − 1？
[ ] 有且只有一个 primary=true 且 level=0 的中心节点？
[ ] 所有 edge.from / edge.to 都能在 nodes 中找到对应 id？
[ ] dimension 覆盖了 ≥ 4 类？
[ ] level 至少有 0 和 1 两层（有 2 层更好）？
[ ] 所有节点标签都是精确术语，没有"公式/方法/性质"这种模糊词？
[ ] 每条 edge 都有 label 说明关系？

任何一项没打勾，就重新生成直到全部满足。`;
}

// ── Top-level handler ──
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Parse body (Vercel already parses JSON, but be defensive)
  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const startedAt = Date.now();

  try {
    const { slug, concept, context, userProvider, userKey } = body;
    const conceptName = String(concept || slug || "").trim();
    if (!conceptName) {
      return res.status(400).json({ error: "missing_concept", hint: "concept or slug is required" });
    }

    const hasUserKey = typeof userKey === "string" && userKey.trim().length > 8;
    if (!hasUserKey && !HAS_ANY_SERVER_KEY) {
      return res.status(400).json({
        error: "no_ai_key",
        hint: "No user key and no server key configured. Set GROQ_KEY / GEMINI_KEY / DEEPSEEK_KEY / KIMI_KEY / ANTHROPIC_KEY.",
      });
    }

    const prompt = buildGraphPrompt({
      concept: conceptName,
      context: String(context || "").slice(0, 1500),
    });

    // Round 1
    let round = 1;
    let lastGraph = null;
    let lastValidation = null;
    let lastProvider = null;
    let lastDiag = [];

    const callOnce = async (messages) => {
      const r = await callAI({
        messages,
        userProvider,
        userKey,
        timeoutMs: 25000,   // graph gen gets a longer budget than chat
        temperature: 0.3,   // low temp → consistent, structured output
        maxTokens: 3200,    // enough for 15 nodes + 20 edges with desc/latex
      });
      lastProvider = r.provider;
      lastDiag = r.diag || [];
      return r;
    };

    const first = await callOnce([{ role: "user", content: prompt }]);
    const firstGraph = extractGraphJson(first.text);
    if (firstGraph) {
      lastGraph = firstGraph;
      lastValidation = validateGraph(firstGraph);
      if (lastValidation.ok) {
        return res.status(200).json({
          graph: firstGraph,
          validation: lastValidation,
          cached: false,
          provider: lastProvider,
          round,
          elapsed: Date.now() - startedAt,
        });
      }
    } else {
      lastValidation = {
        ok: false,
        score: 0,
        issues: ["first attempt: failed to extract/parse JSON", first.error || "unknown"],
        shouldRetry: true,
      };
    }

    // Round 2 — only if shouldRetry (either parse failed or score < 50)
    if (lastValidation.shouldRetry) {
      round = 2;
      const retryPrompt = buildGraphPrompt({
        concept: conceptName,
        context: String(context || "").slice(0, 1500),
        issuesFromPrevious: lastValidation.issues.slice(0, 6),
      });
      const second = await callOnce([{ role: "user", content: retryPrompt }]);
      const secondGraph = extractGraphJson(second.text);
      if (secondGraph) {
        const v = validateGraph(secondGraph);
        // If second attempt is better, use it; else keep the first (if any)
        if (!lastGraph || v.score > lastValidation.score) {
          lastGraph = secondGraph;
          lastValidation = v;
        }
      } else if (!lastGraph) {
        // Both attempts failed to parse — return error
        return res.status(200).json({
          error: "parse_failed",
          hint: "Model output could not be parsed as JSON after 2 attempts.",
          validation: lastValidation,
          provider: lastProvider,
          diag: lastDiag,
          round,
          elapsed: Date.now() - startedAt,
        });
      }
    }

    // We have *some* graph. Return it with the validation payload so the
    // client can decide to show a soft warning if score < 70.
    return res.status(200).json({
      graph: lastGraph,
      validation: lastValidation,
      cached: false,
      provider: lastProvider,
      diag: lastDiag,
      round,
      elapsed: Date.now() - startedAt,
    });
  } catch (err) {
    return res.status(500).json({
      error: "internal",
      message: String(err?.message || err).slice(0, 300),
      elapsed: Date.now() - startedAt,
    });
  }
}
