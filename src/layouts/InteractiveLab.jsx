import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
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
  parametric: { fg: "#4338CA", bg: "#EEF2FF", accent: "#6366F1", label: "参数可调模型", tag: "PARAMETRIC" },
  hierarchy:  { fg: "#1D4ED8", bg: "#EFF6FF", accent: "#3B82F6", label: "层级 · 树状拓扑", tag: "HIERARCHY" },
  process:    { fg: "#047857", bg: "#ECFDF5", accent: "#10B981", label: "流程 · 时序推演", tag: "PROCESS" },
  comparison: { fg: "#B45309", bg: "#FFFBEB", accent: "#F59E0B", label: "对比 · 并列分析", tag: "COMPARISON" },
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
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#111827", letterSpacing: "-0.015em" }}>{intent.title}</h1>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "#6B7280" }}>{intent.description || accent.label}</span>
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
        {intent.structure === "hierarchy" && <HierarchyStage intent={intent} accent={accent} />}
        {intent.structure === "process" && <ProcessStage intent={intent} accent={accent} />}
        {intent.structure === "comparison" && <ComparisonStage intent={intent} accent={accent} />}
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
function ProcessStage({ intent, accent }) {
  const steps = Array.isArray(intent?.data?.steps) && intent.data.steps.length > 0
    ? intent.data.steps
    : [{ title: "暂无步骤", desc: "AI 未提供步骤数据" }];
  const [active, setActive] = useState(0);

  return (
    <div style={{ flex: 1, padding: 32, display: "flex", gap: 28, minHeight: 0 }}>
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
                <div style={{ fontSize: 13.5, fontWeight: 800, color: isActive ? accent.fg : "#111827", letterSpacing: "-0.01em" }}>{step.title}</div>
                {step.desc && <div style={{ marginTop: 3, fontSize: 12, color: "#6B7280", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{step.desc}</div>}
              </div>
            </motion.button>
          );
        })}
      </div>

      <div style={{ flex: 1, background: "#FFFFFF", borderRadius: 28, padding: "40px 48px", border: "1px solid #F3F4F6", boxShadow: "0 15px 50px rgba(0,0,0,0.04)", overflowY: "auto" }}>
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
            <h2 style={{ margin: "0 0 14px", fontSize: 24, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em", lineHeight: 1.3 }}>{steps[active].title}</h2>
            <p style={{ margin: 0, fontSize: 14.5, color: "#374151", lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{steps[active].desc || "（无说明）"}</p>
            {steps[active].formula && (
              <div style={{ marginTop: 20, padding: "16px 20px", background: "#0F172A", borderRadius: 16, color: "#E0E7FF", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14 }}>
                {steps[active].formula}
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
