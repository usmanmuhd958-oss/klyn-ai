#!/bin/bash
echo "👑 Klyn AI OS – Render Deployment Setup"
echo "========================================"

# 1. Create render.yaml (Blueprint)
cat > render.yaml << 'BLUEPRINT'
services:
  - type: web
    name: klyn-ai-os
    env: docker
    repo: https://github.com/usmanmuhd958-oss/klyn-ai
    region: frankfurt
    plan: free
    healthCheckPath: /status
    envVars:
      - key: PORT
        value: 3000
      - key: JWT_SECRET
        value: ***REMOVED***
      - key: ADMIN_PASSWORD
        value: klyn
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_ANON_KEY
        sync: false
    dockerfilePath: ./Dockerfile
    autoDeploy: true
BLUEPRINT

# 2. Update GitHub Actions to use Render Deploy Hook (if desired)
cat > .github/workflows/deploy.yml << 'CI'
name: Deploy to Render
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Render Deploy
        run: |
          curl -X POST "${{ secrets.RENDER_DEPLOY_HOOK_URL }}"
CI

echo ""
echo "✅ Configuration files created."
echo ""
echo "Next steps (do them now):"
echo ""
echo "1. Go to https://dashboard.render.com"
echo "2. Click 'New +' → 'Web Service'"
echo "3. Connect your GitHub repo: usmanmuhd958-oss/klyn-ai"
echo "4. Render will auto-detect the Dockerfile and deploy."
echo "5. After the service is created, go to its 'Settings' → 'Deploy Hook'"
echo "6. Copy the Deploy Hook URL"
echo ""
echo "7. Add the URL to GitHub secrets:"
echo "   - Go to https://github.com/usmanmuhd958-oss/klyn-ai/settings/secrets/actions"
echo "   - Click 'New repository secret'"
echo "   - Name: RENDER_DEPLOY_HOOK_URL"
echo "   - Value: paste the hook URL"
echo ""
echo "8. Come back here and run:"
echo "   git add -A && git commit -m '👑 Render auto-deploy setup' && git push origin main"
echo ""
echo "Your OS will be live at: https://klyn-ai-os.onrender.com"
echo "💯 Klyn AI OS – 10/10, undisputed."
