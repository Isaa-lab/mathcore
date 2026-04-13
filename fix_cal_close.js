const fs = require("fs");
let s = fs.readFileSync("src/App.js", "utf8");
const orig = s;

// Fix calendar - add closing div for the overflow wrapper
// Current: ))}\r\n      </div>\r\n      <div style={{ marginTop: 10,
// Need:    ))}\r\n      </div></div>\r\n      <div style={{ marginTop: 10,
const oldCalClose = ")}\r\n      </div>\r\n      <div style={{ marginTop: 10,";
const newCalClose = ")}\r\n      </div></div>\r\n      <div style={{ marginTop: 10,";

// Only replace within ExamPlanSection
const epFn = s.indexOf("function ExamPlanSection(");
const rpFn = s.indexOf("function ReportPage(");
const before = s.substring(0, epFn);
let epCode = s.substring(epFn, rpFn);
const after = s.substring(rpFn);

if (epCode.includes(oldCalClose)) {
  epCode = epCode.replace(oldCalClose, newCalClose);
  s = before + epCode + after;
  console.log("✅ Calendar close wrapper fixed");
} else {
  console.log("❌ Pattern not found, trying without \\r");
  const oldCalClose2 = ")}\n      </div>\n      <div style={{ marginTop: 10,";
  const newCalClose2 = ")}\n      </div></div>\n      <div style={{ marginTop: 10,";
  if (epCode.includes(oldCalClose2)) {
    epCode = epCode.replace(oldCalClose2, newCalClose2);
    s = before + epCode + after;
    console.log("✅ Calendar close wrapper fixed (\\n version)");
  } else {
    console.log("Searching for pattern...");
    const i = epCode.indexOf("</div>\r\n      <div style={{ marginTop: 10,");
    console.log("idx:", i);
    if (i > 0) console.log("context:", JSON.stringify(epCode.substring(i - 30, i + 60)));
  }
}

// Fix4c: Reset AI help in handleNext/nextQ
// Find the function that advances to next question
const qpFn = s.indexOf("function QuizPage(");
const qpEnd = s.indexOf("function FlashcardPage", qpFn);
const qpCode = s.substring(qpFn, qpEnd);

// Find handleNext or nextQ
const nextIdx = qpCode.indexOf("const handleNext = ");
const setQIdxIdx = qpCode.indexOf("setQIdx(prev => prev + 1)");
console.log("\nhandleNext:", nextIdx, "setQIdx:", setQIdxIdx);
if (setQIdxIdx > 0) console.log("context:", JSON.stringify(qpCode.substring(setQIdxIdx - 100, setQIdxIdx + 50)));

// Add AI reset to handleNext/nextQ
const oldNextFn = "setQIdx(prev => prev + 1);";
// Only replace in QuizPage  
const qpBefore = s.substring(0, qpFn);
let newQpCode = s.substring(qpFn, qpFn + qpEnd - qpFn);
const qpAfter = s.substring(qpFn + qpEnd - qpFn);

if (newQpCode.includes(oldNextFn)) {
  newQpCode = newQpCode.replace(oldNextFn, oldNextFn + "\n    setShowAIHelp(false); setAIHelpReply(\"\"); setAIHelpInput(\"\");");
  s = qpBefore + newQpCode + qpAfter;
  console.log("✅ AI help reset on next question added");
} else {
  console.log("❌ setQIdx not found, trying alternate...");
  // Try to find what advances the question
  const gotoNext = qpCode.indexOf("gotoNext");
  const nextQ = qpCode.indexOf("nextQ");
  console.log("gotoNext:", gotoNext, "nextQ:", nextQ);
}

if (s !== orig) {
  fs.writeFileSync("src/App.js", s, "utf8");
  console.log("\n✅ Changes written");
} else {
  console.log("\n⚠️ No changes");
}
