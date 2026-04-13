const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

// Calendar container
const calIdx = s.indexOf("overflowX: \"auto\"");
console.log("calendar flex:", calIdx);
if (calIdx > 0) console.log(JSON.stringify(s.substring(calIdx - 150, calIdx + 250)));

// QuizPage
const qpIdx = s.indexOf("function QuizPage(");
console.log("\nQuizPage at:", qpIdx);
console.log(JSON.stringify(s.substring(qpIdx, qpIdx + 200)));

// How quiz is called with chapter filter
const handleSetPage = s.indexOf("handleSetPage");
console.log("\nhandleSetPage at:", handleSetPage);
const quizMaterial = s.indexOf("quiz_material_");
console.log("\nquiz_material_ at:", quizMaterial);

// Check setPage with quiz chapters
const examChaptersNav = s.indexOf("setPage(\"题库练习\")");
console.log("\nsetPage quiz idx:", examChaptersNav);
if(examChaptersNav > 0) console.log(JSON.stringify(s.substring(examChaptersNav - 50, examChaptersNav + 100)));

// setChapterFilter usage
const scf = s.indexOf("setChapterFilter");
console.log("\nsetChapterFilter at:", scf);
console.log(JSON.stringify(s.substring(scf, scf + 200)));
