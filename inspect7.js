const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const epFn = s.indexOf("function ExamPlanSection(");
const rpFn = s.indexOf("function ReportPage(");
const epCode = s.substring(epFn, rpFn);

// Find plan.map / calendar display
const planMap = epCode.indexOf("plan.map(");
console.log("plan.map at:", planMap);
if (planMap > 0) console.log(JSON.stringify(epCode.substring(planMap - 300, planMap + 500)));
