#!/data/data/com.termux/files/usr/bin/bash

NODES="runtime/nodes.jsonl"

while true; do
    TMP="runtime/tmp_nodes.$$"
    > "$TMP"

    while IFS= read -r line; do
        [ -z "$line" ] && continue

        NODE=$(echo "$line" | cut -d'|' -f1)
        STATUS=$(echo "$line" | cut -d'|' -f2)

        # refresh alive status
        if [ "$STATUS" = "ALIVE" ]; then
            echo "$NODE|ALIVE|$RANDOM|$(date +%s)" >> "$TMP"
        fi

    done < "$NODES"

    mv "$TMP" "$NODES"

    sleep 5
done
