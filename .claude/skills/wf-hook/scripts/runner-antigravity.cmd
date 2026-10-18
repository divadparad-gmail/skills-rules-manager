@echo off
rem =========================================================================
rem wf-hook : Runner Fail-Closed pour Google Antigravity (Windows)
rem Resout dynamiquement adapter-antigravity.js via %~dp0
rem Passe %* (le chemin du script validateur cible) a l'adaptateur
rem Ne produit de decision deny de secours QUE si Node echoue a demarrer (ERRORLEVEL != 0)
rem =========================================================================

node "%~dp0adapter-antigravity.js" %*
if %ERRORLEVEL% NEQ 0 (
  echo {"decision":"deny","reason":"wf-hook [FAIL-CLOSED] : Echec de demarrage du validateur Node (code d'erreur systeme)."}
)
