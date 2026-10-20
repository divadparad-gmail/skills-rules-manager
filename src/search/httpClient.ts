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

/** Taille maximale de réponse acceptée, pour borner l'empreinte mémoire. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface HttpRequestOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  method?: 'GET' | 'POST' | 'OPTIONS';
  body?: string;
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
      reject(new Error(`L'URL « ${url} » n'est pas valide.`));
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
    return request(url, { headers: options.headers, timeoutMs: options.timeoutMs });
  },
};

/** Sonde de santé des registres déclenchée par « Tester la connexion ». */
export const httpHealthProbePort: HealthProbePort = {
  probe(url, options) {
    return request(url, {
      headers: options.headers,
      timeoutMs: options.timeoutMs,
      method: 'GET',
    });
  },
};
