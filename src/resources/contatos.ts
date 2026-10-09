import type { BlingClient } from '../client';
import { BlingResponseError } from '../errors';
import { query, type Pagina } from './produtos';

/**
 * Contato como a **listagem** devolve.
 *
 * Conferido contra a API real em outubro de 2026, e vale ler com atenção: a
 * listagem traz MENOS campos que o detalhe. Não vêm aqui `tiposContato`,
 * `email` nem `endereco` — só em `get()`.
 *
 * É por isso que não dá para separar cliente de fornecedor filtrando a
 * listagem em memória: ela não diz o papel de ninguém. Use `idTipoContato`,
 * que filtra no servidor.
 */
export interface ContatoResumo {
  id: number;
  nome: string;
  codigo: string;
  /** `A` ativo, `I` inativo, `E` excluído. */
  situacao: string;
  /** CPF ou CNPJ, como estiver cadastrado — com ou sem pontuação. */
  numeroDocumento: string;
  telefone: string;
  celular: string;
}

export interface EnderecoBling {
  endereco?: string;
  cep?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  numero?: string;
  complemento?: string;
}

/** Papel do contato: Cliente, Fornecedor, Transportador, e os que a conta criar. */
export interface TipoContato {
  id: number;
  descricao: string;
}

/** Contato completo, de `GET /contatos/{id}`. */
export interface ContatoDetalhe extends ContatoResumo {
  email?: string;
  endereco?: { geral?: EnderecoBling; cobranca?: EnderecoBling } | null;
  tiposContato?: TipoContato[];
  vendedor?: { id?: number } | null;
  financeiro?: {
    limiteCredito?: number;
    condicaoPagamento?: string;
    categoria?: { id?: number };
  } | null;
  dadosAdicionais?: {
    dataNascimento?: string;
    sexo?: string;
    naturalidade?: string;
  } | null;
  pais?: { nome?: string } | null;
  orgaoPublico?: string;
  pessoasContato?: unknown[];
}

export interface ListarContatosParams {
  pagina?: number;
  limite?: number;
  /** Busca por nome. */
  pesquisa?: string;
  /**
   * Filtra pelo papel. É o único jeito de separar cliente de fornecedor:
   * pegue o id em `tipos()`, porque ele muda de conta para conta.
   */
  idTipoContato?: number | string;
  /** `A` ativo, `I` inativo, `E` excluído. */
  situacao?: string;
  /** CPF ou CNPJ. */
  numeroDocumento?: string;
}

const LIMITE_PADRAO = 100;
const MAX_PAGINAS = 1000;

export class Contatos {
  constructor(private readonly client: BlingClient) {}

  /**
   * Os papéis cadastrados na conta, com os ids que `idTipoContato` usa.
   *
   * Os ids são por conta — não dá para fixar no código. `tipoId('Cliente')`
   * resolve o caso comum.
   */
  tipos(): Promise<Pagina<TipoContato>> {
    return this.client.request<Pagina<TipoContato>>('/contatos/tipos');
  }

  /** O id de um papel pela descrição exata, sem diferenciar maiúsculas. */
  async tipoId(descricao: string): Promise<number | null> {
    const { data } = await this.tipos();
    const alvo = descricao.trim().toLowerCase();
    const achado = (data ?? []).find(
      (tipo) => (tipo?.descricao ?? '').trim().toLowerCase() === alvo,
    );
    return typeof achado?.id === 'number' ? achado.id : null;
  }

  /** Uma página de contatos. Lembre: vem sem e-mail, endereço e papéis. */
  list(params: ListarContatosParams = {}): Promise<Pagina<ContatoResumo>> {
    return this.client.request<Pagina<ContatoResumo>>(
      `/contatos${query({ limite: LIMITE_PADRAO, ...params })}`,
    );
  }

  /** O contato completo, com e-mail, endereço e papéis. */
  get(id: number | string): Promise<{ data: ContatoDetalhe }> {
    return this.client.request<{ data: ContatoDetalhe }>(`/contatos/${id}`);
  }

  /**
   * O contato "Consumidor Final" da conta — criado pelo sistema, imutável,
   * usado em venda sem cadastro.
   */
  consumidorFinal(): Promise<{ data: ContatoDetalhe }> {
    return this.client.request<{ data: ContatoDetalhe }>(
      '/contatos/consumidor-final',
    );
  }

  /** Todos os contatos que casam com o filtro. */
  async listAll(params: ListarContatosParams = {}): Promise<ContatoResumo[]> {
    const todos: ContatoResumo[] = [];
    for await (const pagina of this.pages(params)) todos.push(...pagina);
    return todos;
  }

  /** As páginas, uma a uma, conforme chegam. */
  async *pages(
    params: ListarContatosParams = {},
  ): AsyncGenerator<ContatoResumo[], void, undefined> {
    const limite = params.limite ?? LIMITE_PADRAO;

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
      const resposta = await this.list({ ...params, pagina, limite });
      const linhas = resposta?.data;
      if (!Array.isArray(linhas)) {
        throw new BlingResponseError('Resposta de contatos sem a lista `data`.');
      }
      if (linhas.length > limite) {
        throw new BlingResponseError(
          `O Bling devolveu ${linhas.length} contatos com limite ${limite}.`,
        );
      }

      if (linhas.length > 0) yield linhas;
      if (linhas.length < limite) return;
    }

    throw new BlingResponseError(
      `A listagem passou de ${MAX_PAGINAS} páginas e foi interrompida.`,
    );
  }

  /**
   * Os contatos de um papel, já com o detalhe de cada um.
   *
   * Atalho para o caso que custa caro descobrir sozinho: a listagem não traz
   * e-mail nem endereço, então quem precisa deles paga **uma chamada por
   * contato**. A 3 por segundo, mil contatos levam uns 6 minutos — por isso
   * isto é explícito, e não o comportamento padrão de `list()`.
   */
  async *detailedByType(
    idTipoContato: number | string,
    params: Omit<ListarContatosParams, 'idTipoContato'> = {},
  ): AsyncGenerator<ContatoDetalhe, void, undefined> {
    for await (const pagina of this.pages({ ...params, idTipoContato })) {
      for (const resumo of pagina) {
        const { data } = await this.get(resumo.id);
        yield data;
      }
    }
  }
}
