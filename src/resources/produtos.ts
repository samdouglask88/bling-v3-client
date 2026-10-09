import type { BlingClient } from '../client';
import { BlingResponseError } from '../errors';

/**
 * Produto como `GET /produtos` devolve. Formato conferido contra a API real
 * em outubro de 2026.
 *
 * Repare no `estoque`: o saldo vem junto da listagem, sem precisar do escopo
 * de Estoques nem de uma chamada a mais.
 */
export interface Produto {
  id: number;
  nome: string;
  codigo: string;
  preco: number;
  precoCusto: number;
  estoque?: { saldoVirtualTotal?: number } | null;
  /** `P` produto, `S` serviço. */
  tipo?: string;
  /** `A` ativo, `I` inativo. */
  situacao?: string;
  /** `S` simples, `V` com variações, `E` com composição. */
  formato?: string;
  descricaoCurta?: string;
  imagemURL?: string;
}

export interface ListarProdutosParams {
  pagina?: number;
  /** Máximo observado: 100. */
  limite?: number;
  /** Busca por nome. */
  nome?: string;
  /** Busca por código (SKU). */
  codigo?: string;
  /** Filtra por GTIN/EAN. */
  gtins?: string[];
}

export interface Pagina<T> {
  data: T[];
}

const LIMITE_PADRAO = 100;
/** Trava de segurança: catálogo real nunca chega perto disso. */
const MAX_PAGINAS = 1000;

export class Produtos {
  constructor(private readonly client: BlingClient) {}

  /** Uma página de produtos. */
  list(params: ListarProdutosParams = {}): Promise<Pagina<Produto>> {
    return this.client.request<Pagina<Produto>>(
      `/produtos${query({ limite: LIMITE_PADRAO, ...params })}`,
    );
  }

  /** Um produto pelo id do Bling. */
  get(id: number | string): Promise<{ data: Produto }> {
    return this.client.request<{ data: Produto }>(`/produtos/${id}`);
  }

  /**
   * Percorre todas as páginas e devolve o catálogo inteiro.
   *
   * A 3 chamadas por segundo, mil produtos levam uns 4 segundos. Para
   * catálogo grande prefira `pages()`, que entrega conforme chega.
   */
  async listAll(params: ListarProdutosParams = {}): Promise<Produto[]> {
    const todos: Produto[] = [];
    for await (const pagina of this.pages(params)) todos.push(...pagina);
    return todos;
  }

  /** As páginas, uma a uma, conforme chegam. */
  async *pages(
    params: ListarProdutosParams = {},
  ): AsyncGenerator<Produto[], void, undefined> {
    const limite = params.limite ?? LIMITE_PADRAO;

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
      const resposta = await this.list({ ...params, pagina, limite });
      const linhas = resposta?.data;
      if (!Array.isArray(linhas)) {
        throw new BlingResponseError('Resposta de produtos sem a lista `data`.');
      }
      // Mais itens do que foi pedido significa que o filtro não foi aplicado;
      // seguir dali é paginar sobre algo que não entendemos.
      if (linhas.length > limite) {
        throw new BlingResponseError(
          `O Bling devolveu ${linhas.length} produtos com limite ${limite}.`,
        );
      }

      if (linhas.length > 0) yield linhas;
      if (linhas.length < limite) return;
    }

    throw new BlingResponseError(
      `A listagem passou de ${MAX_PAGINAS} páginas e foi interrompida.`,
    );
  }
}

/** Monta a query string, ignorando o que não foi informado. */
export function query(params: Record<string, unknown>): string {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === null || valor === '') continue;
    if (Array.isArray(valor)) {
      for (const item of valor) busca.append(`${chave}[]`, String(item));
      continue;
    }
    busca.set(chave, String(valor));
  }
  const texto = busca.toString();
  return texto ? `?${texto}` : '';
}
