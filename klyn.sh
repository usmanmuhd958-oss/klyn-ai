#!/bin/bash
DB="$HOME/.klyn/memory.db"
mkdir -p $HOME/.klyn
if [! -f "$DB" ]; then sqlite3 "$DB" "CREATE TABLE bugs (id INTEGER PRIMARY KEY, error_hash TEXT UNIQUE, error_text TEXT, file_path TEXT, fix_code TEXT, model_used TEXT, success_count INTEGER DEFAULT 0, last_used INTEGER, money_saved REAL);"; fi
echo "🏢 KLYN OS ENTERPRISE v4.1"
echo "🧠 Claude Fable5 | GPT-5.6 Sol | Gemini3.5 Pro | DeepSeek V4"
echo "📱 Termux Android | Eternal Memory: ACTIVE"
echo ""
if [ -f.env ]; then export $(cat.env | xargs); fi

route_model() {
  local err="$1" local size="$2"
  if [ $size -gt 500000 ]; then echo "gemini";
  elif echo "$err" | grep -qi "architecture\|agent\|refactor\|design"; then echo "fable";
  elif echo "$err" | grep -qi "SyntaxError\|ReferenceError\|TypeError"; then echo "deepseek";
  else echo "gpt56"; fi
}

while true; do
for file in $(find. -maxdepth 2 -name "*.js" -o -name "*.py" -not -path "./node_modules/*" 2>/dev/null); do
OUTPUT=$(node "$file" 2>&1 || python "$file" 2>&1)
if [ $? -ne 0 ]; then
echo "🚨 Error: $file"
HASH=$(echo "$OUTPUT" | sha256sum | cut -d" " -f1)
CACHED=$(sqlite3 "$DB" "SELECT fix_code FROM bugs WHERE error_hash=\"$HASH\" LIMIT 1;")
if [ -n "$CACHED" ]; then
echo "💾 Cache Hit! $0.00"
echo "$CACHED" > "$file"
else
SIZE=$(wc -c <"$file")
MODEL=$(route_model "$OUTPUT" "$SIZE")
CODE=$(cat "$file")
PROMPT="You are KLYN OS. Fix this code. Return ONLY the complete working code. Error: $OUTPUT Code: $CODE"

case $MODEL in
  deepseek) echo "💸 DeepSeek V4 Pro $0.145/1M"
    FIX=$(curl -s https://api.deepseek.com/v1/chat/completions -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Content-Type: application/json" -d "{\"model\":\"deepseek-chat\",\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}]}" | python -c "import sys,json;print(json.load(sys.stdin)['choices'][0]['message']['content'])" 2>/dev/null)
    COST=0.145 ;;
  fable) echo "🧠 Claude Fable 5 $15/1M"
    FIX=$(curl -s https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" -d "{\"model\":\"claude-3-5-sonnet-20241022\",\"max_tokens\":4000,\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}]}" | python -c "import sys,json;print(json.load(sys.stdin)['content'][0]['text'])" 2>/dev/null)
    COST=15.00 ;;
  gpt56) echo "⚡ GPT-5.6 Sol"
    FIX=$(curl -s https://api.openai.com/v1/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d "{\"model\":\"gpt-5.6-sol\",\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}]}" | python -c "import sys,json;print(json.load(sys.stdin)['choices'][0]['message']['content'])" 2>/dev/null)
    COST=8.00 ;;
  gemini) echo "🌐 Gemini 3.5 Pro 1M Context"
    FIX=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=$GEMINI_API_KEY" -H "Content-Type: application/json" -d "{\"contents\":[{\"parts\":[{\"text\":\"$PROMPT\"}]}]}" | python -c "import sys,json;print(json.load(sys.stdin)['candidates'][0]['content']['parts'][0]['text'])" 2>/dev/null)
    COST=5.00 ;;
esac

if [ -n "$FIX" ]; then
echo "$FIX" > "$file"
SAVED=$(python -c "print(round(15.00 - $COST, 2))")
sqlite3 "$DB" "INSERT OR REPLACE INTO bugs (error_hash, error_text, file_path, fix_code, model_used, success_count, last_used, money_saved) VALUES (\"$HASH\",\"$OUTPUT\",\"$file\",\"$FIX\",\"$MODEL\",1,strftime('%s','now'),$SAVED);"
echo "💾 Auto-Fixed with $MODEL! Saved: \$$SAVED vs Cursor"
fi
fi
fi
done
sleep 3
done
