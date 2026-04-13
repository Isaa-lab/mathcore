const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const qpFn = s.indexOf("function QuizPage(");
const qpEnd = s.indexOf("function FlashcardPage", qpFn);
const qpCode = s.substring(qpFn, qpEnd);

// Find buildPool - chapter filter logic
const buildPool = qpCode.indexOf("buildPool");
console.log("buildPool fn at:", buildPool);
console.log(JSON.stringify(qpCode.substring(buildPool, buildPool + 600)));
