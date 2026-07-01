#!/data/data/com.termux/files/usr/bin/bash

echo "🧠 KLYN SELF-REWRITE ENGINE (FIXED VERSION)"

ROOT="packages"

if [ ! -d "$ROOT" ]; then
  echo "❌ packages folder not found"
  exit 1
fi

SYSTEMS=$(find $ROOT -type d -name "GeneratedSystem_*")

if [ -z "$SYSTEMS" ]; then
  echo "⚠️ No generated systems found"
  exit 0
fi

for SYSTEM in $SYSTEMS; do
  echo "📦 Checking: $SYSTEM"

  FILES=$(find "$SYSTEM" -type f)

  for FILE in $FILES; do
    echo "🧠 Analyzing: $FILE"

    cp "$FILE" "$FILE.backup"

    sed -i 's/any/unknown/g' "$FILE" 2>/dev/null
  done

  echo "✅ Updated: $SYSTEM"
done

echo "🔥 Self-rewrite complete"
