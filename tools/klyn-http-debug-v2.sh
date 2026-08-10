#!/data/data/com.termux/files/usr/bin/bash

set -e

cd ~/klyn-ai-os

mkdir -p backups/klyn-http-debug-v2
cp klyn_server.js backups/klyn-http-debug-v2/klyn_server.js.$(date +%Y%m%d-%H%M%S)

python3 - <<'PY'
from pathlib import Path

p=Path("klyn_server.js")
s=p.read_text()

old="""req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {"""

new="""req.on('data', chunk => { body += chunk.toString(); });

    req.on('end', () => {
      console.log('[HTTP REQUEST RECEIVED]', req.method, req.url);

      try {"""

if old in s:
    s=s.replace(old,new)

old2="""if (req.method === 'GET' && req.url === '/v1/memory-status') {
          res.end(JSON.stringify(memoryStats()));"""

new2="""if (req.method === 'GET' && req.url === '/v1/memory-status') {
          console.log('[MEMORY STATUS HIT]');
          const data = JSON.stringify(memoryStats());
          console.log('[MEMORY SIZE]', data.length);
          res.end(data);"""

if old2 in s:
    s=s.replace(old2,new2)

p.write_text(s)
print("HTTP DEBUG PATCHED")
PY

node --check klyn_server.js

echo "DONE"
