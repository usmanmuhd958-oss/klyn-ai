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
