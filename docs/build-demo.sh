#!/bin/sh
# Rebuilds the GitHub Pages demo from the real studio page.
cd "$(dirname "$0")/.." || exit 1
mkdir -p docs/fonts
cp studio/fonts/* docs/fonts/
sed 's|^<script>$|<script src="demo.js"></script>\n<script>|' studio/index.html > docs/index.html
