// Lot 0.6.2 : coût d'un skill du catalogue (ligne F5 du Global) et badge « Différent du catalogue »
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { ANTIGRAVITY_PROFILES } from '../src/antigravity/behavior';
import { NasScanner } from '../src/services/NasScanner';
import { IntegrityService } from '../src/services/IntegrityService';
import { buildAntigravitySkillItem } from '../src/services/antigravitySkillItem';
import { ResourceItem } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const main = require(path.resolve(__dirname, '../../src/webview/main.js'));

interface MockEl {
  className: string;
  textContent: string;
  innerHTML: string;
  title: string;
  children: MockEl[];
  style: Record<string, string>;
  appendChild: (c: MockEl) => MockEl;
  addEventListener: () => void;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
}

const mockDoc = () => {
  const createElement = (): MockEl => {
    const classes = new Set<string>();
    const el: MockEl = {
      className: '', textContent: '', innerHTML: '', title: '', children: [], style: {},
      appendChild(c: MockEl) { this.children.push(c); return c; },
      addEventListener() {},
      classList: {
        add: (c: string) => { classes.add(c); el.className = [...classes].join(' '); },
        remove: (c: string) => { classes.delete(c); el.className = [...classes].join(' '); },
        contains: (c: string) => classes.has(c),
      },
    };
    return el;
  };
  return { createElement, getElementById: () => createElement() };
};

const badgesEcart = (item: ResourceItem): Array<{ text: string; title: string }> => {
  const found: Array<{ text: string; title: string }> = [];
  const walk = (el: MockEl) => {
    if (el.className.includes('item-badge-pill') && el.textContent.includes('Différent du catalogue')) {
      found.push({ text: el.textContent, title: el.title });
    }
    el.children.forEach(walk);
  };
  walk(main.createItemCard(item, true, mockDoc()));
  return found;
};

const SKILL = '---\nname: wf-deploy\ndescription: Déploie le projet.\n---\n\n# Déployer\n\nÉtape 1.\nÉtape 2.\n';

describe('Suite de Tests : écart entre le Global et le catalogue (lot 0.6.2)', () => {
  let base: string;
  let nasDir: string;
  let globalDir: string;

  before(async () => {
    base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ecart-catalogue-'));
    nasDir = path.join(base, 'nas');
    globalDir = path.join(base, 'global');
    await fs.promises.mkdir(path.join(nasDir, 'skills', 'wf-deploy'), { recursive: true });
    await fs.promises.mkdir(path.join(globalDir, 'skills', 'wf-deploy'), { recursive: true });
    await fs.promises.writeFile(path.join(nasDir, 'skills', 'wf-deploy', 'SKILL.md'), SKILL);
  });

  after(async () => {
    await fs.promises.rm(base, { recursive: true, force: true });
  });

  const globalCard = async (content: string): Promise<{ global: ResourceItem; nas: ResourceItem }> => {
    const folder = path.join(globalDir, 'skills', 'wf-deploy');
    await fs.promises.writeFile(path.join(folder, 'SKILL.md'), content);
    const nas = (await NasScanner.scan(nasDir, 'antigravity', ANTIGRAVITY_PROFILES['2.5.5'], globalDir)).items.find((i) => i.id === 'wf-deploy')!;
    const built = await buildAntigravitySkillItem(folder, { scope: 'global', fallbackDescription: () => '' });
    const [global] = await IntegrityService.enrichResourcesWithSyncStatus([built], [nas], true);
    return { global, nas };
  };

  test('(a) Un skill identique affiche le même coût dans la colonne du catalogue et dans le Global', async () => {
    const { global, nas } = await globalCard(SKILL);
    assert.strictEqual(nas.charCount, global.charCount, 'caractères identiques');
    assert.strictEqual(nas.tokenCount, global.tokenCount, 'tokens identiques');
    assert.strictEqual(global.catalogDiffFile, undefined);
    assert.deepStrictEqual(badgesEcart(global), []);
  });

  test('(b) Un SKILL.md différent affiche le badge, dont l\'infobulle nomme le fichier du catalogue', async () => {
    const { global } = await globalCard(SKILL.replace('Étape 2.', 'Étape 2 modifiée.'));
    const nasFile = path.join(nasDir, 'skills', 'wf-deploy', 'SKILL.md');
    assert.strictEqual(global.catalogDiffFile, nasFile);
    const badges = badgesEcart(global);
    assert.strictEqual(badges.length, 1);
    assert.ok(badges[0].title.includes(nasFile), 'l\'infobulle nomme le fichier comparé');
    // Catalogue hors ligne : pas de badge
    const [offline] = await IntegrityService.enrichResourcesWithSyncStatus([{ ...global, catalogDiffFile: undefined }], [], false);
    assert.deepStrictEqual(badgesEcart(offline), []);
  });

  test('(c) Une copie qui ne diffère que par les fins de ligne n\'affiche pas de badge', async () => {
    const { global } = await globalCard(SKILL.replace(/\n/g, '\r\n'));
    assert.strictEqual(global.catalogDiffFile, undefined);
    assert.deepStrictEqual(badgesEcart(global), []);
  });
});
