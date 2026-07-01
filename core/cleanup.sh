#!/data/data/com.termux/files/usr/bin/bash

LEDGER="runtime/jobs.db"
ARCHIVE="runtime/jobs_archive.db"
TMP="runtime/tmp.db"

[ ! -f "$LEDGER" ] && exit 0

touch "$ARCHIVE"
> "$TMP"

while IFS= read -r line; do

    [ -z "$line" ] && continue

    STATUS=$(echo "$line" | cut -d'|' -f1)

    if [ "$STATUS" = "DONE" ]; then
        echo "$line" >> "$ARCHIVE"
    else
        echo "$line" >> "$TMP"
    fi

done < "$LEDGER"

mv "$TMP" "$LEDGER"
