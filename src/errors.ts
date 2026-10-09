/** Erro base da biblioteca. Tudo que ela lança herda daqui. */
export class BlingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** O aplicativo não está ligado a nenhuma conta, ou a ligação foi removida. */
export class BlingNotConnectedError extends BlingError {
  constructor(message = 'Nenhuma conta do Bling está conectada.') {
    super(message);
  }
}

/**
 * A renovação não foi aceita. O refresh token do Bling vale 30 dias; vencido,
 * só reconectando pela tela de autorização.
 */
export class BlingAuthError extends BlingError {
  constructor(
    message: string,
    /** Código que o Bling devolveu, quando devolveu. */
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * HTTP 429. O Bling permite 3 chamadas por segundo e bloqueia o IP de origem
 * por 10 minutos em abuso — o bloqueio atinge o servidor inteiro, não só quem
 * passou do ponto.
 */
export class BlingRateLimitError extends BlingError {
  constructor(
    /** Quanto o Bling pediu para esperar, em milissegundos. */
    readonly retryAfterMs: number,
    message = `O Bling pediu para reduzir o ritmo. Esperar ${retryAfterMs}ms.`,
  ) {
    super(message);
  }
}

/**
 * HTTP 403 com `insufficient_scope`: o aplicativo não pediu esse escopo.
 *
 * Diferente de uma falta de permissão do usuário na conta, que vem como 403
 * com `FORBIDDEN` e se resolve no cadastro de usuários do Bling, não aqui.
 */
export class BlingScopeError extends BlingError {
  constructor(
    readonly path: string,
    message = `O aplicativo não tem escopo para ${path}. Adicione o escopo no cadastro do aplicativo e autorize de novo.`,
  ) {
    super(message);
  }
}

/** Qualquer outra resposta de erro da API. */
export class BlingApiError extends BlingError {
  constructor(
    readonly status: number,
    readonly path: string,
    /** Corpo da resposta, quando pôde ser lido. */
    readonly body?: unknown,
    message = `O Bling respondeu ${status} em ${path}.`,
  ) {
    super(message);
  }
}

/** A resposta chegou, mas num formato que não dá para usar. */
export class BlingResponseError extends BlingError {}
