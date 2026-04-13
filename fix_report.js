const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// ── Find and replace the entire ReportPage function ──────────────────────────
const startMarker = 'function ReportPage({ setPage }) {';
const endMarker = '\n// \u2500\u2500 Upload Page';

const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker, startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.log('Markers not found:', startIdx, endIdx);
  process.exit(1);
}

console.log('Found ReportPage at:', startIdx, '-', endIdx);

// New enhanced ReportPage with radar chart, streak, and micro-wins
const newReportPage = String.raw`function ReportPage({ setPage }) {
  // Load real session answers from localStorage
  const savedAnswers = (() => {
    try { return JSON.parse(localStorage.getItem("mc_answers") || "{}"); } catch { return {}; }
  })();

  // Build stats from real data + fallback demo data
  const chapterStats = getChapterStats(savedAnswers);
  const hasRealData = Object.keys(chapterStats).length > 0;

  const demoStats = [
    { name: "Ch.1 方程求解", correct: 7, total: 10 },
    { name: "Ch.2 线性方程组", correct: 6, total: 10 },
    { name: "Ch.3 插值", correct: 4, total: 10 },
    { name: "Ch.4 最小二乘", correct: 3, total: 8 },
    { name: "Ch.5 数值微积分", correct: 5, total: 8 },
    { name: "最优化 Ch.1", correct: 5, total: 10 },
  ];

  const stats = hasRealData
    ? Object.entries(chapterStats).map(([name, s]) => ({ name, correct: s.correct, total: s.total }))
    : demoStats;

  const tc = stats.reduce((a, c) => a + c.correct, 0);
  const tq = stats.reduce((a, c) => a + c.total, 0);
  const pct = tq > 0 ? Math.round(tc / tq * 100) : 0;
  const weak = [...stats].sort((a, b) => (a.correct / a.total) - (b.correct / b.total)).slice(0, 3);
  const strong = [...stats].sort((a, b) => (b.correct / b.total) - (a.correct / a.total)).slice(0, 2);

  // Study streak from localStorage
  const streak = (() => {
    try {
      const data = JSON.parse(localStorage.getItem("mc_streak") || "{}");
      return data.days || 0;
    } catch { return 0; }
  })();

  // Level system based on accuracy
  const getLevel = (p) => {
    if (p >= 90) return { label: "大师级", emoji: "🏆", color: G.amber, desc: "超越了90%的同学！" };
    if (p >= 75) return { label: "熟练级", emoji: "⭐", color: G.teal, desc: "掌握扎实，继续保持！" };
    if (p >= 60) return { label: "进阶中", emoji: "📈", color: G.blue, desc: "你在快速进步！" };
    return { label: "学习中", emoji: "🌱", color: G.purple, desc: "每天一小步，坚持就是胜利！" };
  };
  const level = getLevel(pct);

  // SVG Radar Chart
  const radarData = stats.slice(0, 6).map(s => ({ label: s.name.split(" ")[0], value: s.correct / s.total }));
  const N = radarData.length;
  const cx = 120, cy = 120, R = 90;
  const angleStep = (2 * Math.PI) / N;
  const toXY = (i, r) => ({
    x: cx + r * Math.sin(i * angleStep),
    y: cy - r * Math.cos(i * angleStep),
  });
  const radarPoints = radarData.map((d, i) => toXY(i, d.value * R));
  const radarPath = radarPoints.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ") + " Z";
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div style={{ padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <Btn size="sm" onClick={() => setPage("首页")}>← 返回</Btn>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>📊 学习报告</div>
        {!hasRealData && <span style={{ fontSize: 12, background: G.amberLight, color: G.amber, padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>演示数据 — 完成题库练习后将显示真实数据</span>}
        <div style={{ marginLeft: "auto" }}>
          <Btn size="sm" onClick={() => { if (window.confirm("确定重置本地答题记录？")) { localStorage.removeItem("mc_answers"); window.location.reload(); } }}>重置记录</Btn>
        </div>
      </div>

      {/* 顶部：级别徽章 + 连打卡 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 24 }}>
        <div style={{ gridColumn: "1 / 3", background: `linear-gradient(135deg, ${level.color}22, ${level.color}11)`, borderRadius: 16, padding: "20px 24px", border: `1.5px solid ${level.color}44`, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 48 }}>{level.emoji}</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: level.color, letterSpacing: "0.1em", marginBottom: 4 }}>当前熟练度</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: level.color, lineHeight: 1 }}>{level.label}</div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{level.desc}</div>
          </div>
        </div>
        <StatCard icon="🎯" label="总体正确率" value={`${pct}%`} sub={`${tc}/${tq} 题`} color={pct >= 80 ? G.teal : pct >= 60 ? G.amber : G.red} />
        <div style={{ background: streak >= 3 ? "linear-gradient(135deg,#fef3c7,#fde68a)" : "#f8fafc", borderRadius: 16, padding: "18px 20px", border: `1.5px solid ${streak >= 3 ? "#fcd34d" : "#eee"}`, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 4 }}>{streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "📅"}</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: streak >= 3 ? G.amber : "#999" }}>{streak}</div>
          <div style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>天连续学习</div>
          {streak === 0 && <div style={{ fontSize: 11, color: "#bbb", marginTop: 4 }}>今天开始打卡吧！</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* 雷达图 */}
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>📡 能力雷达图</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="240" height="240" viewBox="0 0 240 240">
              {/* Grid circles */}
              {gridLevels.map((lv, gi) => (
                <polygon key={gi}
                  points={Array.from({ length: N }, (_, i) => { const p = toXY(i, lv * R); return `${p.x},${p.y}`; }).join(" ")}
                  fill="none" stroke="#e5e7eb" strokeWidth="1"
                />
              ))}
              {/* Axes */}
              {radarData.map((_, i) => {
                const outer = toXY(i, R);
                return <line key={i} x1={cx} y1={cy} x2={outer.x} y2={outer.y} stroke="#e5e7eb" strokeWidth="1" />;
              })}
              {/* Data polygon */}
              <path d={radarPath} fill={G.teal + "44"} stroke={G.teal} strokeWidth="2" />
              {/* Data points */}
              {radarPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="4" fill={G.teal} />
              ))}
              {/* Labels */}
              {radarData.map((d, i) => {
                const p = toXY(i, R + 18);
                return <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#555" fontFamily="system-ui">{d.label}</text>;
              })}
            </svg>
            <div style={{ flex: 1 }}>
              {radarData.map((d, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: "#555" }}>{d.label}</span>
                    <span style={{ fontWeight: 700, color: d.value >= 0.8 ? G.teal : d.value >= 0.6 ? G.amber : G.red }}>{Math.round(d.value * 100)}%</span>
                  </div>
                  <ProgressBar value={d.value * 100} max={100} color={d.value >= 0.8 ? G.teal : d.value >= 0.6 ? G.amber : G.red} height={5} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 各章节进度 */}
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>📚 章节掌握度</div>
          {stats.map((c, i) => {
            const p = Math.round(c.correct / c.total * 100);
            const col = p >= 80 ? G.teal : p >= 60 ? G.amber : G.red;
            const badge = p >= 80 ? "✅ 已掌握" : p >= 60 ? "📈 进步中" : "⚠️ 需加强";
            return (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 13, color: "#333", fontWeight: 500 }}>{c.name}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: col, fontWeight: 600 }}>{badge}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: col }}>{p}%</span>
                  </div>
                </div>
                <ProgressBar value={c.correct} max={c.total} color={col} height={7} />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* 薄弱章节 + 建议 */}
        <div style={{ ...s.card }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>⚠️ 薄弱章节（优先复习）</div>
          {weak.map((c, i) => {
            const p = Math.round(c.correct / c.total * 100);
            const tips = [
              "建议：先复习知识点再刷题",
              "建议：重点看例题解题思路",
              "建议：多做计算练习题",
            ];
            return (
              <div key={i} style={{ padding: "12px 0", borderBottom: i < weak.length-1 ? "1px solid #f5f5f5" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "#333", fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{tips[i] || tips[0]}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Badge color="red">{p}%</Badge>
                    <Btn size="sm" onClick={() => setPage("题库练习")}>练习</Btn>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 14, padding: "12px 14px", background: G.amberLight, borderRadius: 10, fontSize: 13, color: "#92400e", lineHeight: 1.7 }}>
            💡 <strong>个性化建议：</strong>从正确率最低的 <strong>{weak[0]?.name.split(" ")[0]}</strong> 开始复习，先看知识点卡片，再做 5 题巩固，效果最好！
          </div>
        </div>

        {/* 优势章节 + 激励 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...s.card }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>🌟 优势章节</div>
            {strong.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < strong.length-1 ? "1px solid #f5f5f5" : "none" }}>
                <span style={{ fontSize: 14, color: "#333", fontWeight: 500 }}>{c.name}</span>
                <Badge color="teal">{Math.round(c.correct / c.total * 100)}% 🎉</Badge>
              </div>
            ))}
            <div style={{ marginTop: 14, padding: "12px 14px", background: G.tealLight, borderRadius: 10, fontSize: 13, color: "#065f46", lineHeight: 1.7 }}>
              🎊 太棒了！你的 <strong>{strong[0]?.name.split(" ")[0]}</strong> 已达到优秀水平，超越了同期大部分学习者！
            </div>
          </div>

          <div style={{ ...s.card }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>🗓️ 学习计划</div>
            {[
              { day: "今天", task: `复习 ${weak[0]?.name.split(" ")[0] || "薄弱章节"}`, type: "urgent", icon: "🔥" },
              { day: "明天", task: "完成 10 道练习题", type: "normal", icon: "✏️" },
              { day: "后天", task: "记忆卡片复习", type: "normal", icon: "🃏" },
            ].map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < 2 ? "1px solid #f5f5f5" : "none", alignItems: "center" }}>
                <div style={{ fontSize: 18, flexShrink: 0 }}>{a.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>{a.day}</div>
                  <div style={{ fontSize: 14, color: "#333", fontWeight: 500 }}>{a.task}</div>
                </div>
                {a.type === "urgent" && <Badge color="red">优先</Badge>}
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Btn variant="primary" onClick={() => setPage("题库练习")} style={{ flex: 1 }}>开始今日练习</Btn>
              <Btn onClick={() => setPage("知识点")} style={{ flex: 1 }}>查看知识点</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
`;

src = src.slice(0, startIdx) + newReportPage + src.slice(endIdx + 1);
fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ ReportPage rewritten');
console.log('File size:', src.length);
