#!/bin/bash
PROJECTS_DIR="$HOME/klyn-ai-os/projects"
PORT=8000
echo "Starting Global API Gateway on port $PORT"

# Start socat to handle incoming requests
socat TCP-LISTEN:$PORT,reuseaddr,fork EXEC:'
read -r REQUEST
HTTP_METHOD=$(echo "$REQUEST" | cut -d" " -f1)
PATH_INFO=$(echo "$REQUEST" | cut -d" " -f2)
PROJECT=$(echo "$PATH_INFO" | cut -d/ -f2)
ENDPOINT=$(echo "$PATH_INFO" | cut -d/ -f3-)

# Default to root project if none specified
if [ -z "$PROJECT" ]; then
    echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"gateway\":\"Klyn AI OS Global API\",\"projects\":\"$(ls $PROJECTS_DIR | grep -v templates | wc -l)\"}"
    exit
fi

PROJECT_DIR="$PROJECTS_DIR/$PROJECT"
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\r\n{\"error\":\"Project not found\"}"
    exit
fi

# Route to project health endpoint
if [ "$ENDPOINT" = "health" ]; then
    echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"project\":\"$PROJECT\",\"status\":\"active\"}"
else
    echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nProject: $PROJECT - endpoint: $ENDPOINT"
fi
'
