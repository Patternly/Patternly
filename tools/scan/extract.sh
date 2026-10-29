#!/bin/sh
# Pull the PLScan engine out of index.html into plscan.js (Node can require it).
cd "$(dirname "$0")" && awk '/<script id="plscan-src">/{f=1;next} f&&/<\/script>/{exit} f' ../../index.html > plscan.js && echo "plscan.js: $(wc -l < plscan.js) lines"
