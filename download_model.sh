#!/bin/bash
URL="https://huggingface.co/TheBloke/DeepSeek-Coder-6.7B-Instruct-GGUF/resolve/main/deepseek-coder-6.7b-instruct.Q4_K_M.gguf"
OUTDIR="llama.cpp/models"
mkdir -p "$OUTDIR"

retry=0
max_retries=10
wait_time=10

while [ $retry -lt $max_retries ]; do
  echo "Attempt $((retry+1))/$max_retries..."
  wget -c -P "$OUTDIR" "$URL" && break
  retry=$((retry+1))
  echo "Failed. Waiting ${wait_time}s before retry..."
  sleep $wait_time
  wait_time=$((wait_time*2))  # exponential backoff
done

if [ -f "$OUTDIR/deepseek-coder-6.7b-instruct.Q4_K_M.gguf" ]; then
  echo "✅ Download complete or partially resumed. Run the test when ready."
else
  echo "❌ Download could not complete after $max_retries attempts."
fi
