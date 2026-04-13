const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// ── Step 1: Remove the misplaced aiDrillMode block from inside MathText ──────
// The block starts right after the split() call and before the main return
const badBlock = `  if (aiDrillMode && aiWrongQs.length > 0) return (\r\n    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>\r\n      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>\r\n        <Btn onClick={() => setAiDrillMode(false)}>\u2190 \u8fd4\u56de\u9519\u9898\u672c</Btn>\r\n        <span style={{ fontSize: 16, fontWeight: 700, color: G.blue }}>\uD83E\uDD16 AI \u53d8\u5f0f\u9898\u4e13\u9879\u7ec3\u4e60</span>\r\n      </div>\r\n      <WrongDrill questions={aiWrongQs} onExit={() => setAiDrillMode(false)} onMastered={() => {}} />\r\n    </div>\r\n  );\r\n`;

// Try to find and remove it
if (src.includes(badBlock)) {
  src = src.replace(badBlock, '');
  console.log('✓ Removed misplaced aiDrillMode block from MathText');
} else {
  // Try with LF
  const badBlockLF = badBlock.replace(/\r\n/g, '\n');
  if (src.includes(badBlockLF)) {
    src = src.replace(badBlockLF, '');
    console.log('✓ Removed misplaced aiDrillMode block (LF)');
  } else {
    // Find by marker and remove manually
    const marker = '  if (aiDrillMode && aiWrongQs.length > 0) return (';
    const idx = src.indexOf(marker);
    if (idx > -1) {
      // Check it's inside MathText (before MaterialChatPage)
      const mathTextEnd = src.indexOf('function MaterialChatPage');
      if (idx < mathTextEnd) {
        // Find end of this JSX block - look for ");\n" after it
        let end = idx;
        let depth = 0;
        let started = false;
        while (end < src.length) {
          if (src[end] === '(') { depth++; started = true; }
          else if (src[end] === ')') { depth--; }
          if (started && depth === 0) { end++; break; }
          end++;
        }
        // Skip trailing ";\n" or ";\r\n"
        if (src[end] === ';') end++;
        if (src[end] === '\r') end++;
        if (src[end] === '\n') end++;
        src = src.slice(0, idx) + src.slice(end);
        console.log('✓ Removed misplaced aiDrillMode block (manual)');
      } else {
        console.log('aiDrillMode block is correctly inside WrongPage, no action needed');
      }
    } else {
      console.log('✗ aiDrillMode block NOT found');
    }
  }
}

// ── Step 2: Ensure aiDrillMode block is in WrongPage after drillMode block ──
const drillModeBlock = `  if (drillMode) return (\r\n    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>\r\n      <WrongDrill questions={remaining.slice(drillStart)} onExit={() => setDrillMode(false)} onMastered={id => setMastered(s => new Set([...s, id]))} />\r\n    </div>\r\n  );\r\n`;

const aiDrillBlock = `  if (aiDrillMode && aiWrongQs.length > 0) return (\r\n    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>\r\n      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>\r\n        <Btn onClick={() => setAiDrillMode(false)}>\u2190 \u8fd4\u56de\u9519\u9898\u672c</Btn>\r\n        <span style={{ fontSize: 16, fontWeight: 700, color: G.blue }}>\uD83E\uDD16 AI \u53d8\u5f0f\u9898\u4e13\u9879\u7ec3\u4e60</span>\r\n      </div>\r\n      <WrongDrill questions={aiWrongQs} onExit={() => setAiDrillMode(false)} onMastered={() => {}} />\r\n    </div>\r\n  );\r\n`;

// Check if aiDrillMode is already in WrongPage
const wrongPageStart = src.indexOf('function WrongPage(');
const wrongPageDrillIdx = src.indexOf('if (aiDrillMode', wrongPageStart);

if (wrongPageDrillIdx === -1) {
  // Need to insert it after drillMode block
  if (src.includes(drillModeBlock)) {
    src = src.replace(drillModeBlock, drillModeBlock + aiDrillBlock);
    console.log('✓ aiDrillMode block inserted in WrongPage');
  } else {
    // Try with LF endings
    const drillModeBlockLF = drillModeBlock.replace(/\r\n/g, '\n');
    const aiDrillBlockLF = aiDrillBlock.replace(/\r\n/g, '\n');
    if (src.includes(drillModeBlockLF)) {
      src = src.replace(drillModeBlockLF, drillModeBlockLF + aiDrillBlockLF);
      console.log('✓ aiDrillMode block inserted in WrongPage (LF)');
    } else {
      // Find by index
      const drillIdx = src.indexOf('if (drillMode) return (', wrongPageStart);
      if (drillIdx > -1) {
        let end = drillIdx;
        let depth = 0, started = false;
        while (end < src.length) {
          if (src[end] === '(') { depth++; started = true; }
          else if (src[end] === ')') { depth--; }
          if (started && depth === 0) { end++; break; }
          end++;
        }
        if (src[end] === ';') end++;
        if (src[end] === '\r') end++;
        if (src[end] === '\n') end++;
        const insertBlock = `  if (aiDrillMode && aiWrongQs.length > 0) return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto" }}>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <Btn onClick={() => setAiDrillMode(false)}>← 返回错题本</Btn>
        <span style={{ fontSize: 16, fontWeight: 700, color: G.blue }}>🤖 AI 变式题专项练习</span>
      </div>
      <WrongDrill questions={aiWrongQs} onExit={() => setAiDrillMode(false)} onMastered={() => {}} />
    </div>
  );
`;
        src = src.slice(0, end) + insertBlock + src.slice(end);
        console.log('✓ aiDrillMode block inserted in WrongPage (manual, at:', end, ')');
      }
    }
  }
} else {
  console.log('✓ aiDrillMode already in WrongPage at:', wrongPageDrillIdx);
}

// Verify MathText is clean
const mathTextIdx = src.indexOf('function MathText(');
const mathTextEnd = src.indexOf('\nfunction MaterialChatPage', mathTextIdx);
const mathTextBody = src.slice(mathTextIdx, mathTextEnd);
if (mathTextBody.includes('aiDrillMode')) {
  console.log('⚠️  aiDrillMode still found in MathText!');
} else {
  console.log('✓ MathText is clean');
}

fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ File written');
