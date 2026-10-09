/**
 * Formatos reais das respostas da API v3, observados em outubro de 2026.
 *
 * Os **dados** são fictícios; o que importa aqui é a forma: quais campos
 * existem, quais faltam, e como o Bling representa o que está vazio.
 *
 * Três coisas que só aparecem olhando uma resposta de verdade:
 *
 * 1. A listagem de contatos **não** traz `tiposContato`, `email` nem
 *    `endereco`. Quem filtra cliente pela listagem não acha nenhum.
 * 2. Campo vazio vem como string vazia, não ausente nem `null`.
 * 3. A listagem de produtos já traz o saldo em `estoque.saldoVirtualTotal`.
 */

/** `GET /contatos` — repare no que NÃO está aqui. */
export const CONTATOS_LISTAGEM = {
  data: [
    {
      id: 18439839880,
      nome: 'Padaria do Centro Ltda',
      codigo: '',
      situacao: 'A',
      numeroDocumento: '',
      telefone: '',
      celular: '(11) 90000-0000',
    },
  ],
};

/** `GET /contatos/tipos` — os ids mudam de conta para conta. */
export const CONTATOS_TIPOS = {
  data: [
    { id: 14585010321, descricao: 'Cliente' },
    { id: 14585010322, descricao: 'Fornecedor' },
    { id: 14585010323, descricao: 'Vendedor' },
    { id: 14585010320, descricao: 'Transportador' },
    { id: 14585010325, descricao: 'Funcionário' },
    { id: 14585010319, descricao: 'Padrao' },
  ],
};

/** `GET /contatos/{id}` de um cadastro em branco: tudo string vazia. */
export const CONTATO_DETALHE_VAZIO = {
  data: {
    id: 18439839880,
    nome: 'Padaria do Centro Ltda',
    codigo: '',
    situacao: 'A',
    numeroDocumento: '',
    telefone: '',
    celular: '(11) 90000-0000',
    email: '',
    endereco: {
      geral: {
        endereco: '',
        cep: '',
        bairro: '',
        municipio: '',
        uf: '',
        numero: '',
        complemento: '',
      },
      cobranca: {
        endereco: '',
        cep: '',
        bairro: '',
        municipio: '',
        uf: '',
        numero: '',
        complemento: '',
      },
    },
    orgaoPublico: '',
    vendedor: { id: 0 },
    dadosAdicionais: {
      dataNascimento: '0000-00-00',
      sexo: '',
      naturalidade: '',
    },
    financeiro: {
      limiteCredito: 0,
      condicaoPagamento: '',
      categoria: { id: 0 },
    },
    pais: { nome: '' },
    tiposContato: [{ id: 14585010322, descricao: 'Fornecedor' }],
    pessoasContato: [],
  },
};

/** `GET /contatos/{id}` de um cadastro completo. */
export const CONTATO_DETALHE_COMPLETO = {
  data: {
    id: 18500000001,
    nome: 'Mercearia Boa Vista ME',
    codigo: 'CLI-001',
    situacao: 'A',
    numeroDocumento: '12.345.678/0001-90',
    telefone: '(11) 3000-0000',
    celular: '(11) 99000-0000',
    email: 'contato@exemplo.com.br',
    endereco: {
      geral: {
        endereco: 'Rua das Palmeiras',
        cep: '01000-000',
        bairro: 'Centro',
        municipio: 'São Paulo',
        uf: 'SP',
        numero: '123',
        complemento: 'Sala 2',
      },
    },
    tiposContato: [{ id: 14585010321, descricao: 'Cliente' }],
  },
};

/** `GET /produtos` — o saldo vem junto, sem escopo de Estoques. */
export const PRODUTOS_LISTAGEM = {
  data: [
    {
      id: 16717182503,
      nome: 'Serviço de instalação',
      codigo: 'SRV-001',
      preco: 600,
      precoCusto: 0,
      estoque: { saldoVirtualTotal: 0 },
      tipo: 'P',
      situacao: 'A',
      formato: 'S',
      descricaoCurta: '',
      imagemURL: '',
    },
    {
      id: 16717182004,
      nome: 'Licença anual',
      codigo: 'LIC-001',
      preco: 1200,
      precoCusto: 0,
      estoque: { saldoVirtualTotal: 12 },
      tipo: 'P',
      situacao: 'A',
      formato: 'S',
      descricaoCurta: '',
      imagemURL: '',
    },
  ],
};

/** 403 por falta de escopo no aplicativo — some adicionando o escopo. */
export const ERRO_ESCOPO = {
  error: { type: 'insufficient_scope' },
  error_description:
    'The request requires higher privileges than provided by the access token',
};

/**
 * 403 por falta de permissão do usuário na conta. Parece o mesmo, mas se
 * resolve no cadastro de usuários do Bling, não no do aplicativo.
 */
export const ERRO_PERMISSAO = {
  error: {
    type: 'FORBIDDEN',
    message: 'Não permitido.',
    description:
      'Você não está autorizado a realizar esta operação. Consulte suas permissões com o administrador de sua conta.',
  },
};
