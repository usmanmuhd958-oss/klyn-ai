#!/bin/bash
PROJECTS_DIR="$HOME/klyn-ai-os/projects"
PORT=8080
echo "Starting Web Code Editor on port $PORT"

socat TCP-LISTEN:$PORT,reuseaddr,fork EXEC:'
read -r REQUEST
HTTP_METHOD=$(echo "$REQUEST" | cut -d" " -f1)
PATH_INFO=$(echo "$REQUEST" | cut -d" " -f2)

# Home page – list projects
if [ "$PATH_INFO" = "/" ] || [ "$PATH_INFO" = "/index.html" ]; then
    echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"
    cat << HTML
<!DOCTYPE html>
<html><head><title>Klyn AI OS – Web Editor</title>
<style>body{background:#0a0a1a;color:#e0e0e0;font-family:monospace;padding:2rem}
h1{color:#0f0} .card{background:#111;padding:1rem;margin:1rem 0;border-radius:8px}
a{color:#0f0} textarea{width:100%;background:#000;color:#0f0;border:1px solid #333;padding:0.5rem}
button{background:#0f0;color:#000;border:none;padding:0.5rem 1rem;cursor:pointer}
</style></head><body>
<h1>🌐 Klyn AI OS Web Editor</h1>
<div class="card"><h3>Projects</h3><ul>
$(for d in $(ls \$PROJECTS_DIR | grep -v templates); do echo "<li><a href=\"/project/\$d\">\$d</a></li>"; done)
</ul></div>
<div class="card"><h3>Create New File</h3>
<select id="project"><option value="">Select project</option>
$(for d in $(ls \$PROJECTS_DIR | grep -v templates); do echo "<option value=\"\$d\">\$d</option>"; done)
</select>
<input id="filename" placeholder="filename.js">
<textarea id="content" rows="10" placeholder="File content..."></textarea>
<button onclick="saveFile()">Save File</button>
</div>
<script>
function saveFile(){
  const project=document.getElementById("project").value;
  const filename=document.getElementById("filename").value;
  const content=document.getElementById("content").value;
  fetch("/api/save?project="+project+"&file="+filename,{method:"POST",body:content}).then(r=>r.text()).then(alert);
}
</script></body></html>
HTML

# API – serve a file
elif [ "$HTTP_METHOD" = "GET" ] && echo "$PATH_INFO" | grep -q "^/project/"; then
    PROJECT=$(echo "$PATH_INFO" | cut -d/ -f3)
    FILE=$(echo "$PATH_INFO" | cut -d/ -f4-)
    FILE_PATH="$PROJECTS_DIR/$PROJECT/$FILE"
    if [ -f "$FILE_PATH" ]; then
        echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n"
        cat "$FILE_PATH"
    else
        echo -e "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nFile not found"
    fi

# API – save a file
elif [ "$HTTP_METHOD" = "POST" ] && echo "$PATH_INFO" | grep -q "^/api/save"; then
    PROJECT=$(echo "$QUERY_STRING" | sed -n 's/.*project=\([^&]*\).*/\1/p')
    FILE=$(echo "$QUERY_STRING" | sed -n 's/.*file=\([^&]*\).*/\1/p')
    read -r CONTENT
    FILE_PATH="$PROJECTS_DIR/$PROJECT/$FILE"
    mkdir -p "$(dirname "$FILE_PATH")"
    echo "$CONTENT" > "$FILE_PATH"
    echo -e "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nSaved $FILE_PATH"

else
    echo -e "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nNot found"
fi
'
