// [KLYN-V4.7-SELF-HEALED-AST-NODE: Cannot use import statement outside a module]
import fs from 'node:fs';

let content = fs.readFileSync('klyn_server.js', 'utf8');

// Inject Git Auto-Commit functionality into executeAutonomousTask
const gitCommitPatch = `
          // Autonomous Git Commit on Success
          try {
            execSync(\`git add \${file} && git commit -m "auto-heal(klyn): verified change in \${file} [TX: \${txId}]"\`, { cwd: this.workDir, stdio: 'ignore' });
          } catch (gitErr) {}
`;

if (!content.includes('auto-heal(klyn)')) {
  content = content.replace(
    'this.indexCodebase();\n          const finalStatus =',
    `${gitCommitPatch}\n          this.indexCodebase();\n          const finalStatus =`
  );
  fs.writeFileSync('klyn_server.js', content, 'utf8');
  console.log('✅ Klyn Master Server successfully updated to v4.2 (Git Auto-Commit Engine)!');
} else {
  console.log('ℹ️ Klyn Server v4.2 is already updated.');
}
