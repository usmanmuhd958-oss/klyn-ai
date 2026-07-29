#!/bin/bash
if [ -z "$1" ] || [ ! -f "$1" ]; then
  echo "Usage: bash scripts/restore.sh <backup.tar.gz>"
  exit 1
fi

cd "$(dirname "$0")/.."
BACKUP_FILE="$1"

echo "🔄 Restoring from $BACKUP_FILE..."
tar -xzf "$BACKUP_FILE" -C /tmp/klyn_restore_temp
RESTORE_DIR=$(ls -d /tmp/klyn_restore_temp/*/ 2>/dev/null | head -1)

if [ -d "$RESTORE_DIR" ]; then
  cp -r "$RESTORE_DIR/state" runtime/ 2>/dev/null || true
  [ -f "$RESTORE_DIR/state.json" ] && cp "$RESTORE_DIR/state.json" runtime/
  cp -r "$RESTORE_DIR/config" . 2>/dev/null || true
  cp -r "$RESTORE_DIR/plugins" plugins/installed 2>/dev/null || true
  cp -r "$RESTORE_DIR/agents" runtime/ 2>/dev/null || true
  rm -rf /tmp/klyn_restore_temp
  echo "✅ Restore complete."
  echo "   Run 'bash boot.sh' to restart the OS."
else
  echo "❌ Invalid backup archive."
  exit 1
fi
