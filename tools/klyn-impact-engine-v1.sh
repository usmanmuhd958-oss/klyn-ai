#!/data/data/com.termux/files/usr/bin/bash

echo "=============================="
echo " KLYN IMPACT ENGINE V1"
echo " CODE CHANGE INTELLIGENCE"
echo "=============================="

mkdir -p .klyn

python3 - <<'PY'
import json,os

dep_file=".klyn/dependency-map.json"
symbol_file=".klyn/symbol-map.json"

impact={}

if os.path.exists(dep_file):
    deps=json.load(open(dep_file))
else:
    deps={}

if os.path.exists(symbol_file):
    symbols=json.load(open(symbol_file))
else:
    symbols={}


for symbol,data in symbols.items():

    file=data.get("defined_in",[])

    impact[symbol]={
        "defined_in":file,
        "affected_files":[],
        "risk":"unknown"
    }

    for path,info in deps.items():
        imports=" ".join(info.get("imports",[]))

        for f in file:
            name=os.path.basename(f)

            if name in imports or symbol in imports:
                impact[symbol]["affected_files"].append(path)


    count=len(impact[symbol]["affected_files"])

    if count > 20:
        impact[symbol]["risk"]="high"
    elif count > 5:
        impact[symbol]["risk"]="medium"
    else:
        impact[symbol]["risk"]="low"


json.dump(
    impact,
    open(".klyn/impact-map.json","w"),
    indent=2
)

print("IMPACT SYMBOLS:",len(impact))
print("CREATED: .klyn/impact-map.json")

PY

echo "=============================="
echo " IMPACT ENGINE READY"
echo "=============================="

