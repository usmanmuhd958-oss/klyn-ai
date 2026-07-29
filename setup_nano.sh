#!/usr/bin/env bash

cd ~/klyn-ai-os
mkdir -p 1.brain 4.mouth bin

while true; do
  clear
  echo "================================================================="
  echo "         KLYN AI OS - NANO EDITOR FOR 2026 ARCHITECTURE          "
  echo "================================================================="
  echo "1) Edit 1.brain/cognitive_router.ts  (Cognitive Router)"
  echo "2) Edit 4.mouth/cli.ts               (CLI Engine)"
  echo "3) Edit bin/klyn                     (Executable Shebang)"
  echo "4) Edit package.json                 (Package Config)"
  echo "5) Exit Menu"
  echo "================================================================="
  read -p "Select file to open in nano [1-5]: " choice

  case $choice in
    1) nano 1.brain/cognitive_router.ts ;;
    2) nano 4.mouth/cli.ts ;;
    3) nano bin/klyn ;;
    4) nano package.json ;;
    5) echo "Exiting setup tool..."; exit 0 ;;
    *) echo "Invalid option!"; sleep 1 ;;
  esac
done
