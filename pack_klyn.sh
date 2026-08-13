#!/usr/bin/env bash

set -e

CONFIG_FILE="repomix.config.json"
OUTPUT_FILE="repomix-output.xml"
DEST_DIR="/sdcard/Download"
DEST_FILE="${DEST_DIR}/repomix-output-2.xml"

echo "=========================================="
echo "  Klyn AI OS - Repomix Packing Pipeline"
echo "=========================================="

echo "[+] Creating Repomix configuration..."
cat << 'CONFIG_EOF' > "${CONFIG_FILE}"
{
  "output": {
    "filePath": "repomix-output.xml",
    "style": "xml",
    "removeEmptyLines": true
  },
  "ignore": {
    "useGitignore": true,
    "useDefaultPatterns": true,
    "customPatterns": [
      "vault_data/**",
      ".migration-backup/**",
      "architecture-audit/**",
      "bootstrap_*",
      "backups/**",
      "target/**",
      "dist/**",
      "*.log",
      "*.sqlite",
      "*.db"
    ]
  }
}
CONFIG_EOF

echo "[+] Executing repomix..."
if command -v npx &> /dev/null; then
    npx repomix
else
    echo "[-] Error: npx command not found. Please ensure Node.js is installed."
    exit 1
fi

if [ -f "${OUTPUT_FILE}" ]; then
    echo "[+] Preparing export destination..."
    
    if [ ! -d "${DEST_DIR}" ]; then
        echo "[!] Storage folder not found. Requesting storage permission..."
        termux-setup-storage
        sleep 2
    fi

    echo "[+] Exporting ${OUTPUT_FILE} to ${DEST_FILE}..."
    cp "${OUTPUT_FILE}" "${DEST_FILE}"
    
    echo "=========================================="
    echo "  SUCCESS!"
    echo "  File exported to: ${DEST_FILE}"
    echo "=========================================="
else
    echo "[-] Error: Bundled file ${OUTPUT_FILE} was not created."
    exit 1
fi
