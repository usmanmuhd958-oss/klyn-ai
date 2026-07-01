#!/data/data/com.termux/files/usr/bin/bash

echo "[CLUSTER MASTER v4] booting..."

bash kernel/v4/scheduler.sh &
bash kernel/v4/node.sh &
bash kernel/v4/node.sh &

echo "[CLUSTER MASTER] 3-node cluster active"

wait
