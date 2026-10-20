/**
 * Client du service Gemini employé par la recherche sémantique (§2.C du PRD).
 *
 * Deux usages sont couverts : le raisonnement, qui déconstruit une demande
 * formulée librement, et les embeddings, qui permettent d'apparier cette
 * demande aux manifestes candidats.
 *
 * La clé d'API est lue à la demande dans le coffre chiffré ; elle n'est jamais
 * conservée en mémoire au-delà de l'appel, ni écrite dans la configuration.
 */

import { GeminiClientPort } from './SemanticSearchEngine';
import { SecretStoragePort } from '../settings/RegistryConfigService';
import { request } from './httpClient';

export const GEMINI_API_KEY_SECRET = 'antigravity.gemini.apiKey';
export const DEFAULT_REASONING_MODEL = 'gemini-2.5-flash';
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiClientOptions {
  reasoningModel?: string;
  embeddingModel?: string;
  /** Point d'entrée alternatif, utile pour un déploiement d'entreprise. */
  apiRoot?: string;
}

export class GeminiClient implements GeminiClientPort {
  constructor(
    private readonly secrets: SecretStoragePort,
    private readonly options: GeminiClientOptions = {}
  ) {}

  /** Vrai lorsqu'une clé d'API est disponible dans le coffre. */
  public async isConfigured(): Promise<boolean> {
    const key = await this.secrets.get(GEMINI_API_KEY_SECRET);
    return typeof key === 'string' && key.trim().length > 0;
  }

  /**
   * Soumet une consigne au modèle de raisonnement et restitue le texte
   * produit, concaténé si la réponse arrive en plusieurs fragments.
   */
  public async generate(prompt: string, options: { timeoutMs?: number } = {}): Promise<string> {
    const apiKey = await this.requireApiKey();
    const model = this.options.reasoningModel ?? DEFAULT_REASONING_MODEL;
    const url = `${this.apiRoot()}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: options.timeoutMs ?? 10000,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Le service Gemini a répondu avec le code ${response.statusCode}.`);
    }

    return extractGeneratedText(response.body);
  }

  /**
   * Calcule les vecteurs d'embedding d'un lot de textes, en une seule requête
   * groupée pour limiter la latence.
   */
  public async embed(texts: string[], options: { timeoutMs?: number } = {}): Promise<number[][]> {
    if (texts.length === 0) return [];

    const apiKey = await this.requireApiKey();
    const model = this.options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    const url = `${this.apiRoot()}/${model}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;

    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: options.timeoutMs ?? 12000,
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
        })),
      }),
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Le service d'embeddings a répondu avec le code ${response.statusCode}.`);
    }

    return extractEmbeddings(response.body);
  }

  private apiRoot(): string {
    return this.options.apiRoot ?? API_ROOT;
  }

  private async requireApiKey(): Promise<string> {
    const key = await this.secrets.get(GEMINI_API_KEY_SECRET);
    if (!key || key.trim().length === 0) {
      throw new Error(
        "Aucune clé d'API Gemini n'est enregistrée : la recherche bascule sur l'analyse lexicale locale."
      );
    }
    return key.trim();
  }
}

/** Extrait le texte d'une réponse `generateContent`. */
export function extractGeneratedText(body: string): string {
  const parsed = JSON.parse(body) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

/** Extrait les vecteurs d'une réponse `batchEmbedContents`. */
export function extractEmbeddings(body: string): number[][] {
  const parsed = JSON.parse(body) as { embeddings?: Array<{ values?: number[] }> };
  const embeddings = parsed.embeddings ?? [];
  return embeddings.map((embedding) =>
    Array.isArray(embedding.values) ? embedding.values.filter((v) => Number.isFinite(v)) : []
  );
}
