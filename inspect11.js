const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const qpFn = s.indexOf("function QuizPage(");
const qpEnd = s.indexOf("function FlashcardPage", qpFn);
const qpCode = s.substring(qpFn, qpEnd);

// Find the question display - the q.question text
const qTextDiv = qpCode.indexOf("fontSize: 18, color: \"#111\", lineHeight: 1.75, marginBottom: 22");
console.log("question div at offset:", qTextDiv);
console.log(JSON.stringify(qpCode.substring(qTextDiv - 100, qTextDiv + 300)));

// Find "返回" button in quiz
const backBtn = qpCode.indexOf("\u8fd4\u56de");
console.log("\n返回 btn at offset:", backBtn);
console.log(JSON.stringify(qpCode.substring(backBtn - 50, backBtn + 100)));

// Find the quiz's main return JSX structure
const mainReturn = qpCode.indexOf("return (\n    <div style={{ position: \"relative\"");
console.log("\nmain return:", mainReturn);
if (mainReturn > 0) console.log(JSON.stringify(qpCode.substring(mainReturn, mainReturn + 200)));
