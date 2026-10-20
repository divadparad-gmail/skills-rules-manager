/**
 * Moteur de recherche sémantique et de résolution d'intention floue (§3.2 du
 * PRD).
 *
 * Le moteur déconstruit une demande formulée en langage naturel — souvent
 * familière ou orientée objectif — pour en extraire l'intention, la pile
 * technique visée et les contraintes opérationnelles, puis évalue chaque
 * manifeste candidat contre cette intention.
 *
 * L'appel au modèle Gemini est confié à un port injectable. Lorsqu'aucune clé
 * d'API n'est configurée ou que le service est injoignable, le moteur bascule
 * sur une analyse lexicale locale : la recherche reste utilisable hors ligne,
 * au prix d'une finesse moindre, plutôt que d'échouer.
 */

import { QueryIntent, RawRegistryEntry } from '../common/discoveryTypes';

/** Accès au modèle de langage, injectable pour les tests et le mode hors ligne. */
export interface GeminiClientPort {
  /** Appel de raisonnement renvoyant du texte brut. */
  generate(prompt: string, options?: { timeoutMs?: number }): Promise<string>;
  /** Génération de vecteurs d'embedding pour l'appariement sémantique. */
  embed(texts: string[], options?: { timeoutMs?: number }): Promise<number[][]>;
}

export interface ScoredCandidate {
  entry: RawRegistryEntry;
  semanticScore: number;
  matchRationale: string;
}

/** Mots vides français et anglais écartés de l'analyse lexicale. */
const STOP_WORDS = new Set<string>([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'pour', 'avec', 'sans', 'dans',
  'sur', 'par', 'que', 'qui', 'est', 'sont', 'au', 'aux', 'en', 'je', 'veux', 'cherche', 'besoin',
  'the', 'a', 'an', 'of', 'and', 'or', 'for', 'with', 'without', 'in', 'on', 'by', 'that', 'is',
  'are', 'to', 'i', 'want', 'need', 'looking', 'find', 'me', 'my',
]);

/** Lexique de piles techniques reconnues dans une demande. */
const TECH_LEXICON: Record<string, string[]> = {
  react: ['react', 'jsx', 'hooks', 'redux', 'nextjs', 'next.js'],
  vue: ['vue', 'vuejs', 'nuxt', 'pinia'],
  angular: ['angular', 'rxjs', 'ngrx'],
  node: ['node', 'nodejs', 'express', 'fastify', 'npm'],
  python: ['python', 'django', 'flask', 'pandas', 'fastapi'],
  dotnet: ['dotnet', '.net', 'csharp', 'c#', 'aspnet'],
  database: ['sql', 'postgres', 'postgresql', 'mysql', 'mongodb', 'sqlite', 'database', 'base'],
  devops: ['docker', 'kubernetes', 'terraform', 'ansible', 'ci', 'cd', 'pipeline', 'deploiement'],
  web: ['scraping', 'scrape', 'playwright', 'puppeteer', 'selenium', 'browser', 'navigateur'],
  testing: ['test', 'tests', 'jest', 'vitest', 'pytest', 'mocha', 'e2e'],
  api: ['api', 'rest', 'graphql', 'openapi', 'swagger', 'grpc'],
  security: ['auth', 'oauth', 'jwt', 'securite', 'security', 'chiffrement', 'encryption'],
};

/** Contraintes opérationnelles fréquemment exprimées. */
const CONSTRAINT_LEXICON: Record<string, string[]> = {
  authentification: ['auth', 'authentifie', 'authenticated', 'login', 'connexion', 'behind auth'],
  'temps réel': ['temps reel', 'realtime', 'real-time', 'streaming', 'live'],
  performance: ['performance', 'rapide', 'fast', 'bottleneck', 'lent', 'slow', 'optimis'],
  'hors ligne': ['offline', 'hors ligne', 'sans reseau'],
  'données dynamiques': ['dynamique', 'dynamic', 'spa', 'javascript rendered'],
};

export class SemanticSearchEngine {
  constructor(private readonly client?: GeminiClientPort) {}

  /**
   * Analyse une requête libre et en extrait l'intention exploitable. En cas
   * d'indisponibilité du modèle, l'analyse lexicale locale prend le relais.
   */
  public async interpretQuery(query: string): Promise<QueryIntent> {
    const local = this.interpretQueryLocally(query);
    if (!this.client) {
      return local;
    }

    try {
      const prompt = buildIntentPrompt(query);
      const raw = await this.client.generate(prompt, { timeoutMs: 8000 });
      const parsed = parseIntentResponse(raw);
      if (!parsed) return local;

      // Les mots-clés locaux sont conservés en complément : ils garantissent
      // un socle lexical même si le modèle renvoie une analyse lacunaire.
      const keywords = dedupe([...parsed.keywords, ...local.keywords]);
      return {
        normalizedQuery: parsed.normalizedQuery || local.normalizedQuery,
        keywords,
        techStack: dedupe([...parsed.techStack, ...local.techStack]),
        constraints: dedupe([...parsed.constraints, ...local.constraints]),
        ambiguous: parsed.ambiguous ?? local.ambiguous,
        refinements: parsed.refinements.length > 0 ? parsed.refinements : local.refinements,
      };
    } catch {
      return local;
    }
  }

  /**
   * Évalue les candidats contre l'intention et produit, pour chacun, un score
   * de pertinence normalisé entre 0 et 1 accompagné de son explication.
   */
  public async scoreCandidates(
    intent: QueryIntent,
    candidates: RawRegistryEntry[]
  ): Promise<ScoredCandidate[]> {
    if (candidates.length === 0) return [];

    const lexicalScores = candidates.map((entry) => this.lexicalScore(intent, entry));

    if (!this.client) {
      return candidates.map((entry, index) => ({
        entry,
        semanticScore: lexicalScores[index],
        matchRationale: this.buildRationale(intent, entry, lexicalScores[index]),
      }));
    }

    try {
      const documents = candidates.map((entry) => describeEntry(entry));
      const vectors = await this.client.embed([intent.normalizedQuery, ...documents], {
        timeoutMs: 10000,
      });
      const [queryVector, ...documentVectors] = vectors;
      if (!queryVector || documentVectors.length !== candidates.length) {
        throw new Error("Le service d'embeddings a renvoyé un nombre de vecteurs inattendu.");
      }

      return candidates.map((entry, index) => {
        const similarity = cosineSimilarity(queryVector, documentVectors[index]);
        // La similarité vectorielle est pondérée avec le score lexical : elle
        // capte le sens, le lexical ancre les termes techniques exacts.
        const semanticScore = clamp01(0.7 * normalizeSimilarity(similarity) + 0.3 * lexicalScores[index]);
        return {
          entry,
          semanticScore,
          matchRationale: this.buildRationale(intent, entry, semanticScore),
        };
      });
    } catch {
      return candidates.map((entry, index) => ({
        entry,
        semanticScore: lexicalScores[index],
        matchRationale: this.buildRationale(intent, entry, lexicalScores[index]),
      }));
    }
  }

  /**
   * Analyse lexicale locale : tokenisation, retrait des mots vides, détection
   * de pile technique et de contraintes, puis repérage d'ambiguïté.
   */
  public interpretQueryLocally(query: string): QueryIntent {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    const tokens = tokenize(normalizedQuery);
    const keywords = tokens.filter((token) => !STOP_WORDS.has(token) && token.length > 2);

    const haystack = stripAccents(normalizedQuery.toLowerCase());
    const techStack = Object.entries(TECH_LEXICON)
      .filter(([, markers]) => markers.some((marker) => haystack.includes(marker)))
      .map(([stack]) => stack);

    const constraints = Object.entries(CONSTRAINT_LEXICON)
      .filter(([, markers]) => markers.some((marker) => haystack.includes(marker)))
      .map(([constraint]) => constraint);

    // Une demande très courte et dépourvue de repère technique ne permet pas
    // de départager les domaines : on propose alors des pistes de précision.
    const ambiguous = keywords.length <= 1 && techStack.length === 0;

    return {
      normalizedQuery,
      keywords: dedupe(keywords),
      techStack,
      constraints,
      ambiguous,
      refinements: ambiguous ? buildRefinements(normalizedQuery) : [],
    };
  }

  /**
   * Score lexical d'un candidat : recouvrement pondéré entre les mots-clés de
   * l'intention et les champs du manifeste, le nom pesant plus que les
   * étiquettes et la description.
   */
  private lexicalScore(intent: QueryIntent, entry: RawRegistryEntry): number {
    const keywords = intent.keywords;
    if (keywords.length === 0) return 0;

    const name = stripAccents(String(entry.name ?? '').toLowerCase());
    const description = stripAccents(String(entry.description ?? '').toLowerCase());
    const tags = (entry.tags ?? []).map((tag) => stripAccents(String(tag).toLowerCase()));

    let score = 0;
    for (const keyword of keywords) {
      const needle = stripAccents(keyword);
      if (name.includes(needle)) score += 3;
      else if (tags.some((tag) => tag.includes(needle))) score += 2;
      else if (description.includes(needle)) score += 1;
    }

    // Une pile technique explicitement retrouvée renforce nettement le lien.
    for (const stack of intent.techStack) {
      const markers = TECH_LEXICON[stack] ?? [stack];
      if (markers.some((marker) => name.includes(marker) || description.includes(marker))) {
        score += 2;
      }
    }

    const maxScore = keywords.length * 3 + intent.techStack.length * 2;
    return maxScore > 0 ? clamp01(score / maxScore) : 0;
  }

  /**
   * Rédige l'explication affichée sous le résultat : sur quoi repose
   * concrètement la correspondance.
   */
  private buildRationale(intent: QueryIntent, entry: RawRegistryEntry, score: number): string {
    const name = String(entry.name ?? 'Cette ressource');
    const description = String(entry.description ?? '');
    const haystack = stripAccents(`${name} ${description}`.toLowerCase());

    const matchedKeywords = intent.keywords.filter((keyword) =>
      haystack.includes(stripAccents(keyword))
    );
    const matchedStacks = intent.techStack.filter((stack) =>
      (TECH_LEXICON[stack] ?? [stack]).some((marker) => haystack.includes(marker))
    );
    const matchedConstraints = intent.constraints.filter((constraint) =>
      (CONSTRAINT_LEXICON[constraint] ?? [constraint]).some((marker) => haystack.includes(marker))
    );

    const fragments: string[] = [];
    if (matchedKeywords.length > 0) {
      fragments.push(`couvre les termes « ${matchedKeywords.slice(0, 4).join(', ')} »`);
    }
    if (matchedStacks.length > 0) {
      fragments.push(`cible la pile ${matchedStacks.join(' et ')}`);
    }
    if (matchedConstraints.length > 0) {
      fragments.push(`répond à la contrainte « ${matchedConstraints.join(', ')} »`);
    }

    if (fragments.length === 0) {
      return `${name} présente une parenté thématique limitée avec la demande (pertinence estimée à ${formatPercent(score)}).`;
    }

    return `${name} ${fragments.join(', ')} — pertinence estimée à ${formatPercent(score)}.`;
  }
}

/** Assemble la consigne d'extraction d'intention soumise au modèle. */
export function buildIntentPrompt(query: string): string {
  return [
    "Tu analyses la demande d'un développeur cherchant une compétence, une règle, un workflow ou un hook.",
    'Réponds uniquement par un objet JSON valide, sans texte autour, respectant ce schéma :',
    '{"normalizedQuery": string, "keywords": string[], "techStack": string[], "constraints": string[], "ambiguous": boolean, "refinements": string[]}',
    '',
    `Demande : ${query}`,
  ].join('\n');
}

/** Extrait l'objet JSON d'une réponse de modèle, même entourée de texte. */
export function parseIntentResponse(raw: string): QueryIntent | null {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<QueryIntent>;
    return {
      normalizedQuery: typeof parsed.normalizedQuery === 'string' ? parsed.normalizedQuery : '',
      keywords: toStringArray(parsed.keywords),
      techStack: toStringArray(parsed.techStack),
      constraints: toStringArray(parsed.constraints),
      ambiguous: parsed.ambiguous === true,
      refinements: toStringArray(parsed.refinements),
    };
  } catch {
    return null;
  }
}

/** Similarité cosinus entre deux vecteurs d'embedding. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Ramène une similarité cosinus de [-1, 1] vers [0, 1]. */
export function normalizeSimilarity(similarity: number): number {
  return clamp01((similarity + 1) / 2);
}

/** Décrit une entrée sous forme textuelle, pour le calcul d'embedding. */
export function describeEntry(entry: RawRegistryEntry): string {
  const parts = [
    String(entry.name ?? ''),
    String(entry.description ?? ''),
    (entry.tags ?? []).join(' '),
  ];
  return parts.filter((part) => part.trim().length > 0).join('. ');
}

/** Propositions de reformulation servies quand la demande reste ambiguë. */
export function buildRefinements(query: string): string[] {
  return [
    `Quelle technologie ou quel cadriciel « ${query} » concerne-t-il ?`,
    'Cherchez-vous une compétence, une règle, un workflow ou un hook en particulier ?',
    "S'agit-il d'automatiser une tâche, d'analyser du code ou de produire de la documentation ?",
  ];
}

export function tokenize(value: string): string[] {
  return stripAccents(value.toLowerCase())
    .split(/[^a-z0-9.+#-]+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((token) => token.length > 0);
}

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function formatPercent(score: number): string {
  return `${Math.round(clamp01(score) * 100)} %`;
}
