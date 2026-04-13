const fs = require("fs");
let s = fs.readFileSync("src/App.js", "utf8");
const orig = s;

// ===== Fix the calendar closing div =====
// After Fix1, we added an extra wrapper div but need to close it
// Find the plan.map closing and what comes after
const planMapStart = s.indexOf("plan.map(({ date, dayName");
if (planMapStart > 0) {
  // Find the closing after plan.map - it's: )}\n      </div>\n\n      {plan
  const searchFrom = planMapStart;
  // The flex inner div closes the plan items, then we need another </div> for outer wrapper
  // Let's look at context after plan.map
  const planMapEnd = s.indexOf("\n      </div>\n\n      {plan.length", searchFrom);
  if (planMapEnd > 0) {
    const snippet = s.substring(planMapEnd, planMapEnd + 80);
    console.log("Found plan map end:", JSON.stringify(snippet));
    // Insert extra closing div
    const oldClose = "\n      </div>\n\n      {plan.length";
    const newClose = "\n      </div></div>\n\n      {plan.length";
    // Only replace the first occurrence after plan.map
    const beforePlanMap = s.substring(0, planMapEnd);
    const afterPlanMap = s.substring(planMapEnd).replace(oldClose, newClose);
    s = beforePlanMap + afterPlanMap;
    console.log("✅ Calendar extra close div added");
  } else {
    // Try different pattern
    const alt = s.indexOf("</div>\n\n      {plan.length > 0", searchFrom);
    console.log("alt pattern at:", alt);
    if (alt > 0) {
      console.log("alt context:", JSON.stringify(s.substring(alt - 50, alt + 100)));
    }
    // Try with \r\n
    const planMapEnd2 = s.indexOf("\r\n      </div>\r\n\r\n      {plan.length", searchFrom);
    if (planMapEnd2 > 0) {
      const oldClose2 = "\r\n      </div>\r\n\r\n      {plan.length";
      const newClose2 = "\r\n      </div></div>\r\n\r\n      {plan.length";
      const beforePlanMap2 = s.substring(0, planMapEnd2);
      const afterPlanMap2 = s.substring(planMapEnd2).replace(oldClose2, newClose2);
      s = beforePlanMap2 + afterPlanMap2;
      console.log("✅ Calendar extra close div added (rn version)");
    } else {
      console.log("❌ Calendar closing pattern not found");
      // Print context around planMapStart to understand structure
      const planMapEndApprox = s.indexOf("plan.length > 0", planMapStart);
      console.log("plan.length > 0 at:", planMapEndApprox);
      console.log("context before:", JSON.stringify(s.substring(planMapEndApprox - 150, planMapEndApprox + 80)));
    }
  }
}

// ===== Fix4c: Reset AI help on question change =====
// Find the useEffect that resets quiz question state
// Look for the useEffect that has setAnswered(false) and setSelected(null)
const qEffectSearch = "setAnswered(false);\n    setSelected(null);";
const qEffectSearch2 = "setAnswered(false);\r\n    setSelected(null);";
const idx1 = s.indexOf(qEffectSearch);
const idx2 = s.indexOf(qEffectSearch2);
console.log("\nsetAnswered+setSelected idx1:", idx1, "idx2:", idx2);
if (idx1 > 0) {
  console.log("context:", JSON.stringify(s.substring(idx1 - 80, idx1 + 150)));
}
if (idx2 > 0) {
  console.log("context rn:", JSON.stringify(s.substring(idx2 - 80, idx2 + 150)));
}

// Try to find the full useEffect containing q reset
const qpFn = s.indexOf("function QuizPage(");
const useEffectPattern = "useEffect(() => {";
let startSearch = qpFn;
let ueIdx = s.indexOf(useEffectPattern, startSearch);
while (ueIdx > 0 && ueIdx < qpFn + 40000) {
  const snippet = s.substring(ueIdx, ueIdx + 200);
  if (snippet.includes("setAnswered") || snippet.includes("setSelected(null)")) {
    console.log("\nFound relevant useEffect at offset:", ueIdx - qpFn);
    console.log(JSON.stringify(snippet));
    break;
  }
  ueIdx = s.indexOf(useEffectPattern, ueIdx + 1);
}

if (s !== orig) {
  fs.writeFileSync("src/App.js", s, "utf8");
  console.log("\n✅ Changes written");
} else {
  console.log("\n⚠️ No changes");
}
