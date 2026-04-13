const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const qpFn = s.indexOf("function QuizPage(");
const qpEnd = s.indexOf("function FlashcardPage", qpFn);
const qpCode = s.substring(qpFn, qpEnd);

// Find handleNext
const nextIdx = qpCode.indexOf("const handleNext = ");
console.log("handleNext at:", nextIdx);
if (nextIdx > 0) console.log(JSON.stringify(qpCode.substring(nextIdx, nextIdx + 300)));
