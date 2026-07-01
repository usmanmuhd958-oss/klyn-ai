#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

QUEUE="runtime/queue/jobs.jsonl"
SYSTEM_STATE="runtime/state/system.json"

# Neman Event Bus idan yana nan
if [[ -f kernel/core/event_bus.sh ]]; then
  source kernel/core/event_bus.sh
fi

mkdir -p "$(dirname "$QUEUE")"
touch "$QUEUE"

echo "[KLYN DAEMON] Industrial Core Online & Listening on $QUEUE..."

while true; do
  if [[ -s "$QUEUE" ]]; then
    # Dauko layin karshe
    JOB=$(tail -n 1 "$QUEUE")
    
    if [[ -n "$JOB" ]]; then
      # Tace fayil din idan ingantaccen JSON ne kafin turawa ga jq
      if echo "$JOB" | jq empty 2>/dev/null; then
        TYPE=$(echo "$JOB" | jq -r '.type // empty')
        PAYLOAD=$(echo "$JOB" | jq -r '.payload // empty')
        
        if [[ -n "$TYPE" ]]; then
          echo "[DAEMON] Processing Task: $TYPE"
          
          # Kira ga Agent
          if [[ -f "agents/${TYPE}er.sh" ]]; then
            bash "agents/${TYPE}er.sh" "$PAYLOAD" || echo "[ERROR] Agent failed."
          elif [[ -f "agents/${TYPE}.sh" ]]; then
            bash "agents/${TYPE}.sh" "$PAYLOAD" || echo "[ERROR] Agent failed."
          else
            echo "[DAEMON] Creating fallback placeholder for agent: $TYPE"
            mkdir -p agents
            echo -e "#!/data/data/com.termux/files/usr/bin/bash\necho \"[AGENT] Executing: \$1\"" > "agents/${TYPE}.sh"
            chmod +x "agents/${TYPE}.sh"
            bash "agents/${TYPE}.sh" "$PAYLOAD"
          fi
          
          # Share layin da aka gama domin hana loop dake kawo parse error
          > "$QUEUE"
        fi
      else
        # Idan layin ba JSON bane (kamar kalmar 'Processed:'), share shi don kare tsarin
        if [[ "$JOB" != "" ]]; then
          echo "[WARN] Skipping corrupted non-JSON pipeline entry."
          > "$QUEUE"
        fi
      fi
    fi
  fi
  sleep 1
done
