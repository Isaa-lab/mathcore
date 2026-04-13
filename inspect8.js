const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

const epFn = s.indexOf("function ExamPlanSection(");
const rpFn = s.indexOf("function ReportPage(");
const epCode = s.substring(epFn, rpFn);

// Get full ExamPlanSection code around plan.map - wider context
const planMap = epCode.indexOf("plan.map(");
console.log(JSON.stringify(epCode.substring(planMap - 500, planMap + 1200)));
