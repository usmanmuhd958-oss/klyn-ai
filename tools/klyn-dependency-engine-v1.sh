#!/data/data/com.termux/files/usr/bin/bash

echo "=============================="
echo " KLYN DEPENDENCY ENGINE V1"
echo "=============================="

mkdir -p .klyn

python3 - <<'PY'
import os,json

graph={}

for root,dirs,files in os.walk("."):
    dirs[:]=[d for d in dirs if d not in [
        "node_modules",".git","backups","vault_data"
    ]]

    for f in files:
        if f.endswith((".ts",".js")):
            path=os.path.join(root,f)

            try:
                data=open(path,errors="ignore").read()

                imports=[]

                for line in data.splitlines():
                    if "import " in line or "require(" in line:
                        imports.append(line.strip())

                graph[path]={
                    "imports":imports,
                    "lines":len(data.splitlines())
                }

            except:
                pass

json.dump(
    graph,
    open(".klyn/dependency-map.json","w"),
    indent=2
)

print("FILES:",len(graph))
print("CREATED: .klyn/dependency-map.json")
PY

echo "=============================="
echo " DEPENDENCY ENGINE READY"
echo "=============================="
