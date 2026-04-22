import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import katex from "katex";
import { useMathStore } from "../store/useMathStore";

const pageTransition = { type: "spring", stiffness: 260, damping: 26 };

// ── Inline icons ──────────────────────────────────────────────────────────
const IconArrowLeft = ({ size = 18, color = "#111827" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);
const IconSettings = ({ size = 16, color = "#111827" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const IconActivity = ({ size = 14, color = "#4F46E5" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const IconCheck = ({ size = 14, color = "#10B981" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ── Structure accent tokens (kept in sync with chat card dictionary) ──────
const STRUCT_ACCENT = {
  parametric: { fg: "#4338CA", bg: "#EEF2FF", accent: "#6366F1", label: "参数可调模型",   tag: "PARAMETRIC" },
  hierarchy:  { fg: "#1D4ED8", bg: "#EFF6FF", accent: "#3B82F6", label: "层级 · 树状拓扑",   tag: "HIERARCHY"  },
  process:    { fg: "#047857", bg: "#ECFDF5", accent: "#10B981", label: "流程 · 时序推演",   tag: "PROCESS"    },
  comparison: { fg: "#B45309", bg: "#FFFBEB", accent: "#F59E0B", label: "对比 · 并列分析",   tag: "COMPARISON" },
  annotation: { fg: "#6D28D9", bg: "#F5F3FF", accent: "#8B5CF6", label: "公式标注 · 拆解", tag: "ANNOTATION" },
  concept:    { fg: "#0F766E", bg: "#F0FDFA", accent: "#14B8A6", label: "概念关系网络",     tag: "CONCEPT"    },
};

// Annotation tone palette
const TONE_MAP = {
  indigo:  { bg: "#EEF2FF", fg: "#4338CA", accent: "#6366F1" },
  blue:    { bg: "#EFF6FF", fg: "#1D4ED8", accent: "#3B82F6" },
  emerald: { bg: "#ECFDF5", fg: "#047857", accent: "#10B981" },
  amber:   { bg: "#FFFBEB", fg: "#B45309", accent: "#F59E0B" },
  rose:    { bg: "#FFF1F2", fg: "#BE123C", accent: "#F43F5E" },
  violet:  { bg: "#F5F3FF", fg: "#6D28D9", accent: "#8B5CF6" },
  slate:   { bg: "#F1F5F9", fg: "#334155", accent: "#64748B" },
};

// ───────────────────────────────────────────────────────────────────────────
//                           PORTAL HOST + DISPATCHER
// ───────────────────────────────────────────────────────────────────────────
export default function InteractiveLab() {
  const labOpen = useMathStore((s) => s.labOpen);
  const labConfig = useMathStore((s) => s.labConfig);
  const closeLab = useMathStore((s) => s.closeLab);

  // Background scroll lock + ESC-to-close, guarded by labOpen
  useEffect(() => {
    if (!labOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") closeLab(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [labOpen, closeLab]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {labOpen && <InteractiveLabShell key="lab" intent={labConfig} onClose={closeLab} />}
    </AnimatePresence>,
    document.body
  );
}

// Safe KaTeX rendering helper
function katexRender(tex, displayMode = false) {
  try { return katex.renderToString(String(tex || ""), { throwOnError: false, displayMode }); }
  catch { return `<code>${tex}</code>`; }
}

// Normalize any incoming config (may be null / legacy / full intent)
function normalizeIntent(cfg) {
  if (!cfg || typeof cfg !== "object") {
    return { structure: "parametric", interactionLevel: "L2", title: "常微分方程可视化", description: "解的族群分析：积分常数 C 的影响", data: {} };
  }
  if (cfg.structure && STRUCT_ACCENT[cfg.structure]) return cfg;
  // Legacy { k, steady, cMin, cMax, cInit } — route to parametric
  if (cfg.k != null || cfg.steady != null || cfg.cMin != null) {
    return {
      structure: "parametric", interactionLevel: "L2",
      title: cfg.title || "参数曲线族", description: cfg.description || "解的族群分析",
      data: { k: cfg.k, steady: cfg.steady, cMin: cfg.cMin, cMax: cfg.cMax, cInit: cfg.cInit, equation: cfg.equation },
    };
  }
  return { structure: cfg.structure || "parametric", interactionLevel: cfg.interactionLevel || "L1", title: cfg.title || "可视化", description: cfg.description || "", data: cfg.data || cfg };
}

function InteractiveLabShell({ intent: raw, onClose }) {
  const intent = useMemo(() => normalizeIntent(raw), [raw]);
  const accent = STRUCT_ACCENT[intent.structure] || STRUCT_ACCENT.parametric;
  const level = intent.interactionLevel || "L1";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.985 }}
      transition={pageTransition}
      style={{
        position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
        background: "#FAFAFC", zIndex: 999,
        display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 0,
      }}
    >
      {/* Immersive nav bar */}
      <header style={{ flexShrink: 0, padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFFFF", borderBottom: "1px solid #F3F4F6" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <motion.button
            type="button"
            onClick={onClose}
            whileHover={{ scale: 1.05, background: "#F3F4F6" }}
            whileTap={{ scale: 0.95 }}
            style={{ width: 40, height: 40, borderRadius: 999, background: "#FAFAFC", border: "1px solid #F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            aria-label="返回对话"
          >
            <IconArrowLeft size={18} color="#111827" />
          </motion.button>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#111827", letterSpacing: "-0.015em" }}>{renderInlineKatex(intent.title)}</h1>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "#6B7280" }}>{renderInlineKatex(intent.description || accent.label)}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ padding: "5px 10px", borderRadius: 999, background: accent.bg, color: accent.fg, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em" }}>{accent.tag}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: "#EEF2FF", borderRadius: 999 }}>
            <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} style={{ width: 6, height: 6, borderRadius: 999, background: "#4F46E5" }} />
            <IconActivity size={13} color="#4F46E5" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#4F46E5", letterSpacing: "0.04em" }}>{level} · {level === "L2" || level === "L3" ? "LIVE SIMULATION" : "LIVE STRUCTURE"}</span>
          </div>
        </div>
      </header>

      {/* Structure-aware body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {intent.structure === "parametric" && <ParametricStage intent={intent} accent={accent} />}
        {intent.structure === "hierarchy"  && <HierarchyStage  intent={intent} accent={accent} />}
        {intent.structure === "process"    && <ProcessStage    intent={intent} accent={accent} />}
        {intent.structure === "comparison" && <ComparisonStage intent={intent} accent={accent} />}
        {intent.structure === "annotation" && <AnnotationStage intent={intent} accent={accent} />}
        {intent.structure === "concept"    && <ConceptStage    intent={intent} accent={accent} />}
      </div>
    </motion.div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
//                            STAGE 1: PARAMETRIC
// ───────────────────────────────────────────────────────────────────────────
function ParametricStage({ intent, accent }) {
  const data = intent.data || {};
  const k = Number(data.k ?? 2);
  const steady = Number(data.steady ?? 1.5);
  const xMin = Number(data.xMin ?? 0);
  const xMax = Number(data.xMax ?? 5);
  const yMin = Number(data.yMin ?? -2);
  const yMax = Number(data.yMax ?? 4);
  const cMin = Number(data.cMin ?? -3);
  const cMax = Number(data.cMax ?? 3);
  const cInit = Number(data.cInit ?? 1);
  const equation = data.equation || "dy/dx + 2y = 3";
  const f = (x, c) => c * Math.exp(-k * x) + steady;

  const [c, setC] = useState(cInit);
  const W = 800, H = 400;
  const xToSvg = (x) => ((x - xMin) / (xMax - xMin)) * W;
  const yToSvg = (y) => H - ((y - yMin) / (yMax - yMin)) * H;

  const pathData = useMemo(() => {
    let d = "";
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + (i / steps) * (xMax - xMin);
      const y = f(x, c);
      d += i === 0 ? `M ${xToSvg(x).toFixed(2)} ${yToSvg(y).toFixed(2)} ` : `L ${xToSvg(x).toFixed(2)} ${yToSvg(y).toFixed(2)} `;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, xMin, xMax, yMin, yMax, k, steady]);

  const ghostCs = useMemo(() => {
    const out = [];
    const span = cMax - cMin;
    for (let g = 0; g <= 6; g++) {
      const cv = cMin + (g / 6) * span;
      let d = "";
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        const x = xMin + (i / steps) * (xMax - xMin);
        const y = f(x, cv);
        d += i === 0 ? `M ${xToSvg(x).toFixed(2)} ${yToSvg(y).toFixed(2)} ` : `L ${xToSvg(x).toFixed(2)} ${yToSvg(y).toFixed(2)} `;
      }
      out.push(d);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cMin, cMax, xMin, xMax, yMin, yMax, k, steady]);

  const initY = f(xMin, c);

  return (
    <div style={{ flex: 1, padding: 28, display: "flex", gap: 24, minHeight: 0 }}>
      <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 20, overflowY: "auto" }}>
        <div style={{ background: "#FFFFFF", borderRadius: 24, padding: 24, border: "1px solid #F3F4F6", boxShadow: "0 10px 40px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <IconSettings size={16} color="#111827" />
            <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: "#111827", letterSpacing: "-0.01em" }}>参数控制台</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>积分常数 (C)</label>
              <span style={{ background: accent.bg, color: accent.fg, padding: "4px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minWidth: 56, textAlign: "center" }}>
                {c.toFixed(2)}
              </span>
            </div>
            <input type="range" min={cMin} max={cMax} step={0.05} value={c} onChange={(e) => setC(parseFloat(e.target.value))} aria-label="积分常数 C" style={{ width: "100%", height: 4, accentColor: accent.accent, cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9CA3AF", marginTop: -4 }}>
              <span>{cMin.toFixed(1)}</span>
              <span>{((cMin + cMax) / 2).toFixed(1)}</span>
              <span>{cMax.toFixed(1)}</span>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: "#6B7280", lineHeight: 1.6 }}>
              拖动滑块观察常数 C 如何改变解的初始位置与演化轨迹。所有曲线最终渐进于稳态 y = {steady}。
            </p>
          </div>
        </div>

        <div style={{ background: "#0F172A", borderRadius: 24, padding: 22, boxShadow: "0 18px 40px rgba(15,23,42,0.18)" }}>
          <h3 style={{ margin: "0 0 10px", color: "#94A3B8", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>当前系统方程</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#FFFFFF", fontSize: 14 }}>
            <span>{equation}</span>
            <div style={{ height: 1, width: "100%", background: "rgba(148,163,184,0.2)", margin: "4px 0" }} />
            <span style={{ color: "#A5B4FC" }}>y(x) = {c.toFixed(2)}·e⁻{k}ˣ + {steady}</span>
          </div>
          <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(99,102,241,0.12)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10.5, color: "#94A3B8", letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase" }}>初始条件</span>
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#E0E7FF", fontSize: 12.5 }}>y({xMin}) = {initY.toFixed(3)}</span>
          </div>
        </div>
      </div>

      {/* Right canvas */}
      <div style={{ flex: 1, background: "#FFFFFF", borderRadius: 32, padding: 28, border: "1px solid #F3F4F6", boxShadow: "0 15px 50px rgba(0,0,0,0.05)", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: "radial-gradient(#111827 1.4px, transparent 1.4px)", backgroundSize: "30px 30px", pointerEvents: "none" }} />
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible", maxHeight: 600, position: "relative", zIndex: 1 }}>
          <defs>
            <filter id="curveGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <g stroke="#E5E7EB" strokeWidth="1" opacity="0.6">
            {[1, 2, 3, 4].map((i) => <line key={`v-${i}`} x1={(i / 5) * W} y1="0" x2={(i / 5) * W} y2={H} strokeDasharray="3 4" />)}
            {[1, 2, 3, 4, 5].map((i) => <line key={`h-${i}`} x1="0" y1={(i / 6) * H} x2={W} y2={(i / 6) * H} strokeDasharray="3 4" />)}
          </g>
          <line x1="0" y1={yToSvg(0)} x2={W} y2={yToSvg(0)} stroke="#9CA3AF" strokeWidth="1.5" />
          <line x1={xToSvg(xMin)} y1="0" x2={xToSvg(xMin)} y2={H} stroke="#9CA3AF" strokeWidth="1.5" />
          <line x1="0" y1={yToSvg(steady)} x2={W} y2={yToSvg(steady)} stroke={accent.accent} strokeWidth="1.5" strokeDasharray="6 5" opacity="0.55" />
          <text x={W - 8} y={yToSvg(steady) - 8} fill={accent.fg} fontSize="11" fontWeight="700" textAnchor="end" letterSpacing="0.05em">y = {steady}</text>
          {ghostCs.map((d, i) => (<path key={`gh-${i}`} d={d} fill="none" stroke={accent.accent} strokeWidth="1.2" opacity="0.3" strokeLinecap="round" />))}
          <motion.path d={pathData} fill="none" stroke={accent.accent} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#curveGlow)" animate={{ d: pathData }} transition={{ type: "spring", stiffness: 220, damping: 24 }} />
          <motion.circle cx={xToSvg(xMin)} cy={yToSvg(initY)} r="7" fill="#FFFFFF" stroke="#111827" strokeWidth="2.5" animate={{ cy: yToSvg(initY) }} transition={{ type: "spring", stiffness: 220, damping: 24 }} />
          <motion.circle cx={xToSvg(xMin)} cy={yToSvg(initY)} r="3" fill="#111827" animate={{ cy: yToSvg(initY) }} transition={{ type: "spring", stiffness: 220, damping: 24 }} />
          <text x={W - 6} y={yToSvg(0) - 8} fill="#6B7280" fontSize="11" fontWeight="700" textAnchor="end">x</text>
          <text x={xToSvg(xMin) + 8} y="14" fill="#6B7280" fontSize="11" fontWeight="700">y</text>
        </svg>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
//                            STAGE 2: HIERARCHY
// ───────────────────────────────────────────────────────────────────────────
function HierarchyStage({ intent, accent }) {
  const rootNode = intent?.data?.root || { name: intent.title, children: [] };

  return (
    <div style={{ flex: 1, padding: 32, overflowY: "auto" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", background: "#FFFFFF", borderRadius: 28, padding: "32px 40px", border: "1px solid #F3F4F6", boxShadow: "0 15px 50px rgba(0,0,0,0.04)" }}>
        <TreeNode node={rootNode} depth={0} accent={accent} path="root" />
      </div>
    </div>
  );
}

function TreeNode({ node, depth, accent, path }) {
  const [open, setOpen] = useState(depth < 2); // show first 2 depths by default
  const hasKids = Array.isArray(node?.children) && node.children.length > 0;
  const name = node?.name || node?.title || "节点";
  const desc = node?.desc || node?.description || "";

  const size = Math.max(12 - depth, 0);
  const indent = depth * 24;
  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        onClick={() => hasKids && setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "10px 14px", marginLeft: indent, marginBottom: 4,
          borderRadius: 12, background: depth === 0 ? accent.bg : (hasKids ? "#FAFAFC" : "transparent"),
          border: depth === 0 ? `1px solid ${accent.bg}` : "1px solid transparent",
          cursor: hasKids ? "pointer" : "default",
          transition: "background 0.15s",
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 7, width: 6 + size / 2, height: 6 + size / 2, borderRadius: 999, background: depth === 0 ? accent.accent : (hasKids ? accent.accent : "#CBD5E1") }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: depth === 0 ? 16 : depth === 1 ? 14 : 13.5, fontWeight: depth < 2 ? 800 : 600, color: depth === 0 ? accent.fg : "#111827", letterSpacing: "-0.01em" }}>{name}</span>
            {hasKids && <span style={{ fontSize: 10.5, fontWeight: 700, color: accent.fg, background: "rgba(255,255,255,0.6)", padding: "1px 6px", borderRadius: 4 }}>{node.children.length}</span>}
          </div>
          {desc && <div style={{ marginTop: 3, fontSize: 12.5, color: "#6B7280", lineHeight: 1.55 }}>{desc}</div>}
        </div>
        {hasKids && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s", marginTop: 6 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </motion.div>
      <AnimatePresence initial={false}>
        {open && hasKids && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            {node.children.map((child, i) => (
              <TreeNode key={`${path}-${i}`} node={child} depth={depth + 1} accent={accent} path={`${path}-${i}`} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
//                            STAGE 3: PROCESS
// ───────────────────────────────────────────────────────────────────────────
// 把 "$a$ 行内" 和 "$$a$$ 块级" 渲染成 KaTeX；其余走纯文本。
// 之前 ProcessStage 只展示 title/desc/formula，Groq 新输出的 narrative/math/insight/substeps
// 全部被丢弃，详情页就显得空。这个 helper 让 narrative / insight 里的内联 LaTeX 也能直接渲染。
function renderInlineKatex(text) {
  if (text == null) return null;
  const str = String(text);
  const parts = str.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
      try {
        const html = katex.renderToString(part.slice(2, -2).trim(), { throwOnError: false, displayMode: true });
        return <span key={i} style={{ display: "block", overflowX: "auto", margin: "8px 0" }} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch { return <code key={i}>{part}</code>; }
    }
    if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
      try {
        const html = katex.renderToString(part.slice(1, -1).trim(), { throwOnError: false, displayMode: false });
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch { return <code key={i}>{part}</code>; }
    }
    return <span key={i}>{part}</span>;
  });
}

// AI 偶尔会在 math.latex 字段里**错加包装**——最常见的是：
//   "$L_i(x) = \\frac{...}{...}$"   ← 多了 $ 包裹
//   "$$y = ax + b$$"                ← 多了 $$ 包裹
//   "```L_i(x)```"                  ← 套了代码块围栏
// 不清洗就直接喂给 KaTeX，会触发"公式以原始代码形式显示在红框里"的现象。
// 规则：math.latex 约定为**纯 LaTeX 源码**，这里兜底剥掉任何包装符号。
function stripLatexWrapping(src) {
  let s = String(src ?? "").trim();
  if (!s) return "";
  // 代码块围栏（可能带语言标签）
  s = s.replace(/^```(?:latex|math|tex)?\s*/i, "").replace(/```\s*$/, "");
  s = s.trim();
  // 块级公式 $$...$$
  if (s.startsWith("$$") && s.endsWith("$$") && s.length >= 4) {
    s = s.slice(2, -2).trim();
  }
  // 行内公式 $...$（允许前后还有空白）
  if (s.startsWith("$") && s.endsWith("$") && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  // 再洗一次代码块围栏（如果模型套了双层包装）
  s = s.replace(/^```(?:latex|math|tex)?\s*/i, "").replace(/```\s*$/, "").trim();
  return s;
}

function renderBlockKatex(latex) {
  const cleaned = stripLatexWrapping(latex);
  if (!cleaned) return null;
  try {
    const html = katex.renderToString(cleaned, { throwOnError: false, displayMode: true });
    return <span style={{ display: "block", overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    // 降级：展开一个 <details> 让用户能看到原始 LaTeX 源，不做哑巴式失败
    return (
      <details style={{ fontSize: 12, color: "#F87171" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>⚠️ 公式渲染失败（点击查看原始 LaTeX）</summary>
        <code style={{ display: "block", marginTop: 6, padding: 8, background: "rgba(248,113,113,0.1)", borderRadius: 6, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, wordBreak: "break-all" }}>{cleaned}</code>
      </details>
    );
  }
}

// 归一化单步：兼容 Schema v1（title/desc/formula）和 Schema v2（title/narrative/math.latex/insight/substeps）。
function normalizeProcessStep(raw, idx) {
  const src = raw && typeof raw === "object" ? raw : {};
  const title = (typeof src.title === "string" && src.title.trim()) || `第 ${idx + 1} 步`;
  const narrative = typeof src.narrative === "string" && src.narrative.trim()
    ? src.narrative.trim()
    : (typeof src.desc === "string" ? src.desc.trim() : "");
  let math = null;
  if (src.math && typeof src.math === "object" && (src.math.latex || src.math.explanation)) {
    math = {
      latex: typeof src.math.latex === "string" ? src.math.latex : "",
      explanation: typeof src.math.explanation === "string" ? src.math.explanation : "",
    };
  } else if (typeof src.formula === "string" && src.formula.trim()) {
    // 旧 schema 里 formula 可能是 LaTeX，也可能只是一段等式字符串 —— 都塞进 math.latex 让 KaTeX 试着渲
    math = { latex: src.formula.trim(), explanation: "" };
  }
  const insight = typeof src.insight === "string" ? src.insight.trim() : "";
  const substeps = Array.isArray(src.substeps) ? src.substeps.filter((s) => typeof s === "string" && s.trim()) : [];
  const connects = typeof src.connects_to_next === "string" ? src.connects_to_next.trim() : "";
  return { title, narrative, math, insight, substeps, connects };
}

function ProcessStage({ intent, accent }) {
  const rawSteps = Array.isArray(intent?.data?.steps) && intent.data.steps.length > 0
    ? intent.data.steps
    : [{ title: "暂无步骤", narrative: "AI 未提供步骤数据" }];
  const steps = rawSteps.map((s, i) => normalizeProcessStep(s, i));
  const [active, setActive] = useState(0);

  // 顶层叙事元数据（Schema v2 新增）：title / subtitle / conclusion
  const dataTitle = typeof intent?.data?.title === "string" ? intent.data.title.trim() : "";
  const subtitle = typeof intent?.data?.subtitle === "string" ? intent.data.subtitle.trim() : "";
  const conclusion = typeof intent?.data?.conclusion === "string" ? intent.data.conclusion.trim() : "";

  const current = steps[active] || steps[0];

  return (
    <div style={{ flex: 1, padding: 32, display: "flex", flexDirection: "column", gap: 18, minHeight: 0 }}>
      {/* 顶部叙事横幅：题目标题 + 聚焦副标题 + 结论（若有）—— 给"为什么学这一串步骤"定调 */}
      {(dataTitle || subtitle || conclusion) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 20px", borderRadius: 18, background: `linear-gradient(135deg, ${accent.bg} 0%, #FFFFFF 100%)`, border: `1px solid ${accent.accent}33` }}>
          {dataTitle && <div style={{ fontSize: 17, fontWeight: 800, color: "#111827", letterSpacing: "-0.015em" }}>{renderInlineKatex(dataTitle)}</div>}
          {subtitle && <div style={{ fontSize: 13, color: "#4B5563", fontStyle: "italic" }}>{renderInlineKatex(subtitle)}</div>}
          {conclusion && (
            <div style={{ marginTop: 2, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: accent.fg, fontWeight: 700 }}>
              <span style={{ flexShrink: 0 }}>🎯</span>
              <span style={{ fontWeight: 600, color: "#111827" }}>最终结论：{renderInlineKatex(conclusion)}</span>
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", gap: 28, minHeight: 0 }}>
        <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          {steps.map((step, i) => {
            const isActive = i === active;
            const isPast = i < active;
            return (
              <motion.button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                whileHover={{ y: -1 }}
                transition={{ type: "spring", stiffness: 300, damping: 24 }}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "14px 16px", borderRadius: 16,
                  background: isActive ? accent.bg : "#FFFFFF",
                  border: `1px solid ${isActive ? accent.accent : "#F3F4F6"}`,
                  boxShadow: isActive ? `0 8px 24px ${accent.accent}22` : "0 2px 8px rgba(0,0,0,0.02)",
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                }}
              >
                <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 999, background: isActive ? accent.accent : (isPast ? "#FFFFFF" : "#FAFAFC"), border: `2px solid ${isActive || isPast ? accent.accent : "#E5E7EB"}`, display: "flex", alignItems: "center", justifyContent: "center", color: isActive ? "#FFFFFF" : accent.fg, fontSize: 13, fontWeight: 800 }}>
                  {isPast ? <IconCheck size={14} color={accent.accent} /> : i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* 左侧步骤导航的 title / narrative 之前是字面量渲染，如果包含 $...$ 会字面显示，
                      例如 "分析基函数 $L_i(x)$ 的次数" 的美元符号会裸露在 UI 上。这里统一走 renderInlineKatex。 */}
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: isActive ? accent.fg : "#111827", letterSpacing: "-0.01em", lineHeight: 1.35 }}>{renderInlineKatex(step.title)}</div>
                  {step.narrative && <div style={{ marginTop: 3, fontSize: 12, color: "#6B7280", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{renderInlineKatex(step.narrative)}</div>}
                </div>
              </motion.button>
            );
          })}
        </div>

        <div style={{ flex: 1, background: "#FFFFFF", borderRadius: 28, padding: "36px 44px", border: "1px solid #F3F4F6", boxShadow: "0 15px 50px rgba(0,0,0,0.04)", overflowY: "auto" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ padding: "3px 10px", borderRadius: 999, background: accent.bg, color: accent.fg, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>STEP {active + 1} / {steps.length}</span>
                <span style={{ height: 3, flex: 1, background: "#F3F4F6", borderRadius: 999, overflow: "hidden" }}>
                  <motion.span style={{ display: "block", height: "100%", background: accent.accent, borderRadius: 999 }} initial={{ width: 0 }} animate={{ width: `${((active + 1) / steps.length) * 100}%` }} transition={{ type: "spring", stiffness: 220, damping: 26 }} />
                </span>
              </div>

              <h2 style={{ margin: "0 0 14px", fontSize: 24, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em", lineHeight: 1.3 }}>
                {renderInlineKatex(current.title)}
              </h2>

              {current.narrative && (
                <p style={{ margin: 0, fontSize: 14.5, color: "#374151", lineHeight: 1.75 }}>
                  {renderInlineKatex(current.narrative)}
                </p>
              )}

              {/* math.latex 块级渲染 + explanation 副标题 —— 这是 Schema v2 的核心展示位 */}
              {current.math && current.math.latex && (
                <div style={{ marginTop: 22, padding: "20px 24px", background: "#0F172A", borderRadius: 16, color: "#E0E7FF" }}>
                  <div style={{ fontSize: 16, color: "#E0E7FF" }}>{renderBlockKatex(current.math.latex)}</div>
                  {current.math.explanation && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,0.25)", fontSize: 12.5, color: "#CBD5E1", lineHeight: 1.6 }}>
                      {renderInlineKatex(current.math.explanation)}
                    </div>
                  )}
                </div>
              )}

              {/* 细分小步骤 */}
              {current.substeps && current.substeps.length > 0 && (
                <ul style={{ marginTop: 20, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
                  {current.substeps.map((ss, i) => (
                    <li key={i} style={{ fontSize: 13.5, color: "#374151", lineHeight: 1.65 }}>
                      {renderInlineKatex(ss)}
                    </li>
                  ))}
                </ul>
              )}

              {/* 关键洞察 —— 这一步能让人"豁然开朗"的那句 */}
              {current.insight && (
                <div style={{ marginTop: 22, padding: "14px 18px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 14, display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ flexShrink: 0, fontSize: 16, lineHeight: 1, marginTop: 1 }}>💡</span>
                  <div style={{ flex: 1, fontSize: 13.5, color: "#92400E", lineHeight: 1.65, fontWeight: 600 }}>
                    {renderInlineKatex(current.insight)}
                  </div>
                </div>
              )}

              {/* 过渡到下一步 */}
              {current.connects && active < steps.length - 1 && (
                <div style={{ marginTop: 14, fontSize: 12, color: "#6B7280", fontStyle: "italic" }}>
                  → {renderInlineKatex(current.connects)}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div style={{ marginTop: 32, display: "flex", justifyContent: "space-between", gap: 10 }}>
            <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setActive((v) => Math.max(0, v - 1))} disabled={active === 0} style={{ padding: "10px 20px", borderRadius: 12, background: "#FAFAFC", border: "1px solid #F3F4F6", fontSize: 13, fontWeight: 700, color: active === 0 ? "#CBD5E1" : "#111827", cursor: active === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>← 上一步</motion.button>
            <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setActive((v) => Math.min(steps.length - 1, v + 1))} disabled={active === steps.length - 1} style={{ padding: "10px 20px", borderRadius: 12, background: active === steps.length - 1 ? "#FAFAFC" : "#111827", border: active === steps.length - 1 ? "1px solid #F3F4F6" : "none", fontSize: 13, fontWeight: 700, color: active === steps.length - 1 ? "#CBD5E1" : "#FFFFFF", cursor: active === steps.length - 1 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>下一步 →</motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
//                            STAGE 4: COMPARISON
// ───────────────────────────────────────────────────────────────────────────
function ComparisonStage({ intent, accent }) {
  const columns = Array.isArray(intent?.data?.columns) && intent.data.columns.length > 0
    ? intent.data.columns
    : [{ title: "方案 A", points: ["（AI 未提供）"] }, { title: "方案 B", points: ["（AI 未提供）"] }];

  const palettes = [
    { bg: accent.bg, fg: accent.fg, accent: accent.accent },
    { bg: "#FFFBEB", fg: "#B45309", accent: "#F59E0B" },
    { bg: "#F0FDF4", fg: "#047857", accent: "#10B981" },
    { bg: "#FEF2F2", fg: "#B91C1C", accent: "#EF4444" },
  ];

  return (
    <div style={{ flex: 1, padding: 32, overflowY: "auto" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(0, 1fr))`, gap: 24 }}>
        {columns.map((col, ci) => {
          const p = palettes[ci % palettes.length];
          const points = Array.isArray(col.points) ? col.points : [];
          return (
            <motion.div
              key={ci}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24, delay: ci * 0.06 }}
              style={{ background: "#FFFFFF", borderRadius: 28, padding: 28, border: "1px solid #F3F4F6", boxShadow: "0 15px 50px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: 16 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: p.bg, color: p.fg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em" }}>{ci + 1}</div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#111827", letterSpacing: "-0.015em" }}>{col.title || `方案 ${ci + 1}`}</h3>
                  {col.subtitle && <span style={{ marginTop: 2, fontSize: 12, color: "#6B7280" }}>{col.subtitle}</span>}
                </div>
              </div>
              <div style={{ height: 2, background: `linear-gradient(90deg, ${p.accent} 0%, transparent 100%)`, borderRadius: 999 }} />
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {points.map((pt, pi) => {
                  const text = typeof pt === "string" ? pt : (pt?.text || JSON.stringify(pt));
                  const tone = typeof pt === "object" ? pt?.tone : null; // "pro" | "con" | null
                  return (
                    <li key={pi} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderRadius: 10, background: "#FAFAFC" }}>
                      <span style={{ flexShrink: 0, marginTop: 6, width: 6, height: 6, borderRadius: 999, background: tone === "con" ? "#EF4444" : tone === "pro" ? "#10B981" : p.accent }} />
                      <span style={{ fontSize: 13.5, color: "#1F2937", lineHeight: 1.6 }}>{text}</span>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
//                            STAGE 5: ANNOTATION
//   Formula decomposition — each part colored, clickable, with explanation
// ───────────────────────────────────────────────────────────────────────────
function AnnotationStage({ intent, accent }) {
  const data = intent?.data || {};
  const formula = data.formula || "y";
  const parts = Array.isArray(data.parts) && data.parts.length > 0
    ? data.parts
    : [{ tex: formula, label: "表达式", desc: "（AI 未提供拆解）", tone: "indigo" }];
  const [selected, setSelected] = useState(0);

  const fullHTML = useMemo(() => katexRender(formula, true), [formula]);

  const columns = Math.min(parts.length, 3);
  const selectedPalette = TONE_MAP[parts[selected]?.tone] || TONE_MAP.indigo;

  return (
    <div style={{ flex: 1, padding: 32, overflowY: "auto" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
        {/* Hero: full formula */}
        <div style={{ background: "#FFFFFF", borderRadius: 28, padding: "56px 48px", border: "1px solid #F3F4F6", boxShadow: "0 15px 50px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${accent.accent} 0%, ${selectedPalette.accent} 100%)` }} />
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.14em", color: "#9CA3AF", textTransform: "uppercase" }}>公式结构拆解</span>
          <div style={{ fontSize: "1.3em", textAlign: "center" }} dangerouslySetInnerHTML={{ __html: fullHTML }} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
            {parts.map((p, i) => {
              const pal = TONE_MAP[p.tone] || TONE_MAP.indigo;
              const isSel = i === selected;
              return (
                <motion.button
                  type="button" key={i}
                  onClick={() => setSelected(i)}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    padding: "5px 12px", borderRadius: 999,
                    background: isSel ? pal.accent : pal.bg,
                    color: isSel ? "#FFFFFF" : pal.fg,
                    border: `1.5px solid ${isSel ? pal.accent : "transparent"}`,
                    fontSize: 11.5, fontWeight: 800, letterSpacing: "0.04em",
                    cursor: "pointer", fontFamily: "inherit",
                    boxShadow: isSel ? `0 4px 14px ${pal.accent}55` : "none",
                  }}
                >
                  {p.label || `部分 ${i + 1}`}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Part legend grid */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 20 }}>
          {parts.map((part, i) => {
            const pal = TONE_MAP[part.tone] || TONE_MAP.indigo;
            const isSel = i === selected;
            const partHTML = katexRender(part.tex, false);
            return (
              <motion.div
                key={i}
                onClick={() => setSelected(i)}
                whileHover={{ y: -2 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
                style={{
                  background: "#FFFFFF",
                  border: `2px solid ${isSel ? pal.accent : "#F3F4F6"}`,
                  borderRadius: 20, padding: "22px 24px", cursor: "pointer",
                  boxShadow: isSel ? `0 12px 40px ${pal.accent}22` : "0 4px 14px rgba(0,0,0,0.03)",
                  display: "flex", flexDirection: "column", gap: 14,
                  transition: "box-shadow 0.2s, border-color 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 8, background: pal.bg, color: pal.fg, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: "0.04em" }}>{i + 1}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#111827", letterSpacing: "-0.01em" }}>{part.label || `部分 ${i + 1}`}</span>
                </div>
                <div style={{ padding: "14px 16px", background: pal.bg, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 56 }}>
                  <span style={{ color: pal.fg, fontSize: "1.15em" }} dangerouslySetInnerHTML={{ __html: partHTML }} />
                </div>
                {part.desc && (
                  <p style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.65 }}>{part.desc}</p>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
//                            STAGE 6: CONCEPT
//   Radial node-link diagram — 1 primary center + satellite concepts
// ───────────────────────────────────────────────────────────────────────────
// ── 6 个 dimension 的配色：用户悬停或点击会按此上色，同时侧栏有图例 ──
// 颜色选择：高对比但不刺眼，满足色弱友好 + 视觉层次
const DIMENSION_PALETTE = {
  definition:   { fill: "#E0F2FE", stroke: "#0284C7", fg: "#075985", label: "定义" },
  formula:      { fill: "#FEF3C7", stroke: "#D97706", fg: "#92400E", label: "公式" },
  construction: { fill: "#DCFCE7", stroke: "#16A34A", fg: "#166534", label: "构造" },
  property:     { fill: "#EDE9FE", stroke: "#7C3AED", fg: "#5B21B6", label: "性质" },
  error:        { fill: "#FEE2E2", stroke: "#DC2626", fg: "#991B1B", label: "误差/限制" },
  application:  { fill: "#FFE4E6", stroke: "#E11D48", fg: "#9F1239", label: "应用" },
  related:      { fill: "#E5E7EB", stroke: "#6B7280", fg: "#374151", label: "关联概念" },
};

// KaTeX 安全渲染：失败时降级为原始文本，不炸整个面板
function renderKatex(tex, opts = {}) {
  if (!tex) return "";
  try {
    return katex.renderToString(String(tex), { throwOnError: false, output: "html", ...opts });
  } catch {
    return String(tex);
  }
}

function ConceptStage({ intent, accent }) {
  const data = intent?.data || {};
  const rawNodes = Array.isArray(data.nodes) && data.nodes.length > 0
    ? data.nodes
    : [{ id: "root", name: intent.title || "核心", primary: true }];
  const edges = Array.isArray(data.edges) ? data.edges : [];

  // ── 归一化：确保每个节点都有 name/level/dimension（老数据兼容 + 新字段补全） ──
  // 1 个 primary（优先 primary=true，否则 level=0 的节点，最后兜底第一个）
  let primaryIdx = rawNodes.findIndex((n) => n && n.primary);
  if (primaryIdx < 0) primaryIdx = rawNodes.findIndex((n) => n && Number(n.level) === 0);
  if (primaryIdx < 0) primaryIdx = 0;

  const nodes = rawNodes.map((n, i) => {
    const isPrimary = i === primaryIdx;
    const rawLevel = n?.level;
    // level 不存在时：primary 默认 0，其他默认 1（平铺在内环）
    const level = rawLevel === 0 || rawLevel === 1 || rawLevel === 2
      ? Number(rawLevel)
      : (isPrimary ? 0 : 1);
    return {
      ...n,
      name: n?.name || n?.label || n?.id || "(未命名)",
      primary: isPrimary,
      level,
      dimension: n?.dimension || (isPrimary ? "definition" : "related"),
      importance: n?.importance || (isPrimary ? "core" : "main"),
    };
  });
  const primary = nodes[primaryIdx];

  // ── 多环径向布局：level 0 → 中心；level 1 → R1；level 2 → R2 ──
  // 动态收缩半径：当内环节点过多时放大；当只有稀疏层时也要保证最小半径
  const W = 920, H = 560;
  const CX = W / 2, CY = H / 2;
  const level1 = nodes.filter((n) => n.level === 1 && !n.primary);
  const level2 = nodes.filter((n) => n.level === 2);
  const R1 = Math.max(150, Math.min(210, 110 + level1.length * 8));
  const R2 = Math.max(R1 + 110, Math.min(290, R1 + 90 + level2.length * 6));

  const positions = useMemo(() => {
    const p = {};
    p[primary.id] = { x: CX, y: CY };
    const place = (group, R, angleOffset = 0) => {
      const N = Math.max(group.length, 1);
      group.forEach((n, i) => {
        const angle = (i / N) * 2 * Math.PI - Math.PI / 2 + angleOffset;
        p[n.id] = { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
      });
    };
    place(level1, R1, 0);
    // level 2 的角度错开半格，避免和 level 1 放在同一径向线上挡视线
    place(level2, R2, Math.PI / Math.max(level2.length, 1));
    // 若有没归类到 level 1/2 的残留节点（例如 AI 吐了 level=3），退化到外环
    const orphan = nodes.filter(
      (n) => !n.primary && n.level !== 1 && n.level !== 2,
    );
    if (orphan.length) {
      orphan.forEach((n, i) => {
        const angle = (i / orphan.length) * 2 * Math.PI + Math.PI / 4;
        p[n.id] = { x: CX + (R2 + 30) * Math.cos(angle), y: CY + (R2 + 30) * Math.sin(angle) };
      });
    }
    return p;
  }, [primary.id, level1, level2, nodes, R1, R2]);

  const [hovered, setHovered] = useState(null);

  const nodeSelectedDesc = hovered
    ? nodes.find((n) => n.id === hovered)
    : primary;

  // dimension 分布：侧栏图例用
  const dimensionCount = useMemo(() => {
    const acc = {};
    nodes.forEach((n) => {
      const d = n.dimension || "related";
      acc[d] = (acc[d] || 0) + 1;
    });
    return acc;
  }, [nodes]);

  return (
    <div style={{ flex: 1, padding: 32, display: "flex", gap: 24, minHeight: 0 }}>
      <div style={{ flex: 1, background: "#FFFFFF", borderRadius: 28, padding: 24, border: "1px solid #F3F4F6", boxShadow: "0 15px 50px rgba(0,0,0,0.04)", overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: "radial-gradient(#111827 1.4px, transparent 1.4px)", backgroundSize: "30px 30px", pointerEvents: "none" }} />
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible", maxHeight: 620, position: "relative", zIndex: 1 }}>
          {/* Edges */}
          {edges.map((e, i) => {
            const from = positions[e.from];
            const to = positions[e.to];
            if (!from || !to) return null;
            const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
            const isActive = hovered && (hovered === e.from || hovered === e.to);
            return (
              <g key={i}>
                <motion.line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={isActive ? accent.accent : "#CBD5E1"}
                  strokeWidth={isActive ? 2.4 : 1.4}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.8, delay: 0.1 + i * 0.06, ease: "easeOut" }}
                  style={{ transition: "stroke 0.18s, stroke-width 0.18s" }}
                />
                {e.label && (
                  <g>
                    <rect
                      x={mx - String(e.label).length * 4.5}
                      y={my - 16}
                      width={String(e.label).length * 9}
                      height="16"
                      rx="4"
                      fill="#FFFFFF"
                      stroke={isActive ? accent.accent : "#E5E7EB"}
                      strokeWidth={isActive ? 1.2 : 0.8}
                      opacity={isActive ? 1 : 0.85}
                      style={{ transition: "stroke 0.18s, opacity 0.18s" }}
                    />
                    <text
                      x={mx} y={my - 4}
                      fill={isActive ? accent.fg : "#6B7280"}
                      fontSize="10.5" fontWeight="700" textAnchor="middle"
                      style={{ transition: "fill 0.18s", userSelect: "none" }}
                    >{e.label}</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((n, i) => {
            const pos = positions[n.id];
            if (!pos) return null;
            const isPrimary = n.primary;
            const isHovered = hovered === n.id;
            // 按 level + importance 决定节点大小：level 越高、importance 越核心 → 越大
            const levelR = isPrimary ? 48 : (n.level === 1 ? 36 : 28);
            const importanceBoost = n.importance === "core" ? 4 : n.importance === "detail" ? -4 : 0;
            const baseR = levelR + importanceBoost;
            const pulseR = baseR + 8;
            const label = String(n.name || n.id);
            // level 越外圈，文字越能容纳（细节节点允许更长标签，因为它们本来就是精确术语）
            const maxCharWidth = isPrimary ? 8 : n.level === 1 ? 7 : 9;
            const displayLabel = label.length > maxCharWidth ? label.slice(0, maxCharWidth) + "…" : label;
            // dimension 配色：非 primary 节点都按 dimension 着色，让维度分布一眼可见
            const palette = DIMENSION_PALETTE[n.dimension] || DIMENSION_PALETTE.related;
            const fillColor = isPrimary ? accent.accent : palette.fill;
            const strokeColor = isPrimary
              ? accent.fg
              : (isHovered ? palette.stroke : palette.stroke);
            const textColor = isPrimary ? "#FFFFFF" : palette.fg;
            return (
              <motion.g
                key={n.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 240, damping: 22, delay: 0.05 + i * 0.04 }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={pos.x} cy={pos.y} r={pulseR}
                  fill={isPrimary ? accent.bg : palette.fill}
                  opacity={isHovered ? 1 : 0.42}
                  style={{ transition: "opacity 0.18s" }}
                />
                <circle
                  cx={pos.x} cy={pos.y} r={baseR}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={isPrimary ? 2.5 : (isHovered ? 2.4 : 1.6)}
                  style={{ transition: "stroke 0.18s, stroke-width 0.18s" }}
                />
                <text
                  x={pos.x} y={pos.y + 4}
                  fill={textColor}
                  fontSize={isPrimary ? 13 : n.level === 1 ? 12 : 11}
                  fontWeight="800" textAnchor="middle"
                  style={{ userSelect: "none", letterSpacing: "-0.01em", pointerEvents: "none" }}
                >{displayLabel}</text>
              </motion.g>
            );
          })}
        </svg>
      </div>

      {/* Side info panel */}
      <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflow: "auto" }}>
        {/* 聚焦节点详情：名称 + 维度 + 层级 + LaTeX 公式（若有） + 描述 */}
        <div style={{ background: "#FFFFFF", borderRadius: 20, padding: 20, border: "1px solid #F3F4F6", boxShadow: "0 8px 24px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.12em", color: "#9CA3AF", textTransform: "uppercase" }}>{hovered ? "聚焦节点" : "中心概念"}</span>
            {nodeSelectedDesc?.dimension && (
              <span style={{
                marginLeft: "auto",
                fontSize: 10.5,
                fontWeight: 800,
                padding: "2px 8px",
                borderRadius: 999,
                background: (DIMENSION_PALETTE[nodeSelectedDesc.dimension] || DIMENSION_PALETTE.related).fill,
                color: (DIMENSION_PALETTE[nodeSelectedDesc.dimension] || DIMENSION_PALETTE.related).fg,
                border: `1px solid ${(DIMENSION_PALETTE[nodeSelectedDesc.dimension] || DIMENSION_PALETTE.related).stroke}33`,
              }}>{(DIMENSION_PALETTE[nodeSelectedDesc.dimension] || DIMENSION_PALETTE.related).label}</span>
            )}
          </div>
          <h3 style={{ margin: "4px 0 8px", fontSize: 17, fontWeight: 800, color: nodeSelectedDesc?.primary ? accent.fg : "#111827", letterSpacing: "-0.015em", lineHeight: 1.3 }}>
            {nodeSelectedDesc?.name || "—"}
          </h3>
          {Number.isFinite(nodeSelectedDesc?.level) && (
            <div style={{ fontSize: 10.5, color: "#9CA3AF", marginBottom: 8 }}>
              层级 Level {nodeSelectedDesc.level}{nodeSelectedDesc.level === 0 ? "（中心）" : nodeSelectedDesc.level === 1 ? "（主分支）" : "（细节/延伸）"}
            </div>
          )}
          {nodeSelectedDesc?.latex && (
            <div
              style={{
                margin: "8px 0",
                padding: "10px 12px",
                background: "#F9FAFB",
                borderRadius: 10,
                border: "1px solid #F3F4F6",
                overflowX: "auto",
                fontSize: 14,
              }}
              dangerouslySetInnerHTML={{ __html: renderKatex(nodeSelectedDesc.latex, { displayMode: true }) }}
            />
          )}
          {nodeSelectedDesc?.desc && (
            <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#374151", lineHeight: 1.6 }}>{nodeSelectedDesc.desc}</p>
          )}
        </div>

        {/* 丰度指标：一眼看出这张图画得够不够充实 */}
        <div style={{ background: "#FAFAFC", borderRadius: 18, padding: 16, border: "1px solid #F3F4F6" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: accent.accent }} />
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: "#6B7280", textTransform: "uppercase" }}>节点数</span>
            <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: nodes.length >= 8 ? "#16A34A" : nodes.length >= 5 ? "#111827" : "#DC2626" }}>{nodes.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#94A3B8" }} />
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: "#6B7280", textTransform: "uppercase" }}>连接数</span>
            <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: edges.length >= Math.max(nodes.length - 1, 4) ? "#16A34A" : "#111827" }}>{edges.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#A78BFA" }} />
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: "#6B7280", textTransform: "uppercase" }}>覆盖维度</span>
            <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: Object.keys(dimensionCount).length >= 4 ? "#16A34A" : "#111827" }}>{Object.keys(dimensionCount).length} / 7</span>
          </div>
        </div>

        {/* 维度图例：每个 dimension 一色，也展示本图覆盖了哪些维度 */}
        {Object.keys(dimensionCount).length > 0 && (
          <div style={{ background: "#FFFFFF", borderRadius: 18, padding: 14, border: "1px solid #F3F4F6" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: "#6B7280", textTransform: "uppercase", marginBottom: 8 }}>维度分布</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(DIMENSION_PALETTE).map(([key, pal]) => {
                const count = dimensionCount[key] || 0;
                if (count === 0) return null;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: pal.fill, border: `1px solid ${pal.stroke}` }} />
                    <span style={{ color: pal.fg, fontWeight: 700 }}>{pal.label}</span>
                    <span style={{ marginLeft: "auto", color: "#9CA3AF", fontWeight: 600 }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 11, color: "#9CA3AF", lineHeight: 1.55 }}>
          悬停任一节点可高亮其关联路径并展示对应公式。
        </p>
      </div>
    </div>
  );
}
