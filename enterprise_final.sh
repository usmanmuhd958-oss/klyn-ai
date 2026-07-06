#!/bin/bash
set -e

echo "🚀 Klyn AI OS – Enterprise v11 (Final)"
echo "============================================"

# ---- 1. Dependencies ----
pkg install -y jq curl gnupg coreutils >/dev/null 2>&1 || true
npm list dotenv >/dev/null 2>&1 || npm install dotenv
npm list express >/dev/null 2>&1 || npm install express
npm list @supabase/supabase-js >/dev/null 2>&1 || npm install @supabase/supabase-js
npm list uuid >/dev/null 2>&1 || npm install uuid
npm list jsonwebtoken >/dev/null 2>&1 || npm install jsonwebtoken

# ---- 2. Enhanced Offline Intelligence ----
cat > agents/src/local_intelligence.sh << 'LOCALAI'
#!/bin/bash
TASK="$(echo "$*" | tr '[:upper:]' '[:lower:]')"

# Password generator
if [[ "$TASK" == *"password"* ]]; then
  echo '```python'
  echo 'import secrets, string'
  echo 'def generate_password(length=20):'
  echo '    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()"'
  echo '    return "".join(secrets.choice(alphabet) for _ in range(length))'
  echo 'if __name__ == "__main__": print(generate_password())'
  echo '```'
  exit 0
fi

# Flask REST API
if [[ "$TASK" == *"rest api"* ]] || [[ "$TASK" == *"flask"* ]]; then
  echo '```python'
  echo 'from flask import Flask, jsonify'
  echo 'app = Flask(__name__)'
  echo '@app.route("/health")'
  echo 'def health(): return jsonify({"status":"ok"})'
  echo 'if __name__ == "__main__": app.run(port=5000)'
  echo '```'
  exit 0
fi

# HTML page
if [[ "$TASK" == *"html"* ]] || [[ "$TASK" == *"web page"* ]]; then
  echo '```html'
  echo '<!DOCTYPE html><html><head><title>Klyn OS</title></head>'
  echo '<body><h1>Klyn AI OS</h1></body></html>'
  echo '```'
  exit 0
fi

# Log parser
if [[ "$TASK" == *"log"* ]] && [[ "$TASK" == *"parse"* ]]; then
  echo '```bash'
  echo '#!/bin/bash'
  echo 'grep "ERROR" /var/log/*.log | sort | uniq -c'
  echo '```'
  exit 0
fi

# Dockerfile
if [[ "$TASK" == *"docker"* ]]; then
  echo '```dockerfile'
  echo 'FROM node:18-alpine'
  echo 'WORKDIR /app'
  echo 'COPY . .'
  echo 'RUN npm install'
  echo 'CMD ["node", "server.js"]'
  echo '```'
  exit 0
fi

echo "I can generate: password generator, REST API, HTML page, log parser, Dockerfile."
echo "For custom tasks, set an API key and the cloud AI will take over."
exit 0
LOCALAI
chmod +x agents/src/local_intelligence.sh

# ---- 3. Persistent Job Queue with Retries ----
cat > kernel/src/services/job_queue.sh << 'QUEUE'
#!/bin/bash
JOB_DIR="${PROJECT_ROOT:-..}/runtime/queue"
MAX_RETRIES=3

enqueue() {
    mkdir -p "$JOB_DIR"
    local id=$(uuidgen)
    echo '{"id":"'"$id"'","task":"'"$*"'","retries":0,"status":"pending"}' > "$JOB_DIR/$id.json"
    echo "job:$id" >> "${PROJECT_ROOT:-..}/runtime/events/jobs.trigger"
}

process_queue() {
    for f in "$JOB_DIR"/*.json; do
        [ -f "$f" ] || continue
        local retries=$(jq -r '.retries' "$f")
        if [ "$retries" -ge "$MAX_RETRIES" ]; then
            mv "$f" "${JOB_DIR}/failed/"
            continue
        fi
        local task=$(jq -r '.task' "$f")
        if bash -c "${task}" 2>/dev/null; then
            rm "$f"
        else
            local id=$(jq -r '.id' "$f")
            jq '.retries += 1' "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
        fi
    done
}
QUEUE

# ---- 4. Process Manager (built-in) ----
cat > kernel/src/services/process_manager.sh << 'PM'
#!/bin/bash
PIDS_DIR="${PROJECT_ROOT:-..}/runtime/pids"
start_service() {
    local name="$1"
    local cmd="$2"
    $cmd &
    echo $! > "$PIDS_DIR/$name.pid"
    echo "Started $name (PID $(cat $PIDS_DIR/$name.pid))"
}
stop_service() {
    local name="$1"
    if [ -f "$PIDS_DIR/$name.pid" ]; then
        kill $(cat "$PIDS_DIR/$name.pid") 2>/dev/null
        rm "$PIDS_DIR/$name.pid"
    fi
}
list_services() {
    for pidfile in "$PIDS_DIR"/*.pid; do
        [ -f "$pidfile" ] || continue
        local name=$(basename "$pidfile" .pid)
        local pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            echo "$name (RUNNING, PID $pid)"
        else
            echo "$name (DEAD)"
        fi
    done
}
PM

# ---- 5. API with simple auth (JWT) ----
cat > api/server.js << 'APIJS'
const express = require('express');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const app = express();
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'klyn-secret-change-me';

function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({error:'Missing token'});
    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch(e) {
        res.status(401).json({error:'Invalid token'});
    }
}

app.post('/auth/login', (req,res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === (process.env.ADMIN_PASSWORD || 'klyn')) {
        const token = jwt.sign({ username }, SECRET, { expiresIn: '24h' });
        res.json({ token });
    } else {
        res.status(403).json({ error: 'Invalid credentials' });
    }
});

app.get('/status', authMiddleware, (req,res) => {
    exec('bash scripts/health_check.sh', (err, stdout) => {
        res.json({ status: err ? 'unhealthy' : 'healthy', output: stdout });
    });
});

app.post('/agent/run', authMiddleware, (req,res) => {
    const { agent, task } = req.body;
    exec(`bash agents/src/${agent}.sh "${task}"`, (err, stdout) => {
        res.json({ result: stdout, error: err?.message });
    });
});

app.listen(3000, () => console.log('Klyn API (secured) on port 3000'));
APIJS

# ---- 6. Supervisor now uses process manager ----
cat > kernel/src/core/supervisor.sh << 'SUPER'
#!/bin/bash
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$PROJECT_ROOT/kernel/src/services/process_manager.sh"
source "$PROJECT_ROOT/kernel/src/services/job_queue.sh"

# Ensure runtime dirs
mkdir -p "$PROJECT_ROOT/runtime/pids" "$PROJECT_ROOT/runtime/queue/failed"

# Start critical services
start_service "api" "node $PROJECT_ROOT/api/server.js"
start_service "eventbus" "bash -c 'tail -f $PROJECT_ROOT/runtime/events/jobs.trigger 2>/dev/null | while read line; do process_queue; done'"
start_service "scheduler" "bash -c 'while true; do process_queue; sleep 2; done'"

# Health loop
while true; do
    if ! kill -0 $(cat "$PROJECT_ROOT/runtime/pids/api.pid") 2>/dev/null; then
        echo "[$(date)] API died, restarting..."
        start_service "api" "node $PROJECT_ROOT/api/server.js"
    fi
    # Process the job queue every iteration
    process_queue
    sleep 5
done
SUPER

# ---- 7. Boot script (final) ----
cat > boot.sh << 'BOOTV11'
#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p runtime/{logs,events,queue/failed,pids,metrics}

echo "🚀 Klyn AI OS v11 Enterprise"
echo "============================"

# Start supervisor (which starts everything else)
nohup bash kernel/src/core/supervisor.sh > runtime/logs/supervisor.log 2>&1 &
echo "✅ Supervisor started (PID $!)"

echo ""
echo "🔐 API secured with JWT. Default login: admin / klyn"
echo "   Change via ADMIN_PASSWORD env var."
echo ""
echo "🛠️  Use './bin/klyn' for the interactive menu."
echo "💯 Klyn AI OS is now fully enterprise-grade."
BOOTV11
chmod +x boot.sh

# ---- 8. CLI update ----
cat > bin/klyn << 'CLIV11'
#!/bin/bash
export PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$#" -eq 0 ]; then
    clear
    echo "╔══════════════════════════════════════╗"
    echo "║        KLYN AI OS v11 Enterprise     ║"
    echo "╠══════════════════════════════════════╣"
    echo "║ 1) Start OS                          ║"
    echo "║ 2) Status (health)                   ║"
    echo "║ 3) Logs (tail)                       ║"
    echo "║ 4) Run agent                         ║"
    echo "║ 5) Dashboard (port 4000)             ║"
    echo "║ 6) List services                     ║"
    echo "║ 0) Exit                              ║"
    echo "╚══════════════════════════════════════╝"
    read -p "> " CHOICE
    case $CHOICE in
        1) bash "$PROJECT_ROOT/boot.sh" ;;
        2) bash "$PROJECT_ROOT/scripts/health_check.sh" ;;
        3) tail -f "$PROJECT_ROOT/runtime/logs/supervisor.log" ;;
        4) read -p "Agent: " AGENT; read -p "Task: " TASK; bash "$PROJECT_ROOT/agents/src/$AGENT.sh" "$TASK" ;;
        5) node "$PROJECT_ROOT/apps/web/server.js" & ;;
        6) bash -c "source $PROJECT_ROOT/kernel/src/services/process_manager.sh; list_services" ;;
        0) exit ;;
    esac
else
    case "$1" in
        start) bash "$PROJECT_ROOT/boot.sh" ;;
        status) bash "$PROJECT_ROOT/scripts/health_check.sh" ;;
        agent) shift; bash "$PROJECT_ROOT/agents/src/$1.sh" "${@:2}" ;;
        list) bash -c "source $PROJECT_ROOT/kernel/src/services/process_manager.sh; list_services" ;;
        *) echo "Usage: klyn {start|status|agent|list}" ;;
    esac
fi
CLIV11
chmod +x bin/klyn

# ---- 9. Final health check (includes queue & process manager) ----
cat > scripts/health_check.sh << 'HEOF'
#!/bin/bash
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PASS=0; FAIL=0

log() { if [ "$1" = "OK" ]; then echo "[PASS] $2"; ((PASS++)); else echo "[FAIL] $2"; ((FAIL++)); fi; }

[ -d "$PROJECT_ROOT/runtime" ] && log OK "Runtime" || log FAIL "Runtime missing"
[ -f "$PROJECT_ROOT/runtime/pids/api.pid" ] && kill -0 $(cat "$PROJECT_ROOT/runtime/pids/api.pid") 2>/dev/null && log OK "API running" || log FAIL "API not running"
[ -d "$PROJECT_ROOT/runtime/queue" ] && log OK "Job queue" || log FAIL "Job queue missing"

if node "$PROJECT_ROOT/kernel/src/services/state_engine.js" health 2>/dev/null; then
    log OK "State engine"
else
    log FAIL "State engine offline"
fi

echo "==========="
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
HEOF
chmod +x scripts/health_check.sh

echo ""
echo "✅ Enterprise v11 upgrade complete."
echo "   Run: bash boot.sh"
echo "   Then: ./bin/klyn"
