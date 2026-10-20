/**
 * Suite de tests du médiateur d'événements typé (ExtensionEventBus).
 *
 * Elle couvre les quatre garanties structurantes décrites au chapitre 3.1 du
 * PRD : enveloppe normalisée, hydratation d'une vue, mise en file circulaire
 * des vues démontées et isolation des erreurs d'abonné.
 */

import * as assert from 'node:assert';
import { test, describe } from 'node:test';
import { ExtensionEventBus, RingBuffer } from '../src/common/ExtensionEventBus';
import { EventEnvelope, KNOWN_TOPICS } from '../src/common/eventTypes';

describe("Suite de Tests : Médiateur d'événements typé (ExtensionEventBus)", () => {
  test("1. Enveloppe normalisée : chaque publication porte un identifiant, un horodatage ISO et sa source", () => {
    const bus = new ExtensionEventBus();
    const received: EventEnvelope[] = [];
    bus.subscribe('agent:status', (envelope) => {
      received.push(envelope);
    });

    const published = bus.publish('agent:status', 'agent.sidepanel', { status: 'thinking' });

    assert.strictEqual(received.length, 1, 'Le gestionnaire doit recevoir exactement une enveloppe.');
    const envelope = received[0];
    assert.match(
      envelope.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      "L'identifiant doit respecter le format UUID."
    );
    assert.ok(
      !Number.isNaN(Date.parse(envelope.timestamp)),
      "L'horodatage doit être une date ISO 8601 analysable."
    );
    assert.strictEqual(envelope.topic, 'agent:status');
    assert.strictEqual(envelope.source, 'agent.sidepanel');
    assert.deepStrictEqual(envelope.payload, { status: 'thinking' });
    assert.strictEqual(published.id, envelope.id, "L'appelant reçoit l'enveloppe effectivement diffusée.");

    bus.dispose();
  });

  test("2. Corrélation requête-réponse : l'identifiant de corrélation est propagé tel quel", () => {
    const bus = new ExtensionEventBus();
    let seen: string | undefined;
    bus.subscribe('permission:user:granted', (envelope) => {
      seen = envelope.correlationId;
    });

    bus.publish('permission:user:granted', 'extension.host', { requestId: 'req-1' }, {
      correlationId: 'correlation-42',
    });

    assert.strictEqual(seen, 'correlation-42');
    bus.dispose();
  });

  test('3. Taxonomie : tous les sujets déclarés sont acceptés et un sujet inconnu part en lettre morte', () => {
    const bus = new ExtensionEventBus();

    assert.strictEqual(KNOWN_TOPICS.length, 23, 'Les 23 sujets du PRD doivent être déclarés.');

    // Publication d'un sujet hors taxonomie, forcée par un transtypage.
    bus.publish('agent:inconnu' as never, 'extension.host', { quelconque: true } as never);

    const deadLetters = bus.getDeadLetters();
    assert.strictEqual(deadLetters.length, 1, 'Le sujet inconnu doit être rejeté.');
    assert.match(deadLetters[0].reason, /malformée/);
    bus.dispose();
  });

  test("4. Charge utile absente : l'enveloppe est rejetée sans atteindre les abonnés", () => {
    const bus = new ExtensionEventBus();
    let delivered = 0;
    bus.subscribe('agent:status', () => {
      delivered += 1;
    });

    bus.publish('agent:status', 'extension.host', null as never);

    assert.strictEqual(delivered, 0, "Aucun abonné ne doit recevoir d'enveloppe malformée.");
    assert.strictEqual(bus.getDeadLetters().length, 1);
    bus.dispose();
  });

  test("5. Frontière d'erreur : un abonné fautif n'empêche pas la diffusion vers les autres", () => {
    const bus = new ExtensionEventBus();
    const healthy: string[] = [];

    bus.subscribe('plan:created', () => {
      throw new Error('Le rendu du plan a échoué.');
    });
    bus.subscribe('plan:created', (envelope) => {
      healthy.push(envelope.payload.planId);
    });

    bus.publish('plan:created', 'artifact.renderer', {
      planId: 'plan-1',
      title: 'Plan de test',
      stepCount: 3,
    });

    assert.deepStrictEqual(healthy, ['plan-1'], "L'abonné sain doit tout de même être servi.");
    const deadLetters = bus.getDeadLetters();
    assert.strictEqual(deadLetters.length, 1);
    assert.strictEqual(deadLetters[0].reason, 'Le rendu du plan a échoué.');
    bus.dispose();
  });

  test('6. Vue démontée : les messages sont mis en file circulaire puis rejoués à son retour', () => {
    const bus = new ExtensionEventBus();
    const received: string[] = [];

    bus.subscribe(
      'skill:deploy:completed',
      (envelope) => {
        received.push(envelope.payload.skillId);
      },
      { viewId: 'discovery.panel' }
    );

    // La vue n'a jamais été montée : rien ne doit lui parvenir pour l'instant.
    bus.publish('skill:deploy:completed', 'deploy.service', {
      skillId: 'skill-a',
      target: 'local',
      success: true,
    });
    bus.publish('skill:deploy:completed', 'deploy.service', {
      skillId: 'skill-b',
      target: 'nas',
      success: true,
    });

    assert.deepStrictEqual(received, [], 'Une vue démontée ne reçoit aucun message.');
    assert.strictEqual(bus.queuedCount('discovery.panel'), 2, 'Les deux messages sont en file.');

    bus.mountView('discovery.panel');

    assert.deepStrictEqual(received, ['skill-a', 'skill-b'], "Le rejeu respecte l'ordre de réception.");
    assert.strictEqual(bus.queuedCount('discovery.panel'), 0, 'La file est vidée après le rejeu.');
    bus.dispose();
  });

  test("7. File circulaire bornée : au-delà de la capacité, les messages les plus anciens sont évincés", () => {
    const buffer = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((value) => buffer.push(value));

    assert.strictEqual(buffer.size, 3, 'La file ne dépasse jamais sa capacité.');
    assert.deepStrictEqual(buffer.drain(), [3, 4, 5], 'Seuls les messages récents sont conservés.');
    assert.strictEqual(buffer.size, 0, 'La vidange laisse la file vide.');
    assert.throws(() => new RingBuffer<number>(0), /capacité/);
  });

  test("8. Hydratation : la vue reçoit l'instantané d'état avant le rejeu des deltas", () => {
    const bus = new ExtensionEventBus();
    const order: string[] = [];

    bus.publish('agent:status', 'extension.host', { status: 'idle' });
    bus.subscribe(
      'agent:status',
      (envelope) => {
        order.push(`delta:${envelope.payload.status}`);
      },
      { viewId: 'agent.sidepanel' }
    );
    bus.publish('agent:status', 'extension.host', { status: 'executing' });

    bus.hydrateView('agent.sidepanel', (snapshot) => {
      snapshot.forEach((envelope) => {
        order.push(`snapshot:${envelope.topic}`);
      });
    });

    assert.deepStrictEqual(
      order,
      ['snapshot:agent:status', 'delta:executing'],
      "L'instantané précède le rejeu, ce qui élimine tout affichage périmé."
    );
    bus.dispose();
  });

  test("9. Instantané filtré : seuls les sujets demandés sont restitués à la vue", () => {
    const bus = new ExtensionEventBus();
    bus.publish('agent:status', 'extension.host', { status: 'idle' });
    bus.publish('env:host:detected', 'environment.detector', {
      host: 'vscode-standalone',
      score: 0,
      overridden: false,
    });

    const snapshot = bus.getStateSnapshot(['env:host:detected']);

    assert.strictEqual(snapshot.length, 1);
    assert.strictEqual(snapshot[0].topic, 'env:host:detected');
    bus.dispose();
  });

  test('10. Regroupement adaptatif : une rafale de progressions ne diffuse que le dernier état par étape', async () => {
    const bus = new ExtensionEventBus();
    const received: number[] = [];
    bus.subscribe('agent:step:progress', (envelope) => {
      received.push(envelope.payload.progress);
    });

    for (let progress = 10; progress <= 100; progress += 10) {
      bus.publish('agent:step:progress', 'daemon.bridge', {
        stepId: 'etape-1',
        label: 'Analyse',
        progress,
        done: progress === 100,
      });
    }

    assert.deepStrictEqual(received, [], 'Aucune diffusion immédiate pour un sujet à forte cadence.');
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepStrictEqual(received, [100], 'Seul le dernier état de l’étape est diffusé.');
    bus.dispose();
  });

  test("11. Deux étapes concurrentes ne s'éclipsent pas lors du regroupement", async () => {
    const bus = new ExtensionEventBus();
    const received: string[] = [];
    bus.subscribe('agent:step:progress', (envelope) => {
      received.push(`${envelope.payload.stepId}:${envelope.payload.progress}`);
    });

    bus.publish('agent:step:progress', 'daemon.bridge', {
      stepId: 'etape-1',
      label: 'A',
      progress: 50,
      done: false,
    });
    bus.publish('agent:step:progress', 'daemon.bridge', {
      stepId: 'etape-2',
      label: 'B',
      progress: 70,
      done: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepStrictEqual(received.sort(), ['etape-1:50', 'etape-2:70']);
    bus.dispose();
  });

  test("12. Publication immédiate : l'option contourne le regroupement", () => {
    const bus = new ExtensionEventBus();
    const received: number[] = [];
    bus.subscribe('agent:token:budget', (envelope) => {
      received.push(envelope.payload.usedTokens);
    });

    bus.publish(
      'agent:token:budget',
      'extension.host',
      { usedTokens: 1200, budgetTotal: 20000, availablePercentage: 94 },
      { immediate: true }
    );

    assert.deepStrictEqual(received, [1200]);
    bus.dispose();
  });

  test("13. Désabonnement : un abonné libéré cesse de recevoir, et le bus libéré refuse les publications", () => {
    const bus = new ExtensionEventBus();
    let count = 0;
    const subscription = bus.subscribe('diff:batch:applied', () => {
      count += 1;
    });

    bus.publish('diff:batch:applied', 'diff.reviewer', { filePaths: ['a.ts'], acceptedHunks: 1 });
    subscription.dispose();
    bus.publish('diff:batch:applied', 'diff.reviewer', { filePaths: ['b.ts'], acceptedHunks: 2 });

    assert.strictEqual(count, 1, "L'abonné libéré ne reçoit plus rien.");

    bus.dispose();
    bus.publish('diff:batch:applied', 'diff.reviewer', { filePaths: ['c.ts'], acceptedHunks: 3 });
    assert.ok(
      bus.getDeadLetters().some((entry) => /libéré/.test(entry.reason)),
      'Une publication après libération est consignée en lettre morte.'
    );
  });

  test("14. Lettres mortes bornées : le journal n'excède jamais sa capacité", () => {
    const bus = new ExtensionEventBus({ deadLetterCapacity: 5 });
    for (let i = 0; i < 12; i += 1) {
      bus.publish('agent:status', 'extension.host', undefined as never);
    }

    assert.strictEqual(bus.getDeadLetters().length, 5, 'Le journal est plafonné.');
    bus.clearDeadLetters();
    assert.strictEqual(bus.getDeadLetters().length, 0, 'La purge vide le journal.');
    bus.dispose();
  });

  test("15. Abonnement unique : l'option « once » ne déclenche le gestionnaire qu'une fois", () => {
    const bus = new ExtensionEventBus();
    let count = 0;
    bus.subscribe('artifact:render:ready', () => { count += 1; }, { once: true });

    bus.publish('artifact:render:ready', 'artifact.renderer', { artifactId: 'a1', kind: 'plan' });
    bus.publish('artifact:render:ready', 'artifact.renderer', { artifactId: 'a2', kind: 'plan' });

    assert.strictEqual(count, 1);
    bus.dispose();
  });

  test("16. Rejet asynchrone : une promesse d'abonné rompue est consignée sans casser la diffusion", async () => {
    const bus = new ExtensionEventBus();
    bus.subscribe('daemon:health:ping', async () => {
      throw new Error('Le démon ne répond pas.');
    });

    bus.publish('daemon:health:ping', 'daemon.bridge', { alive: false, latencyMs: 0 }, {
      immediate: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(
      bus.getDeadLetters().some((entry) => entry.reason === 'Le démon ne répond pas.'),
      "Le rejet asynchrone doit rejoindre la file de lettres mortes."
    );
    bus.dispose();
  });
});
