#!/bin/bash
BACKUP_DIR="$HOME/klyn_backups"
MAX_BACKUPS=7
# Remove old backups, keeping the newest $MAX_BACKUPS
cd "$BACKUP_DIR" 2>/dev/null || exit 0
ls -t *.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS+1)) | xargs rm -f 2>/dev/null
# Create new backup
bash "$HOME/klyn-ai-os/scripts/backup.sh"
