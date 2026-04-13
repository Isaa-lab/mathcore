const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const epFn = s.indexOf("function ExamPlanSection(");
const rpFn = s.indexOf("function ReportPage(");
const epCode = s.substring(epFn, rpFn);

// Show the ending of the plan.map section - last 2000 chars
console.log("Last 2500 chars of ExamPlanSection:");
console.log(JSON.stringify(epCode.substring(epCode.length - 2500)));
