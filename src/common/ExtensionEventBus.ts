/**
 * Médiateur d'événements typé et centralisé (§3.1 du PRD).
 *
 * Le bus constitue l'unique canal de communication entre le panneau latéral,
 * le moteur de rendu de plans, le réviseur de diff, la barre d'état, les
 * réglages et les modales. Aucun de ces composants ne connaît les autres :
 * ils publient et s'abonnent à des sujets.
 *
 * Trois garanties structurantes y sont implantées :
 *   - l'hydratation à l'accrochage d'une vue (instantané puis rejeu des deltas) ;
 *   - la mise en file circulaire des messages destinés aux vues démontées ;
 *   - l'isolation des erreurs d'abonné via une file de lettres mortes.
 */

import { randomUUID } from 'crypto';
import {
  DeadLetterEntry,
  EventEnvelope,
  EventHandler,
  EventSource,
  EventTopic,
  EventTopicMap,
  KNOWN_TOPICS,
} from './eventTypes';

/** Sujets à forte cadence pour lesquels un regroupement adaptatif s'applique. */
const HIGH_FREQUENCY_TOPICS: ReadonlySet<string> = new Set<string>([
  'agent:step:progress',
  'agent:token:budget',
  'daemon:health:ping',
]);

/** Fenêtre de regroupement initiale, alignée sur une cadence de 60 images/s. */
const BASE_DEBOUNCE_MS = 16;

/** Fenêtre de regroupement maximale lorsque le débit d'événements s'emballe. */
const MAX_DEBOUNCE_MS = 250;

/** Nombre de publications par seconde au-delà duquel la fenêtre s'élargit. */
const BURST_THRESHOLD_PER_SECOND = 30;

export interface PublishOptions {
  /** Identifiant de corrélation reliant une réponse à la requête d'origine. */
  correlationId?: string;
  /** Fenêtre de regroupement explicite, en millisecondes. */
  debounceMs?: number;
  /** Force la publication immédiate, même pour un sujet à forte cadence. */
  immediate?: boolean;
}

export interface SubscribeOptions {
  /**
   * Identifiant de la vue abonnée. Lorsqu'il est fourni, les messages publiés
   * pendant que la vue est démontée sont mis en file circulaire puis rejoués.
   */
  viewId?: string;
  /** Ne déclenche le gestionnaire qu'une seule fois. */
  once?: boolean;
}

export interface Disposable {
  dispose(): void;
}

interface Subscription {
  id: string;
  topic: EventTopic;
  handler: EventHandler<EventTopic>;
  viewId?: string;
  once: boolean;
}

/**
 * File circulaire bornée : les messages les plus anciens sont évincés quand la
 * capacité est atteinte, ce qui borne l'empreinte mémoire d'une vue restée
 * longtemps repliée.
 */
export class RingBuffer<T> {
  private readonly items: T[] = [];

  constructor(public readonly capacity: number) {
    if (capacity < 1) {
      throw new Error('La capacité de la file circulaire doit être supérieure ou égale à 1.');
    }
  }

  public push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
  }

  public drain(): T[] {
    const drained = [...this.items];
    this.items.length = 0;
    return drained;
  }

  public get size(): number {
    return this.items.length;
  }
}

export class ExtensionEventBus implements Disposable {
  private readonly subscriptions = new Map<EventTopic, Subscription[]>();

  /** Dernier état connu par sujet, servant d'instantané d'hydratation. */
  private readonly stateSnapshot = new Map<EventTopic, EventEnvelope>();

  /** Files circulaires des vues actuellement démontées ou repliées. */
  private readonly viewQueues = new Map<string, RingBuffer<EventEnvelope>>();

  /** Vues déclarées comme montées et donc aptes à recevoir immédiatement. */
  private readonly mountedViews = new Set<string>();

  private readonly deadLetters: DeadLetterEntry[] = [];

  private readonly pendingDebounce = new Map<string, NodeJS.Timeout>();

  /** Horodatages de publication par sujet, pour mesurer le débit instantané. */
  private readonly recentPublishes = new Map<EventTopic, number[]>();

  private disposed = false;

  constructor(
    private readonly options: {
      viewQueueCapacity?: number;
      deadLetterCapacity?: number;
    } = {}
  ) {}

  private get viewQueueCapacity(): number {
    return this.options.viewQueueCapacity ?? 200;
  }

  private get deadLetterCapacity(): number {
    return this.options.deadLetterCapacity ?? 100;
  }

  /**
   * Abonne un gestionnaire à un sujet. Le retour doit être libéré lors de la
   * destruction du composant abonné.
   */
  public subscribe<T extends EventTopic>(
    topic: T,
    handler: EventHandler<T>,
    options: SubscribeOptions = {}
  ): Disposable {
    const subscription: Subscription = {
      id: randomUUID(),
      topic,
      handler: handler as EventHandler<EventTopic>,
      viewId: options.viewId,
      once: options.once === true,
    };

    const existing = this.subscriptions.get(topic);
    if (existing) {
      existing.push(subscription);
    } else {
      this.subscriptions.set(topic, [subscription]);
    }

    return {
      dispose: () => {
        const list = this.subscriptions.get(topic);
        if (!list) return;
        const index = list.findIndex((s) => s.id === subscription.id);
        if (index >= 0) {
          list.splice(index, 1);
        }
        if (list.length === 0) {
          this.subscriptions.delete(topic);
        }
      },
    };
  }

  /**
   * Publie un événement sur le bus. Les sujets à forte cadence sont regroupés
   * automatiquement sauf demande explicite de publication immédiate.
   */
  public publish<T extends EventTopic>(
    topic: T,
    source: EventSource,
    payload: EventTopicMap[T],
    options: PublishOptions = {}
  ): EventEnvelope<T> {
    const envelope: EventEnvelope<T> = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      topic,
      source,
      payload,
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    };

    if (this.disposed) {
      this.recordDeadLetter(envelope, 'Bus déjà libéré : publication refusée.');
      return envelope;
    }

    if (!this.isValidEnvelope(envelope)) {
      this.recordDeadLetter(envelope, 'Enveloppe malformée : sujet inconnu ou charge utile absente.');
      return envelope;
    }

    // L'instantané est mis à jour dès la publication, même différée, afin
    // qu'une vue qui s'accroche entre-temps reçoive l'état le plus récent.
    this.stateSnapshot.set(topic, envelope as EventEnvelope);

    const debounceMs = this.resolveDebounceWindow(topic, options);
    if (debounceMs <= 0) {
      this.deliver(envelope);
      return envelope;
    }

    const key = this.debounceKey(envelope);
    const pending = this.pendingDebounce.get(key);
    if (pending) {
      clearTimeout(pending);
    }
    const timer = setTimeout(() => {
      this.pendingDebounce.delete(key);
      this.deliver(envelope);
    }, debounceMs);
    // Ne pas retenir le processus Node en vie pour un simple regroupement.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.pendingDebounce.set(key, timer);
    return envelope;
  }

  /**
   * Déclare une vue comme montée : sa file circulaire est vidée et rejouée
   * dans l'ordre de réception.
   */
  public mountView(viewId: string): void {
    this.mountedViews.add(viewId);
    const queue = this.viewQueues.get(viewId);
    if (!queue || queue.size === 0) {
      return;
    }
    for (const envelope of queue.drain()) {
      this.dispatchToSubscribers(envelope, (s) => s.viewId === viewId);
    }
  }

  /** Déclare une vue comme démontée : ses messages seront mis en file. */
  public unmountView(viewId: string): void {
    this.mountedViews.delete(viewId);
  }

  /**
   * Restitue l'instantané d'état courant, servi à une vue au moment de son
   * accrochage avant le rejeu des deltas.
   */
  public getStateSnapshot(topics?: EventTopic[]): EventEnvelope[] {
    const wanted = topics ?? [...this.stateSnapshot.keys()];
    const snapshot: EventEnvelope[] = [];
    for (const topic of wanted) {
      const envelope = this.stateSnapshot.get(topic);
      if (envelope) {
        snapshot.push(envelope);
      }
    }
    return snapshot;
  }

  /**
   * Hydrate une vue : lui transmet l'instantané puis la déclare montée, ce qui
   * déclenche le rejeu des deltas accumulés. Cet ordre élimine les situations
   * de compétition qui laisseraient une vue dans un état périmé.
   */
  public hydrateView(
    viewId: string,
    onSnapshot: (snapshot: EventEnvelope[]) => void,
    topics?: EventTopic[]
  ): void {
    onSnapshot(this.getStateSnapshot(topics));
    this.mountView(viewId);
  }

  /** Nombre de messages en attente pour une vue démontée. */
  public queuedCount(viewId: string): number {
    return this.viewQueues.get(viewId)?.size ?? 0;
  }

  public getDeadLetters(): readonly DeadLetterEntry[] {
    return [...this.deadLetters];
  }

  public clearDeadLetters(): void {
    this.deadLetters.length = 0;
  }

  public dispose(): void {
    this.disposed = true;
    for (const timer of this.pendingDebounce.values()) {
      clearTimeout(timer);
    }
    this.pendingDebounce.clear();
    this.subscriptions.clear();
    this.viewQueues.clear();
    this.mountedViews.clear();
    this.stateSnapshot.clear();
  }

  // ------------------------------------------------------------------
  // Mécanique interne
  // ------------------------------------------------------------------

  private deliver(envelope: EventEnvelope): void {
    this.dispatchToSubscribers(envelope, (s) => {
      // Une vue démontée ne reçoit rien : son message part en file circulaire.
      if (s.viewId && !this.mountedViews.has(s.viewId)) {
        this.enqueueForView(s.viewId, envelope);
        return false;
      }
      return true;
    });
  }

  private dispatchToSubscribers(
    envelope: EventEnvelope,
    predicate: (subscription: Subscription) => boolean
  ): void {
    const subscribers = this.subscriptions.get(envelope.topic);
    if (!subscribers || subscribers.length === 0) {
      return;
    }

    // Copie défensive : un gestionnaire peut se désabonner pendant la diffusion.
    for (const subscription of [...subscribers]) {
      if (!predicate(subscription)) {
        continue;
      }
      if (subscription.once) {
        const list = this.subscriptions.get(envelope.topic);
        if (list) {
          const index = list.findIndex((s) => s.id === subscription.id);
          if (index >= 0) list.splice(index, 1);
        }
      }
      try {
        const outcome = subscription.handler(envelope);
        if (outcome && typeof (outcome as Promise<void>).catch === 'function') {
          (outcome as Promise<void>).catch((err: unknown) => {
            this.recordDeadLetter(envelope, this.describeError(err));
          });
        }
      } catch (err) {
        // Frontière d'erreur : un abonné fautif ne doit jamais interrompre la
        // diffusion vers les vues voisines ni faire tomber l'hôte d'extension.
        this.recordDeadLetter(envelope, this.describeError(err));
      }
    }
  }

  private enqueueForView(viewId: string, envelope: EventEnvelope): void {
    let queue = this.viewQueues.get(viewId);
    if (!queue) {
      queue = new RingBuffer<EventEnvelope>(this.viewQueueCapacity);
      this.viewQueues.set(viewId, queue);
    }
    queue.push(envelope);
  }

  private isValidEnvelope(envelope: EventEnvelope): boolean {
    if (!envelope || typeof envelope.topic !== 'string') return false;
    if (!KNOWN_TOPICS.includes(envelope.topic)) return false;
    if (envelope.payload === null || envelope.payload === undefined) return false;
    if (typeof envelope.payload !== 'object') return false;
    return true;
  }

  private debounceKey(envelope: EventEnvelope): string {
    // Les progressions d'étapes sont regroupées par étape afin que deux étapes
    // concurrentes ne s'éclipsent pas mutuellement.
    if (envelope.topic === 'agent:step:progress') {
      const payload = envelope.payload as EventTopicMap['agent:step:progress'];
      return `${envelope.topic}::${payload.stepId}`;
    }
    return `${envelope.topic}::${envelope.source}`;
  }

  /**
   * Détermine la fenêtre de regroupement : nulle pour les sujets ordinaires,
   * élargie progressivement pour les sujets à forte cadence lorsque le débit
   * dépasse le seuil de rafale.
   */
  private resolveDebounceWindow(topic: EventTopic, options: PublishOptions): number {
    if (options.immediate) return 0;
    if (typeof options.debounceMs === 'number') return Math.max(0, options.debounceMs);
    if (!HIGH_FREQUENCY_TOPICS.has(topic)) return 0;

    const now = Date.now();
    const history = this.recentPublishes.get(topic) ?? [];
    const windowStart = now - 1000;
    const recent = history.filter((t) => t >= windowStart);
    recent.push(now);
    this.recentPublishes.set(topic, recent);

    if (recent.length <= BURST_THRESHOLD_PER_SECOND) {
      return BASE_DEBOUNCE_MS;
    }
    const overflowFactor = recent.length / BURST_THRESHOLD_PER_SECOND;
    return Math.min(MAX_DEBOUNCE_MS, Math.round(BASE_DEBOUNCE_MS * overflowFactor));
  }

  private describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  private recordDeadLetter(
    envelope: EventEnvelope | { topic: string; [key: string]: unknown },
    reason: string
  ): void {
    this.deadLetters.push({
      envelope,
      reason,
      occurredAt: new Date().toISOString(),
    });
    if (this.deadLetters.length > this.deadLetterCapacity) {
      this.deadLetters.shift();
    }
  }
}

/** Instance partagée par l'hôte d'extension. */
export const extensionEventBus = new ExtensionEventBus();
