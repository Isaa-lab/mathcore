import { motion } from "framer-motion";
import katex from "katex";
import { useMathStore } from "../store/useMathStore";

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
const IconBarChart = ({ size = 14, color = "#4F46E5" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" rx="0.5" /><rect x="12" y="8" width="3" height="10" rx="0.5" /><rect x="17" y="4" width="3" height="14" rx="0.5" />
  </svg>
);
const IconMaximize = ({ size = 12, color = "#4F46E5" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

// ── LaTeX Pre-processor ────────────────────────────────────────────────────
function preprocessLaTeX(content) {
  if (!content) return "";
  let processed = String(content);
  processed = processed.replace(/\$\$\s*\n\s*\n+/g, "$$\n");
  processed = processed.replace(/\n\s*\n+\s*\$\$/g, "\n$$");
  processed = processed.replace(/\$\$[ \t]+/g, "$$");
  processed = processed.replace(/[ \t]+\$\$/g, "$$");
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

// ── SmartVizPreviewCard: lightweight in-bubble SVG preview + hover-to-fullscreen
// Architectural compromise: renders a *static/lightly-animated* SVG inside the bubble
// to satisfy the "AI appears to visualize" expectation without paying the cost of
// the full interactive engine. Clicking it opens the full-screen KnowledgePointPage.
function SmartVizPreviewCard({ title, onOpen }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={{ scale: 1.01, y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={springTransition}
      style={{
        marginTop: 16,
        marginBottom: 4,
        width: "100%",
        maxWidth: 320,
        borderRadius: 16,
        background: "#FFFFFF",
        border: "1px solid rgba(229,231,235,0.8)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
        overflow: "hidden",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        padding: 0,
        display: "block",
        position: "relative",
      }}
      className="mc-viz-preview-card"
      aria-label={`展开图谱：${title}`}
    >
      {/* Top preview area: lightweight SVG that traces a decaying wave */}
      <div style={{ height: 100, width: "100%", background: "#FAFAFC", borderBottom: "1px solid #F3F4F6", position: "relative", overflow: "hidden" }}>
        <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none" style={{ color: "#818CF8", opacity: 0.7, display: "block" }}>
          {/* Subtle grid */}
          <g stroke="#E5E7EB" strokeWidth="0.25" opacity="0.7">
            <line x1="0" y1="10" x2="100" y2="10" />
            <line x1="0" y1="20" x2="100" y2="20" />
            <line x1="0" y1="30" x2="100" y2="30" />
            <line x1="25" y1="0" x2="25" y2="40" />
            <line x1="50" y1="0" x2="50" y2="40" />
            <line x1="75" y1="0" x2="75" y2="40" />
          </g>
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.4, ease: "easeOut" }}
            d="M0 30 Q 25 28, 50 20 T 100 5"
            fill="transparent"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <motion.path
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.4, delay: 0.2, ease: "easeOut" }}
            d="M0 35 Q 30 34, 60 25 T 100 10"
            fill="transparent"
            stroke="currentColor"
            strokeWidth="0.8"
            strokeDasharray="3 2"
            strokeLinecap="round"
          />
        </svg>

        {/* Hover overlay */}
        <div className="mc-viz-preview-hover" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", transition: "background 0.25s" }}>
          <div className="mc-viz-preview-chip" style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(6px)", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", opacity: 0, transform: "translateY(6px)", transition: "opacity 0.22s, transform 0.22s" }}>
            <IconMaximize size={12} color="#4F46E5" />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#4F46E5", letterSpacing: "0.04em" }}>进入全屏交互实验室</span>
          </div>
        </div>
      </div>

      {/* Bottom info bar */}
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: "#FFFFFF" }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <IconBarChart size={14} color="#4F46E5" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <span style={{ color: "#111827", fontWeight: 700, fontSize: 12.5, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          <span style={{ color: "#6B7280", fontSize: 11, marginTop: 2, letterSpacing: "0.01em" }}>动态参数模型</span>
        </div>
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

// ── Block renderer ─────────────────────────────────────────────────────────
function renderMarkdown(text, context) {
  if (!text) return null;
  const cleaned = preprocessLaTeX(text);

  const varBlocks = [];
  const chartBlocks = [];
  let prepared = "";
  let i = 0;
  const src = cleaned;
  while (i < src.length) {
    const v = src.slice(i).match(/^\[VAR:([a-zA-Z_]\w*),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/);
    if (v) {
      varBlocks.push({ name: v[1], min: Number(v[2]), max: Number(v[3]) });
      prepared += `__VAR_${varBlocks.length - 1}__`;
      i += v[0].length;
      continue;
    }
    if (src.slice(i, i + 7) === "[CHART:") {
      let depth = 1, j = i + 7;
      while (j < src.length && depth > 0) {
        if (src[j] === "[") depth++;
        else if (src[j] === "]") depth--;
        j++;
      }
      chartBlocks.push(src.slice(i + 7, j - 1).trim());
      prepared += `__CHART_${chartBlocks.length - 1}__`;
      i = j;
    } else if (src.slice(i, i + 7) === "[CHART]") {
      chartBlocks.push(null);
      prepared += `__CHART_${chartBlocks.length - 1}__`;
      i += 7;
    } else {
      prepared += src[i];
      i++;
    }
  }
  prepared = prepared
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

    const chartOnly = t.match(/^__CHART_(\d+)__$/);
    if (chartOnly) {
      flushList();
      const cidx = Number(chartOnly[1]);
      const raw = chartBlocks[cidx];
      let title = "动态图表";
      if (raw) {
        try { const cfg = JSON.parse(raw); title = cfg.title || cfg.name || cfg.type || "动态图表"; } catch {}
      }
      blocks.push(
        <SmartVizPreviewCard
          key={`chart-${idx}`}
          title={title}
          onOpen={() => context?.onOpenChart?.(raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null)}
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

// ── AI Bubble (full-bleed, 13.5px) ─────────────────────────────────────────
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

// ── User Bubble (compact, 13.5px) ──────────────────────────────────────────
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
}) {
  const stream = messages || conversationHistory || [];
  const openLab = useMathStore((s) => s.openLab);
  const context = {
    renderChart,
    onOpenChart: (cfg) => {
      // Always launch the in-canvas full-screen Interactive Lab overlay
      openLab(cfg);
      // Allow caller to perform additional side-effects (e.g. analytics)
      if (onOpenChart) onOpenChart(cfg);
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
