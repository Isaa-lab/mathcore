const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

// handleSetPage definition
const hsp = s.indexOf("const handleSetPage = (p)");
console.log("handleSetPage def:", hsp);
if (hsp > 0) console.log(JSON.stringify(s.substring(hsp, hsp + 200)));

// QuizPage render
const quizRender = s.indexOf("QuizPage setPage");
console.log("\nQuizPage render:", quizRender);
if (quizRender > 0) console.log(JSON.stringify(s.substring(quizRender - 20, quizRender + 400)));

// renderPage function
const renderPage = s.indexOf("function renderPage");
console.log("\nrenderPage:", renderPage);
if (renderPage > 0) console.log(JSON.stringify(s.substring(renderPage, renderPage + 800)));

// ExamPlanSection - opening practice button
const epBtn = s.indexOf("setPage(\"\u9898\u5e93\u7ec3\u4e60\")");
console.log("\nsetPage quiz:", epBtn);
if (epBtn > 0) console.log(JSON.stringify(s.substring(epBtn - 150, epBtn + 100)));
