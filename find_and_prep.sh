#!/usr/bin/env bash

echo "=========================================="
echo "   KLYN AI OS - AUTO FILE FINDER & PREP   "
echo "=========================================="

# Search for any file matching darepomix or repomix inside /sdcard/
FOUND_FILE=$(find /sdcard/ -type f \( -iname "*darepomix*" -o -iname "*repomix*" \) 2>/dev/null | head -n 1)

if [ -z "$FOUND_FILE" ]; then
    echo "[-] Error: No repomix/darepomix file found in /sdcard/"
    echo "[*] Listing files in Download folder to help you check:"
    ls -la /sdcard/Download/ | grep -i "\.xml$" || ls -la /sdcard/Download/
    exit 1
fi

echo "[+] Found file at: $FOUND_FILE"
echo "[+] Copying to current directory as 'darepomix-output.xml'..."
cp "$FOUND_FILE" ./darepomix-output.xml

TARGET_FILE="darepomix-output.xml"

echo ""
echo "[+] File Details:"
ls -lh "$TARGET_FILE"

echo ""
echo "[+] Creating compressed version (.gz)..."
gzip -k -9 "$TARGET_FILE"
ls -lh "${TARGET_FILE}.gz"

echo ""
echo "[+] Splitting into 20MB chunks..."
OUTPUT_DIR="xml_chunks"
mkdir -p "$OUTPUT_DIR"
split -b 20M "$TARGET_FILE" "${OUTPUT_DIR}/repomix_part_"

echo ""
echo "[+] Chunks generated inside '${OUTPUT_DIR}/':"
ls -lh "$OUTPUT_DIR"

echo "=========================================="
echo "          PROCESS COMPLETED               "
echo "=========================================="
