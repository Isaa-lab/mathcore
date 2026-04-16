import { useMemo } from "react";
import katex from "katex";
import { useMathStore } from "../store/useMathStore";
import "katex/dist/katex.min.css";

const W = 400;
const H = 200;
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
        input[type=range] {
          -webkit-appearance: none;
          width: 100%;
          background: transparent;
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 6px;
          background: #E5E7EB;
          border-radius: 9999px;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #4F46E5;
          margin-top: -7px;
          box-shadow: 0 2px 6px rgba(79, 70, 229, 0.4);
          cursor: pointer;
          transition: transform 0.1s;
        }
        input[type=range]::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }
      `}</style>
      <div style={{ background: "#F9FAFB", borderRadius: 12, border: "1px solid #E5E7EB", marginBottom: 24, padding: 12 }}>
        <svg width="100%" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid meet">
          <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#D1D5DB" strokeWidth="1" />
          <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#D1D5DB" strokeWidth="1" />
          <path
            d={pathD}
            stroke="#4F46E5"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transition: "d 80ms linear" }}
          />
        </svg>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 10 }}>
            振幅 a
          </div>
          <input
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

        <div
          style={{ background: "#FFFFFF", padding: 16, borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.03)", textAlign: "center", fontSize: "1.25rem", fontFamily: "'KaTeX_Math', serif" }}
          dangerouslySetInnerHTML={{ __html: mathHtml }}
        />
      </div>
    </div>
  );
}

