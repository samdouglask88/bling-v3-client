# bling-v3-client

Cliente TypeScript para a [API v3 do Bling](https://developer.bling.com.br).
Cuida de OAuth, renovação automática do acesso e do limite de ritmo — as
regras de negócio sobre os dados ficam com você.

Sem dependências em produção. Node 20 ou superior.

```bash
npm install bling-v3-client
```

## Como usar

```ts
import { BlingClient, InMemoryTokenStore } from 'bling-v3-client';

const bling = new BlingClient({
  clientId: process.env.BLING_CLIENT_ID!,
  clientSecret: process.env.BLING_CLIENT_SECRET!,
  redirectUri: 'https://seu-sistema.com/bling/retorno',
  store: new InMemoryTokenStore(),
});

// 1. Mande a pessoa autorizar
const url = bling.authorizeUrl('um-state-qualquer');

// 2. Na volta, troque o código por tokens
await bling.connect(codigoQueOBlingDevolveu);

// 3. Use
const { data } = await bling.produtos.list({ limite: 100 });
```

## O que esta biblioteca resolve por você

**Renovação do token.** O acesso do Bling vale 6 horas. Cada chamada confere o
vencimento e renova sozinha, com um minuto de antecedência — renovar no
instante exato deixaria uma chamada falhar no meio do caminho.

**O refresh token que muda a cada uso.** O Bling devolve um refresh token novo
em toda renovação e invalida o anterior. Guardar o antigo mata a ligação no
vencimento seguinte. O cliente sempre grava o novo, e serializa renovações
simultâneas para não gastar o token duas vezes.

**O limite de ritmo.** O Bling permite 3 chamadas por segundo. Acima disso
responde 429 e, com frequência, **bloqueia o IP de origem por 10 minutos** — o
castigo atinge todo mundo que sai por aquele IP. A fila interna segura o ritmo
por janela deslizante.

## Três coisas que só aparecem chamando a API de verdade

Estão documentadas aqui porque custam tempo para descobrir sozinho.

### A listagem de contatos não diz o papel de ninguém

`GET /contatos` devolve **menos campos** que `GET /contatos/{id}`:

```jsonc
// GET /contatos
{ "id": 1, "nome": "...", "codigo": "", "situacao": "A",
  "numeroDocumento": "", "telefone": "", "celular": "..." }
// sem tiposContato, sem email, sem endereco
```

Quem tenta separar cliente de fornecedor filtrando a listagem em memória acha
**zero** — o campo não chega. A separação é feita no servidor, e o id do papel
muda de conta para conta:

```ts
const idCliente = await bling.contatos.tipoId('Cliente');
const clientes = await bling.contatos.listAll({ idTipoContato: idCliente! });
```

Para e-mail e endereço é preciso o detalhe, uma chamada por contato:

```ts
for await (const contato of bling.contatos.detailedByType(idCliente!)) {
  console.log(contato.email, contato.endereco?.geral?.municipio);
}
```

A 3 chamadas por segundo, mil contatos levam uns 6 minutos. Por isso é
explícito, e não o comportamento padrão.

### O saldo do produto vem de graça

`GET /produtos` já traz o estoque, sem o escopo de Estoques e sem chamada
extra:

```ts
const { data } = await bling.produtos.list();
data[0]?.estoque?.saldoVirtualTotal; // número
```

### 403 tem duas causas, e conserto em lugares diferentes

```ts
import { BlingScopeError, BlingApiError } from 'bling-v3-client';

try {
  await bling.request('/pedidos/vendas');
} catch (erro) {
  if (erro instanceof BlingScopeError) {
    // Falta escopo: resolve no cadastro do APLICATIVO, e exige autorizar de novo
  } else if (erro instanceof BlingApiError && erro.status === 403) {
    // Falta permissão: resolve no cadastro de USUÁRIOS da conta
  }
}
```

## Guardando os tokens

`InMemoryTokenStore` serve para teste e script de uma vez só — em produção os
tokens somem a cada reinício. Implemente a interface para guardar onde fizer
sentido:

```ts
import type { BlingTokenStore, BlingTokens } from 'bling-v3-client';

class MeuStore implements BlingTokenStore {
  constructor(private readonly contaId: string) {}

  async get(): Promise<BlingTokens | null> { /* ... */ }

  // Chamado em TODA renovação, não só na conexão. Grave sempre.
  async set(tokens: BlingTokens): Promise<void> { /* ... */ }

  async clear(): Promise<void> { /* ... */ }
}
```

Para multi-empresa, um cliente por conta, cada um com seu store.

## Protegendo o retorno do OAuth

Sem assinar o `state`, qualquer um pode chamar sua URL de retorno com um
código e você não tem como saber se a autorização partiu do seu sistema.

```ts
import { signState, verifyState } from 'bling-v3-client';

const state = signState({ contaId: '42' }, process.env.APP_SECRET!);
const url = bling.authorizeUrl(state);

// na volta
const dados = verifyState(stateQueVoltou, process.env.APP_SECRET!);
if (!dados || dados.contaId !== '42') throw new Error('Autorização inválida');
```

Vale 10 minutos por padrão. O conteúdo vai legível em base64url — **não
coloque segredo ali**.

## API

| | |
|---|---|
| `authorizeUrl(state)` | Endereço para autorizar |
| `connect(code)` | Troca o código por tokens e guarda |
| `disconnect()` | Esquece os tokens (não revoga no Bling) |
| `isConnected()` | Há conta conectada? |
| `request<T>(path, init?)` | Chamada autenticada a qualquer rota |
| `produtos.list / get / listAll / pages` | Produtos |
| `contatos.list / get / tipos / tipoId / listAll / pages` | Contatos |
| `contatos.detailedByType(id)` | Contatos de um papel, já com o detalhe |
| `contatos.consumidorFinal()` | O contato padrão do sistema |

Para o que ainda não tem atalho, `request()` chega a qualquer uma das rotas da
API:

```ts
const pedidos = await bling.request('/pedidos/vendas?limite=100');
```

### Erros

| Erro | Quando |
|---|---|
| `BlingNotConnectedError` | Não há tokens guardados |
| `BlingAuthError` | Autorização ou renovação recusada |
| `BlingRateLimitError` | 429, com `retryAfterMs` |
| `BlingScopeError` | 403 por falta de escopo do aplicativo |
| `BlingApiError` | Outro erro HTTP, com `status`, `path` e `body` |
| `BlingResponseError` | Resposta num formato inesperado |

## Limites do Bling

| Limite | Valor | Ao passar |
|---|---|---|
| Requisições por segundo | 3 | HTTP 429 |
| Requisições por dia | 120.000 | HTTP 429 |
| Erros em 10 segundos | 300 | IP bloqueado por 10 min |
| Requisições em 10 segundos | 600 | IP bloqueado por 10 min |
| Chamadas a `/oauth/token` em 60 s | 20 | **IP bloqueado por 60 min** |
| Filtro por período | 1 ano | HTTP 400 |

O limite do `/oauth/token` é o mais perigoso e o menos óbvio: seis vezes a
punição normal. É por isso que o cliente serializa renovações.

Um aplicativo aceita **uma única URL de redirecionamento** — ambiente local e
produção precisam de aplicativos separados.

## Desenvolvimento

```bash
npm install
npm test
npm run typecheck
npm run build
```

Os testes rodam contra `fetch` falso, sem tocar na API. As fixtures em
`src/__fixtures__` reproduzem **formatos reais** de resposta com dados
fictícios — é o que impede de testar contra um formato imaginado.

## Licença

MIT
