export { BlingClient, type BlingClientOptions } from './client';

export {
  BlingApiError,
  BlingAuthError,
  BlingError,
  BlingNotConnectedError,
  BlingRateLimitError,
  BlingResponseError,
  BlingScopeError,
} from './errors';

export {
  BLING_API_BASE,
  BLING_AUTHORIZE_URL,
  BLING_TOKEN_URL,
  buildAuthorizeUrl,
  isExpired,
  retryAfterFromHeaders,
  signState,
  verifyState,
  type AuthorizeUrlInput,
  type VerifyStateOptions,
} from './oauth';

export { RateLimiter } from './rate-limiter';

export {
  InMemoryTokenStore,
  type BlingTokens,
  type BlingTokenStore,
} from './store';

export {
  Produtos,
  type ListarProdutosParams,
  type Pagina,
  type Produto,
} from './resources/produtos';

export {
  Contatos,
  type ContatoDetalhe,
  type ContatoResumo,
  type EnderecoBling,
  type ListarContatosParams,
  type TipoContato,
} from './resources/contatos';
