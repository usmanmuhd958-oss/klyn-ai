#!/bin/bash
PORT=8080
echo "Web Editor on port $PORT"
while true; do
  HTML='<!DOCTYPE html><html><head><title>Klyn Web Editor</title><style>body{background:#0a0a1a;color:#0f0;font-family:monospace;padding:2rem}h1{color:#0f0}</style></head><body><h1>🌐 Klyn AI OS Web Editor</h1><div class="card"><h3>Projects</h3><ul>'
  for d in $(ls projects/ 2>/dev/null | grep -v templates); do
    HTML="$HTML<li>$d</li>"
  done
  HTML="$HTML</ul></div></body></html>"
  echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n$HTML" | nc -l -p $PORT -q 1
done
