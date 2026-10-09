import {
  BlingApiError,
  BlingAuthError,
  BlingNotConnectedError,
  BlingRateLimitError,
  BlingResponseError,
  BlingScopeError,
} from './errors';
import {
  BLING_API_BASE,
  BLING_TOKEN_URL,
  buildAuthorizeUrl,
  isExpired,
  retryAfterFromHeaders,
} from './oauth';
import { RateLimiter } from './rate-limiter';
import { BlingTokens, BlingTokenStore, InMemoryTokenStore } from './store';
import { Contatos } from './resources/contatos';
import { Produtos } from './resources/produtos';

export interface BlingClientOptions {
  clientId: string;
  clientSecret: string;
  /** Precisa ser idêntico ao cadastrado no aplicativo. */
  redirectUri: string;
  /** Onde guardar os tokens. Padrão: memória, só para teste. */
  store?: BlingTokenStore;
  /** Chamadas por segundo. O Bling permite 3; subir daqui bloqueia o IP. */
  requestsPerSecond?: number;
  /** Trocável em teste. Padrão: `fetch` global. */
  fetch?: typeof fetch;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** O que o Bling manda no corpo de um 403. */
interface ErrorBody {
  error?: { type?: string; message?: string; description?: string };
  error_description?: string;
}

/** Sem informação do Bling, assume as 6 horas que ele documenta. */
const DEFAULT_EXPIRES_IN = 21_600;

/**
 * Cliente da API v3 do Bling.
 *
 * Cuida de OAuth, renovação automática do acesso e do limite de ritmo. As
 * regras de negócio sobre os dados são de quem usa.
 *
 * ```ts
 * const bling = new BlingClient({ clientId, clientSecret, redirectUri, store });
 * const { data } = await bling.produtos.list({ limite: 100 });
 * ```
 */
export class BlingClient {
  readonly produtos: Produtos;
  readonly contatos: Contatos;

  private readonly store: BlingTokenStore;
  private readonly limiter: RateLimiter;
  private readonly http: typeof fetch;
  /** Renovações simultâneas gastariam o refresh token duas vezes. */
  private renovando: Promise<BlingTokens> | null = null;

  constructor(private readonly options: BlingClientOptions) {
    if (!options?.clientId || !options?.clientSecret || !options?.redirectUri) {
      throw new TypeError(
        'clientId, clientSecret e redirectUri são obrigatórios.',
      );
    }
    this.store = options.store ?? new InMemoryTokenStore();
    this.limiter = new RateLimiter(options.requestsPerSecond ?? 3, 1000);
    this.http = options.fetch ?? globalThis.fetch;
    this.produtos = new Produtos(this);
    this.contatos = new Contatos(this);
  }

  // ─── Ligação ─────────────────────────────────────────────────────────────

  /** Endereço para onde mandar o navegador autorizar. */
  authorizeUrl(state: string): string {
    return buildAuthorizeUrl({
      clientId: this.options.clientId,
      redirectUri: this.options.redirectUri,
      state,
    });
  }

  /** Troca o código da volta por tokens e guarda no store. */
  async connect(code: string): Promise<BlingTokens> {
    if (!code?.trim()) {
      throw new BlingAuthError('Código de autorização ausente.');
    }
    const tokens = await this.exchange({
      grant_type: 'authorization_code',
      code,
    });
    await this.store.set(tokens);
    return tokens;
  }

  /** Esquece os tokens. Não revoga nada no Bling. */
  async disconnect(): Promise<void> {
    await this.store.clear?.();
  }

  /** Há conta conectada? */
  async isConnected(): Promise<boolean> {
    return (await this.store.get()) !== null;
  }

  // ─── Chamadas ────────────────────────────────────────────────────────────

  /**
   * Chamada autenticada, dentro do limite de ritmo, renovando o acesso quando
   * preciso. `path` começa com `/`, relativo a `/Api/v3`.
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();

    return this.limiter.schedule(async () => {
      const response = await this.http(`${BLING_API_BASE}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          // Pede o formato JWT atual dos tokens do Bling.
          'enable-jwt': '1',
          ...(init.headers ?? {}),
        },
      });

      if (response.status === 429) {
        throw new BlingRateLimitError(retryAfterFromHeaders(response.headers));
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as
          | ErrorBody
          | undefined;
        // 403 tem duas causas distintas e conserto em lugares diferentes:
        // falta de escopo se resolve no cadastro do aplicativo; falta de
        // permissão do usuário, no cadastro de usuários da conta.
        if (
          response.status === 403 &&
          body?.error?.type === 'insufficient_scope'
        ) {
          throw new BlingScopeError(path);
        }
        throw new BlingApiError(response.status, path, body);
      }

      if (response.status === 204) return undefined as T;

      try {
        return (await response.json()) as T;
      } catch {
        throw new BlingResponseError(`O Bling devolveu algo que não é JSON em ${path}.`);
      }
    });
  }

  /** Devolve um acesso válido, renovando sozinho quando venceu. */
  async accessToken(): Promise<string> {
    const atual = await this.store.get();
    if (!atual) throw new BlingNotConnectedError();
    if (!isExpired(atual.expiresAt)) return atual.accessToken;

    // Uma renovação por vez: o Bling invalida o refresh token a cada uso, e
    // duas chamadas em paralelo derrubariam a ligação.
    this.renovando ??= this.refresh(atual).finally(() => {
      this.renovando = null;
    });
    return (await this.renovando).accessToken;
  }

  private async refresh(atual: BlingTokens): Promise<BlingTokens> {
    const novos = await this.exchange(
      { grant_type: 'refresh_token', refresh_token: atual.refreshToken },
      'A ligação com o Bling expirou. Autorize novamente.',
    );
    // O Bling devolve um refresh token novo a cada uso; guardar o antigo
    // mataria a ligação no vencimento seguinte.
    const tokens: BlingTokens = {
      ...novos,
      refreshToken: novos.refreshToken || atual.refreshToken,
    };
    await this.store.set(tokens);
    return tokens;
  }

  private async exchange(
    body: Record<string, string>,
    mensagemDeFalha?: string,
  ): Promise<BlingTokens> {
    const basic = Buffer.from(
      `${this.options.clientId}:${this.options.clientSecret}`,
    ).toString('base64');

    const response = await this.limiter.schedule(() =>
      this.http(BLING_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
          'enable-jwt': '1',
        },
        body: new URLSearchParams({
          ...body,
          redirect_uri: this.options.redirectUri,
        }).toString(),
      }),
    );

    const payload = (await response.json().catch(() => ({}))) as TokenResponse;

    if (!response.ok || payload.error || !payload.access_token) {
      throw new BlingAuthError(
        mensagemDeFalha ??
          payload.error_description ??
          'O Bling recusou a autorização.',
        payload.error,
      );
    }

    const segundos =
      Number.isFinite(payload.expires_in) && (payload.expires_in as number) > 0
        ? (payload.expires_in as number)
        : DEFAULT_EXPIRES_IN;

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? '',
      expiresAt: new Date(Date.now() + segundos * 1000),
    };
  }
}
