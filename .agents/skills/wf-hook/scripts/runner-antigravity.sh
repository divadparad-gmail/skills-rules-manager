#!/usr/bin/env bash
# =========================================================================
# wf-hook : Runner Fail-Closed pour Google Antigravity (macOS / Linux)
# Resout dynamiquement adapter-antigravity.js via $(dirname "$0")
# Passe "$@" (le script validateur cible) a l'adaptateur
# N'emet de decision deny QUE si Node echoue a demarrer (exit != 0)
# =========================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$DIR/adapter-antigravity.js" "$@"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo '{"decision":"deny","reason":"wf-hook [FAIL-CLOSED] : Echec de demarrage du validateur Node (code d'\''erreur systeme)."}'
fi
