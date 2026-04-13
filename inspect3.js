const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const qpFn = s.indexOf("function QuizPage(");
// find the return JSX of QuizPage - question display area
const qpReturn = s.indexOf("return (", qpFn);
const qText = s.indexOf("MathText text={q.question}", qpFn);
console.log("Question MathText at offset:", qText - qpFn);
if (qText > 0) console.log(JSON.stringify(s.substring(qText - 200, qText + 300)));

// Also find the submit/answer area to know where to add AI button
const submitBtn = s.indexOf("handleSubmit()", qpFn);
console.log("\nSubmit btn at offset:", submitBtn - qpFn);
if (submitBtn > 0) console.log(JSON.stringify(s.substring(submitBtn - 100, submitBtn + 200)));
