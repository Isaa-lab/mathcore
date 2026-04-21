import { useMemo, useState } from "react";
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

// ── Function library: each preset describes title, formula, evaluator, ranges
function buildPreset(config) {
  const title = config?.title || "常微分方程可视化";
  const subtitle = config?.subtitle || "解的族群分析：积分常数 C 的影响";
  const equation = config?.equation || "dy/dx + 2y = 3";
  const generalForm = config?.generalForm || "y(x) = C·e⁻²ˣ + 1.5";
  // y = C * e^(-k*x) + steady, defaults reproduce the prompt's example
  const k = Number(config?.k ?? 2);
  const steady = Number(config?.steady ?? 1.5);
  const xMin = Number(config?.xMin ?? 0);
  const xMax = Number(config?.xMax ?? 5);
  const yMin = Number(config?.yMin ?? -2);
  const yMax = Number(config?.yMax ?? 4);
  const cMin = Number(config?.cMin ?? -3);
  const cMax = Number(config?.cMax ?? 3);
  const cInit = Number(config?.cInit ?? 1);
  const f = (x, c) => c * Math.exp(-k * x) + steady;
  return { title, subtitle, equation, generalForm, k, steady, xMin, xMax, yMin, yMax, cMin, cMax, cInit, f };
}

export default function InteractiveLab() {
  const labOpen = useMathStore((s) => s.labOpen);
  const labConfig = useMathStore((s) => s.labConfig);
  const closeLab = useMathStore((s) => s.closeLab);

  return (
    <AnimatePresence>
      {labOpen && <InteractiveLabPanel key="lab" config={labConfig} onClose={closeLab} />}
    </AnimatePresence>
  );
}

function InteractiveLabPanel({ config, onClose }) {
  const preset = useMemo(() => buildPreset(config), [config]);
  const [c, setC] = useState(preset.cInit);

  // SVG canvas dimensions
  const W = 800;
  const H = 400;
  const xToSvg = (x) => ((x - preset.xMin) / (preset.xMax - preset.xMin)) * W;
  const yToSvg = (y) => H - ((y - preset.yMin) / (preset.yMax - preset.yMin)) * H;

  // Trace the active solution
  const pathData = useMemo(() => {
    let d = "";
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const x = preset.xMin + (i / steps) * (preset.xMax - preset.xMin);
      const y = preset.f(x, c);
      const sx = xToSvg(x);
      const sy = yToSvg(y);
      d += i === 0 ? `M ${sx.toFixed(2)} ${sy.toFixed(2)} ` : `L ${sx.toFixed(2)} ${sy.toFixed(2)} `;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, preset]);

  // Ghost family curves (other C values, faint)
  const ghostCs = useMemo(() => {
    const out = [];
    const span = preset.cMax - preset.cMin;
    for (let g = 0; g <= 6; g++) {
      const cv = preset.cMin + (g / 6) * span;
      let d = "";
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        const x = preset.xMin + (i / steps) * (preset.xMax - preset.xMin);
        const y = preset.f(x, cv);
        const sx = xToSvg(x);
        const sy = yToSvg(y);
        d += i === 0 ? `M ${sx.toFixed(2)} ${sy.toFixed(2)} ` : `L ${sx.toFixed(2)} ${sy.toFixed(2)} `;
      }
      out.push(d);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const initX = preset.xMin;
  const initY = preset.f(initX, c);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.985 }}
      transition={pageTransition}
      style={{
        position: "absolute",
        inset: 0,
        background: "#FAFAFC",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 24,
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
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#111827", letterSpacing: "-0.015em" }}>{preset.title}</h1>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "#6B7280" }}>{preset.subtitle}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: "#EEF2FF", borderRadius: 999 }}>
          <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} style={{ width: 6, height: 6, borderRadius: 999, background: "#4F46E5" }} />
          <IconActivity size={13} color="#4F46E5" />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#4F46E5", letterSpacing: "0.04em" }}>LIVE SIMULATION</span>
        </div>
      </header>

      {/* Workspace */}
      <div style={{ flex: 1, padding: 28, display: "flex", gap: 24, minHeight: 0 }}>
        {/* Left: control deck */}
        <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#FFFFFF", borderRadius: 24, padding: 24, border: "1px solid #F3F4F6", boxShadow: "0 10px 40px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <IconSettings size={16} color="#111827" />
              <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: "#111827", letterSpacing: "-0.01em" }}>参数控制台</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>积分常数 (C)</label>
                <span style={{ background: "#EEF2FF", color: "#4F46E5", padding: "4px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minWidth: 56, textAlign: "center" }}>
                  {c.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={preset.cMin}
                max={preset.cMax}
                step={0.05}
                value={c}
                onChange={(e) => setC(parseFloat(e.target.value))}
                aria-label="积分常数 C"
                style={{ width: "100%", height: 4, accentColor: "#4F46E5", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9CA3AF", marginTop: -4 }}>
                <span>{preset.cMin.toFixed(1)}</span>
                <span>{((preset.cMin + preset.cMax) / 2).toFixed(1)}</span>
                <span>{preset.cMax.toFixed(1)}</span>
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 12, color: "#6B7280", lineHeight: 1.6, letterSpacing: "0.01em" }}>
                拖动滑块观察常数 C 如何改变解的初始位置与演化轨迹。所有曲线最终渐进于稳态 y = {preset.steady}。
              </p>
            </div>
          </div>

          <div style={{ background: "#0F172A", borderRadius: 24, padding: 22, boxShadow: "0 18px 40px rgba(15,23,42,0.18)" }}>
            <h3 style={{ margin: "0 0 10px", color: "#94A3B8", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>当前系统方程</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#FFFFFF", fontSize: 14 }}>
              <span>{preset.equation}</span>
              <div style={{ height: 1, width: "100%", background: "rgba(148,163,184,0.2)", margin: "4px 0" }} />
              <span style={{ color: "#A5B4FC" }}>y(x) = {c.toFixed(2)}·e⁻{preset.k}ˣ + {preset.steady}</span>
            </div>
            <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(99,102,241,0.12)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10.5, color: "#94A3B8", letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase" }}>初始条件</span>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#E0E7FF", fontSize: 12.5 }}>y({initX}) = {initY.toFixed(3)}</span>
            </div>
          </div>

          <div style={{ flex: 1, background: "#FFFFFF", borderRadius: 24, padding: 22, border: "1px solid #F3F4F6", boxShadow: "0 10px 40px rgba(0,0,0,0.04)" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 800, color: "#9CA3AF", letterSpacing: "0.12em", textTransform: "uppercase" }}>图例</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Legend dot="#6366F1" label="当前解曲线" />
              <Legend dash dot="#A5B4FC" label="解的族群（不同 C）" />
              <Legend dash dot="#94A3B8" label={`稳态线 y = ${preset.steady}`} />
            </div>
          </div>
        </div>

        {/* Right: vector canvas */}
        <div style={{ flex: 1, background: "#FFFFFF", borderRadius: 32, padding: 28, border: "1px solid #F3F4F6", boxShadow: "0 15px 50px rgba(0,0,0,0.05)", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Dot grid background */}
          <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: "radial-gradient(#111827 1.4px, transparent 1.4px)", backgroundSize: "30px 30px", pointerEvents: "none" }} />

          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible", maxHeight: 600, position: "relative", zIndex: 1 }}>
            <defs>
              <filter id="curveGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Grid */}
            <g stroke="#E5E7EB" strokeWidth="1" opacity="0.6">
              {[1, 2, 3, 4].map((i) => (
                <line key={`v-${i}`} x1={(i / 5) * W} y1="0" x2={(i / 5) * W} y2={H} strokeDasharray="3 4" />
              ))}
              {[1, 2, 3, 4, 5].map((i) => (
                <line key={`h-${i}`} x1="0" y1={(i / 6) * H} x2={W} y2={(i / 6) * H} strokeDasharray="3 4" />
              ))}
            </g>

            {/* X axis (y = 0) */}
            <line x1="0" y1={yToSvg(0)} x2={W} y2={yToSvg(0)} stroke="#9CA3AF" strokeWidth="1.5" />
            {/* Y axis (x = 0) */}
            <line x1={xToSvg(preset.xMin)} y1="0" x2={xToSvg(preset.xMin)} y2={H} stroke="#9CA3AF" strokeWidth="1.5" />
            {/* Steady-state line */}
            <line x1="0" y1={yToSvg(preset.steady)} x2={W} y2={yToSvg(preset.steady)} stroke="#818CF8" strokeWidth="1.5" strokeDasharray="6 5" opacity="0.55" />
            <text x={W - 8} y={yToSvg(preset.steady) - 8} fill="#6366F1" fontSize="11" fontWeight="700" textAnchor="end" letterSpacing="0.05em">y = {preset.steady}</text>

            {/* Ghost family */}
            {ghostCs.map((d, i) => (
              <path key={`gh-${i}`} d={d} fill="none" stroke="#A5B4FC" strokeWidth="1.2" opacity="0.35" strokeLinecap="round" />
            ))}

            {/* Active solution */}
            <motion.path
              d={pathData}
              fill="none"
              stroke="#6366F1"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#curveGlow)"
              animate={{ d: pathData }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
            />

            {/* Initial point */}
            <motion.circle
              cx={xToSvg(initX)}
              cy={yToSvg(initY)}
              r="7"
              fill="#FFFFFF"
              stroke="#111827"
              strokeWidth="2.5"
              animate={{ cy: yToSvg(initY) }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
            />
            <motion.circle
              cx={xToSvg(initX)}
              cy={yToSvg(initY)}
              r="3"
              fill="#111827"
              animate={{ cy: yToSvg(initY) }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
            />

            {/* Axis labels */}
            <text x={W - 6} y={yToSvg(0) - 8} fill="#6B7280" fontSize="11" fontWeight="700" textAnchor="end">x</text>
            <text x={xToSvg(preset.xMin) + 8} y="14" fill="#6B7280" fontSize="11" fontWeight="700">y</text>
          </svg>
        </div>
      </div>
    </motion.div>
  );
}

function Legend({ dot, label, dash }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 24, display: "flex", justifyContent: "center" }}>
        {dash ? (
          <div style={{ width: 22, height: 0, borderTop: `2px dashed ${dot}` }} />
        ) : (
          <div style={{ width: 22, height: 3, borderRadius: 2, background: dot }} />
        )}
      </div>
      <span style={{ fontSize: 12.5, color: "#374151", fontWeight: 500 }}>{label}</span>
    </div>
  );
}
