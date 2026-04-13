const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// ── 1. Fix buildPool chapter matching (too broad startsWith) ──────────────────
const oldBuildPool = `  const buildPool = (chapters, types) => {
    let pool = allQuestions;
    if (chapters.length > 0) pool = pool.filter(q => {
      if (!q.chapter) return false;
      return chapters.some(c => {
        // Exact match or direct startsWith (e.g. "Ch.1" → "Ch.1" or "Ch.10")
        if (q.chapter === c) return true;
        if (q.chapter.startsWith(c + " ")) return true;
        // Full prefix match for "线性代数 Ch.2" filter
        if (q.chapter.startsWith(c)) return true;
        return false;
      });
    });
    if (types.length > 0) pool = pool.filter(q => types.includes(q.type));
    return pool;
  };`;

const newBuildPool = `  const buildPool = (chapters, types) => {
    let pool = allQuestions;
    if (chapters.length > 0) pool = pool.filter(q => {
      if (!q.chapter) return false;
      const qch = q.chapter.trim();
      return chapters.some(c => {
        const cTrim = c.trim();
        // 1. Exact match
        if (qch === cTrim) return true;
        // 2. "Ch.1 方程求解" matches filter "Ch.1" (space or end after number)
        if (qch.startsWith(cTrim + " ") || qch.startsWith(cTrim + "·") || qch.startsWith(cTrim + "-")) return true;
        // 3. Course-prefixed: "线性代数 Ch.2" filter "线性代数 Ch.2"
        // NO bare startsWith(c) — that would match Ch.1→Ch.10,Ch.11 etc.
        return false;
      });
    });
    if (types.length > 0) pool = pool.filter(q => types.includes(q.type));
    return pool;
  };`;

// Need to handle CRLF
const oldBuildPoolCRLF = oldBuildPool.replace(/\n/g, '\r\n');
if (src.includes(oldBuildPool)) {
  src = src.replace(oldBuildPool, newBuildPool);
  console.log('✓ buildPool chapter filter fixed (LF)');
} else if (src.includes(oldBuildPoolCRLF)) {
  src = src.replace(oldBuildPoolCRLF, newBuildPool.replace(/\n/g, '\r\n'));
  console.log('✓ buildPool chapter filter fixed (CRLF)');
} else {
  console.log('NOT FOUND: buildPool - trying partial match');
  const idx = src.indexOf('if (q.chapter.startsWith(c)) return true;');
  if (idx > -1) {
    // Replace just the bad line
    src = src.replace('        if (q.chapter.startsWith(c)) return true;\r\n', '');
    src = src.replace('        if (q.chapter.startsWith(c)) return true;\n', '');
    console.log('✓ Removed overly-broad startsWith line');
  } else {
    console.log('✗ Could not find the problematic line');
  }
}

// ── 2. Also ensure the chapter display in setup screen shows unique deduplicated chapters ──
// Find where allChapters is sorted and add dedup/sort by chapter number
const oldChapters = `  const allChapters = [...new Set(allQuestions.map(q => q.chapter).filter(Boolean))].sort();`;
const newChapters = `  const allChapters = [...new Set(allQuestions.map(q => q.chapter).filter(Boolean))].sort((a, b) => {
    // Sort chapters numerically: Ch.1, Ch.2, ..., Ch.10
    const numA = parseInt((a.match(/\\d+/) || [0])[0]);
    const numB = parseInt((b.match(/\\d+/) || [0])[0]);
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b, 'zh');
  });`;

const oldChaptersCRLF = oldChapters.replace(/\n/g, '\r\n');
if (src.includes(oldChapters)) {
  src = src.replace(oldChapters, newChapters);
  console.log('✓ allChapters sorted numerically');
} else if (src.includes(oldChaptersCRLF)) {
  src = src.replace(oldChaptersCRLF, newChapters.replace(/\n/g, '\r\n'));
  console.log('✓ allChapters sorted numerically (CRLF)');
} else {
  console.log('NOT FOUND: allChapters');
}

// ── 3. Improve isLowQualityQuestion: filter questions with no valid chapter ──
// This prevents untagged questions from appearing in wrong categories.
// Questions with q.chapter === null/undefined/empty should be filtered out when chapter filter is active
// (already handled by buildPool - chapter=null is filtered out).

fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ File written');
