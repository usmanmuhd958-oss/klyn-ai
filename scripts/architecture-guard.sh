#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "[ARCH GUARD] Checking architecture rules"


if grep -R "2.vault\|archive-history\|.migration-backup" \
--include="*.ts" \
packages kernel intelligence core agents; then

echo "Forbidden dependency detected"
exit 1

fi


echo "ARCHITECTURE OK"
