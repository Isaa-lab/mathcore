import { motion } from "framer-motion";
import { useMathStore } from "../store/useMathStore";

const springTransition = { type: "spring", stiffness: 260, damping: 25 };

function InlineVarSlider({ name, min, max }) {
  const value = useMathStore((s) => s.interactiveParams[name] ?? Number(min));
  const setInteractiveParam = useMathStore((s) => s.setInteractiveParam);

  return (
    <input
      type="range"
      className="inline-slider"
      min={min}
      max={max}
      value={value}
      onChange={(e) => setInteractiveParam(name, Number(e.target.value))}
      aria-label={`动态调整数学参数 ${name}`}
      style={{ width: 180, verticalAlign: "middle" }}
    />
  );
}

function ParsedFlowBlock({ text, renderChart }) {
  const tokens = String(text || "").split(/(\[VAR:[^\]]+\]|\[CHART\])/g);
  return (
    <>
      {tokens.map((token, idx) => {
        const varMatch = token.match(/^\[VAR:([a-zA-Z_]\w*),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]$/);
        if (varMatch) {
          const [, name, min, max] = varMatch;
          return <InlineVarSlider key={idx} name={name} min={Number(min)} max={Number(max)} />;
        }
        if (token === "[CHART]") {
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={springTransition}
              style={{ margin: "10px 0" }}
            >
              {renderChart?.()}
            </motion.div>
          );
        }
        return token ? <span key={idx}>{token}</span> : null;
      })}
    </>
  );
}

export default function MaterialChatPage({
  messages,
  conversationHistory,
  currentMaterial,
  renderChart,
}) {
  const stream = messages || conversationHistory || [];
  return (
    <div style={{ maxWidth: 768, margin: "0 auto", padding: "8px 12px 24px" }}>
      {currentMaterial?.title && (
        <div style={{ marginBottom: 16, fontSize: 12, color: "var(--text-secondary)" }}>
          当前资料：{currentMaterial.title}
        </div>
      )}
      {stream.map((msg, i) =>
        msg.role === "user" ? (
          <div
            key={i}
            style={{
              textAlign: "right",
              marginBottom: 32,
              fontWeight: 500,
              color: "var(--text-primary)",
            }}
          >
            <ParsedFlowBlock text={msg.text} renderChart={renderChart} />
          </div>
        ) : (
          <div
            key={i}
            style={{
              textAlign: "left",
              marginBottom: 32,
              paddingLeft: 16,
              borderLeft: "2px solid transparent",
              borderImage: "var(--ai-glow) 1",
              color: "var(--text-primary)",
            }}
          >
            <ParsedFlowBlock text={msg.text} renderChart={renderChart} />
          </div>
        )
      )}
    </div>
  );
}

