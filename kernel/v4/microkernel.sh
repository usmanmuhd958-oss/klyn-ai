#!/data/data/com.termux/files/usr/bin/bash

echo "[KLYN AI OS v4] booting enterprise distributed kernel..."

bash kernel/v4/recovery.sh

bash kernel/v4/cluster/master.sh &

echo "[KLYN OS v4] system online"

wait
