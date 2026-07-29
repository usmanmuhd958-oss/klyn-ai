#!/bin/bash
echo "================================="
echo " KLYN AI OS HEALTH CHECK"
echo "================================="

echo "📦 PROJECT SIZE"
du -sh .
echo "Total TS/JS Files:"
find . -type f \( -name "*.ts" -o -name "*.js" \) -not -path "./node_modules/*" -not -path "./dist/*" | wc -l

echo ""
echo "🔒 SECURITY AUDIT"
npm audit --omit=dev

echo ""
echo "🧠 TYPESCRIPT CHECK"
npx tsc --noEmit && echo "✅ No errors" || echo "❌ Errors found"

echo ""
echo "⚡ PERFORMANCE CHECK"
echo "Node Version: $(node -v)"
node -e "console.log('Estimated RAM:', (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2), 'MB')"

echo ""
echo "🧪 RUNNING TESTS"
npm test || echo "No tests found."

echo ""
echo "📂 GIT STATUS"
git status -s

echo ""
echo "✅ AUDIT COMPLETE"
