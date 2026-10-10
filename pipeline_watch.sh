#!/data/data/com.termux/files/usr/bin/bash

echo "=========================================="
echo " 🚀 KLYN-AI DUAL PIPELINE STATUS MONITOR"
echo "=========================================="
echo ""

echo "--- [1] GitHub Actions Workflow ---"
gh run list -L 1

echo ""
echo "--- [2] GitLab Pipeline ---"
glab pipeline status -R usmanmuhd958-oss/klyn-ai || echo "No active GitLab pipeline found yet."

echo "=========================================="
