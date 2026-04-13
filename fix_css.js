const fs = require('fs');
let src = fs.readFileSync('src/App.js', 'utf8');

// Inject global CSS keyframes right after the imports
const afterImports = 'import "katex/dist/katex.min.css";\r\n';
const cssBlock = `import "katex/dist/katex.min.css";

// Inject global CSS animations
(() => {
  if (document.getElementById("mc-global-styles")) return;
  const style = document.createElement("style");
  style.id = "mc-global-styles";
  style.textContent = \`
    @keyframes popIn {
      0% { transform: scale(0.5); opacity: 0; }
      70% { transform: scale(1.08); opacity: 1; }
      100% { transform: scale(1); }
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  \`;
  document.head.appendChild(style);
})();
`;

if (src.includes(afterImports)) {
  src = src.replace(afterImports, cssBlock + '\r\n');
  console.log('✓ CSS keyframes injected');
} else {
  console.log('NOT FOUND, trying LF...');
  const afterImportsLF = 'import "katex/dist/katex.min.css";\n';
  if (src.includes(afterImportsLF)) {
    src = src.replace(afterImportsLF, cssBlock + '\n');
    console.log('✓ CSS keyframes injected (LF)');
  } else {
    console.log('NOT FOUND at all');
  }
}

// Also update streak tracking in localStorage - inject into the app startup
// Add streak update logic when user visits the app
const streakInitMarker = 'const supabase = createClient(';
const streakCode = `// Update daily streak in localStorage
(() => {
  try {
    const today = new Date().toDateString();
    const data = JSON.parse(localStorage.getItem("mc_streak") || "{}");
    if (data.lastVisit !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      const days = data.lastVisit === yesterday ? (data.days || 0) + 1 : 1;
      localStorage.setItem("mc_streak", JSON.stringify({ days, lastVisit: today }));
    }
  } catch(e) {}
})();

`;

if (src.includes(streakInitMarker)) {
  src = src.replace(streakInitMarker, streakCode + streakInitMarker);
  console.log('✓ Streak init code added');
} else { console.log('NOT FOUND: supabase createClient'); }

fs.writeFileSync('src/App.js', src, 'utf8');
console.log('✓ File written');
