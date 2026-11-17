import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, describe } from 'node:test';
import { CLAUDE_IMPORT_NOT_CONSULTED } from '../src/claude/memoryImports';

// Les états d'un import de Claude Code que l'extension ne consulte pas sont écrits à deux endroits :
// CLAUDE_IMPORT_NOT_CONSULTED dans src/claude/memoryImports.ts, et isClaudeImportNotConsulted dans
// src/webview/main.js, qui ne charge pas les modules TypeScript. Ce test lit main.js comme texte, sans
// l'exécuter, et vérifie que les deux listes sont identiques : un état ajouté d'un côté seulement le fait échouer.

const MAIN_JS = path.resolve(__dirname, '../../src/webview/main.js');

/** Les états comparés dans le corps de isClaudeImportNotConsulted, dans l'ordre du texte. */
function etatsDuWebview(texte: string): string[] {
  const corps = /function isClaudeImportNotConsulted\(item\) \{([\s\S]*?)\n {2}\}/.exec(texte);
  assert.ok(corps, 'la fonction isClaudeImportNotConsulted est absente de src/webview/main.js');
  const retour = /\breturn ([^;]+);/.exec(corps[1]);
  assert.ok(retour, 'isClaudeImportNotConsulted se termine par un return');
  // Le return n'est fait que de « etat === '…' » reliés par « || » : une autre forme ferait manquer un état
  const termes = retour[1].split('||').map((t) => t.trim());
  const etats = termes.map((t) => /^etat === '([^']+)'$/.exec(t)?.[1]);
  assert.deepStrictEqual(termes.filter((_, i) => etats[i] === undefined), [], 'chaque terme du return a la forme etat === \'…\'');
  return etats as string[];
}

describe('Claude Code : les états d\'import non consultés, identiques dans le webview et dans le module', () => {
  test('1. La liste de src/webview/main.js est celle de CLAUDE_IMPORT_NOT_CONSULTED, et le webview s\'en sert', () => {
    const texte = fs.readFileSync(MAIN_JS, 'utf8');
    const webview = etatsDuWebview(texte);
    assert.ok(webview.length > 0, 'au moins un état dans le webview');
    assert.deepStrictEqual([...webview].sort(), [...CLAUDE_IMPORT_NOT_CONSULTED].sort(),
      'les états non consultés du webview et de src/claude/memoryImports.ts sont les mêmes');
    // La définition, le bandeau des imports hors du projet et le bouton 📄
    const usages = texte.split('isClaudeImportNotConsulted(').length - 1;
    assert.ok(usages >= 3, `la fonction est définie puis utilisée au moins deux fois (${usages} occurrences)`);
  });
});
