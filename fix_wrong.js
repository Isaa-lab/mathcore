const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// ── 1. Fix WrongPage: add aiDrillMode state and AI variant practice section ──
const OLD_WRONG_STATES = `  const [aiWrongQs, setAiWrongQs] = useState([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenMsg, setRegenMsg] = useState("");
  const mergedWrong = [...WRONG_QS, ...aiWrongQs];
  const remaining = mergedWrong.filter(q => !mastered.has(q.id || q.question));`;

const NEW_WRONG_STATES = `  const [aiWrongQs, setAiWrongQs] = useState([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenMsg, setRegenMsg] = useState("");
  const [aiDrillMode, setAiDrillMode] = useState(false);
  const mergedWrong = [...WRONG_QS, ...aiWrongQs];
  const remaining = mergedWrong.filter(q => !mastered.has(q.id || q.question));`;

if (src.includes(OLD_WRONG_STATES)) {
  src = src.replace(OLD_WRONG_STATES, NEW_WRONG_STATES);
  console.log('✓ aiDrillMode state added');
} else { console.log('✗ state NOT found'); }

// ── 2. Fix drillMode check to handle aiDrillMode ──
const OLD_DRILL_RETURN = `  if (drillMode) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <WrongDrill questions={remaining.slice(drillStart)} onExit={() => setDrillMode(false)} onMastered={id => setMastered(s => new Set([...s, id]))} />
    </div>
  );`;

const NEW_DRILL_RETURN = `  if (drillMode) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <WrongDrill questions={remaining.slice(drillStart)} onExit={() => setDrillMode(false)} onMastered={id => setMastered(s => new Set([...s, id]))} />
    </div>
  );
  if (aiDrillMode && aiWrongQs.length > 0) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <Btn onClick={() => setAiDrillMode(false)}>← 返回错题本</Btn>
        <span style={{ marginLeft: 12, fontSize: 16, fontWeight: 700, color: G.blue }}>🤖 AI 变式题专项练习</span>
      </div>
      <WrongDrill questions={aiWrongQs} onExit={() => setAiDrillMode(false)} onMastered={() => {}} />
    </div>
  );`;

if (src.includes(OLD_DRILL_RETURN)) {
  src = src.replace(OLD_DRILL_RETURN, NEW_DRILL_RETURN);
  console.log('✓ AI drill mode added');
} else { console.log('✗ drillMode return NOT found'); }

// ── 3. Fix regenerateWrongQuestions to use weak chapters better ──
const OLD_REGEN = `  const regenerateWrongQuestions = async () => {
    setRegenLoading(true);
    setRegenMsg("");
    try {
      const chapter = weakChapters[0]?.[0] || "综合";
      const aiCfg = getAIConfig();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter, type: "单选题", count: 5,
          userProvider: aiCfg.provider, userKey: aiCfg.key, userCustomUrl: aiCfg.customUrl,
        }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const rows = (data.questions || []).map((q, idx) => ({
        id: "ai_wrong_" + Date.now() + "_" + idx,
        chapter,
        type: "单选题",
        question: q.question,
        options: q.options || null,
        answer: q.answer,
        explanation: q.explanation || "",
      }));
      setAiWrongQs(rows);
      setRegenMsg(\`已生成 \${rows.length} 道变式题，可立即重练。\`);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (uid) {
          await supabase.from("questions") /* wrong_drill_logs stub */.insert(rows.map((q) => ({
            user_id: uid,
            chapter: q.chapter,
            question: q.question,
            correct_answer: q.answer,
            explanation: q.explanation,
          })));
        }
      } catch (e) {}
    } catch (err) {
      setRegenMsg("生成失败：" + (err?.message || "未知错误"));
    }
    setRegenLoading(false);
  };`;

// Find the actual content in the file (with encoding issues)
const idx = src.indexOf('regenerateWrongQuestions = async');
if (idx === -1) {
  console.log('✗ regenerateWrongQuestions NOT found');
} else {
  // Find the end of the function
  let depth = 0, i = idx;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  const oldRegen = src.substring(idx - 4, i + 1); // include "  const "
  
  const newRegen = `regenerateWrongQuestions = async () => {
    setRegenLoading(true);
    setRegenMsg("");
    try {
      // 针对最弱章节生成变式题
      const targetChapters = weakChapters.slice(0, 2).map(([ch]) => ch);
      const chapter = targetChapters.length > 0
        ? targetChapters.join(" 和 ")
        : (WRONG_QS[0]?.chapter || "数学综合");
      const aiCfg = getAIConfig();
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter, type: "单选题", count: 8,
          userProvider: aiCfg.provider, userKey: aiCfg.key, userCustomUrl: aiCfg.customUrl,
        }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const rows = (data.questions || []).map((q, idx2) => ({
        id: "ai_wrong_" + Date.now() + "_" + idx2,
        chapter,
        type: q.type || "单选题",
        question: q.question,
        options: q.options || null,
        answer: q.answer,
        explanation: q.explanation || "",
      }));
      if (rows.length === 0) throw new Error("AI 未返回题目，请检查 API Key 配置");
      setAiWrongQs(rows);
      setRegenMsg(\`✅ 已针对薄弱章节生成 \${rows.length} 道变式题！点击下方"专项练习"开始练习。\`);
    } catch (err) {
      setRegenMsg("❌ 生成失败：" + (err?.message || "请检查 API 设置"));
    }
    setRegenLoading(false);
  };`;
  
  src = src.slice(0, idx - 4) + '  const ' + newRegen + src.slice(i + 1);
  console.log('✓ regenerateWrongQuestions fixed');
}

// ── 4. Add AI variant practice button after regenMsg ──
const OLD_REGEN_MSG = `        {regenMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{regenMsg}</div>}`;

const NEW_REGEN_MSG = `        {regenMsg && <div style={{ padding: "10px 12px", borderRadius: 10, background: G.blueLight, color: G.blue, marginBottom: 12, fontSize: 14 }}>{regenMsg}</div>}
        {aiWrongQs.length > 0 && (
          <div style={{ marginBottom: 14, padding: "14px 16px", background: "linear-gradient(135deg,#eff6ff,#dbeafe)", borderRadius: 12, border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, color: G.blue, fontSize: 14, marginBottom: 2 }}>🤖 AI 变式题已生成 {aiWrongQs.length} 道</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>针对你的薄弱点量身定制，点击右侧开始专项练习</div>
            </div>
            <button onClick={() => setAiDrillMode(true)} style={{ padding: "10px 20px", background: G.blue, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", flexShrink: 0 }}>🎯 专项练习</button>
          </div>
        )}`;

if (src.includes(OLD_REGEN_MSG)) {
  src = src.replace(OLD_REGEN_MSG, NEW_REGEN_MSG);
  console.log('✓ AI variant practice button added');
} else { console.log('✗ regenMsg div NOT found'); }

fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ File written');
