#!/bin/bash
#!/data/data/com.termux/files/usr/bin/bash

echo "===== KLYN DOCTOR ====="
echo "Size: $(du -sh . | cut -f1)"
echo "Files: $(find . -type f | wc -l)"
echo "Folders: $(find . -type d | wc -l)"
echo "======================="
