#!/usr/bin/env bash
set -Eeuo pipefail

mkdir -p \
runtime/{logs,pids,queue,metrics,events,sessions,memory,state} \
tmp \
archive
