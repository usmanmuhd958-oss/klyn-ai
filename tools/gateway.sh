#!/bin/bash
PORT=8000
echo "Gateway on port $PORT"
while true; do
  echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"gateway\":\"Klyn AI OS\",\"projects\":$(ls projects/ 2>/dev/null | grep -v templates | wc -l)}" | nc -l -p $PORT -q 1
done
