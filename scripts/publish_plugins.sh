#!/bin/bash
# Publishes the plugin marketplace to GitHub Pages
echo "📦 Publishing plugin marketplace..."
mkdir -p plugins/marketplace/public
cp plugins/marketplace/index.json plugins/marketplace/public/
cat > plugins/marketplace/public/index.html << 'HTML'
<!DOCTYPE html>
<html><head><title>Klyn AI OS Plugin Marketplace</title>
<style>body{background:#0a0a1a;color:#0f0;font-family:monospace;padding:2rem}h1{color:#0f0}
.plugin{background:#111;padding:1rem;margin:1rem 0;border-radius:8px}
a{color:#0f0}</style></head>
<body>
<h1>🧩 Klyn AI OS Plugin Marketplace</h1>
<p>Browse and install plugins for your sovereign AI OS.</p>
<div id="plugins"></div>
<script>
fetch('/index.json').then(r=>r.json()).then(d=>{
  let html='';
  for(let name in d){
    html+='<div class="plugin"><h3>'+name+'</h3><p>Install: <code>klyn plugin install '+name+'</code></p></div>';
  }
  document.getElementById('plugins').innerHTML=html;
});
</script></body></html>
HTML
echo "✅ Marketplace prepared in plugins/marketplace/public/"
echo "   Deploy with: cd plugins/marketplace/public && npx gh-pages -d ."
