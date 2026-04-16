import { useMemo } from "react";
import katex from "katex";
import { useMathStore } from "../store/useMathStore";
import "katex/dist/katex.min.css";

const W = 720;
const H = 300;
const PAD = 32;

export default function InteractiveVisualizer() {
  const a = useMathStore((s) => s.interactiveParams.a ?? 1);
  const setInteractiveParam = useMathStore((s) => s.setInteractiveParam);

  const mathString = `f(x) = ${a.toFixed(1)} \\cdot \\sin(x)`;
  const mathHtml = useMemo(
    () => katex.renderToString(mathString, { throwOnError: false, displayMode: true }),
    [mathString]
  );

  const pathD = useMemo(() => {
    const points = [];
    const xMin = -Math.PI * 2;
    const xMax = Math.PI * 2;
    const ySpan = Math.max(1.5, Math.abs(a) + 0.8);
    const toX = (x) => PAD + ((x - xMin) / (xMax - xMin)) * (W - PAD * 2);
    const toY = (y) => H / 2 - (y / ySpan) * (H / 2 - PAD);

    for (let i = 0; i <= 240; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / 240;
      const y = a * Math.sin(x);
      points.push(`${i === 0 ? "M" : "L"} ${toX(x).toFixed(2)} ${toY(y).toFixed(2)}`);
    }
    return points.join(" ");
  }, [a]);

  return (
    <div className="premium-card" style={{ padding: 20 }}>
      <style>{`
        .math-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 9999px;
          background: #E5E7EB;
          outline: none;
        }
        .math-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #4F46E5;
          border: 0;
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.28);
          cursor: pointer;
        }
        .math-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #4F46E5;
          border: 0;
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.28);
          cursor: pointer;
        }
      `}</style>
      <div style={{ height: 300, marginBottom: 18 }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#E5E7EB" strokeWidth="1" />
          <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#E5E7EB" strokeWidth="1" />
          <path
            d={pathD}
            stroke="#4F46E5"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            style={{ transition: "d 80ms linear" }}
          />
        </svg>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <div
          style={{ color: "#111827", minHeight: 48 }}
          dangerouslySetInnerHTML={{ __html: mathHtml }}
        />

        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 10 }}>
            振幅 a
          </div>
          <input
            className="math-slider"
            type="range"
            min="1"
            max="10"
            step="0.1"
            value={a}
            onChange={(e) => setInteractiveParam("a", Number(e.target.value))}
            aria-label="拖动以改变振幅 a，观察曲线形变"
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

