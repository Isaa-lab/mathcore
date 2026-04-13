const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// ── 1. Add correctStreak + showWin states ──
const old1 = '  const [wrongList, setWrongList] = useState([]);\r\n  const [finished, setFinished] = useState(false);\r\n  const [timer, setTimer] = useState(0);';
const new1 = '  const [wrongList, setWrongList] = useState([]);\r\n  const [finished, setFinished] = useState(false);\r\n  const [timer, setTimer] = useState(0);\r\n  const [correctStreak, setCorrectStreak] = useState(0);\r\n  const [showWin, setShowWin] = useState(false);';

if (src.includes(old1)) {
  src = src.replace(old1, new1);
  console.log('✓ correctStreak state added');
} else { console.log('NOT FOUND: streak state'); }

// ── 2. Update handleSubmit to track streak + trigger win ──
const old2 = `  const handleSubmit = () => {
    if (selected === null) return;
    setAnswered(true);
    const correct = opts
      ? letters[selected] === q.answer
      : (selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误");
    if (correct) setScore(s => s + 1);
    else setWrongList(w => [...w, q]);
    if (onAnswer && q) onAnswer(q.id || q.question, correct, q.chapter || "Unknown", q);
  };`;

const new2 = `  const handleSubmit = () => {
    if (selected === null) return;
    setAnswered(true);
    const correct = opts
      ? letters[selected] === q.answer
      : (selected === 0 && q.answer === "正确") || (selected === 1 && q.answer === "错误");
    if (correct) {
      setScore(s => s + 1);
      setCorrectStreak(s => {
        const next = s + 1;
        if (next === 3 || next === 5 || next % 5 === 0) {
          setShowWin(true);
          setTimeout(() => setShowWin(false), 2200);
        }
        return next;
      });
    } else {
      setCorrectStreak(0);
      setWrongList(w => [...w, q]);
    }
    if (onAnswer && q) onAnswer(q.id || q.question, correct, q.chapter || "Unknown", q);
  };`;

if (src.includes(old2)) {
  src = src.replace(old2, new2);
  console.log('✓ handleSubmit updated with streak');
} else {
  // Try CRLF version
  const old2crlf = old2.replace(/\n/g, '\r\n');
  if (src.includes(old2crlf)) {
    src = src.replace(old2crlf, new2);
    console.log('✓ handleSubmit updated with streak (CRLF)');
  } else {
    console.log('NOT FOUND: handleSubmit');
    const idx = src.indexOf('const handleSubmit = () => {');
    console.log('Found at:', idx);
    if (idx > -1) console.log(JSON.stringify(src.substring(idx, idx + 200)));
  }
}

// ── 3. Reset streak on handleNext ──
const old3 = `  const handleNext = () => {
    if (current >= displayQ.length - 1) { setFinished(true); return; }
    setCurrent(c => c + 1); setSelected(null); setAnswered(false); setShowHint(false);
  };`;

const new3 = `  const handleNext = () => {
    if (current >= displayQ.length - 1) { setFinished(true); return; }
    setCurrent(c => c + 1); setSelected(null); setAnswered(false); setShowHint(false);
  };
  // Reset streak on quiz restart
  const handleRestartQuiz = () => {
    setCorrectStreak(0); setShowWin(false); setFinished(false);
    setCurrent(0); setSelected(null); setAnswered(false); setScore(0); setWrongList([]);
  };`;

if (src.includes(old3)) {
  src = src.replace(old3, new3);
  console.log('✓ handleNext + restart added');
} else {
  const old3crlf = old3.replace(/\n/g, '\r\n');
  if (src.includes(old3crlf)) {
    src = src.replace(old3crlf, new3);
    console.log('✓ handleNext + restart added (CRLF)');
  } else {
    console.log('NOT FOUND: handleNext');
  }
}

// ── 4. Add micro-win celebration overlay near quiz active section ──
// Find the quiz active area (after "if (loading) return") and insert win overlay
const winOverlay = `
  {/* Micro-win celebration overlay */}
  {showWin && (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, pointerEvents: "none" }}>
      <div style={{ background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", borderRadius: 24, padding: "28px 48px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.25)", animation: "popIn 0.3s ease" }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>{correctStreak >= 5 ? "🔥" : "⭐"}</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
          {correctStreak >= 5 ? "连续 " + correctStreak + " 题全对！" : "连续三题全对！"}
        </div>
        <div style={{ fontSize: 14, opacity: 0.9 }}>{correctStreak >= 5 ? "你真的太厉害了！🏆" : "棒极了，继续保持！💪"}</div>
      </div>
    </div>
  )}`;

// Find a good injection point: right before the quiz active mode rendering
const injectionMarker = '  if (loading) return <div style={{ padding: "4rem", textAlign: "center", color: "#888" }}>';
const markerIdx = src.indexOf(injectionMarker);
if (markerIdx > -1) {
  src = src.slice(0, markerIdx) + winOverlay + '\n' + src.slice(markerIdx);
  console.log('✓ Win overlay inserted');
} else { console.log('NOT FOUND: loading marker'); }

fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ File written');
