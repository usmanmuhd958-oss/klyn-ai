#!/usr/bin/env bash
# apply-vercel-fix.sh
# Run from anywhere inside the klyn-ai repo (Termux: pkg install git nodejs).
# Edits vercel.json, root package.json and apps/backend/package.json together,
# validates the JSON, and commits only those three files. It does not push.
set -euo pipefail

MSG='fix(vercel): resolve ROOTDIR_NOT_EXIST by resetting root directory to repo root'
FILES=(vercel.json package.json apps/backend/package.json)

command -v git  >/dev/null || { echo "git not found (pkg install git)" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found (pkg install nodejs)" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"

for f in package.json apps/backend/package.json; do
  [ -f "$f" ] || { echo "missing $f: wrong repo or branch?" >&2; exit 1; }
done

# Refuse to mix unrelated edits into this commit.
for f in "${FILES[@]}"; do
  if ! git diff --quiet -- "$f" || ! git diff --cached --quiet -- "$f"; then
    echo "$f has uncommitted changes. Commit or stash them first." >&2
    exit 1
  fi
done

WORK="$(mktemp -d)"
mkdir -p "$WORK/new/apps/backend" "$WORK/bak/apps/backend"
VERCEL_EXISTED=0; [ -f vercel.json ] && VERCEL_EXISTED=1
SWAPPED=0

rollback() {
  if [ "$SWAPPED" = 1 ]; then
    git reset -q -- "${FILES[@]}" 2>/dev/null || true
    for f in "${FILES[@]}"; do
      if [ -f "$WORK/bak/$f" ]; then cp -p "$WORK/bak/$f" "$f"; fi
    done
    [ "$VERCEL_EXISTED" = 1 ] || rm -f vercel.json
    echo "Rolled back: working tree restored." >&2
  fi
}
cleanup() { rc=$?; [ $rc -eq 0 ] || rollback; rm -rf "$WORK"; exit $rc; }
trap cleanup EXIT

# 1. Build the new contents in a temp dir (nothing in the repo is touched yet).
WORK="$WORK" node <<'NODE'
const fs = require('fs'), path = require('path');
const W = process.env.WORK;
const load = (p) => {
  if (!fs.existsSync(p)) return { obj: null, indent: 2, nl: '\n' };
  const raw = fs.readFileSync(p, 'utf8');
  const m = raw.match(/^([ \t]+)"/m);
  return { obj: JSON.parse(raw), indent: m ? m[1] : 2, nl: raw.endsWith('\n') ? '\n' : '' };
};
const save = (rel, st, obj) => {
  const out = path.join(W, 'new', rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(obj, null, st.indent) + (st.nl || '\n'));
};

// vercel.json (merge into existing; only the keys below are set)
let v = load('vercel.json');
const vj = v.obj || { $schema: 'https://openapi.vercel.sh/vercel.json' };
vj.installCommand = 'pnpm install --frozen-lockfile';
vj.buildCommand   = 'pnpm --filter @klyn/backend build';
vj.ignoreCommand  = 'bash vercel-ignore-build.sh';
save('vercel.json', v, vj);

// root package.json
let r = load('package.json');
r.obj.scripts = Object.assign({}, r.obj.scripts, { 'vercel-build': 'pnpm --filter @klyn/backend build' });
save('package.json', r, r.obj);

// apps/backend/package.json
let b = load('apps/backend/package.json');
b.obj.scripts = Object.assign({}, b.obj.scripts, { build: 'tsc -p tsconfig.json --pretty false' });
save('apps/backend/package.json', b, b.obj);
NODE

# 2. Validate every generated file before swapping anything in.
for f in "${FILES[@]}"; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$WORK/new/$f" \
    || { echo "Generated $f is not valid JSON; nothing was changed." >&2; exit 1; }
done

# 3. Back up originals, then swap each file in with same-directory renames.
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then cp -p "$f" "$WORK/bak/$f"; fi
done
SWAPPED=1
for f in "${FILES[@]}"; do
  cp "$WORK/new/$f" "$f.klyn-new" && mv "$f.klyn-new" "$f"
done

# 4. Re-validate in place, then commit only these three paths.
for f in "${FILES[@]}"; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f"
done

git add -- "${FILES[@]}"
if git diff --cached --quiet -- "${FILES[@]}"; then
  echo "Already applied; nothing to commit."
  SWAPPED=0
  exit 0
fi
git commit -q -m "$MSG" -- "${FILES[@]}"
SWAPPED=0

echo "Committed: $(git log -1 --format='%h %s')"
git show --stat --format= HEAD

# 5. Non-fatal preflight warnings.
[ -f pnpm-lock.yaml ]          || echo "WARN: pnpm-lock.yaml not found; --frozen-lockfile will fail." >&2
[ -f vercel-ignore-build.sh ]  || echo "WARN: vercel-ignore-build.sh not found at repo root; ignoreCommand points at it." >&2
[ -f pnpm-workspace.yaml ]     || echo "WARN: pnpm-workspace.yaml not found at repo root." >&2
echo "Not pushed. Review with 'git show', then 'git push'."
