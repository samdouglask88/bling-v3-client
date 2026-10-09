import { describe, expect, it, vi } from 'vitest';
import {
  isExpired,
  retryAfterFromHeaders,
  signState,
  verifyState,
} from './oauth';
import { RateLimiter } from './rate-limiter';

describe('signState e verifyState', () => {
  const SEGREDO = 'segredo-de-teste';

  it('devolve o conteúdo quando a assinatura bate', () => {
    const state = signState({ contaId: 'abc', usuarioId: '42' }, SEGREDO);
    expect(verifyState(state, SEGREDO)).toMatchObject({
      contaId: 'abc',
      usuarioId: '42',
    });
  });

  it('recusa assinatura de outro segredo', () => {
    expect(verifyState(signState({ a: 1 }, SEGREDO), 'outro')).toBeNull();
  });

  it('recusa conteúdo adulterado', () => {
    const state = signState({ contaId: 'abc' }, SEGREDO);
    const [corpo, assinatura] = state.split('.');
    const outroCorpo = Buffer.from(
      JSON.stringify({ contaId: 'invasor', issuedAt: Date.now(), nonce: 'x' }),
    ).toString('base64url');
    expect(verifyState(`${outroCorpo}.${assinatura}`, SEGREDO)).toBeNull();
    expect(corpo).not.toBe(outroCorpo);
  });

  it('recusa formato inválido', () => {
    expect(verifyState('', SEGREDO)).toBeNull();
    expect(verifyState('sem-ponto', SEGREDO)).toBeNull();
    expect(verifyState('a.b.c', SEGREDO)).toBeNull();
    expect(verifyState('x'.repeat(3000), SEGREDO)).toBeNull();
  });

  it('recusa state vencido', () => {
    vi.useFakeTimers();
    try {
      const state = signState({ a: 1 }, SEGREDO);
      vi.advanceTimersByTime(600_001);
      expect(verifyState(state, SEGREDO)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aceita prazo próprio', () => {
    vi.useFakeTimers();
    try {
      const state = signState({ a: 1 }, SEGREDO);
      vi.advanceTimersByTime(700_000);
      expect(verifyState(state, SEGREDO, { ttlMs: 900_000 })).toMatchObject({
        a: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // Dois states seguidos não podem ser iguais: senão um retorno capturado
  // poderia ser reenviado.
  it('gera um valor diferente a cada chamada', () => {
    expect(signState({ a: 1 }, SEGREDO)).not.toBe(signState({ a: 1 }, SEGREDO));
  });
});

describe('isExpired', () => {
  const agora = new Date('2026-10-09T12:00:00Z');

  it('considera vencido o que já passou', () => {
    expect(isExpired(new Date('2026-10-09T11:00:00Z'), agora)).toBe(true);
  });

  // Renovar no instante exato deixaria uma chamada falhar no meio do caminho.
  it('antecipa o vencimento em um minuto', () => {
    expect(isExpired(new Date('2026-10-09T12:00:30Z'), agora)).toBe(true);
    expect(isExpired(new Date('2026-10-09T12:02:00Z'), agora)).toBe(false);
  });

  it('trata data inválida como vencida', () => {
    expect(isExpired(new Date('nada'), agora)).toBe(true);
  });
});

describe('retryAfterFromHeaders', () => {
  const comHeader = (valor?: string) =>
    retryAfterFromHeaders(new Headers(valor ? { 'retry-after': valor } : {}));

  it('converte segundos em milissegundos', () => {
    expect(comHeader('5')).toBe(5000);
  });

  it('usa um segundo quando o Bling não diz', () => {
    expect(comHeader()).toBe(1000);
    expect(comHeader('nada')).toBe(1000);
  });

  it('não espera mais que um minuto', () => {
    expect(comHeader('3600')).toBe(60_000);
  });
});

describe('RateLimiter', () => {
  it('recusa configuração sem sentido', () => {
    expect(() => new RateLimiter(0)).toThrow(RangeError);
    expect(() => new RateLimiter(3, 0)).toThrow(RangeError);
  });

  it('libera até o limite de uma vez', async () => {
    const limiter = new RateLimiter(3, 1000);
    const ordem: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        limiter.schedule(() => {
          ordem.push(n);
          return Promise.resolve(n);
        }),
      ),
    );
    expect(ordem).toEqual([1, 2, 3]);
  });

  it('segura o que passa do limite até a janela abrir', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(2, 1000);
      const executadas: number[] = [];
      const todas = Promise.all(
        [1, 2, 3, 4].map((n) =>
          limiter.schedule(() => {
            executadas.push(n);
            return Promise.resolve(n);
          }),
        ),
      );

      await Promise.resolve();
      expect(executadas).toEqual([1, 2]);

      await vi.advanceTimersByTimeAsync(1000);
      await todas;
      expect(executadas).toEqual([1, 2, 3, 4]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propaga o erro de quem falhou sem travar a fila', async () => {
    const limiter = new RateLimiter(2, 1000);
    const falha = limiter.schedule(() => Promise.reject(new Error('estourou')));
    const ok = limiter.schedule(() => Promise.resolve('bom'));

    await expect(falha).rejects.toThrow('estourou');
    await expect(ok).resolves.toBe('bom');
  });
});
