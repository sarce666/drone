#!/bin/zsh
# Publie la version courante de Drones sur GitHub Pages.
# Double-clic dans le Finder, ou : ./publier.command "message"
# - met à jour VERSION dans sw.js (pour que les iPad installés se mettent à jour)
# - commit + push sur GitHub ; GitHub Pages redéploie en une à deux minutes.
set -e
cd "$(dirname "$0")"

msg="${1:-Mise à jour $(date '+%Y-%m-%d %H:%M')}"
stamp="drones-$(date '+%Y-%m-%d-%H%M%S')"
sed -i '' "s/^const VERSION = '.*';/const VERSION = '$stamp';/" sw.js

git add -A
if git diff --cached --quiet; then
  echo "Rien à publier."
else
  git commit -q -m "$msg"
  git push -q
  echo "Publié : $msg"
  echo "Version service worker : $stamp"
  echo "GitHub Pages met l'app en ligne dans une à deux minutes."
fi
