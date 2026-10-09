/** Tokens de uma conta conectada. */
export interface BlingTokens {
  accessToken: string;
  refreshToken: string;
  /** Quando o acesso vence. O Bling dá 6 horas. */
  expiresAt: Date;
}

/**
 * Onde os tokens ficam entre uma chamada e outra.
 *
 * É uma interface porque isso é decisão de quem usa a biblioteca: banco,
 * arquivo, cofre de segredos. A biblioteca não escolhe por você.
 *
 * **Atenção ao `set`:** o Bling devolve um refresh token NOVO a cada
 * renovação, e invalida o anterior. Guardar o antigo mata a ligação no
 * vencimento seguinte — por isso `set` é chamado em toda renovação, não só na
 * conexão inicial.
 *
 * Para multi-empresa, dê a cada conta um store próprio, com a chave dela.
 */
export interface BlingTokenStore {
  get(): Promise<BlingTokens | null>;
  set(tokens: BlingTokens): Promise<void>;
  /** Chamado ao desconectar. */
  clear?(): Promise<void>;
}

/**
 * Store em memória. Serve para teste e script de uma vez só.
 *
 * Em produção os tokens somem a cada reinício, e aí é preciso autorizar de
 * novo pela tela.
 */
export class InMemoryTokenStore implements BlingTokenStore {
  private tokens: BlingTokens | null = null;

  constructor(inicial?: BlingTokens) {
    this.tokens = inicial ?? null;
  }

  get(): Promise<BlingTokens | null> {
    return Promise.resolve(this.tokens);
  }

  set(tokens: BlingTokens): Promise<void> {
    this.tokens = tokens;
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.tokens = null;
    return Promise.resolve();
  }
}
