const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// ── 1. Add aiDrillMode state ──
const old1 = `  const [aiWrongQs, setAiWrongQs] = useState([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenMsg, setRegenMsg] = useState("");
  const mergedWrong = [...WRONG_QS, ...aiWrongQs]`;

const new1 = `  const [aiWrongQs, setAiWrongQs] = useState([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenMsg, setRegenMsg] = useState("");
  const [aiDrillMode, setAiDrillMode] = useState(false);
  const mergedWrong = [...WRONG_QS, ...aiWrongQs]`;

if (src.includes(old1)) {
  src = src.replace(old1, new1);
  console.log('✓ aiDrillMode state added');
} else { console.log('NOT FOUND: state'); }

// ── 2. Fix drillMode return to add aiDrillMode ──
const idx = src.indexOf('if (drillMode) return (');
if (idx !== -1) {
  // Find end of this if block
  const closeSearch = src.indexOf(');\n', idx);
  if (closeSearch !== -1) {
    const blockEnd = closeSearch + 3;
    const addBlock = `  if (aiDrillMode && aiWrongQs.length > 0) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <Btn onClick={() => setAiDrillMode(false)}>← 返回错题本</Btn>
        <span style={{ fontSize: 16, fontWeight: 700, color: G.blue }}>🤖 AI 变式题专项练习</span>
      </div>
      <WrongDrill questions={aiWrongQs} onExit={() => setAiDrillMode(false)} onMastered={() => {}} />
    </div>
  );
`;
    src = src.slice(0, blockEnd) + addBlock + src.slice(blockEnd);
    console.log('✓ AI drill mode return added at:', blockEnd);
  }
}

// ── 3. Add AI variant practice panel after regenMsg div ──
const old3 = `{regenMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{regenMsg}</div>}`;
const new3 = `{regenMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{regenMsg}</div>}
        {aiWrongQs.length > 0 && (
          <div style={{ marginBottom: 14, padding: "14px 16px", background: "linear-gradient(135deg,#eff6ff,#dbeafe)", borderRadius: 12, border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, color: G.blue, fontSize: 14, marginBottom: 2 }}>🤖 AI 变式题已就绪 — {aiWrongQs.length} 道</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>针对薄弱章节量身定制，点击右侧开始专项练习</div>
            </div>
            <button onClick={() => setAiDrillMode(true)} style={{ padding: "10px 20px", background: G.blue, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap" }}>🎯 专项练习</button>
          </div>
        )}`;

if (src.includes(old3)) {
  src = src.replace(old3, new3);
  console.log('✓ AI variant panel added');
} else { console.log('NOT FOUND: regenMsg div'); }

fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ File written');
