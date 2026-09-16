#!/bin/bash
BACKUP_DIR="$HOME/klyn_backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cd "$(dirname "$0")/.."

echo "💾 Creating backup..."
# Backup state
cp -r runtime/state "$BACKUP_DIR/state" 2>/dev/null || true
cp runtime/state.json "$BACKUP_DIR/state.json" 2>/dev/null || true
# Backup configs
cp -r config "$BACKUP_DIR/config" 2>/dev/null || true
# Backup plugins
cp -r plugins/installed "$BACKUP_DIR/plugins" 2>/dev/null || true
# Backup agent runtime configs
cp -r runtime/agents "$BACKUP_DIR/agents" 2>/dev/null || true

# Create manifest
echo "Backup created at: $BACKUP_DIR" > "$BACKUP_DIR/manifest.txt"
echo "Project: Klyn AI OS v15 Supreme" >> "$BACKUP_DIR/manifest.txt"
echo "Date: $(date)" >> "$BACKUP_DIR/manifest.txt"
echo "Host: $(hostname 2>/dev/null || echo 'termux')" >> "$BACKUP_DIR/manifest.txt"

# Compress
tar -czf "$BACKUP_DIR.tar.gz" -C "$HOME/klyn_backups" "$(basename "$BACKUP_DIR")"
rm -rf "$BACKUP_DIR"

echo "✅ Backup saved to $BACKUP_DIR.tar.gz"
echo "   Restore with: bash scripts/restore.sh $BACKUP_DIR.tar.gz"
