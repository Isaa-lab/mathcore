const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const qpFn = s.indexOf("function QuizPage(");
const qpEnd = s.indexOf("\r\nfunction FlashcardPage", qpFn);
const qpCode = s.substring(qpFn, qpEnd);

// Find question display - look for q && 
const qIdx = qpCode.indexOf("q && (");
console.log("q && ( at:", qIdx);
if (qIdx > 0) console.log(JSON.stringify(qpCode.substring(qIdx, qIdx + 500)));

// Find the question text rendering
const qtIdx = qpCode.indexOf("q.question}");
console.log("\nq.question} at:", qtIdx);
if (qtIdx > 0) console.log(JSON.stringify(qpCode.substring(qtIdx - 200, qtIdx + 200)));
