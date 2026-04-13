const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

// Find ExamPlanSection
const epFn = s.indexOf("function ExamPlanSection(");
const rpFn = s.indexOf("function ReportPage(");
console.log("EP at:", epFn, "RP at:", rpFn);

// Get calendar area
const epCode = s.substring(epFn, rpFn);
console.log("ExamPlanSection code length:", epCode.length);

// Find plan.map in epCode
const planMap = epCode.indexOf("plan.map(");
console.log("plan.map offset in EP:", planMap);
if (planMap > 0) {
  // show 1000 chars around plan.map
  console.log(JSON.stringify(epCode.substring(planMap - 100, planMap + 1500)));
}
