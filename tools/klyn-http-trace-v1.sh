#!/data/data/com.termux/files/usr/bin/bash

set -e

cd ~/klyn-ai-os

mkdir -p backups/klyn-http-trace-v1
cp klyn_server.js backups/klyn-http-trace-v1/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python3 - <<'PY'
from pathlib import Path

p=Path("klyn_server.js")
s=p.read_text()

old="""const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');"""

new="""const server = http.createServer((req, res) => {
    console.log('[HTTP]', req.method, req.url);

    res.setHeader('Content-Type', 'application/json');"""

if old in s:
    s=s.replace(old,new)
    p.write_text(s)
    print("PATCHED HTTP TRACE")
else:
    print("SKIPPED")
PY

node --check klyn_server.js
