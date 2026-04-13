const fs = require("fs");
let s = fs.readFileSync("src/App.js", "utf8");
const orig = s;

// ===== FIX 1: Calendar overflow =====
// Change grid to flex+overflow wrapper
const oldCal = `<div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 }}>`;
const newCal = `<div style={{ overflowX: "auto", margin: "0 -4px", paddingBottom: 4 }}>\n      <div style={{ display: "flex", gap: 8, minWidth: plan.length * 132 + "px" }}>`;
if (s.includes(oldCal)) {
  s = s.replace(oldCal, newCal);
  console.log("✅ Fix1: calendar outer wrapper done");
} else {
  console.log("❌ Fix1: calendar outer not found");
}

// Also need to close the extra div - find the end of plan.map section
// Current: </div> (closes plan.map div) then buttons
// After change: </div></div> (closes flex + overflow)
const oldCalClose = `        )}\n      </div>\n\n      {plan.length > 0 && (\n        <div style={{ display: "flex"`;
const newCalClose = `        )}\n      </div></div>\n\n      {plan.length > 0 && (\n        <div style={{ display: "flex"`;
if (s.includes(oldCalClose)) {
  s = s.replace(oldCalClose, newCalClose);
  console.log("✅ Fix1b: calendar close wrapper done");
} else {
  // Try alternative pattern
  const oldCalClose2 = `        )}\n      </div>\n\n      {plan.length > 0 && (`;
  const newCalClose2 = `        )}\n      </div></div>\n\n      {plan.length > 0 && (`;
  if (s.includes(oldCalClose2)) {
    s = s.replace(oldCalClose2, newCalClose2);
    console.log("✅ Fix1b-alt: calendar close wrapper done");
  } else {
    // Look for the pattern after the plan.map
    const planMapIdx = s.indexOf('plan.map(({ date, dayName');
    const afterPlanMap = s.indexOf('\n      </div>\n\n      {plan.length', planMapIdx);
    console.log("plan.map idx:", planMapIdx, "afterPlanMap:", afterPlanMap);
    console.log("context:", JSON.stringify(s.substring(afterPlanMap - 30, afterPlanMap + 80)));
  }
}

// ===== FIX 2: Pass setChapterFilter from App to ReportPage =====
const oldRpRender = `<ReportPage setPage={handleSetPage} />`;
const newRpRender = `<ReportPage setPage={handleSetPage} setChapterFilter={setChapterFilter} />`;
if (s.includes(oldRpRender)) {
  s = s.replace(oldRpRender, newRpRender);
  console.log("✅ Fix2a: ReportPage render prop done");
} else {
  console.log("❌ Fix2a: ReportPage render not found");
}

// Update ReportPage signature
const oldRpSig = `function ReportPage({ setPage }) {`;
const newRpSig = `function ReportPage({ setPage, setChapterFilter }) {`;
if (s.includes(oldRpSig)) {
  s = s.replace(oldRpSig, newRpSig);
  console.log("✅ Fix2b: ReportPage signature done");
} else {
  console.log("❌ Fix2b: ReportPage signature not found");
}

// Pass setChapterFilter from ReportPage to ExamPlanSection
const oldEPCall = `<ExamPlanSection weak={weak} setPage={setPage} />`;
const newEPCall = `<ExamPlanSection weak={weak} setPage={setPage} setChapterFilter={setChapterFilter} />`;
if (s.includes(oldEPCall)) {
  s = s.replace(oldEPCall, newEPCall);
  console.log("✅ Fix2c: ExamPlanSection call done");
} else {
  console.log("❌ Fix2c: ExamPlanSection call not found");
}

// Update ExamPlanSection signature
const oldEPSig = `function ExamPlanSection({ weak, setPage }) {`;
const newEPSig = `function ExamPlanSection({ weak, setPage, setChapterFilter }) {`;
if (s.includes(oldEPSig)) {
  s = s.replace(oldEPSig, newEPSig);
  console.log("✅ Fix2d: ExamPlanSection signature done");
} else {
  console.log("❌ Fix2d: ExamPlanSection signature not found");
}

// Fix "开始练习" button to pass chapter filter
const oldPracticeBtn = `() => setPage("题库练习")} style={{ padding:"6px 14px", background:G.tealLight, color:G.teal, border:"none", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"inherit" }}>✏️ 开始练习</button>`;
const newPracticeBtn = `() => { if (setChapterFilter) setChapterFilter(scope.length > 0 ? scope : null); setPage("题库练习"); }} style={{ padding:"6px 14px", background:G.tealLight, color:G.teal, border:"none", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"inherit" }}>✏️ 开始练习</button>`;
if (s.includes(oldPracticeBtn)) {
  s = s.replace(oldPracticeBtn, newPracticeBtn);
  console.log("✅ Fix2e: 开始练习 button done");
} else {
  console.log("❌ Fix2e: 开始练习 button not found, searching...");
  const idx = s.indexOf("✏️ 开始练习");
  console.log("✏️ 开始练习 at:", idx);
  console.log("context:", JSON.stringify(s.substring(idx - 150, idx + 50)));
}

// ===== FIX 3: QuizPage - support array chapterFilter =====
const oldCFInit = `const [selectedChapters, setSelectedChapters] = useState(chapterFilter ? [chapterFilter] : []);`;
const newCFInit = `const [selectedChapters, setSelectedChapters] = useState(Array.isArray(chapterFilter) ? chapterFilter : (chapterFilter ? [chapterFilter] : []));`;
if (s.includes(oldCFInit)) {
  s = s.replace(oldCFInit, newCFInit);
  console.log("✅ Fix3a: chapterFilter array support done");
} else {
  console.log("❌ Fix3a: chapterFilter init not found");
}

// ===== FIX 4: Add AI help state to QuizPage =====
// Add state variables after the existing states at top of QuizPage
const oldQuizStates = `  const [selectedTypes, setSelectedTypes] = useState([]);`;
const newQuizStates = `  const [selectedTypes, setSelectedTypes] = useState([]);
  const [showAIHelp, setShowAIHelp] = useState(false);
  const [aiHelpInput, setAIHelpInput] = useState("");
  const [aiHelpReply, setAIHelpReply] = useState("");
  const [aiHelpLoading, setAIHelpLoading] = useState(false);`;
if (s.includes(oldQuizStates)) {
  s = s.replace(oldQuizStates, newQuizStates);
  console.log("✅ Fix4a: AI help states added");
} else {
  console.log("❌ Fix4a: selectedTypes state not found");
}

// Add AI help function before the return JSX of QuizPage
// Find "const handleSubmit = " in QuizPage context and add the function before it
const oldHandleSubmit = `  const handleSubmit = () => {`;
const newHandleSubmit = `  const askQuestionAI = async (userMsg) => {
    if (!q) return;
    setAIHelpLoading(true);
    setAIHelpReply("");
    try {
      const prompt = "题目：" + q.question + (q.options ? "\\n选项：" + q.options.join(" / ") : "") + "\\n\\n" + userMsg;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "chat", chatQuestion: prompt, materialTitle: "数学题目解析" })
      });
      const data = await res.json();
      setAIHelpReply(data.answer || data.text || data.result || "AI 暂时无法回答");
    } catch (e) {
      setAIHelpReply("网络错误，请稍后再试");
    }
    setAIHelpLoading(false);
  };

  const handleSubmit = () => {`;
if (s.includes(oldHandleSubmit)) {
  s = s.replace(oldHandleSubmit, newHandleSubmit);
  console.log("✅ Fix4b: askQuestionAI function added");
} else {
  console.log("❌ Fix4b: handleSubmit not found");
}

// Reset AI help when question changes - add to useEffect that tracks q
// Find the existing useEffect for question reset
const oldQEffect = `  useEffect(() => {\n    setAnswered(false);\n    setSelected(null);\n    setShowHint(false);`;
const newQEffect = `  useEffect(() => {\n    setAnswered(false);\n    setSelected(null);\n    setShowHint(false);\n    setShowAIHelp(false);\n    setAIHelpInput("");\n    setAIHelpReply("");`;
if (s.includes(oldQEffect)) {
  s = s.replace(oldQEffect, newQEffect);
  console.log("✅ Fix4c: AI help reset on question change added");
} else {
  console.log("❌ Fix4c: q useEffect not found");
  // Try \r\n version
  const oldQEffect2 = "  useEffect(() => {\r\n    setAnswered(false);\r\n    setSelected(null);\r\n    setShowHint(false);";
  const newQEffect2 = "  useEffect(() => {\r\n    setAnswered(false);\r\n    setSelected(null);\r\n    setShowHint(false);\r\n    setShowAIHelp(false);\r\n    setAIHelpInput(\"\");\r\n    setAIHelpReply(\"\");";
  if (s.includes(oldQEffect2)) {
    s = s.replace(oldQEffect2, newQEffect2);
    console.log("✅ Fix4c-rn: AI help reset added");
  } else {
    console.log("❌ Fix4c-rn: also not found");
    const eff = s.indexOf("setAnswered(false);");
    console.log("setAnswered idx:", eff);
    console.log("context:", JSON.stringify(s.substring(eff - 30, eff + 100)));
  }
}

// ===== FIX 5: Add AI help button and panel in QuizPage JSX =====
// After the question text div, add AI help button + panel
const oldQTextDiv = `<div style={{ fontSize: 18, color: "#111", lineHeight: 1.75, marginBottom: 22 }}>{q.question}</div>`;
const newQTextDiv = `<div style={{ fontSize: 18, color: "#111", lineHeight: 1.75, marginBottom: 12 }}>{q.question}</div>
        {/* AI Help button */}
        <div style={{ textAlign: "right", marginBottom: 14 }}>
          <button onClick={() => { setShowAIHelp(!showAIHelp); if (!showAIHelp) { setAIHelpReply(""); setAIHelpInput(""); } }}
            style={{ padding: "6px 14px", background: showAIHelp ? "#eff6ff" : "#f0fdf4", color: showAIHelp ? "#2563eb" : "#16a34a", border: "1px solid " + (showAIHelp ? "#bfdbfe" : "#bbf7d0"), borderRadius: 20, cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.2s" }}>
            {showAIHelp ? "▲ 收起AI解析" : "💬 不会？问 AI"}
          </button>
        </div>
        {showAIHelp && (
          <div style={{ background: "#f0f7ff", border: "1px solid #bfdbfe", borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", marginBottom: 10 }}>🤖 AI 解析助手</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input value={aiHelpInput} onChange={e => setAIHelpInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && askQuestionAI(aiHelpInput || "请详细解析这道题的解题思路和步骤")}
                placeholder="输入你的困惑，或直接点击「获取解析」"
                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #dbeafe", fontSize: 13, background: "#fff", outline: "none" }} />
              <button onClick={() => askQuestionAI(aiHelpInput || "请详细解析这道题的解题思路和步骤")}
                disabled={aiHelpLoading}
                style={{ padding: "8px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                {aiHelpLoading ? "..." : "发送"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {["请详细解析这道题的解题思路和步骤", "这道题考查的是哪个知识点？", "类似题型如何解答？"].map(hint => (
                <button key={hint} onClick={() => askQuestionAI(hint)} disabled={aiHelpLoading}
                  style={{ padding: "4px 10px", background: "#fff", border: "1px solid #bfdbfe", borderRadius: 12, cursor: "pointer", fontSize: 12, color: "#3b82f6" }}>
                  {hint}
                </button>
              ))}
            </div>
            {aiHelpLoading && <div style={{ color: "#3b82f6", fontSize: 13, marginTop: 4 }}>AI 正在思考中...</div>}
            {aiHelpReply && (
              <div style={{ background: "#fff", border: "1px solid #dbeafe", borderRadius: 10, padding: "12px 14px", marginTop: 8, fontSize: 14, lineHeight: 1.8, color: "#1e293b" }}>
                <MathText text={aiHelpReply} />
              </div>
            )}
          </div>
        )}`;
if (s.includes(oldQTextDiv)) {
  s = s.replace(oldQTextDiv, newQTextDiv);
  console.log("✅ Fix5: AI help panel in JSX added");
} else {
  console.log("❌ Fix5: question text div not found");
  const idx = s.indexOf("fontSize: 18, color: \"#111\", lineHeight: 1.75");
  console.log("question text div context:", JSON.stringify(s.substring(idx - 20, idx + 80)));
}

if (s !== orig) {
  fs.writeFileSync("src/App.js", s, "utf8");
  console.log("\n✅ All changes written to src/App.js");
} else {
  console.log("\n⚠️ No changes made");
}
