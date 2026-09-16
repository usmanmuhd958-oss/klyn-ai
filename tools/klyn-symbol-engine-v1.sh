#!/data/data/com.termux/files/usr/bin/bash

echo "=============================="
echo " KLYN SYMBOL ENGINE V1"
echo " SYMBOL INTELLIGENCE LAYER"
echo "=============================="

mkdir -p .klyn

BACKUP="backups/klyn-symbol-engine-v1"
mkdir -p "$BACKUP"

if [ -f .klyn/symbol-map.json ]; then
    cp .klyn/symbol-map.json "$BACKUP/symbol-map.json.$(date +%Y%m%d-%H%M%S)"
fi

python3 - <<'PY'
import os,json,re

symbols={}

ignore=[
    "node_modules",
    ".git",
    "backups",
    "vault_data",
    ".migration-backup"
]

for root,dirs,files in os.walk("."):

    dirs[:]=[
        d for d in dirs
        if d not in ignore
    ]

    for f in files:
        if not f.endswith((".ts",".js")):
            continue

        path=os.path.join(root,f)

        try:
            data=open(path,errors="ignore").read()

            found=[]

            patterns=[
                (r'export\s+class\s+([A-Za-z0-9_]+)',"class"),
                (r'class\s+([A-Za-z0-9_]+)',"class"),
                (r'export\s+function\s+([A-Za-z0-9_]+)',"function"),
                (r'function\s+([A-Za-z0-9_]+)',"function"),
                (r'export\s+const\s+([A-Za-z0-9_]+)',"constant")
            ]

            for pattern,kind in patterns:
                for match in re.findall(pattern,data):
                    found.append({
                        "name":match,
                        "type":kind,
                        "file":path
                    })

            for item in found:
                key=item["name"]

                if key not in symbols:
                    symbols[key]={
                        "type":item["type"],
                        "defined_in":[],
                        "references":[]
                    }

                symbols[key]["defined_in"].append(path)

        except:
            pass


json.dump(
    symbols,
    open(".klyn/symbol-map.json","w"),
    indent=2
)

print("SYMBOLS:",len(symbols))
print("CREATED: .klyn/symbol-map.json")

PY

echo "=============================="
echo " SYMBOL ENGINE READY"
echo "=============================="

