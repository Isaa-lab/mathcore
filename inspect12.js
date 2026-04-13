const fs = require("fs");
const s = fs.readFileSync("src/App.js", "utf8");

// Check how ReportPage is rendered in App
const rp1 = s.indexOf("ReportPage setPage");
console.log("ReportPage setPage render:", rp1);
console.log(JSON.stringify(s.substring(rp1, rp1 + 100)));

// Check how chapterFilter state is managed
const cfState = s.indexOf("const [chapterFilter, setChapterFilter]");
console.log("\nchapterFilter state:", cfState);
console.log(JSON.stringify(s.substring(cfState, cfState + 100)));

// Check App main function
const appFn = s.indexOf("export default function App()");
console.log("\nApp function:", appFn);
console.log(JSON.stringify(s.substring(appFn, appFn + 100)));

// Check ReportPage signature
const rpSig = s.indexOf("function ReportPage(");
console.log("\nReportPage sig:", rpSig);
console.log(JSON.stringify(s.substring(rpSig, rpSig + 100)));
