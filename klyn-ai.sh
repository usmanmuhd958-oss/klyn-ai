#!/bin/bash
# KLYN-AI ENTERPRISE OS - Powered by Gemini 2.5 Pro
cd ~/klyn-ai-os

export GEMINI_API_KEY="AIzaSyA8pHwUTH0qvpFwDpqYXxVVqay1zDfjhwY" # <-- PUT YOUR GEMINI KEY HERE

echo "[GHOST] KLYN-AI GEMINI 2.5 PRO ENTERPRISE RISING..."

while true; do
  echo ""
  echo "===================================="
  read -p "[GEMINI] Enter Command: " PROMPT

  if [ "$PROMPT" = "exit" ]; then
    echo "[GHOST] SHUTTING DOWN"
    break
  fi

  echo "[GEMINI] THINKING..."

  # Send to Gemini
  RESPONSE=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"contents\":[{\"parts\":[{\"text\":\"You are the KLYN-AI OS Architect. Your job is to generate or edit code files. You MUST reply in this exact format only: FILE: path/to/file.js CODE: the_full_code_here. No explanations. No markdown. User request: $PROMPT\"}]}],
      \"generationConfig\":{\"temperature\":0.1}
    }")

  # Extract and save file
  FILE=$(echo "$RESPONSE" | grep -oP 'FILE: \K[^\n]+')
  CODE=$(echo "$RESPONSE" | grep -oP 'CODE: \K.*' | sed 's/\\n/\n/g')

  if [ -n "$FILE" ] && [ -n "$CODE" ]; then
    mkdir -p "$(dirname "$FILE")"
    echo -e "$CODE" > "$FILE"
    echo "[LAW] Sealed: $FILE"
  else
    echo "[GEMINI RAW]: $RESPONSE"
  fi

done
