// Bajar un vídeo de referencia a partir de un enlace, SIN trucos.
//
// Lo único que se hace es una petición HTTP normal, como la haría cualquier
// lector de enlaces, y con estas reglas:
//   * las mismas protecciones contra SSRF que la lectura de webs (net.ts);
//   * se respeta `robots.txt` del sitio (agente `rrss-referencias`): si el sitio
//     no admite descargas automáticas, no se descarga;
//   * sin iniciar sesión, sin cookies, sin ejecutar JavaScript, sin leer los
//     datos internos del reproductor y sin herramientas de descarga;
//   * vale un enlace DIRECTO a un archivo de vídeo, o una página que declare su
//     vídeo en los metadatos públicos para compartir (`og:video`).
// Instagram, TikTok y YouTube no ofrecen el archivo así (piden sesión o no lo
// publican): en esos casos se dice claro y se pide que se suba el archivo.
//
// El vídeo se queda en la carpeta temporal del trabajo (el bucle la borra al
// terminar): nunca se guarda en el almacenamiento.
import { writeFile } from 'node:fs/promises';
import { Parser } from 'htmlparser2';
import robotsParserModule from 'robots-parser';
import { PermanentError } from '../errors.ts';
import { decodeBody } from '../extract/html.ts';
import {
  assertFetchableUrl,
  BlockedUrlError,
  DEFAULT_NET_POLICY,
  safeFetch,
  TransientFetchError,
  type FetchedResponse,
  type NetPolicy,
} from '../extract/net.ts';

export const REFERENCE_AGENT_TOKEN = 'rrss-referencias';
export const REFERENCE_USER_AGENT = `Mozilla/5.0 (compatible; ${REFERENCE_AGENT_TOKEN}/1.0; analisis de un video de referencia)`;

/** El enlace no se puede descargar. El mensaje es para la persona: dice por qué y qué hacer. */
export class ReferenceDownloadError extends PermanentError {
  override name = 'ReferenceDownloadError';
}

export interface DownloadOptions {
  policy?: NetPolicy;
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface DownloadedReference {
  /** Dominio del enlace (lo único que se guarda de él). */
  host: string;
  bytes: number;
  contentType: string;
  /** Cómo se llegó al archivo. */
  via: 'direct' | 'og:video';
}

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
}
const robotsParser = robotsParserModule as unknown as (url: string, contents: string) => Robots;

const NETWORKS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /(^|\.)instagram\.com$/i, name: 'Instagram' },
  { pattern: /(^|\.)tiktok\.com$/i, name: 'TikTok' },
  { pattern: /(^|\.)(youtube\.com|youtu\.be)$/i, name: 'YouTube' },
  { pattern: /(^|\.)(facebook\.com|fb\.watch)$/i, name: 'Facebook' },
];

/** Nombre con el que se habla del sitio: la red, si es una conocida, o su dominio. */
export function siteName(host: string): string {
  return NETWORKS.find((n) => n.pattern.test(host))?.name ?? host;
}

const ASK_FOR_FILE = 'Descarga el vídeo en tu dispositivo y súbelo aquí como archivo.';

function refused(host: string, why: string): ReferenceDownloadError {
  return new ReferenceDownloadError(`${siteName(host)} no deja descargar este vídeo desde un enlace (${why}). ${ASK_FOR_FILE}`);
}

const isVideo = (contentType: string) => /^video\//i.test(contentType.trim());
const isHtml = (contentType: string) => /^(text\/html|application\/xhtml\+xml)\b/i.test(contentType.trim());

/** Dirección del vídeo que la página declara para compartir (`og:video`), si la hay. */
export function ogVideoUrl(html: string, base: URL): string | null {
  const found: Record<string, string> = {};
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name !== 'meta') return;
      const key = (attributes.property ?? attributes.name ?? '').toLowerCase();
      if (!attributes.content) return;
      if (['og:video:secure_url', 'og:video:url', 'og:video'].includes(key) && !found[key]) {
        found[key] = attributes.content;
      }
    },
  });
  parser.write(html);
  parser.end();
  const raw = found['og:video:secure_url'] ?? found['og:video:url'] ?? found['og:video'];
  if (!raw) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

async function get(url: URL, options: DownloadOptions, accept: string, maxBytes: number): Promise<FetchedResponse> {
  try {
    return await safeFetch(url, {
      policy: options.policy,
      userAgent: REFERENCE_USER_AGENT,
      accept,
      maxBytes,
      timeoutMs: options.timeoutMs,
      maxRedirects: 3,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof BlockedUrlError || error instanceof ReferenceDownloadError) throw error;
    if (error instanceof PermanentError && /pesa más de/.test(error.message)) {
      throw new ReferenceDownloadError(
        `El vídeo del enlace pesa más de ${Math.round(maxBytes / (1024 * 1024))} MB. Sube uno más corto o más ligero.`,
      );
    }
    throw error;
  }
}

/** ¿Deja el sitio que un agente automático lea esta dirección? (RFC 9309; sin robots.txt, sí.) */
async function allowedByRobots(url: URL, options: DownloadOptions): Promise<boolean> {
  const robotsUrl = `${url.origin}/robots.txt`;
  let response: FetchedResponse;
  try {
    response = await safeFetch(robotsUrl, {
      policy: options.policy,
      userAgent: REFERENCE_USER_AGENT,
      accept: 'text/plain,*/*;q=0.5',
      maxBytes: 512 * 1024,
      timeoutMs: Math.min(options.timeoutMs, 15_000),
      maxRedirects: 5,
      signal: options.signal,
    });
  } catch (error) {
    // Si no se puede leer robots.txt (no responde, error del servidor), no se descarga.
    if (error instanceof TransientFetchError) return false;
    if (error instanceof PermanentError && !(error instanceof BlockedUrlError)) return false;
    throw error;
  }
  if (response.status >= 500) return false;
  // 401 y 403 en robots.txt: el sitio no quiere lectores automáticos.
  if (response.status === 401 || response.status === 403) return false;
  const contents = response.status >= 200 && response.status < 300 ? decodeBody(response.body, 'utf-8') : '';
  return robotsParser(robotsUrl, contents).isAllowed(url.toString(), REFERENCE_AGENT_TOKEN) !== false;
}

async function fetchAllowed(url: URL, options: DownloadOptions, accept: string, maxBytes: number) {
  if (!(await allowedByRobots(url, options))) {
    throw refused(url.hostname, 'su robots.txt no admite descargas automáticas');
  }
  const response = await get(url, options, accept, maxBytes);
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    throw refused(new URL(response.url).hostname, 'pide iniciar sesión o bloquea las descargas automáticas');
  }
  if (response.status === 404 || response.status === 410) {
    throw new ReferenceDownloadError('El enlace no existe o el vídeo se ha borrado. Revisa la dirección o sube el archivo.');
  }
  if (response.status >= 500) throw new TransientFetchError(`${url.hostname} respondió con un error ${response.status}`);
  if (response.status < 200 || response.status >= 300) {
    throw refused(url.hostname, `respondió con un error ${response.status}`);
  }
  return response;
}

/**
 * Baja el vídeo del enlace a `destinationFile`. Lanza `ReferenceDownloadError`
 * (sin reintento, con el motivo para la persona) si el sitio no lo deja.
 */
export async function downloadReference(
  rawUrl: string,
  destinationFile: string,
  options: DownloadOptions,
): Promise<DownloadedReference> {
  const policy = options.policy ?? DEFAULT_NET_POLICY;
  let url: URL;
  try {
    url = assertFetchableUrl(rawUrl, policy);
  } catch (error) {
    if (error instanceof BlockedUrlError) {
      throw new ReferenceDownloadError(`Ese enlace no se puede abrir: ${error.message}. Sube el archivo del vídeo.`);
    }
    throw error;
  }
  const host = url.hostname;
  let response: FetchedResponse;
  try {
    response = await fetchAllowed(url, { ...options, policy }, 'video/*,text/html;q=0.8,*/*;q=0.5', options.maxBytes);
    let via: DownloadedReference['via'] = 'direct';
    if (!isVideo(response.contentType)) {
      if (!isHtml(response.contentType)) {
        throw refused(host, 'el enlace no lleva a un vídeo');
      }
      const page = new URL(response.url);
      const declared = ogVideoUrl(decodeBody(response.body.subarray(0, 2 * 1024 * 1024), 'utf-8'), page);
      if (!declared) throw refused(host, 'la página no ofrece el archivo del vídeo');
      const videoUrl = assertFetchableUrl(declared, policy);
      response = await fetchAllowed(videoUrl, { ...options, policy }, 'video/*', options.maxBytes);
      if (!isVideo(response.contentType)) throw refused(host, 'la página no ofrece el archivo del vídeo');
      via = 'og:video';
    }
    await writeFile(destinationFile, response.body);
    return { host, bytes: response.body.length, contentType: response.contentType.split(';')[0]!.trim(), via };
  } catch (error) {
    if (error instanceof BlockedUrlError) {
      throw new ReferenceDownloadError(`Ese enlace no se puede abrir: ${error.message}. Sube el archivo del vídeo.`);
    }
    throw error;
  }
}
