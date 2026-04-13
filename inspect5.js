const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

// ExamPlanSection calendar area
const epFn = s.indexOf("function ExamPlanSection(");
const epEnd = s.indexOf("\r\nfunction ReportPage", epFn);
const epCode = s.substring(epFn, epEnd);

// Find the calendar flex wrapper
const calWrapper = epCode.indexOf("overflowX: \"auto\"");
console.log("calendar wrapper at offset:", calWrapper);
if (calWrapper > 0) console.log(JSON.stringify(epCode.substring(calWrapper - 200, calWrapper + 300)));

// Find the bottom buttons area  
const bottomBtns = epCode.indexOf("AI \u52a9\u6559\u590d\u4e60");
console.log("\nAI assist btn offset:", bottomBtns);
if (bottomBtns > 0) console.log(JSON.stringify(epCode.substring(bottomBtns - 200, bottomBtns + 200)));

// Find ExamPlanSection signature
console.log("\nExamPlanSection start:\n" + JSON.stringify(epCode.substring(0, 100)));
