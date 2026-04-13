const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

// Find ExamPlanSection
const epFn = s.indexOf("function ExamPlanSection(");
console.log("ExamPlanSection at:", epFn);
console.log(JSON.stringify(s.substring(epFn, epFn + 100)));

// Find ReportPage
const rpFn = s.indexOf("function ReportPage(");
console.log("\nReportPage at:", rpFn);
console.log(JSON.stringify(s.substring(rpFn, rpFn + 100)));

// Get ExamPlanSection code
if (epFn > 0 && rpFn > 0) {
  const epCode = s.substring(epFn, rpFn);
  const calWrapper = epCode.indexOf("overflowX");
  console.log("\ncalWrapper in epCode:", calWrapper);
  if (calWrapper > 0) console.log(JSON.stringify(epCode.substring(calWrapper - 200, calWrapper + 300)));
  
  // Find bottom buttons
  const btns = epCode.lastIndexOf("button");
  console.log("\nlast button offset:", btns);
  if (btns > 0) console.log(JSON.stringify(epCode.substring(btns - 200, btns + 200)));
}
