#!/bin/bash

REPORT_FILE="project_report.txt"

echo "==================================================" > $REPORT_FILE
echo "           KLYN AI OS - PROJECT REPORT            " >> $REPORT_FILE
echo "==================================================" >> $REPORT_FILE
echo "Generated on: $(date)" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "## 1. PROJECT DIRECTORY STRUCTURE" >> $REPORT_FILE
echo "--------------------------------------------------" >> $REPORT_FILE
find . -not -path '*/node_modules*' -not -path '*/.git*' -not -path '*/llama.cpp*' -not -path '*/dist*' -not -path '*/build*' -not -path '*/_gzip*' | sort >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "## 2. KEY FILES CHECKLIST" >> $REPORT_FILE
echo "--------------------------------------------------" >> $REPORT_FILE
FILES_TO_CHECK=(
    "kernel/orchestrator.js"
    "shared/protocol.js"
    "shared/crypto_utils.js"
    "agents/bug_hunter.js"
    "package.json"
)

for file in "${FILES_TO_CHECK[@]}"; do
    if [ -f "$file" ]; then
        echo "[✓] FOUND: $file" >> $REPORT_FILE
    else
        echo "[X] MISSING: $file" >> $REPORT_FILE
    fi
done
echo "" >> $REPORT_FILE

echo "## 3. PENDING TASKS & UNFINISHED CODE (TODOs & FIXMEs)" >> $REPORT_FILE
echo "--------------------------------------------------" >> $REPORT_FILE
echo "Scanning for unfinished code blocks or notes..." >> $REPORT_FILE
grep -rnw . -e "TODO" -e "FIXME" -e "stub" --exclude-dir={node_modules,.git,llama.cpp,dist,build,_gzip} --exclude="generate_report.sh" --exclude="$REPORT_FILE" >> $REPORT_FILE 2>/dev/null

if [ $? -ne 0 ]; then
    echo "No explicit TODOs or FIXMEs found in the core codebase." >> $REPORT_FILE
fi
echo "" >> $REPORT_FILE

echo "## 4. CORE CODE SYNTAX & COMPONENT ANALYSIS" >> $REPORT_FILE
echo "--------------------------------------------------" >> $REPORT_FILE
find . -name "*.js" \
    -not -path '*/node_modules*' \
    -not -path '*/llama.cpp*' \
    -not -path '*/dist*' \
    -not -path '*/build*' \
    -not -path '*/_gzip*' | while read -r file; do
    if [[ -f "$file" ]]; then
        echo "Core File: $file ($(wc -l < "$file") lines)" >> $REPORT_FILE
    fi
done

echo "" >> $REPORT_FILE
echo "==================================================" >> $REPORT_FILE
echo "Report complete! Output saved to $REPORT_FILE" >> $REPORT_FILE
echo "==================================================" >> $REPORT_FILE

echo "[+] Clean project report successfully generated in: $REPORT_FILE"
