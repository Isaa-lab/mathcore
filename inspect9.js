const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const qpFn = s.indexOf("function QuizPage(");
const qpEnd = s.indexOf("\r\nfunction FlashcardPage", qpFn);
const qpCode = s.substring(qpFn, qpEnd);

// Find buildPool or chapter filter logic
const buildPool = qpCode.indexOf("buildPool");
console.log("buildPool:", buildPool);
// Find chapterFilter usage
const cfIdx = qpCode.indexOf("chapterFilter");
console.log("chapterFilter usage at:", cfIdx);
console.log(JSON.stringify(qpCode.substring(cfIdx, cfIdx + 400)));

// Find state declarations
console.log("\nQuizPage states:");
console.log(JSON.stringify(qpCode.substring(0, 500)));

// Find where exam AI button is (bottom)
const examBtn = qpCode.lastIndexOf("</div>\n}");
console.log("\nend of QuizPage render at offset:", examBtn);
console.log(JSON.stringify(qpCode.substring(examBtn - 400, examBtn + 20)));
