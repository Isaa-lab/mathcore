// 通用 AI 抽取进度条 + 合成进度 hook
//
// 设计要点：
//   - 多步骤已知进度（chunk N/M、bulk i/total）：直接传 pct={x}
//   - 单步骤未知进度（OCR / topic-detail 等单次 API 调用）：用 useSyntheticProgress
//     根据预期耗时做渐近曲线（pct = 95 * (1 - e^(-t/τ))），running 变 false 时跳 100% 然后淡出
//   - 颜色：默认紫色（与 KP "AI 抽取" 主色一致）；done 自动换绿色
//
// 用法：
//   const pct = useSyntheticProgress(loading, 12000);
//   <AIProgressBar label="AI 识别题目中…" pct={pct} />
//
//   或已知进度：
//   <AIProgressBar label={`抽取 ${done}/${total}`} pct={(done/total)*100} />

import { useState, useEffect, useRef } from "react";

export function useSyntheticProgress(running, expectedMs = 12000) {
  const [pct, setPct] = useState(0);
  const startRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!running) {
      // 跑完了：跳 100% 闪一下，然后回归 0
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (pct > 0 && pct < 100) {
        setPct(100);
        const t = setTimeout(() => setPct(0), 700);
        return () => clearTimeout(t);
      }
      return;
    }
    // 开跑
    setPct(0);
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      // 渐近到 95%：tau 是时间常数（≈ expectedMs * 0.6 → 在预期时间点达到 ~80%）
      const tau = Math.max(2000, expectedMs * 0.6);
      const target = 95 * (1 - Math.exp(-elapsed / tau));
      setPct((prev) => Math.max(prev, Math.min(94, target)));
    }, 180);
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, expectedMs]);

  return pct;
}

export default function AIProgressBar({
  label = "AI 处理中…",
  pct = 0,
  color = "#7C3AED",
  state, // "running" | "done" | "error" | undefined（自动从 pct 推断）
  compact = false,
}) {
  const safe = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const inferredState = state || (safe >= 100 ? "done" : "running");
  const barColor = inferredState === "done" ? "#10B981"
                : inferredState === "error" ? "#EF4444"
                : color;
  return (
    <div style={{ width: "100%", padding: compact ? "4px 0" : "6px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: compact ? 3 : 5, gap: 8 }}>
        <span style={{ fontSize: compact ? 11 : 11.5, color: "#475569", lineHeight: 1.3, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{
          fontSize: compact ? 10.5 : 11, fontWeight: 800, color: barColor,
          fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        }}>
          {safe}%
        </span>
      </div>
      <div style={{ height: compact ? 4 : 6, background: "#F3F4F6", borderRadius: 999, overflow: "hidden", position: "relative" }}>
        <div style={{
          width: `${safe}%`, height: "100%",
          background: inferredState === "running"
            ? `linear-gradient(90deg, ${barColor} 0%, ${barColor}cc 50%, ${barColor} 100%)`
            : barColor,
          backgroundSize: inferredState === "running" ? "200% 100%" : "100% 100%",
          animation: inferredState === "running" ? "mc-progress-shine 1.8s linear infinite" : "none",
          borderRadius: 999,
          transition: "width 0.35s ease, background 0.3s",
        }} />
      </div>
      <style>{`
        @keyframes mc-progress-shine {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
