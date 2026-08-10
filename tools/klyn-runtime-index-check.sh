#!/data/data/com.termux/files/usr/bin/bash

cd "$HOME/klyn-ai-os"

node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function scan(dir, results = []) {
  const ignore = [
    "node_modules",
    ".git",
    "target",
    "vault_data",
    ".migration-backup",
    "backups",
    "dist"
  ];

  for (const item of fs.readdirSync(dir)) {
    if (ignore.includes(item)) continue;

    const full = path.join(dir,item);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      scan(full, results);
    } else if (item.endsWith(".js") || item.endsWith(".ts")) {
      results.push(full);
    }
  }

  return results;
}

const files = scan(root);

console.log("[KLYN RUNTIME CHECK]");
console.log("Indexed files:", files.length);

console.log(
  files.slice(0,10).join("\n")
);
NODE
