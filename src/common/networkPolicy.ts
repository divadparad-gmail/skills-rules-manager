/**
 * Politique réseau appliquée aux destinations fournies par une source non
 * fiable, typiquement un registre déclaré dans le `.vscode/settings.json` d'un
 * dépôt.
 *
 * Une telle destination ne doit atteindre que l'Internet public : ni le poste
 * lui-même (bouclage), ni le réseau local ou d'entreprise (plages privées,
 * lien local, partage d'adresses). Le contrôle est fait deux fois : sur le nom
 * écrit dans l'URL à la validation, puis sur l'adresse réellement résolue au
 * moment de la connexion, seul contrôle qui voit un nom de domaine pointant
 * vers une adresse interne.
 *
 * Module pur, sans dépendance à VS Code.
 */

import * as dns from 'dns';
import * as net from 'net';

/** Plages IPv4 non publiques : [adresse de réseau, longueur de préfixe]. */
const NON_PUBLIC_IPV4: Array<[string, number]> = [
  ['0.0.0.0', 8], // « ce réseau », dont 0.0.0.0 qui atteint le poste
  ['10.0.0.0', 8], // privé (RFC 1918)
  ['100.64.0.0', 10], // partage d'adresses des opérateurs (RFC 6598)
  ['127.0.0.0', 8], // bouclage
  ['169.254.0.0', 16], // lien local, dont les services de métadonnées infonuagiques
  ['172.16.0.0', 12], // privé (RFC 1918)
  ['192.0.0.0', 24], // affectations de protocole (RFC 6890)
  ['192.168.0.0', 16], // privé (RFC 1918)
  ['198.18.0.0', 15], // bancs d'essai (RFC 2544)
  ['224.0.0.0', 4], // multidiffusion
  ['240.0.0.0', 4], // réservé, dont la diffusion générale
];

/**
 * Vrai lorsque l'adresse IP littérale n'appartient pas à l'Internet public.
 * Une chaîne qui n'est pas une adresse IP renvoie `false` : c'est un nom, que
 * seule la résolution permet de juger.
 */
export function isNonPublicAddress(rawAddress: string): boolean {
  const address = stripBrackets(rawAddress.trim()).toLowerCase();
  const version = net.isIP(address);
  if (version === 4) return isNonPublicIpv4(address);
  if (version === 6) return isNonPublicIpv6(address);
  return false;
}

/**
 * Vrai lorsque le nom d'hôte d'une URL désigne à coup sûr une destination
 * interne, sans résolution : adresse littérale non publique, `localhost` ou
 * l'un de ses sous-domaines.
 */
export function isNonPublicHostname(rawHost: string): boolean {
  const host = stripBrackets(rawHost.trim()).toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return isNonPublicAddress(host);
}

/** Signature de `dns.lookup` telle que la consomme `net.connect`. */
export type LookupFunction = (
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number
  ) => void
) => void;

/**
 * Construit une fonction de résolution qui refuse toute adresse non publique.
 * Passée en option `lookup` d'une requête Node, elle s'exécute au moment même
 * de la connexion : l'adresse vérifiée est celle qui sera contactée, ce qui
 * déjoue aussi un nom qui changerait d'adresse entre deux résolutions.
 *
 * Si la résolution renvoie plusieurs adresses dont une seule est interne, la
 * requête est refusée en entier : une réponse mixte est un signal suspect.
 */
export function createPublicOnlyLookup(resolve: LookupFunction = dns.lookup as LookupFunction): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, options, (err, address, family) => {
      if (err) {
        callback(err, address, family);
        return;
      }
      const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
      const blocked = addresses.find((candidate) => isNonPublicAddress(candidate));
      if (blocked !== undefined) {
        callback(new NonPublicDestinationError(hostname), address, family);
        return;
      }
      callback(null, address, family);
    });
  };
}

/** Erreur levée lorsqu'une destination non fiable vise une adresse interne. */
export class NonPublicDestinationError extends Error {
  public readonly code = 'ERR_NON_PUBLIC_DESTINATION';

  constructor(hostname: string) {
    super(
      `« ${hostname} » pointe vers une adresse interne (poste ou réseau local) : la requête est refusée pour un registre défini par l'espace de travail.`
    );
    this.name = 'NonPublicDestinationError';
  }
}

// ------------------------------------------------------------------
// Mécanique interne
// ------------------------------------------------------------------

function stripBrackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function ipv4ToNumber(address: string): number {
  return address
    .split('.')
    .reduce((accumulator, octet) => accumulator * 256 + Number(octet), 0);
}

function isNonPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  return NON_PUBLIC_IPV4.some(([network, prefix]) => {
    const size = 2 ** (32 - prefix);
    const start = ipv4ToNumber(network);
    return value >= start && value < start + size;
  });
}

function isNonPublicIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (!bytes) return true; // Forme illisible : on refuse plutôt que de deviner.

  const allZeroUntil = (end: number) => bytes.slice(0, end).every((byte) => byte === 0);

  // :: (non spécifiée) et ::1 (bouclage)
  if (allZeroUntil(15) && (bytes[15] === 0 || bytes[15] === 1)) return true;
  // ::ffff:a.b.c.d (IPv4 projetée) : on juge l'adresse IPv4 embarquée.
  if (allZeroUntil(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isNonPublicIpv4(bytes.slice(12).join('.'));
  }
  // 64:ff9b::/96 (traduction NAT64) : idem.
  if (
    bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return isNonPublicIpv4(bytes.slice(12).join('.'));
  }
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7, adresses locales uniques
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10, lien local
  if (bytes[0] === 0xff) return true; // ff00::/8, multidiffusion
  return false;
}

/** Convertit une adresse IPv6 textuelle en 16 octets, ou `null` si illisible. */
function parseIpv6(address: string): number[] | null {
  let text = address.split('%')[0]; // identifiant de zone éventuel
  const groups: number[] = [];

  // Un suffixe IPv4 pointé occupe les deux derniers groupes.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  let ipv4Tail: number[] = [];
  if (tail.includes('.')) {
    if (net.isIPv4(tail) === false) return null;
    ipv4Tail = tail.split('.').map(Number);
    text = text.slice(0, lastColon + 1) + '0:0';
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => (half.length === 0 ? [] : half.split(':'));
  const head = parseHalf(halves[0]);
  const rest = halves.length === 2 ? parseHalf(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;

  for (const group of [...head, ...Array<string>(missing).fill('0'), ...rest]) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    groups.push(parseInt(group, 16));
  }

  const bytes = groups.flatMap((group) => [group >> 8, group & 0xff]);
  if (ipv4Tail.length === 4) bytes.splice(12, 4, ...ipv4Tail);
  return bytes;
}
