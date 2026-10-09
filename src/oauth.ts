import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const BLING_AUTHORIZE_URL =
  'https://www.bling.com.br/Api/v3/oauth/authorize';
export const BLING_TOKEN_URL = 'https://api.bling.com.br/Api/v3/oauth/token';
export const BLING_API_BASE = 'https://api.bling.com.br/Api/v3';

/**
 * O acesso vale 6 horas. Renovar no instante exato do vencimento deixaria uma
 * chamada falhar no meio do caminho, então antecipamos um minuto.
 */
export const DEFAULT_SKEW_SECONDS = 60;

/** Espera padrão quando o Bling responde 429 sem dizer quanto esperar. */
const DEFAULT_RETRY_MS = 1000;

/** O bloqueio por abuso dura 10 minutos; não dá para segurar tudo isso. */
const MAX_RETRY_MS = 60_000;

export interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  /**
   * Valor opaco devolvido pelo Bling na volta. Use para reconhecer quem
   * iniciou a autorização — `signState` monta um pronto.
   */
  state: string;
}

/**
 * Monta o endereço para onde o navegador leva a pessoa autorizar.
 *
 * O `redirectUri` precisa ser **idêntico** ao cadastrado no aplicativo: o
 * Bling compara como texto puro, e aceita uma única URL por aplicativo.
 */
export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
}: AuthorizeUrlInput): string {
  const url = new URL(BLING_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

/** Prazo padrão de validade do `state`: tempo de alguém autorizar na tela. */
const DEFAULT_STATE_TTL_MS = 600_000;

/**
 * Assina um `state` com o que você precisar reconhecer na volta.
 *
 * Sem isso, qualquer um pode chamar sua URL de retorno com um código e você
 * não tem como saber se aquela autorização partiu do seu sistema.
 *
 * O conteúdo vai legível em base64url — **não coloque segredo ali**, só o que
 * você precisa para reconhecer a volta.
 */
export function signState(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      issuedAt: Date.now(),
      nonce: randomBytes(16).toString('hex'),
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export interface VerifyStateOptions {
  /** Quanto tempo o state continua válido. Padrão: 10 minutos. */
  ttlMs?: number;
}

/**
 * Confere a assinatura e o prazo, e devolve o conteúdo. `null` quando não
 * bate — comparação em tempo constante, para não vazar a assinatura por tempo
 * de resposta.
 *
 * Cabe a quem chama conferir os campos do conteúdo.
 */
export function verifyState(
  state: string,
  secret: string,
  { ttlMs = DEFAULT_STATE_TTL_MS }: VerifyStateOptions = {},
): Record<string, unknown> | null {
  if (typeof state !== 'string' || state.length > 2000) return null;
  const [body64, signature64, ...resto] = state.split('.');
  if (!body64 || !signature64 || resto.length > 0) return null;

  const expected = createHmac('sha256', secret).update(body64).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature64, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const body = JSON.parse(
      Buffer.from(body64, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const age = Date.now() - Number(body.issuedAt);
    // A margem negativa cobre relógio do servidor ligeiramente adiantado.
    if (!(age >= -60_000 && age <= ttlMs)) return null;
    if (typeof body.nonce !== 'string') return null;
    return body;
  } catch {
    return null;
  }
}

/** Já venceu, ou vence dentro da margem? */
export function isExpired(
  expiresAt: Date,
  now: Date = new Date(),
  skewSeconds = DEFAULT_SKEW_SECONDS,
): boolean {
  const time = expiresAt instanceof Date ? expiresAt.getTime() : Number.NaN;
  if (!Number.isFinite(time)) return true;
  return time - skewSeconds * 1000 <= now.getTime();
}

/** Quanto esperar depois de um 429, em milissegundos. */
export function retryAfterFromHeaders(headers: Headers): number {
  const raw = Number(headers.get('retry-after'));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RETRY_MS;
  return Math.min(raw * 1000, MAX_RETRY_MS);
}
