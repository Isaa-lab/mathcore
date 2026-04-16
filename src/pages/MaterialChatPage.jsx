import { motion } from "framer-motion";
import katex from "katex";
import { useMathStore } from "../store/useMathStore";

const springTransition = { type: "spring", stiffness: 300, damping: 25 };
const bubbleVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: springTransition },
};

// ── Inline SVG icons (Lucide-style) ────────────────────────────────────────
const IconSparkles = ({ size = 18, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    <path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>
  </svg>
);
const IconActivity = ({ size = 18, color = "#2563EB" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);
const IconChevron = ({ size = 16, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

// ── Inline variable slider (preserved from legacy spec) ────────────────────
function InlineVarSlider({ name, min, max }) {
  const value = useMathStore((s) => s.interactiveParams[name] ?? Number(min));
  const setInteractiveParam = useMathStore((s) => s.setInteractiveParam);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "2px 10px", borderRadius: 999, background: "#EEF2FF", verticalAlign: "middle", margin: "0 4px" }}>
      <span style={{ fontFamily: "'KaTeX_Math', serif", fontStyle: "italic", color: "#4F46E5", fontWeight: 700, fontSize: 13 }}>{name}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(e) => setInteractiveParam(name, Number(e.target.value))}
        aria-label={`动态调整数学参数 ${name}`}
        style={{ width: 120, accentColor: "#4F46E5", verticalAlign: "middle" }}
      />
      <span style={{ fontSize: 12, color: "#4F46E5", fontWeight: 700, minWidth: 32, textAlign: "right" }}>{Number(value).toFixed(1)}</span>
    </span>
  );
}

// ── Trigger Card (architectural compromise: no heavy charts inside bubbles) ─
function InteractiveTriggerCard({ title, onOpen }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={{ scale: 1.01, y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={springTransition}
      style={{
        marginTop: 20,
        width: "100%",
        padding: 16,
        borderRadius: 16,
        background: "#FAFAFC",
        border: "1px solid #E5E7EB",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "#C7D2FE"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(79,70,229,0.08)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#FAFAFC"; e.currentTarget.style.borderColor = "#E5E7EB"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 999, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563EB", flexShrink: 0 }}>
          <IconActivity size={18} color="#2563EB" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ color: "#111827", fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em" }}>开启沉浸式动态图谱</span>
          <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 500, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </div>
      </div>
      <div style={{ width: 32, height: 32, borderRadius: 999, background: "#fff", border: "1px solid #F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", flexShrink: 0 }}>
        <IconChevron size={14} color="#9CA3AF" />
      </div>
    </motion.button>
  );
}

// ── Inline renderer: bold, italic, code, math, [VAR] placeholders ──────────
function renderInline(text, keyPrefix = "") {
  if (text == null) return null;
  const str = String(text);
  const parts = str.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|__VAR_\d+__|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!part) return null;
    if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
      try {
        const html = katex.renderToString(part.slice(2, -2).trim(), { throwOnError: false, displayMode: true });
        return <span key={key} style={{ display: "block", overflowX: "auto", margin: "10px 0" }} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch { return <code key={key}>{part}</code>; }
    }
    if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
      try {
        const html = katex.renderToString(part.slice(1, -1).trim(), { throwOnError: false, displayMode: false });
        return <span key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      } catch { return <code key={key}>{part}</code>; }
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key} style={{ fontWeight: 800, color: "#111827", background: "rgba(79,70,229,0.08)", padding: "0 4px", borderRadius: 4 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key} style={{ fontStyle: "italic", color: "#4F46E5" }}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={key} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.9em", padding: "2px 6px", background: "#F3F4F6", borderRadius: 6, color: "#111827" }}>{part.slice(1, -1)}</code>;
    }
    const varMatch = part.match(/^__VAR_(\d+)__$/);
    if (varMatch) return <span key={key} data-var-slot={varMatch[1]} />;
    return <span key={key}>{part}</span>;
  });
}

// ── Block-level Markdown renderer ──────────────────────────────────────────
function renderMarkdown(text, context) {
  if (!text) return null;
  // Extract [VAR:...] and [CHART:...] into indexed placeholders first
  const varBlocks = [];
  const chartBlocks = [];
  let prepared = "";
  let i = 0;
  const src = String(text);
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
      chartBlocks.push(null); // legacy marker
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
    // walk children: replace spans with data-var-slot
    if (!Array.isArray(node)) return node;
    return node.map((el, idx) => {
      if (el && el.props && el.props["data-var-slot"] != null) {
        const vb = varBlocks[Number(el.props["data-var-slot"])];
        if (vb) return <InlineVarSlider key={`v-${idx}`} name={vb.name} min={vb.min} max={vb.max} />;
      }
      return el;
    });
  };

  const lines = prepared.split("\n");
  const blocks = [];
  let listBuffer = null;
  const flushList = () => {
    if (!listBuffer) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} style={{ margin: "8px 0 12px 4px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {listBuffer.map((item, idx) => (
          <li key={idx} style={{ display: "flex", alignItems: "flex-start", gap: 12, lineHeight: 1.75, color: "#1F2937" }}>
            <span style={{ flexShrink: 0, marginTop: 10, width: 6, height: 6, borderRadius: 999, background: "#818CF8" }} />
            <div style={{ flex: 1, minWidth: 0 }}>{replaceVars(renderInline(item, `li-${idx}`))}</div>
          </li>
        ))}
      </ul>
    );
    listBuffer = null;
  };
  const flushListIfNeeded = (isListLine) => { if (!isListLine) flushList(); };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trimEnd();
    const t = line.trim();

    // Chart placeholder on its own line → trigger card
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
        <InteractiveTriggerCard
          key={`chart-${idx}`}
          title={title}
          onOpen={() => context?.onOpenChart?.(raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null)}
        />
      );
      return;
    }

    if (!t) { flushList(); blocks.push(<div key={`sp-${idx}`} style={{ height: 8 }} />); return; }
    if (t.startsWith("### ")) {
      flushList();
      blocks.push(<h3 key={`h3-${idx}`} style={{ margin: "18px 0 10px", fontSize: 17, fontWeight: 800, color: "#111827", letterSpacing: "-0.01em" }}>{replaceVars(renderInline(t.slice(4), `h3-${idx}`))}</h3>);
      return;
    }
    if (t.startsWith("## ")) {
      flushList();
      blocks.push(<h2 key={`h2-${idx}`} style={{ margin: "22px 0 12px", fontSize: 19, fontWeight: 800, color: "#0F172A", paddingBottom: 8, borderBottom: "1px solid #F3F4F6", letterSpacing: "-0.02em" }}>{replaceVars(renderInline(t.slice(3), `h2-${idx}`))}</h2>);
      return;
    }
    if (t.startsWith("# ")) {
      flushList();
      blocks.push(<h1 key={`h1-${idx}`} style={{ margin: "24px 0 14px", fontSize: 22, fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em" }}>{replaceVars(renderInline(t.slice(2), `h1-${idx}`))}</h1>);
      return;
    }
    const ulM = t.match(/^[-*]\s+(.+)/);
    const olM = t.match(/^\d+\.\s+(.+)/);
    if (ulM || olM) {
      flushListIfNeeded(true);
      if (!listBuffer) listBuffer = [];
      listBuffer.push((ulM || olM)[1]);
      return;
    }
    flushList();
    blocks.push(
      <p key={`p-${idx}`} style={{ margin: "0 0 12px", lineHeight: 1.85, color: "#1F2937" }}>
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
    <motion.div variants={bubbleVariants} style={{ display: "flex", gap: 14, width: "100%", maxWidth: 820, margin: "0 auto 24px" }}>
      <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 14, background: "linear-gradient(135deg, #6366F1 0%, #A855F7 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(99,102,241,0.25)" }}>
        <IconSparkles />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          background: "#FFFFFF",
          borderRadius: 24,
          borderTopLeftRadius: 6,
          padding: "20px 24px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
          border: "1px solid #F3F4F6",
          fontSize: 15,
          color: "#111827",
          lineHeight: 1.75,
          letterSpacing: "0.005em",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        }}>
          {renderMarkdown(content, context)}
        </div>
      </div>
    </motion.div>
  );
}

// ── User Bubble ────────────────────────────────────────────────────────────
function UserBubble({ content }) {
  return (
    <motion.div variants={bubbleVariants} style={{ display: "flex", gap: 14, width: "100%", maxWidth: 820, margin: "0 auto 24px", justifyContent: "flex-end" }}>
      <div style={{
        background: "#111827",
        color: "#FFFFFF",
        borderRadius: 24,
        borderTopRightRadius: 6,
        padding: "14px 20px",
        boxShadow: "0 6px 20px rgba(17,24,39,0.12)",
        maxWidth: "78%",
        fontSize: 14,
        lineHeight: 1.7,
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
  const context = {
    renderChart,
    onOpenChart: (cfg) => {
      if (onOpenChart) { onOpenChart(cfg); return; }
      // Fallback: inline render if caller didn't provide portal handler
      if (renderChart) {
        // no-op: caller renders charts elsewhere
      }
    },
  };
  return (
    <div style={{ width: "100%", maxWidth: 820, margin: "0 auto", padding: "8px 4px 16px" }}>
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
