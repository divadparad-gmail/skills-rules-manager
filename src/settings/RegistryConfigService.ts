/**
 * Autorité centrale de configuration des registres de recherche (§3.3 du PRD).
 *
 * Ce service encapsule toute interaction avec les API de configuration et de
 * stockage sécurisé de VS Code. Il expose un accès typé et validé, applique
 * les règles de portée et de précédence, et garde les identifiants hors de
 * `settings.json` en les confiant au coffre chiffré du système.
 */

import {
  CustomSearchUrlConfig,
  RegistryAuthType,
  RegistryOrigin,
  RegistryProbeResult,
} from '../common/discoveryTypes';
import { DiscoveryResourceType } from '../common/eventTypes';

/** Clé du réglage contribué dans package.json. */
export const SEARCH_URLS_SETTING = 'antigravity.skills.searchUrls';

/** Préfixe des clés de coffre réservées aux registres. */
export const REGISTRY_SECRET_PREFIX = 'antigravity.registry.';

/**
 * Seule clé de coffre qu'un registre peut désigner. Lier la clé à
 * l'identifiant empêche une entrée de viser le secret d'un autre registre ou
 * la clé Gemini.
 */
export function registrySecretKey(registryId: string): string {
  return `${REGISTRY_SECRET_PREFIX}${registryId}`;
}

export const DEFAULT_TIMEOUT_MS = 5000;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 30000;
export const DEFAULT_PRIORITY = 10;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 100;

export const ALL_RESOURCE_TYPES: DiscoveryResourceType[] = ['skills', 'rules', 'workflows', 'hooks'];

const VALID_AUTH_TYPES: RegistryAuthType[] = ['none', 'bearer', 'apiKey', 'basic', 'customHeader'];

/**
 * Lecture d'un réglage dans les deux portées, telle que VS Code la restitue
 * via `inspect()`. Le service n'a besoin de rien d'autre pour appliquer les
 * règles de précédence.
 */
export interface ScopedSettingValue<T> {
  userValue?: T;
  workspaceValue?: T;
}

/** Accès à la configuration, injectable pour les tests hors hôte VS Code. */
export interface ConfigurationPort {
  inspect<T>(section: string): ScopedSettingValue<T> | undefined;
  get<T>(section: string, defaultValue: T): T;
  update(section: string, value: unknown, scope: 'user' | 'workspace'): Promise<void>;
}

/** Accès au coffre chiffré, injectable pour les tests. */
export interface SecretStoragePort {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Transport HTTP minimal utilisé par la sonde de santé. */
export interface HealthProbePort {
  probe(
    url: string,
    options: { headers: Record<string, string>; timeoutMs: number }
  ): Promise<{ statusCode: number; body: string }>;
}

export interface ValidationIssue {
  field: keyof CustomSearchUrlConfig | 'url';
  message: string;
}

export class RegistryConfigService {
  constructor(
    private readonly config: ConfigurationPort,
    private readonly secrets?: SecretStoragePort,
    private readonly healthProbe?: HealthProbePort
  ) {}

  // ------------------------------------------------------------------
  // Lecture et précédence des portées
  // ------------------------------------------------------------------

  /**
   * Restitue la liste effective des registres : les entrées définies dans
   * l'espace de travail sont ajoutées à celles de l'utilisateur, puis la liste
   * est dédoublonnée sur l'URL canonique — une définition d'espace de travail
   * l'emportant sur une définition utilisateur de même URL.
   *
   * Chaque entrée reçoit ici son origine, qui conditionne l'accès au coffre.
   * Une entrée d'espace de travail reprenant l'identifiant d'un registre
   * utilisateur d'URL différente est écartée : elle usurperait ses actions.
   */
  public getEffectiveRegistries(): CustomSearchUrlConfig[] {
    const inspected = this.config.inspect<unknown[]>(SEARCH_URLS_SETTING);
    const userEntries = this.normalizeList(inspected?.userValue, 'user');
    const workspaceEntries = this.normalizeList(inspected?.workspaceValue, 'workspace');

    const byCanonicalUrl = new Map<string, CustomSearchUrlConfig>();
    for (const entry of userEntries) {
      byCanonicalUrl.set(canonicalizeUrl(entry.url), { ...entry, origin: 'user' });
    }
    const userUrlById = new Map(userEntries.map((entry) => [entry.id, canonicalizeUrl(entry.url)]));
    for (const entry of workspaceEntries) {
      const canonical = canonicalizeUrl(entry.url);
      const userUrl = userUrlById.get(entry.id);
      if (userUrl !== undefined && userUrl !== canonical) continue;
      byCanonicalUrl.set(canonical, { ...entry, origin: 'workspace' });
    }

    return [...byCanonicalUrl.values()].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.localeCompare(b.name, 'fr');
    });
  }

  /** Registres actifs prenant en charge au moins un des types demandés. */
  public getActiveRegistries(types: DiscoveryResourceType[]): CustomSearchUrlConfig[] {
    return this.getEffectiveRegistries().filter(
      (registry) =>
        registry.enabled && types.some((type) => registry.supportedTypes.includes(type))
    );
  }

  public isDefaultRegistryEnabled(): boolean {
    return this.config.get<boolean>('antigravity.skills.enableDefaultRegistry', true);
  }

  public getGlobalTimeoutMs(): number {
    const raw = this.config.get<number>('antigravity.skills.requestTimeoutMs', DEFAULT_TIMEOUT_MS);
    return clamp(raw, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  }

  public getMaxParallelQueries(): number {
    const raw = this.config.get<number>('antigravity.skills.maxParallelRegistryQueries', 5);
    return clamp(Math.trunc(raw), 1, 20);
  }

  // ------------------------------------------------------------------
  // Opérations de création, mise à jour et suppression
  // ------------------------------------------------------------------

  /**
   * Ajoute un registre dans la portée demandée après validation complète.
   * Un doublon d'URL canonique dans la même portée est refusé.
   */
  public async addRegistry(
    candidate: Partial<CustomSearchUrlConfig>,
    scope: 'user' | 'workspace' = 'user'
  ): Promise<CustomSearchUrlConfig> {
    const registry = this.withDefaults(candidate);
    // La clé du coffre ne peut être que la clé canonique : on la renseigne
    // d'office lorsque le mode d'authentification en exige une.
    if (registry.authType !== 'none' && !registry.secretKeyRef) {
      registry.secretKeyRef = registrySecretKey(registry.id);
    }
    const issues = RegistryConfigService.validate(registry, scope);
    if (issues.length > 0) {
      throw new Error(issues.map((issue) => issue.message).join(' '));
    }

    const current = this.readScope(scope);
    const canonical = canonicalizeUrl(registry.url);
    if (current.some((entry) => canonicalizeUrl(entry.url) === canonical)) {
      throw new Error(`Un registre pointant vers « ${registry.url} » est déjà configuré.`);
    }
    if (current.some((entry) => entry.id === registry.id)) {
      throw new Error(`L'identifiant « ${registry.id} » est déjà utilisé par un autre registre.`);
    }

    await this.config.update(SEARCH_URLS_SETTING, [...current, registry], scope);
    return registry;
  }

  /** Met à jour un registre existant, champ par champ. */
  public async updateRegistry(
    id: string,
    changes: Partial<CustomSearchUrlConfig>,
    scope: 'user' | 'workspace' = 'user'
  ): Promise<CustomSearchUrlConfig> {
    const current = this.readScope(scope);
    const index = current.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error(`Aucun registre portant l'identifiant « ${id} » n'a été trouvé.`);
    }

    const merged = this.withDefaults({ ...current[index], ...changes, id });
    const issues = RegistryConfigService.validate(merged, scope);
    if (issues.length > 0) {
      throw new Error(issues.map((issue) => issue.message).join(' '));
    }

    const canonical = canonicalizeUrl(merged.url);
    const collision = current.some(
      (entry, position) => position !== index && canonicalizeUrl(entry.url) === canonical
    );
    if (collision) {
      throw new Error(`Un autre registre pointe déjà vers « ${merged.url} ».`);
    }

    const next = [...current];
    next[index] = merged;
    await this.config.update(SEARCH_URLS_SETTING, next, scope);
    return merged;
  }

  /** Supprime un registre et le secret associé, le cas échéant. */
  public async removeRegistry(id: string, scope: 'user' | 'workspace' = 'user'): Promise<void> {
    const current = this.readScope(scope);
    const target = current.find((entry) => entry.id === id);
    const next = current.filter((entry) => entry.id !== id);
    if (next.length === current.length) {
      throw new Error(`Aucun registre portant l'identifiant « ${id} » n'a été trouvé.`);
    }
    await this.config.update(SEARCH_URLS_SETTING, next, scope);

    // Seul un registre utilisateur possède un secret : retirer une entrée
    // d'espace de travail homonyme ne doit pas purger celui de l'utilisateur.
    if (scope === 'user' && target?.secretKeyRef && this.secrets) {
      await this.secrets.delete(registrySecretKey(target.id));
    }
  }

  /** Active ou désactive un registre sans perdre sa configuration. */
  public async toggleRegistry(
    id: string,
    enabled: boolean,
    scope: 'user' | 'workspace' = 'user'
  ): Promise<CustomSearchUrlConfig> {
    return this.updateRegistry(id, { enabled }, scope);
  }

  /**
   * Réordonne les registres d'une portée : la position dans le tableau fourni
   * détermine la nouvelle priorité de recherche.
   */
  public async reorderRegistries(
    orderedIds: string[],
    scope: 'user' | 'workspace' = 'user'
  ): Promise<CustomSearchUrlConfig[]> {
    const current = this.readScope(scope);
    const byId = new Map(current.map((entry) => [entry.id, entry]));

    const reordered: CustomSearchUrlConfig[] = [];
    orderedIds.forEach((id, position) => {
      const entry = byId.get(id);
      if (!entry) return;
      reordered.push({ ...entry, priority: clamp(position + 1, MIN_PRIORITY, MAX_PRIORITY) });
      byId.delete(id);
    });
    // Les registres non cités conservent leur ordre relatif, à la suite.
    let nextPriority = reordered.length + 1;
    for (const entry of byId.values()) {
      reordered.push({ ...entry, priority: clamp(nextPriority, MIN_PRIORITY, MAX_PRIORITY) });
      nextPriority += 1;
    }

    await this.config.update(SEARCH_URLS_SETTING, reordered, scope);
    return reordered;
  }

  // ------------------------------------------------------------------
  // Identifiants et en-têtes d'authentification
  // ------------------------------------------------------------------

  /**
   * Enregistre le secret d'un registre dans le coffre chiffré du système, sous
   * la clé canonique dérivée de son identifiant.
   */
  public async storeCredential(registry: CustomSearchUrlConfig, secret: string): Promise<string> {
    if (!this.secrets) {
      throw new Error("Le coffre de secrets n'est pas disponible dans ce contexte.");
    }
    if (registry.origin === 'workspace') {
      throw new Error(
        "Un registre défini par l'espace de travail ne peut pas recevoir d'identifiant : ajoutez-le à vos réglages utilisateur."
      );
    }
    const key = registrySecretKey(registry.id);
    await this.secrets.store(key, secret);
    return key;
  }

  /**
   * Construit les en-têtes HTTP d'une requête vers un registre, en récupérant
   * le secret au dernier moment : il ne transite jamais par la configuration.
   *
   * Les trois chemins de requête (recherche du panneau, recherche rapide et
   * test de connexion) passent par cette méthode : c'est ici que se décide
   * l'accès au coffre.
   */
  public async buildAuthHeaders(registry: CustomSearchUrlConfig): Promise<Record<string, string>> {
    // Un registre déclaré par l'espace de travail provient d'un dépôt : il
    // n'accède jamais au coffre et n'impose aucun en-tête.
    if (registry.origin === 'workspace') {
      return { Accept: 'application/json' };
    }

    const headers: Record<string, string> = { Accept: 'application/json', ...(registry.customHeaders ?? {}) };

    if (registry.authType === 'none' || !registry.secretKeyRef || !this.secrets) {
      return headers;
    }

    // Défense en profondeur : même si une entrée échappait à la validation,
    // seule la clé canonique de ce registre peut être lue.
    const key = registrySecretKey(registry.id);
    if (registry.secretKeyRef !== key) {
      return headers;
    }

    const secret = await this.secrets.get(key);
    if (!secret) {
      return headers;
    }

    switch (registry.authType) {
      case 'bearer':
        headers.Authorization = `Bearer ${secret}`;
        break;
      case 'apiKey':
        headers['X-API-Key'] = secret;
        break;
      case 'basic':
        headers.Authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
        break;
      case 'customHeader':
        // Le secret porte la forme « NomEnTete: valeur ».
        {
          const separatorIndex = secret.indexOf(':');
          if (separatorIndex > 0) {
            const headerName = secret.slice(0, separatorIndex).trim();
            const headerValue = secret.slice(separatorIndex + 1).trim();
            if (headerName) headers[headerName] = headerValue;
          }
        }
        break;
      default:
        break;
    }

    return headers;
  }

  // ------------------------------------------------------------------
  // Sonde de santé « Tester la connexion »
  // ------------------------------------------------------------------

  /**
   * Interroge le point de terminaison et qualifie son état : joignable,
   * refusé, injoignable ou de schéma non conforme.
   */
  public async testConnection(registry: CustomSearchUrlConfig): Promise<RegistryProbeResult> {
    if (!this.healthProbe) {
      return {
        registryId: registry.id,
        status: 'unreachable',
        latencyMs: 0,
        supportedTypes: [],
        message: "Aucun transport HTTP n'est disponible pour sonder ce registre.",
      };
    }

    const issues = RegistryConfigService.validate(registry);
    if (issues.length > 0) {
      return {
        registryId: registry.id,
        status: 'invalid_schema',
        latencyMs: 0,
        supportedTypes: [],
        message: issues.map((issue) => issue.message).join(' '),
      };
    }

    const headers = await this.buildAuthHeaders(registry);
    const started = Date.now();

    try {
      const response = await this.healthProbe.probe(registry.url, {
        headers,
        timeoutMs: registry.timeoutMs,
      });
      const latencyMs = Date.now() - started;

      if (response.statusCode === 401 || response.statusCode === 403) {
        return {
          registryId: registry.id,
          status: 'unauthorized',
          latencyMs,
          supportedTypes: [],
          message: `Le registre a refusé les identifiants fournis (code ${response.statusCode}).`,
        };
      }

      if (response.statusCode < 200 || response.statusCode >= 400) {
        return {
          registryId: registry.id,
          status: 'unreachable',
          latencyMs,
          supportedTypes: [],
          message: `Le registre a répondu avec le code ${response.statusCode}.`,
        };
      }

      const supportedTypes = this.extractSupportedTypes(response.body);
      if (!supportedTypes) {
        return {
          registryId: registry.id,
          status: 'invalid_schema',
          latencyMs,
          supportedTypes: [],
          message: "La réponse du registre ne respecte pas le schéma attendu (JSON d'entrées de catalogue).",
        };
      }

      return {
        registryId: registry.id,
        status: 'connected',
        latencyMs,
        supportedTypes,
        message: `Connexion établie en ${latencyMs} ms.`,
      };
    } catch (err) {
      return {
        registryId: registry.id,
        status: 'unreachable',
        latencyMs: Date.now() - started,
        supportedTypes: [],
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  /**
   * Valide un registre. Le protocole HTTPS est exigé, à la seule exception des
   * adresses de bouclage utilisées pendant le développement local, tolérées
   * pour les seuls registres d'origine utilisateur.
   */
  public static validate(
    registry: CustomSearchUrlConfig,
    origin: RegistryOrigin = registry.origin ?? 'user'
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!registry.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(registry.id)) {
      issues.push({
        field: 'id',
        message: "L'identifiant doit être un slug alphanumérique (tirets, points et soulignés admis).",
      });
    }

    if (!registry.name || registry.name.trim().length === 0) {
      issues.push({ field: 'name', message: 'Le nom lisible du registre est obligatoire.' });
    }

    const urlIssue = validateRegistryUrl(registry.url, origin);
    if (urlIssue) {
      issues.push({ field: 'url', message: urlIssue });
    }

    if (
      !Number.isFinite(registry.priority) ||
      registry.priority < MIN_PRIORITY ||
      registry.priority > MAX_PRIORITY
    ) {
      issues.push({
        field: 'priority',
        message: `La priorité doit être comprise entre ${MIN_PRIORITY} et ${MAX_PRIORITY}.`,
      });
    }

    if (
      !Number.isFinite(registry.timeoutMs) ||
      registry.timeoutMs < MIN_TIMEOUT_MS ||
      registry.timeoutMs > MAX_TIMEOUT_MS
    ) {
      issues.push({
        field: 'timeoutMs',
        message: `Le délai d'attente doit être compris entre ${MIN_TIMEOUT_MS} et ${MAX_TIMEOUT_MS} millisecondes.`,
      });
    }

    if (!VALID_AUTH_TYPES.includes(registry.authType)) {
      issues.push({
        field: 'authType',
        message: `Le mode d'authentification doit faire partie de : ${VALID_AUTH_TYPES.join(', ')}.`,
      });
    }

    if (registry.authType !== 'none' && !registry.secretKeyRef) {
      issues.push({
        field: 'secretKeyRef',
        message:
          "Un mode d'authentification autre que « none » exige une référence de secret stockée dans le coffre.",
      });
    }

    if (registry.secretKeyRef && registry.secretKeyRef !== registrySecretKey(registry.id)) {
      issues.push({
        field: 'secretKeyRef',
        message: `La référence de secret doit valoir « ${registrySecretKey(registry.id)} » : un registre ne peut désigner que sa propre clé du coffre.`,
      });
    }

    if (!Array.isArray(registry.supportedTypes) || registry.supportedTypes.length === 0) {
      issues.push({
        field: 'supportedTypes',
        message: 'Le registre doit déclarer au moins une catégorie de ressources prise en charge.',
      });
    }

    return issues;
  }

  // ------------------------------------------------------------------
  // Mécanique interne
  // ------------------------------------------------------------------

  private readScope(scope: 'user' | 'workspace'): CustomSearchUrlConfig[] {
    const inspected = this.config.inspect<unknown[]>(SEARCH_URLS_SETTING);
    return this.normalizeList(
      scope === 'user' ? inspected?.userValue : inspected?.workspaceValue,
      scope
    );
  }

  /**
   * Applique les valeurs par défaut documentées au chapitre 3.3 du PRD. Seuls
   * les champs énumérés ici sont recopiés : `origin`, calculé à la lecture,
   * n'est donc jamais repris de la configuration ni persisté.
   */
  private withDefaults(candidate: Partial<CustomSearchUrlConfig>): CustomSearchUrlConfig {
    const supportedTypes = Array.isArray(candidate.supportedTypes)
      ? candidate.supportedTypes.filter((type): type is DiscoveryResourceType =>
          ALL_RESOURCE_TYPES.includes(type)
        )
      : [...ALL_RESOURCE_TYPES];

    return {
      id: (candidate.id ?? '').trim(),
      name: (candidate.name ?? '').trim(),
      url: (candidate.url ?? '').trim(),
      enabled: candidate.enabled !== false,
      priority: clamp(
        Number.isFinite(candidate.priority) ? Number(candidate.priority) : DEFAULT_PRIORITY,
        MIN_PRIORITY,
        MAX_PRIORITY
      ),
      authType: candidate.authType ?? 'none',
      ...(candidate.secretKeyRef ? { secretKeyRef: candidate.secretKeyRef } : {}),
      ...(candidate.customHeaders ? { customHeaders: candidate.customHeaders } : {}),
      timeoutMs: clamp(
        Number.isFinite(candidate.timeoutMs) ? Number(candidate.timeoutMs) : DEFAULT_TIMEOUT_MS,
        MIN_TIMEOUT_MS,
        MAX_TIMEOUT_MS
      ),
      supportedTypes: supportedTypes.length > 0 ? supportedTypes : [...ALL_RESOURCE_TYPES],
    };
  }

  /**
   * Transforme une valeur brute de configuration en registres exploitables.
   * Les identifiants sont rendus uniques : seule la première entrée portant un
   * identifiant donné est retenue.
   */
  private normalizeList(raw: unknown, origin: RegistryOrigin): CustomSearchUrlConfig[] {
    if (!Array.isArray(raw)) return [];
    const normalized: CustomSearchUrlConfig[] = [];
    const seenIds = new Set<string>();
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const registry = this.withDefaults(entry as Partial<CustomSearchUrlConfig>);
      // Une entrée invalide est ignorée plutôt que de faire échouer la lecture
      // complète du réglage : la vue des réglages signale le problème.
      if (RegistryConfigService.validate(registry, origin).length > 0) continue;
      if (seenIds.has(registry.id)) continue;
      seenIds.add(registry.id);
      normalized.push(registry);
    }
    return normalized;
  }

  /**
   * Vérifie que la réponse respecte le schéma de catalogue attendu et en
   * déduit les catégories réellement servies.
   */
  private extractSupportedTypes(body: string): DiscoveryResourceType[] | null {
    try {
      const parsed = JSON.parse(body) as unknown;
      const entries = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown[] }).results)
          ? (parsed as { results: unknown[] }).results
          : null;

      if (!entries) return null;

      const found = new Set<DiscoveryResourceType>();
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const type = (entry as { type?: unknown }).type;
        if (typeof type === 'string') {
          const normalized = normalizeResourceType(type);
          if (normalized) found.add(normalized);
        }
      }
      return found.size > 0 ? [...found] : [...ALL_RESOURCE_TYPES];
    } catch {
      return null;
    }
  }
}

/**
 * Normalise une URL pour le dédoublonnage : protocole, hôte, port et chemin
 * en minuscules, barre oblique finale retirée.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    const pathname = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${protocol}//${host}${port}${pathname}`;
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Contrôle de forme et de sécurité d'une URL de registre. Retourne le message
 * d'erreur à afficher, ou `null` lorsque l'URL est acceptable.
 *
 * Les adresses de bouclage ne sont tolérées que pour un registre d'origine
 * utilisateur : un dépôt ne doit pas pouvoir diriger des requêtes vers les
 * services qui écoutent localement sur le poste.
 */
export function validateRegistryUrl(rawUrl: string, origin: RegistryOrigin = 'user'): string | null {
  if (!rawUrl || rawUrl.trim().length === 0) {
    return "L'URL du registre est obligatoire.";
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return `L'URL « ${rawUrl} » n'est pas syntaxiquement valide.`;
  }

  const host = parsed.hostname.toLowerCase();
  if (origin === 'workspace' && isLoopbackHost(host)) {
    return "Un registre défini par l'espace de travail ne peut pas viser une adresse locale du poste.";
  }

  if (parsed.protocol === 'https:') {
    return null;
  }

  if (parsed.protocol === 'http:') {
    if (origin === 'user' && isLoopbackHost(host)) {
      return null;
    }
    return "Le protocole HTTP n'est toléré que pour les adresses locales (localhost ou 127.0.0.1) de vos réglages utilisateur ; utilisez HTTPS.";
  }

  return `Le protocole « ${parsed.protocol} » n'est pas pris en charge : utilisez HTTPS.`;
}

/**
 * Reconnaît une adresse de bouclage : localhost et ses sous-domaines, toute la
 * plage 127.0.0.0/8, 0.0.0.0 et ::1 (l'analyseur d'URL restitue l'IPv6 entre
 * crochets).
 */
function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]'
  );
}

/** Convertit une étiquette de type arbitraire en catégorie connue. */
export function normalizeResourceType(raw: string): DiscoveryResourceType | null {
  const value = raw.trim().toLowerCase();
  switch (value) {
    case 'skill':
    case 'skills':
      return 'skills';
    case 'rule':
    case 'rules':
      return 'rules';
    case 'workflow':
    case 'workflows':
      return 'workflows';
    case 'hook':
    case 'hooks':
      return 'hooks';
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
