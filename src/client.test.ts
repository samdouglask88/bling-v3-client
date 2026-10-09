import { describe, expect, it, vi } from 'vitest';
import { BlingClient } from './client';
import {
  BlingApiError,
  BlingAuthError,
  BlingNotConnectedError,
  BlingRateLimitError,
  BlingScopeError,
} from './errors';
import { InMemoryTokenStore, type BlingTokens } from './store';
import {
  CONTATOS_LISTAGEM,
  CONTATOS_TIPOS,
  ERRO_ESCOPO,
  ERRO_PERMISSAO,
  PRODUTOS_LISTAGEM,
} from './__fixtures__/respostas';

const CREDENCIAIS = {
  clientId: 'id-de-teste',
  clientSecret: 'segredo-de-teste',
  redirectUri: 'https://exemplo.test/oauth/retorno',
};

const daquiAHoras = (horas: number) =>
  new Date(Date.now() + horas * 3600_000);

const tokensValidos = (): BlingTokens => ({
  accessToken: 'acesso-valido',
  refreshToken: 'renovacao-valida',
  expiresAt: daquiAHoras(6),
});

/** Responde um JSON com o status pedido. */
const responde = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const monta = (fetchFake: typeof fetch, tokens?: BlingTokens | null) =>
  new BlingClient({
    ...CREDENCIAIS,
    fetch: fetchFake,
    store: new InMemoryTokenStore(tokens ?? undefined),
  });

describe('construção', () => {
  it('recusa credenciais faltando', () => {
    expect(() => new BlingClient({} as never)).toThrow(TypeError);
  });
});

describe('authorizeUrl', () => {
  it('monta o endereço com os parâmetros do OAuth', () => {
    const url = new URL(monta(vi.fn()).authorizeUrl('estado-123'));
    expect(url.origin + url.pathname).toBe(
      'https://www.bling.com.br/Api/v3/oauth/authorize',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CREDENCIAIS.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(CREDENCIAIS.redirectUri);
    expect(url.searchParams.get('state')).toBe('estado-123');
  });
});

describe('connect', () => {
  it('troca o código por tokens e guarda', async () => {
    const fetchFake = vi.fn().mockResolvedValue(
      responde({
        access_token: 'acesso-novo',
        refresh_token: 'renovacao-nova',
        expires_in: 21600,
      }),
    );
    const store = new InMemoryTokenStore();
    const client = new BlingClient({ ...CREDENCIAIS, fetch: fetchFake, store });

    const tokens = await client.connect('codigo-da-volta');
    expect(tokens.accessToken).toBe('acesso-novo');
    expect((await store.get())?.refreshToken).toBe('renovacao-nova');

    const [url, init] = fetchFake.mock.calls[0]!;
    expect(url).toBe('https://api.bling.com.br/Api/v3/oauth/token');
    // O Bling exige as credenciais do aplicativo em Basic, não no corpo.
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^Basic /,
    );
    expect(init.body).toContain('grant_type=authorization_code');
  });

  it('recusa código vazio sem chamar a rede', async () => {
    const fetchFake = vi.fn();
    await expect(monta(fetchFake).connect('  ')).rejects.toThrow(BlingAuthError);
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it('transforma recusa do Bling em erro de autenticação', async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValue(responde({ error: 'invalid_grant' }, 400));
    await expect(monta(fetchFake).connect('codigo')).rejects.toThrow(
      BlingAuthError,
    );
  });
});

describe('request', () => {
  it('avisa quando não há conta conectada', async () => {
    await expect(monta(vi.fn()).request('/produtos')).rejects.toThrow(
      BlingNotConnectedError,
    );
  });

  it('manda o token e o cabeçalho enable-jwt', async () => {
    const fetchFake = vi.fn().mockResolvedValue(responde(PRODUTOS_LISTAGEM));
    await monta(fetchFake, tokensValidos()).request('/produtos');

    const [url, init] = fetchFake.mock.calls[0]!;
    expect(url).toBe('https://api.bling.com.br/Api/v3/produtos');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer acesso-valido');
    expect(headers['enable-jwt']).toBe('1');
  });

  it('transforma 429 em erro com o tempo de espera', async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValue(responde({}, 429, { 'retry-after': '5' }));
    const erro = await monta(fetchFake, tokensValidos())
      .request('/produtos')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(BlingRateLimitError);
    expect((erro as BlingRateLimitError).retryAfterMs).toBe(5000);
  });

  // As duas causas de 403 se resolvem em lugares diferentes: escopo no
  // cadastro do aplicativo, permissão no cadastro de usuários da conta.
  it('separa 403 por escopo de 403 por permissão', async () => {
    const porEscopo = vi.fn().mockResolvedValue(responde(ERRO_ESCOPO, 403));
    await expect(
      monta(porEscopo, tokensValidos()).request('/pedidos/vendas'),
    ).rejects.toThrow(BlingScopeError);

    const porPermissao = vi.fn().mockResolvedValue(responde(ERRO_PERMISSAO, 403));
    const erro = await monta(porPermissao, tokensValidos())
      .request('/formas-pagamentos')
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BlingApiError);
    expect(erro).not.toBeInstanceOf(BlingScopeError);
  });

  it('carrega o status e o caminho no erro de API', async () => {
    const fetchFake = vi.fn().mockResolvedValue(responde({ erro: 'x' }, 500));
    const erro = (await monta(fetchFake, tokensValidos())
      .request('/produtos')
      .catch((e: unknown) => e)) as BlingApiError;

    expect(erro.status).toBe(500);
    expect(erro.path).toBe('/produtos');
  });
});

describe('renovação automática', () => {
  const vencido = (): BlingTokens => ({
    accessToken: 'acesso-vencido',
    refreshToken: 'renovacao-boa',
    expiresAt: daquiAHoras(-1),
  });

  it('renova antes de chamar quando o acesso venceu', async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValueOnce(
        responde({
          access_token: 'acesso-renovado',
          refresh_token: 'renovacao-2',
          expires_in: 21600,
        }),
      )
      .mockResolvedValueOnce(responde(PRODUTOS_LISTAGEM));

    const store = new InMemoryTokenStore(vencido());
    const client = new BlingClient({ ...CREDENCIAIS, fetch: fetchFake, store });
    await client.request('/produtos');

    expect(fetchFake.mock.calls[0]![1].body).toContain(
      'grant_type=refresh_token',
    );
    expect(
      (fetchFake.mock.calls[1]![1].headers as Record<string, string>)
        .Authorization,
    ).toBe('Bearer acesso-renovado');
  });

  // O Bling invalida o refresh token a cada uso. Guardar o antigo mataria a
  // ligação no vencimento seguinte.
  it('guarda o refresh token novo que veio na renovação', async () => {
    const fetchFake = vi.fn().mockResolvedValue(
      responde({
        access_token: 'a2',
        refresh_token: 'renovacao-nova-do-bling',
        expires_in: 21600,
      }),
    );
    const store = new InMemoryTokenStore(vencido());
    await new BlingClient({
      ...CREDENCIAIS,
      fetch: fetchFake,
      store,
    }).accessToken();

    expect((await store.get())?.refreshToken).toBe('renovacao-nova-do-bling');
  });

  // Duas renovações ao mesmo tempo gastariam o refresh token duas vezes e
  // derrubariam a ligação.
  it('renova uma vez só quando várias chamadas partem juntas', async () => {
    const fetchFake = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/oauth/token')) {
        return Promise.resolve(
          responde({ access_token: 'a2', refresh_token: 'r2', expires_in: 21600 }),
        );
      }
      return Promise.resolve(responde(PRODUTOS_LISTAGEM));
    });

    const client = new BlingClient({
      ...CREDENCIAIS,
      fetch: fetchFake,
      store: new InMemoryTokenStore(vencido()),
    });
    await Promise.all([
      client.request('/produtos'),
      client.request('/contatos'),
      client.request('/contatos/tipos'),
    ]);

    const renovacoes = fetchFake.mock.calls.filter(([url]) =>
      String(url).endsWith('/oauth/token'),
    );
    expect(renovacoes).toHaveLength(1);
  });

  it('avisa com clareza quando a renovação é recusada', async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValue(responde({ error: 'invalid_grant' }, 400));
    await expect(
      monta(fetchFake, vencido()).accessToken(),
    ).rejects.toThrow(BlingAuthError);
  });
});

describe('recursos', () => {
  it('produtos.list usa o limite padrão de 100', async () => {
    const fetchFake = vi.fn().mockResolvedValue(responde(PRODUTOS_LISTAGEM));
    const client = monta(fetchFake, tokensValidos());
    const { data } = await client.produtos.list();

    expect(fetchFake.mock.calls[0]![0]).toContain('/produtos?limite=100');
    expect(data[0]?.estoque?.saldoVirtualTotal).toBe(0);
  });

  it('contatos.tipoId acha o id do papel, sem diferenciar caixa', async () => {
    // Um `Response` só pode ser lido uma vez; cada chamada ganha o seu.
    const fetchFake = vi
      .fn()
      .mockImplementation(() => Promise.resolve(responde(CONTATOS_TIPOS)));
    const client = monta(fetchFake, tokensValidos());

    expect(await client.contatos.tipoId('cliente')).toBe(14585010321);
    expect(await client.contatos.tipoId('Inexistente')).toBeNull();
  });

  // A listagem não diz o papel de ninguém: filtrar em memória acharia zero.
  it('contatos.list filtra pelo papel no servidor', async () => {
    const fetchFake = vi.fn().mockResolvedValue(responde(CONTATOS_LISTAGEM));
    await monta(fetchFake, tokensValidos()).contatos.list({
      idTipoContato: 14585010321,
    });

    expect(fetchFake.mock.calls[0]![0]).toContain('idTipoContato=14585010321');
  });

  it('a listagem de contatos realmente não traz tiposContato', () => {
    const linha = CONTATOS_LISTAGEM.data[0] as Record<string, unknown>;
    expect(linha.tiposContato).toBeUndefined();
    expect(linha.email).toBeUndefined();
    expect(linha.endereco).toBeUndefined();
  });
});

describe('paginação', () => {
  const pagina = (quantos: number, inicio = 1) => ({
    data: Array.from({ length: quantos }, (_, i) => ({
      id: inicio + i,
      nome: `Produto ${inicio + i}`,
      codigo: '',
      preco: 10,
      precoCusto: 0,
    })),
  });

  it('para quando a página vem incompleta', async () => {
    const fetchFake = vi
      .fn()
      .mockResolvedValueOnce(responde(pagina(100)))
      .mockResolvedValueOnce(responde(pagina(3, 101)));

    const todos = await monta(fetchFake, tokensValidos()).produtos.listAll();
    expect(todos).toHaveLength(103);
    expect(fetchFake).toHaveBeenCalledTimes(2);
  });

  it('não chama de novo quando a primeira página já vem vazia', async () => {
    const fetchFake = vi.fn().mockResolvedValue(responde({ data: [] }));
    expect(
      await monta(fetchFake, tokensValidos()).produtos.listAll(),
    ).toHaveLength(0);
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });

  // Mais itens do que o pedido significa que o filtro não pegou; seguir dali
  // seria paginar sobre algo que não entendemos.
  it('recusa página maior que o limite pedido', async () => {
    const fetchFake = vi.fn().mockResolvedValue(responde(pagina(5)));
    await expect(
      monta(fetchFake, tokensValidos()).produtos.listAll({ limite: 2 }),
    ).rejects.toThrow(/5 produtos com limite 2/);
  });

  it('recusa resposta sem a lista data', async () => {
    const fetchFake = vi.fn().mockResolvedValue(responde({ data: 'nada' }));
    await expect(
      monta(fetchFake, tokensValidos()).produtos.listAll(),
    ).rejects.toThrow(/sem a lista/);
  });
});
