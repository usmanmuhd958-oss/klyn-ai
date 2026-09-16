#!/usr/bin/env bash
set -euo pipefail
readonly C_GREEN='\033[0;32m'; readonly C_RESET='\033[0m'; readonly ICON_ROCKET="🚀"
cat > .github/workflows/ci.yml << 'EOF'
name: Klyn OS CI
on: [push, pull_request]
jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1
      - uses: actions/setup-node@v5
        with:
          node-version: '22'
      - run: npm install
      - name: Start API and wait for readiness
        env:
          JWT_SECRET: klyn-royal-secret
          ADMIN_PASSWORD: klyn
        run: |
          node api/server.js &
          for i in $(seq 1 15); do
            sleep 2
            if curl -s http://localhost:3000/status | grep -q healthy; then break; fi
          done
      - name: Run stabilizer
        env:
          JWT_SECRET: klyn-royal-secret
          ADMIN_PASSWORD: klyn
        run: bash tools/stabilize_klyn_os.sh
EOF
git add .github/workflows/ci.yml
git commit -m "ci: lightweight, robust workflow – mirrors local stabilizer" || true
git push origin main
echo -e "${C_GREEN}${ICON_ROCKET} CI workflow fixed and pushed.${C_RESET}"
