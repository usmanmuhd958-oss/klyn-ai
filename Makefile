.PHONY: start status logs clean

start:
bash boot.sh
status:
bash scripts/health_check.sh
logs:
tail -f runtime/logs/system.jsonl
clean:
pkill -f "node api/server.js" || true
rm -rf runtime/*.db runtime/*.log
