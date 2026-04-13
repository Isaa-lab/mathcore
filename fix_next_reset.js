const fs = require("fs");
let s = fs.readFileSync("src/App.js", "utf8");
const orig = s;

const qpFn = s.indexOf("function QuizPage(");
const qpEnd = s.indexOf("function FlashcardPage", qpFn);
const qpBefore = s.substring(0, qpFn);
let qpCode = s.substring(qpFn, qpEnd);
const qpAfter = s.substring(qpEnd);

// Find handleNext and find where it increments current
const handleNextIdx = qpCode.indexOf("const handleNext = ");
console.log("handleNext at:", handleNextIdx);

// Look for setCurrent or current++ in handleNext
const setCurrent = qpCode.indexOf("setCurrent(c => c + 1)", handleNextIdx);
const setCurrent2 = qpCode.indexOf("setCurrent(prev => prev + 1)", handleNextIdx);
const setCurrent3 = qpCode.indexOf("setCurrent(current + 1)", handleNextIdx);
console.log("setCurrent (c=>c+1):", setCurrent, "(prev=>prev+1):", setCurrent2, "(current+1):", setCurrent3);

// Get handleNext full body
const handleNextEnd = qpCode.indexOf("\n  };", handleNextIdx);
if (handleNextEnd > 0) {
  console.log("handleNext full:", JSON.stringify(qpCode.substring(handleNextIdx, handleNextEnd + 6)));
}

// The handleNext function probably sets answered=false, selected=null, showHint=false
const resetInNext = qpCode.indexOf("setAnswered(false", handleNextIdx);
console.log("setAnswered in handleNext:", resetInNext);
if (resetInNext > 0) {
  console.log("context:", JSON.stringify(qpCode.substring(resetInNext - 20, resetInNext + 100)));
  // Add AI help reset here
  const oldReset = "setAnswered(false);";
  // Find in context of handleNext
  const nextSection = qpCode.substring(handleNextIdx, handleNextIdx + 500);
  if (nextSection.includes(oldReset)) {
    const newNextSection = nextSection.replace(oldReset, "setAnswered(false); setShowAIHelp(false); setAIHelpReply(\"\"); setAIHelpInput(\"\");");
    qpCode = qpCode.substring(0, handleNextIdx) + newNextSection + qpCode.substring(handleNextIdx + 500);
    s = qpBefore + qpCode + qpAfter;
    console.log("✅ AI help reset added to handleNext");
  }
}

if (s !== orig) {
  fs.writeFileSync("src/App.js", s, "utf8");
  console.log("\n✅ Changes written");
} else {
  console.log("\n⚠️ No changes");
}
