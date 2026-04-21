import { motion } from "framer-motion";
import katex from "katex";
import { useMathStore } from "../store/useMathStore";
import ConceptGraphCard from "../components/ConceptGraphCard";

const springTransition = { type: "spring", stiffness: 300, damping: 25 };
const bubbleVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: springTransition },
};

// ── Inline SVG icons (Lucide-style) ────────────────────────────────────────
const IconSparkles = ({ size = 14, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    <path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>
  </svg>
);
const IconMaximize = ({ size = 12, color = "#4F46E5" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const IconSettings = ({ size = 14, color = "#9CA3AF" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24" opacity="0.55" />
  </svg>
);

// ── Structure-aware icon set (4 cognitive structures) ──────────────────────
const IconProcess = ({ size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" fill={color} stroke="none" />
  </svg>
);
const IconHierarchy = ({ size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="6" cy="18" r="3" /><path d="M6 15a9 9 0 0 0 9 3" />
  </svg>
);
const IconParametric = ({ size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const IconComparison = ({ size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 3 20 7 16 11" /><polyline points="8 21 4 17 8 13" /><line x1="20" y1="7" x2="4" y2="7" /><line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);
const IconAnnotation = ({ size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3h7v7H3z" opacity="0.65" />
    <path d="M14 3h7v7h-7z" />
    <path d="M3 14h7v7H3z" />
    <path d="M14 14h7v7h-7z" opacity="0.4" />
  </svg>
);
const IconConcept = ({ size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <circle cx="5" cy="5" r="2" />
    <circle cx="19" cy="5" r="2" />
    <circle cx="5" cy="19" r="2" />
    <circle cx="19" cy="19" r="2" />
    <line x1="9.7" y1="9.7" x2="6.4" y2="6.4" />
    <line x1="14.3" y1="9.7" x2="17.6" y2="6.4" />
    <line x1="9.7" y1="14.3" x2="6.4" y2="17.6" />
    <line x1="14.3" y1="14.3" x2="17.6" y2="17.6" />
  </svg>
);

// ── LaTeX Pre-processor + Bare-Math Rescuer ────────────────────────────────
// Defense in depth: even if the AI forgets to wrap formulas in $...$, we
// rescue the most common slip-ups (derivatives, exponentials, integrals).
// We are *conservative* — only wrap patterns that are unambiguously math,
// and we skip any chunk already inside $...$ or $$...$$ fences.
function rescueBareMath(text) {
  if (!text) return text;
  // Split by existing math fences; rescue only the non-math chunks
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return parts.map((chunk) => {
    if (!chunk) return chunk;
    if (chunk.startsWith("$")) return chunk;
    let out = chunk;
    // Higher-order derivative first (order matters): d^2y/dx^2, d²y/dx²
    out = out.replace(/\bd\^?(\d+)([a-zA-Z])\/d([a-zA-Z])\^?\1\b/g, "$$d^{$1}$2/d$3^{$1}$$");
    out = out.replace(/\bd²([a-zA-Z])\/d([a-zA-Z])²/g, "$$d^{2}$1/d$2^{2}$$");
    // First-order derivative: dy/dx, du/dt
    out = out.replace(/\bd([a-zA-Z])\/d([a-zA-Z])\b/g, "$$d$1/d$2$$");
    // Partial derivative: ∂y/∂x
    out = out.replace(/∂([a-zA-Z])\/∂([a-zA-Z])/g, "$$\\partial $1/\\partial $2$$");
    // Exponentials bare: e^{...}, e^(...)
    out = out.replace(/\be\^\{([^{}\n]{1,50})\}/g, "$$e^{$1}$$");
    out = out.replace(/\be\^\(([^()\n]{1,50})\)/g, "$$e^{$1}$$");
    // Integration constants with exponential: Ce^{-2x}, Ae^{kt}
    out = out.replace(/\b([A-Z])\s?e\^\{([^{}\n]{1,50})\}/g, "$$$1 e^{$2}$$");
    // Summations / integrals with trailing measure: ∫ f(x) dx, ∑ a_n
    out = out.replace(/∫([^.\n]{1,60}?)\s?d([a-zA-Z])\b/g, "$$\\int $1\\,d$2$$");
    out = out.replace(/∑_\{([^{}]{1,20})\}\^\{([^{}]{1,20})\}\s?([A-Za-z_]\w{0,10})/g, "$$\\sum_{$1}^{$2} $3$$");
    // Primes on y / f (standalone, followed by space / operator / punctuation)
    out = out.replace(/\b(y|f|g)('{1,3})(?=[\s+\-=()]|$)/g, "$$$1$2$$");
    return out;
  }).join("");
}

function preprocessLaTeX(content) {
  if (!content) return "";
  let processed = String(content);
  // Normalize whitespace around $$ fences
  processed = processed.replace(/\$\$\s*\n\s*\n+/g, "$$\n");
  processed = processed.replace(/\n\s*\n+\s*\$\$/g, "\n$$");
  processed = processed.replace(/\$\$[ \t]+/g, "$$");
  processed = processed.replace(/[ \t]+\$\$/g, "$$");
  // Apply rescuer AFTER fence normalization (so splits are stable)
  processed = rescueBareMath(processed);
  return processed;
}

// ── Inline variable slider ─────────────────────────────────────────────────
function InlineVarSlider({ name, min, max }) {
  const value = useMathStore((s) => s.interactiveParams[name] ?? Number(min));
  const setInteractiveParam = useMathStore((s) => s.setInteractiveParam);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "1px 8px", borderRadius: 999, background: "#EEF2FF", verticalAlign: "middle", margin: "0 3px" }}>
      <span style={{ fontFamily: "'KaTeX_Math', serif", fontStyle: "italic", color: "#4F46E5", fontWeight: 700, fontSize: 12 }}>{name}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(e) => setInteractiveParam(name, Number(e.target.value))}
        aria-label={`动态调整数学参数 ${name}`}
        style={{ width: 110, accentColor: "#4F46E5", verticalAlign: "middle" }}
      />
      <span style={{ fontSize: 11.5, color: "#4F46E5", fontWeight: 700, minWidth: 30, textAlign: "right" }}>{Number(value).toFixed(1)}</span>
    </span>
  );
}

// ── Viz Dictionary: the metadata-driven engine ─────────────────────────────
// Maps cognitive structure → visual language (color tokens, icon, preview SVG)
const VIZ_DICTIONARY = {
  process: {
    label: "流程 · 时序推演",
    fg: "#047857", bg: "#ECFDF5", border: "rgba(167,243,208,0.7)", accent: "#10B981",
    Icon: IconProcess,
    preview: (stroke) => (
      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none" style={{ color: stroke, opacity: 0.7 }}>
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: "easeOut" }} d="M8 30 L28 30 L34 14 L48 30 L56 18 L72 30 L92 10" />
        </g>
        {[8, 28, 48, 72, 92].map((x, i) => (
          <motion.circle key={i} cx={x} cy={[30, 30, 30, 30, 10][i]} r="2.2" fill={stroke} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 + i * 0.18, type: "spring" }} />
        ))}
      </svg>
    ),
  },
  hierarchy: {
    label: "层级 · 树状拓扑",
    fg: "#1D4ED8", bg: "#EFF6FF", border: "rgba(191,219,254,0.7)", accent: "#3B82F6",
    Icon: IconHierarchy,
    preview: (stroke) => (
      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none" style={{ color: stroke, opacity: 0.7 }}>
        <motion.g stroke="currentColor" strokeWidth="1.3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
          <line x1="50" y1="10" x2="25" y2="24" />
          <line x1="50" y1="10" x2="75" y2="24" />
          <line x1="25" y1="24" x2="15" y2="34" />
          <line x1="25" y1="24" x2="35" y2="34" />
          <line x1="75" y1="24" x2="65" y2="34" />
          <line x1="75" y1="24" x2="85" y2="34" />
        </motion.g>
        {[[50, 10], [25, 24], [75, 24], [15, 34], [35, 34], [65, 34], [85, 34]].map(([x, y], i) => (
          <motion.circle key={i} cx={x} cy={y} r="2.6" fill={stroke} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 + i * 0.06, type: "spring", stiffness: 260 }} />
        ))}
      </svg>
    ),
  },
  parametric: {
    label: "参数可调模型",
    fg: "#4338CA", bg: "#EEF2FF", border: "rgba(199,210,254,0.7)", accent: "#6366F1",
    Icon: IconParametric,
    preview: (stroke) => (
      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none" style={{ color: stroke, opacity: 0.75 }}>
        <g stroke="#E5E7EB" strokeWidth="0.25" opacity="0.7">
          <line x1="0" y1="10" x2="100" y2="10" /><line x1="0" y1="20" x2="100" y2="20" /><line x1="0" y1="30" x2="100" y2="30" />
        </g>
        <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: "easeOut" }} d="M0 30 Q 25 28, 50 20 T 100 5" fill="transparent" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, delay: 0.2, ease: "easeOut" }} d="M0 35 Q 30 34, 60 25 T 100 10" fill="transparent" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 2" strokeLinecap="round" />
      </svg>
    ),
  },
  comparison: {
    label: "对比 · 并列分析",
    fg: "#B45309", bg: "#FFFBEB", border: "rgba(253,230,138,0.7)", accent: "#F59E0B",
    Icon: IconComparison,
    preview: (stroke) => (
      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none" style={{ color: stroke, opacity: 0.75 }}>
        <motion.rect initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.5, ease: "easeOut" }} style={{ originY: "100%" }} x="16" y="12" width="26" height="22" rx="4" fill="currentColor" opacity="0.45" />
        <motion.rect initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.5, delay: 0.12, ease: "easeOut" }} style={{ originY: "100%" }} x="58" y="8" width="26" height="26" rx="4" fill="currentColor" opacity="0.85" />
        <line x1="50" y1="20" x2="50" y2="20" stroke="currentColor" strokeWidth="0.5" />
      </svg>
    ),
  },
  annotation: {
    label: "公式标注 · 概念拆解",
    fg: "#6D28D9", bg: "#F5F3FF", border: "rgba(221,214,254,0.7)", accent: "#8B5CF6",
    Icon: IconAnnotation,
    preview: () => (
      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
        <motion.rect initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.45, ease: "easeOut" }} style={{ originX: "0%" }} x="12" y="16" width="20" height="10" rx="3" fill="#C4B5FD" opacity="0.9" />
        <motion.rect initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.45, delay: 0.18, ease: "easeOut" }} style={{ originX: "0%" }} x="38" y="16" width="26" height="10" rx="3" fill="#6EE7B7" opacity="0.9" />
        <motion.rect initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.45, delay: 0.36, ease: "easeOut" }} style={{ originX: "0%" }} x="70" y="16" width="18" height="10" rx="3" fill="#FCD34D" opacity="0.9" />
        <motion.line initial={{ opacity: 0 }} animate={{ opacity: 0.55 }} transition={{ delay: 0.55 }} x1="22" y1="28" x2="22" y2="34" stroke="#8B5CF6" strokeWidth="0.8" />
        <motion.line initial={{ opacity: 0 }} animate={{ opacity: 0.55 }} transition={{ delay: 0.6 }} x1="51" y1="28" x2="51" y2="34" stroke="#10B981" strokeWidth="0.8" />
        <motion.line initial={{ opacity: 0 }} animate={{ opacity: 0.55 }} transition={{ delay: 0.65 }} x1="79" y1="28" x2="79" y2="34" stroke="#F59E0B" strokeWidth="0.8" />
      </svg>
    ),
  },
  concept: {
    label: "概念关系网络",
    fg: "#0F766E", bg: "#F0FDFA", border: "rgba(153,246,228,0.7)", accent: "#14B8A6",
    Icon: IconConcept,
    preview: () => (
      <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 0.55 }} transition={{ duration: 0.6 }}>
          <line x1="50" y1="20" x2="22" y2="10" stroke="#14B8A6" strokeWidth="0.9" />
          <line x1="50" y1="20" x2="22" y2="30" stroke="#14B8A6" strokeWidth="0.9" />
          <line x1="50" y1="20" x2="78" y2="10" stroke="#14B8A6" strokeWidth="0.9" />
          <line x1="50" y1="20" x2="78" y2="30" stroke="#14B8A6" strokeWidth="0.9" />
        </motion.g>
        {[[50, 20, 4.5, 0.95], [22, 10, 2.8, 0.6], [22, 30, 2.8, 0.6], [78, 10, 2.8, 0.6], [78, 30, 2.8, 0.6]].map(([x, y, r, op], i) => (
          <motion.circle key={i} cx={x} cy={y} r={r} fill="#14B8A6" opacity={op} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18, delay: i * 0.09 }} />
        ))}
      </svg>
    ),
  },
};

// Normalize any incoming viz config into a canonical `vizIntent` shape
// ── JSON repair for LLM-generated VIZ payloads ────────────────────────────
// LLMs routinely "drift" when emitting JSON: unescaped LaTeX backslashes,
// trailing commas, smart quotes, truncated output, markdown fences, etc.
// Before giving up and showing "已折叠", we try to mechanically fix the
// most common mistakes. Covers 80%+ of the failures we've seen in logs.
export function repairVizJson(raw) {
  if (typeof raw !== "string") return raw;
  let s = raw.trim();
  // Strip markdown fences the AI sometimes wraps around
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Replace smart / curly quotes with plain double quotes
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // Drop trailing commas in objects/arrays
  s = s.replace(/,\s*([}\]])/g, "$1");
  // Double-escape lone backslashes inside strings — the #1 LaTeX-in-JSON killer.
  // Valid JSON escapes: \" \\ \/ \b \f \n \r \t \uXXXX. Everything else (like
  // \frac, \alpha, \theta, \int, \sum, \left, \right, \partial, \mathbb) must
  // be doubled. We walk the string and only touch escapes inside "..." regions.
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
      // inside a string
      if (ch === "\\") {
        const next = s[i + 1];
        if (next === undefined) { out += "\\\\"; continue; }
        if ('"\\/bfnrtu'.indexOf(next) >= 0) {
          // valid escape — keep as is
          out += ch + next;
          i++;
        } else {
          // invalid escape (e.g. \f in \frac is a form-feed but clearly a typo) —
          // treat as literal backslash and double it so JSON.parse accepts it
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
  // Balance brackets if the stream was truncated mid-structure
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
    // If truncated, also drop a dangling trailing ","
    s = s.replace(/,\s*$/, "");
    while (depthSquare > 0) { s += "]"; depthSquare--; }
    while (depthCurly > 0) { s += "}"; depthCurly--; }
  }
  return s;
}

export function normalizeVizIntent(rawOrJson) {
  if (!rawOrJson) return null;
  let cfg = rawOrJson;
  if (typeof rawOrJson === "string") {
    let parsed = null;
    try { parsed = JSON.parse(rawOrJson); }
    catch {
      // Cascade through the repair pipeline before giving up
      try { parsed = JSON.parse(repairVizJson(rawOrJson)); }
      catch { return null; }
    }
    cfg = parsed;
  }
  if (!cfg || typeof cfg !== "object") return null;

  // Explicit vizIntent (preferred)
  if (cfg.structure && VIZ_DICTIONARY[cfg.structure]) {
    return {
      structure: cfg.structure,
      interactionLevel: cfg.interactionLevel || "L1",
      title: cfg.title || "可视化",
      description: cfg.description || "",
      data: cfg.data || {},
    };
  }
  // Legacy [CHART:{k,steady,cMin,...}] → parametric L2
  if (cfg.k != null || cfg.steady != null || cfg.cMin != null || cfg.cMax != null) {
    return {
      structure: "parametric",
      interactionLevel: "L2",
      title: cfg.title || cfg.name || "参数曲线族",
      description: cfg.description || "",
      data: { k: cfg.k, steady: cfg.steady, cMin: cfg.cMin, cMax: cfg.cMax, cInit: cfg.cInit, equation: cfg.equation },
    };
  }
  // Generic fallback — treat unknown shapes as parametric with defaults
  return {
    structure: cfg.structure || "parametric",
    interactionLevel: cfg.interactionLevel || "L1",
    title: cfg.title || "可视化",
    description: cfg.description || "",
    data: cfg.data || cfg,
  };
}

// ── DynamicVizCard — metadata-driven preview chip ──────────────────────────
export function DynamicVizCard({ intent, onOpen }) {
  const structure = intent?.structure && VIZ_DICTIONARY[intent.structure] ? intent.structure : "parametric";
  const cfg = VIZ_DICTIONARY[structure];
  const level = intent?.interactionLevel || "L1";
  const isHighInteractive = level === "L2" || level === "L3";
  const title = intent?.title || "可视化";
  const StructIcon = cfg.Icon;

  const hoverLabel = isHighInteractive ? "进入全屏交互实验室" : "查看完整结构图谱";

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={{ scale: 1.01, y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={springTransition}
      aria-label={`${hoverLabel}：${title}`}
      style={{
        marginTop: 16, marginBottom: 4, width: "100%", maxWidth: 320,
        borderRadius: 16, background: "#FFFFFF", border: `1px solid ${cfg.border}`,
        boxShadow: "0 4px 20px rgba(0,0,0,0.03)", overflow: "hidden", cursor: "pointer",
        fontFamily: "inherit", textAlign: "left", padding: 0, display: "block", position: "relative",
      }}
      className="mc-viz-preview-card"
    >
      <div style={{ height: 84, width: "100%", background: cfg.bg, borderBottom: `1px solid ${cfg.border}`, position: "relative", overflow: "hidden" }}>
        {cfg.preview(cfg.accent)}
        <div className="mc-viz-preview-hover" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", transition: "background 0.25s" }}>
          <div className="mc-viz-preview-chip" style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(6px)", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", opacity: 0, transform: "translateY(6px)", transition: "opacity 0.22s, transform 0.22s" }}>
            <IconMaximize size={12} color={cfg.fg} />
            <span style={{ fontSize: 11, fontWeight: 700, color: cfg.fg, letterSpacing: "0.04em" }}>{hoverLabel}</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: "#FFFFFF" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <StructIcon size={15} color={cfg.fg} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <span style={{ color: "#111827", fontWeight: 700, fontSize: 12.5, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, color: cfg.fg, background: cfg.bg, padding: "1px 6px", borderRadius: 4, letterSpacing: "0.05em" }}>{level}</span>
            <span style={{ color: "#6B7280", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfg.label}</span>
          </div>
        </div>
        {isHighInteractive && <IconSettings size={13} color="#C7CBD4" />}
      </div>
    </motion.button>
  );
}

// ── Inline renderer ────────────────────────────────────────────────────────
function renderInline(text, keyPrefix = "") {
  if (text == null) return null;
  const str = String(text);
  const parts = str.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|__VAR_\d+__|==[^=\n]+?==|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`|<mark>[\s\S]+?<\/mark>)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!part) return null;
    if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
      try {
        const html = katex.renderToString(part.slice(2, -2).trim(), { throwOnError: false, displayMode: true });
        return <span key={key} style={{ display: "block", overflowX: "auto", margin: "6px 0", fontSize: "0.95em" }} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch { return <code key={key}>{part}</code>; }
    }
    if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
      try {
        const html = katex.renderToString(part.slice(1, -1).trim(), { throwOnError: false, displayMode: false });
        return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch { return <code key={key}>{part}</code>; }
    }
    if (part.startsWith("==") && part.endsWith("==") && part.length > 4) {
      return <mark key={key} style={{ background: "rgba(254,240,138,0.85)", color: "#854D0E", padding: "0 4px", borderRadius: 3, fontWeight: 500 }}>{part.slice(2, -2)}</mark>;
    }
    if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
      return <mark key={key} style={{ background: "rgba(254,240,138,0.85)", color: "#854D0E", padding: "0 4px", borderRadius: 3, fontWeight: 500 }}>{part.slice(6, -7)}</mark>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key} style={{ fontWeight: 700, color: "#111827", background: "#EEF2FF", padding: "0 4px", borderRadius: 4 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key} style={{ fontStyle: "italic", color: "#4B5563", borderBottom: "1px solid #E5E7EB", paddingBottom: 1 }}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={key} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.88em", padding: "1px 5px", background: "#F3F4F6", borderRadius: 5, color: "#6366F1" }}>{part.slice(1, -1)}</code>;
    }
    const varMatch = part.match(/^__VAR_(\d+)__$/);
    if (varMatch) return <span key={key} data-var-slot={varMatch[1]} />;
    return <span key={key}>{part}</span>;
  });
}

// ── Placeholder extraction (accepts [VIZ:...], legacy [CHART:...], and [GRAPH_REF:...]) ─
function extractMacros(src) {
  const varBlocks = [];
  const vizBlocks = [];
  const graphRefs = [];
  let out = "";
  let i = 0;
  while (i < src.length) {
    const v = src.slice(i).match(/^\[VAR:([a-zA-Z_]\w*),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/);
    if (v) {
      varBlocks.push({ name: v[1], min: Number(v[2]), max: Number(v[3]) });
      out += `__VAR_${varBlocks.length - 1}__`;
      i += v[0].length;
      continue;
    }
    // [GRAPH_REF:slug|label] — v2 concept graph reference (async pipeline)
    if (src.slice(i, i + 11) === "[GRAPH_REF:") {
      const end = src.indexOf("]", i + 11);
      if (end > 0) {
        const inner = src.slice(i + 11, end);
        const pipe = inner.indexOf("|");
        const slugRaw = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
        const label = (pipe >= 0 ? inner.slice(pipe + 1) : "").trim();
        const slug = slugRaw
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_-]/g, "")
          .replace(/^_+|_+$/g, "");
        if (slug) {
          graphRefs.push({ slug, label: label || slug.replace(/_/g, " ") });
          out += `__GRAPHREF_${graphRefs.length - 1}__`;
          i = end + 1;
          continue;
        }
      }
    }
    // [VIZ:{...}] or [CHART:{...}] — depth-aware bracket match
    const prefix = src.slice(i, i + 5) === "[VIZ:" ? "[VIZ:" : src.slice(i, i + 7) === "[CHART:" ? "[CHART:" : null;
    if (prefix) {
      let depth = 1, j = i + prefix.length;
      while (j < src.length && depth > 0) {
        if (src[j] === "[") depth++;
        else if (src[j] === "]") depth--;
        j++;
      }
      const raw = src.slice(i + prefix.length, j - 1).trim();
      vizBlocks.push(raw);
      out += `__VIZ_${vizBlocks.length - 1}__`;
      i = j;
      continue;
    }
    if (src.slice(i, i + 7) === "[CHART]") {
      vizBlocks.push(null);
      out += `__VIZ_${vizBlocks.length - 1}__`;
      i += 7;
      continue;
    }
    out += src[i];
    i++;
  }
  return { out, varBlocks, vizBlocks, graphRefs };
}

// ── Block renderer ─────────────────────────────────────────────────────────
function renderMarkdown(text, context) {
  if (!text) return null;
  const cleaned = preprocessLaTeX(text);
  const { out: prepared0, varBlocks, vizBlocks, graphRefs } = extractMacros(cleaned);
  const prepared = prepared0
    .replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, "")
    .replace(/\\begin\{figure\}[\s\S]*?\\end\{figure\}/g, "");

  const replaceVars = (node) => {
    if (!Array.isArray(node)) return node;
    return node.map((el, idx) => {
      if (el && el.props && el.props["data-var-slot"] != null) {
        const vb = varBlocks[Number(el.props["data-var-slot"])];
        if (vb) return <InlineVarSlider key={`v-${idx}`} name={vb.name} min={vb.min} max={vb.max} />;
      }
      return el;
    });
  };

  // Group multi-line $$ ... $$ blocks
  const rawLines = prepared.split("\n");
  const lines = [];
  let bm = null;
  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li];
    if (bm != null) {
      bm.push(raw);
      if (/\$\$\s*$/.test(raw.trim())) {
        lines.push(bm.join("\n"));
        bm = null;
      }
      continue;
    }
    const openOnly = /^\$\$\s*$/.test(raw.trim());
    const hasOpen = raw.includes("$$");
    const hasBothOnSameLine = (raw.match(/\$\$/g) || []).length >= 2;
    if (openOnly || (hasOpen && !hasBothOnSameLine && !/\$\$[\s\S]*\$\$/.test(raw))) {
      bm = [raw];
      continue;
    }
    lines.push(raw);
  }
  if (bm) lines.push(bm.join("\n"));

  const blocks = [];
  let listBuffer = null;
  const flushList = () => {
    if (!listBuffer) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} style={{ margin: "2px 0 12px 2px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {listBuffer.map((item, idx) => (
          <li key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 9, lineHeight: 1.6, color: "#1F2937", fontSize: 13.5 }}>
            <span style={{ flexShrink: 0, marginTop: 8, width: 4, height: 4, borderRadius: 999, background: "#8B5CF6" }} />
            <div style={{ flex: 1, minWidth: 0 }}>{replaceVars(renderInline(item, `li-${idx}`))}</div>
          </li>
        ))}
      </ul>
    );
    listBuffer = null;
  };

  lines.forEach((rawLine, idx) => {
    const t = rawLine.trim();

    if (/^\$\$[\s\S]+\$\$$/.test(t)) {
      flushList();
      const inner = t.replace(/^\$\$\s*/, "").replace(/\s*\$\$$/, "").trim();
      try {
        const html = katex.renderToString(inner, { throwOnError: false, displayMode: true });
        blocks.push(
          <div key={`bm-${idx}`} style={{ overflowX: "auto", margin: "8px 0 12px", fontSize: "0.95em" }} dangerouslySetInnerHTML={{ __html: html }} />
        );
      } catch {
        blocks.push(<code key={`bm-${idx}`}>{t}</code>);
      }
      return;
    }

    const vizOnly = t.match(/^__VIZ_(\d+)__$/);
    if (vizOnly) {
      flushList();
      const raw = vizBlocks[Number(vizOnly[1])];
      const intent = normalizeVizIntent(raw);
      if (!intent) return;
      blocks.push(
        <DynamicVizCard key={`viz-${idx}`} intent={intent} onOpen={() => context?.onOpenViz?.(intent)} />
      );
      return;
    }

    const graphRefOnly = t.match(/^__GRAPHREF_(\d+)__$/);
    if (graphRefOnly) {
      flushList();
      const ref = graphRefs[Number(graphRefOnly[1])];
      if (!ref || !ref.slug) return;
      // Render as a full-width async card; reuse onOpenViz as the "open lab" entry
      blocks.push(
        <ConceptGraphCard
          key={`gref-${idx}`}
          slug={ref.slug}
          label={ref.label}
          context={context?.currentMaterial || ""}
          aiBody={context?.aiBody}
          onOpen={(intent) => context?.onOpenViz?.(intent)}
        />
      );
      return;
    }

    if (!t) { flushList(); blocks.push(<div key={`sp-${idx}`} style={{ height: 4 }} />); return; }
    if (t.startsWith("### ")) {
      flushList();
      blocks.push(<h3 key={`h3-${idx}`} style={{ margin: "12px 0 6px", fontSize: 13.5, fontWeight: 800, color: "#111827", letterSpacing: "-0.01em" }}>{replaceVars(renderInline(t.slice(4), `h3-${idx}`))}</h3>);
      return;
    }
    if (t.startsWith("## ")) {
      flushList();
      blocks.push(<h2 key={`h2-${idx}`} style={{ margin: "16px 0 8px", fontSize: 14.5, fontWeight: 800, color: "#111827", paddingBottom: 6, borderBottom: "1px solid #F3F4F6", letterSpacing: "-0.015em" }}>{replaceVars(renderInline(t.slice(3), `h2-${idx}`))}</h2>);
      return;
    }
    if (t.startsWith("# ")) {
      flushList();
      blocks.push(<h1 key={`h1-${idx}`} style={{ margin: "16px 0 8px", fontSize: 15, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>{replaceVars(renderInline(t.slice(2), `h1-${idx}`))}</h1>);
      return;
    }
    const ulM = t.match(/^[-*]\s+(.+)/);
    const olM = t.match(/^\d+\.\s+(.+)/);
    if (ulM || olM) {
      if (!listBuffer) listBuffer = [];
      listBuffer.push((ulM || olM)[1]);
      return;
    }
    flushList();
    blocks.push(
      <p key={`p-${idx}`} style={{ margin: "0 0 10px", lineHeight: 1.6, color: "#1F2937", fontSize: 13.5, letterSpacing: "0.005em" }}>
        {replaceVars(renderInline(t, `p-${idx}`))}
      </p>
    );
  });
  flushList();
  return blocks;
}

// ── AI Bubble ──────────────────────────────────────────────────────────────
function AIBubble({ content, context }) {
  return (
    <motion.div variants={bubbleVariants} style={{ display: "flex", gap: 12, width: "100%", margin: "0 0 24px" }}>
      <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(99,102,241,0.2)", marginTop: 2 }}>
        <IconSparkles size={14} />
      </div>
      <div style={{
        flex: 1,
        minWidth: 0,
        paddingRight: 24,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
      }}>
        {renderMarkdown(content, context)}
      </div>
    </motion.div>
  );
}

// ── User Bubble ────────────────────────────────────────────────────────────
function UserBubble({ content }) {
  return (
    <motion.div variants={bubbleVariants} style={{ display: "flex", gap: 12, width: "100%", margin: "0 0 24px", paddingLeft: 48, justifyContent: "flex-end" }}>
      <div style={{
        background: "#111827",
        color: "#FFFFFF",
        borderRadius: 16,
        borderTopRightRadius: 4,
        padding: "10px 16px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        maxWidth: "80%",
        fontSize: 13.5,
        lineHeight: 1.55,
        fontWeight: 500,
        letterSpacing: "0.01em",
      }}>
        {renderInline(content, "ub")}
      </div>
    </motion.div>
  );
}

export default function MaterialChatPage({
  messages,
  conversationHistory,
  currentMaterial,
  renderChart,
  onOpenChart,
  aiBody,
}) {
  const stream = messages || conversationHistory || [];
  const openLab = useMathStore((s) => s.openLab);
  const context = {
    renderChart,
    currentMaterial,
    aiBody,
    onOpenViz: (intent) => {
      openLab(intent);
      if (onOpenChart) onOpenChart(intent);
    },
  };
  return (
    <div style={{ width: "100%", padding: "4px 0 12px" }}>
      {stream.map((msg, i) =>
        msg.role === "user" ? (
          <UserBubble key={i} content={msg.text} />
        ) : (
          <AIBubble key={i} content={msg.text} context={context} />
        )
      )}
    </div>
  );
}
