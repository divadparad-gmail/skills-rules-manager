/**
 * Transport HTTP de l'extension, appuyé sur les modules natifs de Node afin de
 * n'ajouter aucune dépendance au paquet distribué.
 *
 * Il sert à la fois la diffusion de recherche fédérée et la sonde de santé des
 * registres : même gestion du délai d'attente, mêmes garde-fous.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { HttpSearchPort } from './FederatedSearchService';
import { HealthProbePort } from '../settings/RegistryConfigService';
import {
  LookupFunction,
  NonPublicDestinationError,
  createPublicOnlyLookup,
  isNonPublicHostname,
} from '../common/networkPolicy';

/** Taille maximale de réponse acceptée, pour borner l'empreinte mémoire. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface HttpRequestOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  method?: 'GET' | 'POST' | 'OPTIONS';
  body?: string;
  /**
   * Restreint la destination à l'Internet public : une adresse IP littérale
   * interne est refusée d'emblée, et un nom de domaine est résolu par une
   * fonction qui refuse toute adresse interne au moment de la connexion.
   */
  publicOnly?: boolean;
  /** Résolveur sous-jacent, injectable pour les tests ; `dns.lookup` par défaut. */
  resolve?: LookupFunction;
}

export interface HttpResponse {
  statusCode: number;
  body: string;
}

/**
 * Exécute une requête HTTP(S) et restitue le corps sous forme de texte. Le
 * délai d'attente couvre l'établissement de la connexion comme la lecture.
 */
export function request(url: string, options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise<HttpResponse>((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // L'URL n'est pas citée : elle pourrait porter un identifiant.
      reject(new Error("L'URL de la requête n'est pas valide."));
      return;
    }

    // Une adresse IP littérale ne passe pas par la résolution : elle est jugée
    // ici, avant toute connexion.
    if (options.publicOnly && isNonPublicHostname(parsed.hostname)) {
      reject(new NonPublicDestinationError(parsed.hostname));
      return;
    }

    const transport = parsed.protocol === 'http:' ? http : https;
    const headers = { ...options.headers };
    if (options.body) {
      // Sans longueur déclarée, certains points de terminaison refusent le corps.
      headers['Content-Length'] = String(Buffer.byteLength(options.body, 'utf8'));
    }
    const requestOptions: http.RequestOptions = {
      method: options.method ?? 'GET',
      headers,
      timeout: options.timeoutMs,
      ...(options.publicOnly ? { lookup: createPublicOnlyLookup(options.resolve) } : {}),
    };

    const clientRequest = transport.request(parsed, requestOptions, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;

      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          clientRequest.destroy();
          reject(new Error('La réponse du registre dépasse la taille maximale admise (4 Mio).'));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    clientRequest.on('timeout', () => {
      clientRequest.destroy();
      reject(new Error(`Délai d'attente dépassé après ${options.timeoutMs} ms.`));
    });

    clientRequest.on('error', (err: Error) => {
      reject(err);
    });

    if (options.body) {
      clientRequest.write(options.body);
    }
    clientRequest.end();
  });
}

/** Transport utilisé par la recherche fédérée. */
export const httpSearchPort: HttpSearchPort = {
  get(url, options) {
    return request(url, {
      headers: options.headers,
      timeoutMs: options.timeoutMs,
      publicOnly: options.publicOnly,
    });
  },
};

/** Sonde de santé des registres déclenchée par « Tester la connexion ». */
export const httpHealthProbePort: HealthProbePort = {
  probe(url, options) {
    return request(url, {
      headers: options.headers,
      timeoutMs: options.timeoutMs,
      method: 'GET',
      publicOnly: options.publicOnly,
    });
  },
};
