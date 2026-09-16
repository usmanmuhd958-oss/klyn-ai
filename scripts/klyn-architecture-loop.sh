#!/data/data/com.termux/files/usr/bin/bash

echo "================================="
echo " KLYN CONTINUOUS ARCHITECTURE LOOP "
echo "================================="


./scripts/klyn-dependency-intelligence.sh

./architecture/validators/drift-detector.sh

./scripts/klyn-risk-analyzer.sh

./scripts/klyn-evolution-record.sh


echo
echo "KLYN ARCHITECTURE LOOP COMPLETE"
