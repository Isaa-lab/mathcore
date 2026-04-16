import { useMemo } from "react";
import { useMathStore } from "../store/useMathStore";

const W = 680;
const H = 320;
const PAD = 32;

export default function InteractiveMathChart() {
  const a = useMathStore((s) => s.interactiveParams.a ?? 1);

  const pathD = useMemo(() => {
    const points = [];
    const xMin = -Math.PI * 2;
    const xMax = Math.PI * 2;
    const yMaxAbs = Math.max(1, Math.abs(a) * 1.2);
    const toX = (x) => PAD + ((x - xMin) / (xMax - xMin)) * (W - PAD * 2);
    const toY = (y) => H / 2 - (y / yMaxAbs) * (H / 2 - PAD);

    for (let i = 0; i <= 180; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / 180;
      const y = a * Math.sin(x);
      points.push(`${i === 0 ? "M" : "L"} ${toX(x).toFixed(2)} ${toY(y).toFixed(2)}`);
    }
    return points.join(" ");
  }, [a]);

  return (
    <div className="premium-card" style={{ padding: 14, background: "#FCFCFF" }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#CBD5E1" strokeWidth="1" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#CBD5E1" strokeWidth="1" />
        <path
          d={pathD}
          fill="none"
          stroke="#4F46E5"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: "d 80ms linear" }}
        />
      </svg>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
        动态函数：y = {Number(a).toFixed(2)} * sin(x)
      </div>
    </div>
  );
}

