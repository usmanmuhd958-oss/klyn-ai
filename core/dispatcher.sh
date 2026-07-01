#!/data/data/com.termux/files/usr/bin/bash

AGENT=$1
TASK=$2
JOBID=$(date +%s%N)

echo "QUEUED|$AGENT|$TASK|$JOBID" >> runtime/jobs.jsonl

echo "[DISPATCH] Job queued → $AGENT ($JOBID)"
