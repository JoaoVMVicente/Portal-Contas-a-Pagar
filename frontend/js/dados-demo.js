/**
 * dados-demo.js — O modo demonstração.
 * ---------------------------------------------------------------------------
 * Guarda tudo no próprio navegador (localStorage). Serve para você abrir o
 * portal e ver funcionando antes de existir qualquer banco.
 *
 * Ele tem EXATAMENTE os mesmos métodos do dados-supabase.js. Nenhuma tela sabe
 * qual dos dois está ativo — e é isso que permite trocar um pelo outro sem
 * mexer em tela nenhuma.
 *
 * SOBRE A SENHA NO MODO DEMONSTRAÇÃO
 * ----------------------------------
 * Antes, qualquer senha entrava. Isso deixava a demonstração enganosa: dava a
 * impressão de que o portal aceita qualquer um. Agora a demonstração imita o
 * fluxo de verdade:
 *
 *   1. Os e-mails da equipe já estão cadastrados, mas SEM SENHA.
 *   2. Tentar entrar dá erro, com um caminho: "Primeiro acesso".
 *   3. No primeiro acesso, um link de ativação é gerado. No mundo real ele vai
 *      para a caixa de e-mail da pessoa; aqui, como não há e-mail, mostramos o
 *      link na tela — e deixamos escrito que é simulação.
 *   4. Só depois de abrir o link é que a pessoa escolhe a senha.
 *
 * A senha nunca é guardada como texto: guardamos o resumo SHA-256 dela. Mesmo
 * numa demonstração, senha em texto puro é hábito ruim de se pegar.
 */

import { CONFIG, problemaComEmail } from './config.js';

const CHAVE = 'serena.demo.v2';

const ADMINS = {
  // podeDescartar reproduz a coluna pode_descartar de admin_emails (db/11).
  'joao.vicente@srna.co': { nome: 'João', sobrenome: 'Vicente', escopo: 'ambos', podeDescartar: true },
  'sit.pedro.moreira@ext.srna.co': { nome: 'Pedro', sobrenome: 'Moreira', escopo: 'ambos' },
  'thais.lima@srna.co': { nome: 'Thaís', sobrenome: 'Lima', escopo: 'MD' },
  'ran.karoline.lima@ext.srna.co': { nome: 'Karoline', sobrenome: 'Lima', escopo: 'MD' },
  'kelly.silva@srna.co': { nome: 'Kelly', sobrenome: 'Silva', escopo: 'NF' },
  'rodrigo.rabelo@srna.co': { nome: 'Rodrigo', sobrenome: 'Rabelo', escopo: 'NF' },
  'luana.silva@srna.co': { nome: 'Luana', sobrenome: 'Silva', escopo: 'NF' },
  'ellen.kim@srna.co': { nome: 'Ellen', sobrenome: 'Kim', escopo: 'NF' },
  'ellen.marques@srna.co': { nome: 'Ellen', sobrenome: 'Marques', escopo: 'NF' },
  'vanessa.rodrigues@srna.co': { nome: 'Vanessa', sobrenome: 'Rodrigues', escopo: 'NF' },
  'natalia.inacio@srna.co': { nome: 'Natália', sobrenome: 'Inácio', escopo: 'NF' },
  'danilo.viana@srna.co': { nome: 'Danilo', sobrenome: 'Viana', escopo: 'NF' },
  'caique.brito@srna.co': { nome: 'Caique', sobrenome: 'Brito', escopo: 'NF' },
  'debora.silva@srna.co': { nome: 'Débora', sobrenome: 'Silva', escopo: 'NF' },
  'danilo.salmazi@srna.co': { nome: 'Danilo', sobrenome: 'Salmazi', escopo: 'NF' },
  'andre.teixeira@srna.co': { nome: 'André', sobrenome: 'Teixeira', escopo: 'NF' },
  'tka.moises.bianco@ext.srna.co': { nome: 'Moisés', sobrenome: 'Bianco', escopo: 'NF' },
};

const DEPARTAMENTOS = [
  'Financeiro', 'Contas a Pagar', 'Gestão de Ativos', 'Operação e Manutenção',
  'Engenharia', 'Suprimentos', 'Jurídico', 'Regulatório', 'Tecnologia', 'Pessoas', 'Outro',
];

/* ========================================================================== *
 * Ferramentas
 * ========================================================================== */
const agora = () => new Date().toISOString();
const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function resumoDaSenha(senha) {
  const bytes = new TextEncoder().encode(`serena-demo::${senha}`);
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Sem SubtleCrypto (http em rede local, por exemplo): resumo fraco, mas
  // ainda melhor do que guardar a senha legível.
  let h = 0;
  for (const b of bytes) h = (h * 31 + b) | 0;
  return `fraco:${(h >>> 0).toString(16)}`;
}

function erro(mensagem, codigo = 'demo') {
  const e = new Error(mensagem);
  e.codigo = codigo;
  return e;
}

/* ========================================================================== *
 * O driver
 * ========================================================================== */
export function criarDriverDemo() {
  const ouvintes = new Set();

  function ler() {
    try {
      const cru = localStorage.getItem(CHAVE);
      if (cru) return JSON.parse(cru);
    } catch {
      /* dado corrompido: começamos de novo */
    }
    return null;
  }

  function gravar(estado) {
    localStorage.setItem(CHAVE, JSON.stringify(estado));
    return estado;
  }

  /* ------------------------------------------------------ semear ---------- */
  /**
   * Cria os dados de exemplo. As empresas e contas vêm do arquivo real
   * (contas-bancarias.json), então a demonstração usa CNPJs e contas que
   * existem de verdade na planilha — nada inventado.
   */
  async function semear() {
    const { listarEmpresas } = await import('./contas.js');
    let empresas = [];
    try {
      empresas = (await listarEmpresas()).filter((e) => e.contas.some((c) => c.ativa)).slice(0, 6);
    } catch {
      empresas = [];
    }

    const escolher = (i) => {
      const e = empresas[i % Math.max(empresas.length, 1)];
      if (!e) {
        return { unidade_negocio: 'Empresa de exemplo', unidade_cnpj: '00000000000000', cc: '0000-0' };
      }
      const conta = e.contas.find((c) => c.ativa) ?? e.contas[0];
      return {
        unidade_negocio: e.razaoSocial,
        unidade_cnpj: e.documento,
        cc: conta.conta,
        conta_banco: conta.banco,
        conta_agencia: conta.agencia,
        conta_tipo: conta.tipoConta,
      };
    };

    const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const emDias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

    // Os números do layout: 7 boletos, R$ 21.090, 4 pendentes, 3 associados.
    // Divididos entre NF e MD para você conseguir ver o escopo funcionando:
    // 5 notas fiscais e 2 medições.
    const modelos = [
      { tipo: 'NF', numero: '8821', forn: 'Alfa Serviços Ltda',       fcnpj: '33111222000144', valor: 4250.0,  venc: 12,  status: 'associado', por: 'Kelly Silva',   pd: 3 },
      { tipo: 'NF', numero: '9013', forn: 'Gama Engenharia ME',       fcnpj: '55333444000166', valor: 12760.0, venc: 8,   status: 'associado', por: 'Kelly Silva',   pd: 2 },
      { tipo: 'NF', numero: '7702', forn: 'Beta Manutenção S.A.',     fcnpj: '44222333000155', valor: 980.5,   venc: 20,  status: 'associado', por: 'Rodrigo Rabelo', pd: 5 },
      { tipo: 'NF', numero: '9214', forn: 'Delta Transportes Ltda',   fcnpj: '66444555000177', valor: 649.0,   venc: 4,   status: 'pendente' },
      { tipo: 'NF', numero: '8890', forn: 'Épsilon Suprimentos ME',   fcnpj: '77555666000188', valor: 1250.5,  venc: -2,  status: 'pendente' },
      { tipo: 'MD', numero: '4432', forn: 'Zeta O&M Ltda',            fcnpj: '88666777000199', valor: 700.0,   venc: 15,  status: 'pendente' },
      { tipo: 'MD', numero: '5108', forn: 'Ômega Engenharia S.A.',    fcnpj: '99777888000110', valor: 500.0,   venc: 6,   status: 'pendente' },
    ];

    const boletos = modelos.map((m, i) => {
      const local = escolher(i);
      const associado = m.status === 'associado';
      return {
        id: uuid(),
        numero_protocolo: 1000 + i,
        solicitante_id: 'demo-solicitante',
        solicitante_nome: ['Kelly', 'Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe'][i],
        solicitante_sobrenome: ['Silva', 'Souza', 'Lima', 'Costa', 'Alves', 'Rocha', 'Dias'][i],
        solicitante_email: 'exemplo@srna.co',
        tipo_documento: m.tipo,
        numero_documento: m.numero,
        documento_regularizado: true,
        ...local,
        fornecedor_razao_social: m.forn,
        fornecedor_cnpj: m.fcnpj,
        valor: m.valor,
        vencimento: emDias(m.venc),
        data_pagamento_desejada: null,
        codigo_barras: null,
        linha_digitavel: null,
        banco_emissor: ['Banco do Brasil', 'Bradesco', 'Itaú Unibanco', 'Santander', 'Caixa Econômica Federal', 'Sicoob', 'Banco Inter'][i],
        extracao_confianca: 'alta',
        extracao_metodo: 'exemplo',
        extracao_avisos: [],
        departamento: DEPARTAMENTOS[i % DEPARTAMENTOS.length],
        motivo_excecao: null,
        observacoes_cliente: null,
        observacoes_operador: null,
        arquivo_caminho: null,
        arquivo_nome: `boleto-${m.tipo.toLowerCase()}-${m.numero}.pdf`,
        arquivo_tamanho: 90000 + i * 8000,
        arquivo_tipo: 'application/pdf',
        status: m.status,
        data_envio: diasAtras(7 - i),
        data_associacao: associado ? diasAtras(m.pd) : null,
        associado_por: associado ? 'demo-operador' : null,
        associado_por_nome: associado ? m.por : null,
        associado_por_email: associado ? 'operacao@srna.co' : null,
      };
    });

    const contas = {};
    for (const [email, dados] of Object.entries(ADMINS)) {
      contas[email] = {
        email,
        nome: dados.nome,
        sobrenome: dados.sobrenome,
        papel: 'admin',
        escopo: dados.escopo,
        podeDescartar: Boolean(dados.podeDescartar),
        senhaResumo: null, // sem senha ainda: precisa do primeiro acesso
        emailConfirmado: false,
        tokenAtivacao: null,
      };
    }

    return gravar({
      versao: 2,
      criadoEm: agora(),
      contas,
      boletos,
      eventos: boletos.map((b) => ({
        id: uuid(),
        boleto_id: b.id,
        tipo: 'criado',
        observacao: 'Boleto de exemplo',
        usuario_email: b.solicitante_email,
        criado_em: b.data_envio,
      })),
      sessao: null,
      arquivos: {},
    });
  }

  async function estado() {
    return ler() ?? (await semear());
  }

  function avisar() {
    const s = ler();
    const sessao = montarSessao(s);
    ouvintes.forEach((f) => f(sessao));
  }

  function montarSessao(s) {
    if (!s?.sessao) return { usuario: null, perfil: null };
    const conta = s.contas[s.sessao.email];
    if (!conta) return { usuario: null, perfil: null };
    return {
      usuario: { id: s.sessao.id, email: conta.email },
      perfil: {
        id: s.sessao.id,
        email: conta.email,
        nome: conta.nome,
        sobrenome: conta.sobrenome,
        nome_completo: `${conta.nome} ${conta.sobrenome}`.trim(),
        papel: conta.papel,
        escopo: conta.escopo,
        pode_descartar: Boolean(conta.podeDescartar),
        departamento: conta.departamento ?? null,
      },
    };
  }

  /* ---------------------------------------------------------- driver ------ */
  return {
    modo: 'demo',

    /* ------------------------------------------------------- sessão ------ */
    async sessaoAtual() {
      return montarSessao(await estado());
    },

    aoMudarSessao(funcao) {
      ouvintes.add(funcao);
      return () => ouvintes.delete(funcao);
    },

    async entrar({ email, senha }) {
      const s = await estado();
      const chave = String(email).toLowerCase().trim();

      const problema = problemaComEmail(chave);
      if (problema) throw erro(problema, 'dominio');

      const conta = s.contas[chave];

      // Não existe conta: em modo demonstração criamos na hora, para quem
      // quiser testar o lado do solicitante sem burocracia. Mas exigimos senha.
      if (!conta) {
        if (!senha || senha.length < CONFIG.TAMANHO_MINIMO_SENHA) {
          throw erro(
            `Este e-mail ainda não tem conta. Use "Primeiro acesso" para criar, ou digite uma senha de pelo menos ${CONFIG.TAMANHO_MINIMO_SENHA} caracteres.`,
            'sem_conta'
          );
        }
        const partes = chave.split('@')[0].split('.');
        const inicio = partes.length >= 3 && partes[0].length <= 3 ? 1 : 0;
        s.contas[chave] = {
          email: chave,
          nome: (partes[inicio] ?? 'Pessoa').replace(/^./, (c) => c.toUpperCase()),
          sobrenome: (partes[inicio + 1] ?? '').replace(/^./, (c) => c.toUpperCase()),
          papel: 'cliente',
          escopo: 'ambos',
          senhaResumo: await resumoDaSenha(senha),
          emailConfirmado: true,
          tokenAtivacao: null,
        };
        s.sessao = { email: chave, id: `demo-${chave}` };
        gravar(s);
        avisar();
        return montarSessao(s);
      }

      // Conta da equipe que ainda não foi ativada.
      if (!conta.senhaResumo) {
        throw erro(
          'Esta conta ainda não foi ativada. Use "Primeiro acesso" para receber o link de ativação.',
          'precisa_primeiro_acesso'
        );
      }

      const resumo = await resumoDaSenha(senha ?? '');
      if (resumo !== conta.senhaResumo) {
        throw erro('E-mail ou senha não conferem.', 'credenciais');
      }

      s.sessao = { email: chave, id: `demo-${chave}` };
      gravar(s);
      avisar();
      return montarSessao(s);
    },

    /**
     * Primeiro acesso. No mundo real isto manda um e-mail. Aqui devolvemos o
     * link para a tela mostrar, deixando claro que é simulação.
     */
    async solicitarPrimeiroAcesso(email) {
      const s = await estado();
      const chave = String(email).toLowerCase().trim();

      const problema = problemaComEmail(chave);
      if (problema) throw erro(problema, 'dominio');

      if (!s.contas[chave]) {
        const partes = chave.split('@')[0].split('.');
        const inicio = partes.length >= 3 && partes[0].length <= 3 ? 1 : 0;
        s.contas[chave] = {
          email: chave,
          nome: (partes[inicio] ?? 'Pessoa').replace(/^./, (c) => c.toUpperCase()),
          sobrenome: (partes[inicio + 1] ?? '').replace(/^./, (c) => c.toUpperCase()),
          papel: 'cliente',
          escopo: 'ambos',
          senhaResumo: null,
          emailConfirmado: false,
          tokenAtivacao: null,
        };
      }

      const token = uuid().replace(/-/g, '').slice(0, 24);
      s.contas[chave].tokenAtivacao = token;
      gravar(s);

      return {
        ok: true,
        simulado: true,
        linkSimulado: `./login.html?ativar=${token}&email=${encodeURIComponent(chave)}`,
        mensagem:
          'Se este e-mail estiver liberado, o link de ativação foi enviado. ' +
          'Como esta é a demonstração, o link aparece aqui na tela.',
      };
    },

    /** Confere um token de ativação sem gastar ele. */
    async conferirTokenAtivacao(token, email) {
      const s = await estado();
      const chave = String(email ?? '').toLowerCase().trim();
      const conta = s.contas[chave];
      if (!conta || !conta.tokenAtivacao || conta.tokenAtivacao !== token) {
        throw erro('Este link de ativação não é válido ou já foi usado.', 'token');
      }
      return { email: chave, nome: conta.nome, sobrenome: conta.sobrenome };
    },

    /** Fecha o primeiro acesso: guarda a senha e entra. */
    async concluirPrimeiroAcesso({ token, email, senha, nome, sobrenome, departamento }) {
      const s = await estado();
      const chave = String(email ?? '').toLowerCase().trim();
      const conta = s.contas[chave];

      if (!conta || conta.tokenAtivacao !== token) {
        throw erro('Este link de ativação não é válido ou já foi usado.', 'token');
      }
      if (!senha || senha.length < CONFIG.TAMANHO_MINIMO_SENHA) {
        throw erro(`A senha precisa ter pelo menos ${CONFIG.TAMANHO_MINIMO_SENHA} caracteres.`, 'senha');
      }

      conta.senhaResumo = await resumoDaSenha(senha);
      conta.emailConfirmado = true;
      conta.tokenAtivacao = null;
      if (nome) conta.nome = nome;
      if (sobrenome) conta.sobrenome = sobrenome;
      if (departamento) conta.departamento = departamento;

      s.sessao = { email: chave, id: `demo-${chave}` };
      gravar(s);
      avisar();
      return montarSessao(s);
    },

    async cadastrar({ email, senha, nome, sobrenome }) {
      // Na demonstração, criar conta é o mesmo caminho do primeiro acesso.
      const r = await this.solicitarPrimeiroAcesso(email);
      const s = ler();
      const chave = String(email).toLowerCase().trim();
      if (nome) s.contas[chave].nome = nome;
      if (sobrenome) s.contas[chave].sobrenome = sobrenome;
      gravar(s);
      void senha;
      return { precisaVerificarEmail: true, ...r };
    },

    async recuperarSenha(email) {
      const r = await this.solicitarPrimeiroAcesso(email);
      return { ...r, mensagem: 'Se este e-mail existir, o link para redefinir a senha foi enviado.' };
    },

    async reenviarVerificacao(email) {
      return this.solicitarPrimeiroAcesso(email);
    },

    async definirNovaSenha(senha) {
      const s = await estado();
      if (!s.sessao) throw erro('Você precisa estar logado para trocar a senha.', 'sessao');
      s.contas[s.sessao.email].senhaResumo = await resumoDaSenha(senha);
      gravar(s);
      return { ok: true, mensagem: 'Senha atualizada.' };
    },

    async sair() {
      const s = await estado();
      s.sessao = null;
      gravar(s);
      avisar();
      return { ok: true };
    },

    /* -------------------------------------------------------- listas ----- */
    async listarDepartamentos() {
      return DEPARTAMENTOS;
    },

    /* ------------------------------------------------------- boletos ----- */
    async listarBoletos({
      escopo: qual = 'todos',
      status = 'todos',
      tipo = null,
      busca = '',
      cc = '',
      pagina = 1,
      porPagina = CONFIG.LINHAS_POR_PAGINA,
      ordenarPor = 'data_envio',
      ordem = 'desc',
      nulosPrimeiro = null,
    } = {}) {
      const s = await estado();
      const sessao = montarSessao(s);
      let linhas = [...s.boletos];

      if (qual === 'meus') {
        linhas = linhas.filter(
          (b) => b.solicitante_email === sessao.usuario?.email || b.solicitante_id === sessao.usuario?.id
        );
      } else if (sessao.perfil?.papel !== 'admin') {
        linhas = linhas.filter(
          (b) => b.solicitante_email === sessao.usuario?.email || b.solicitante_id === sessao.usuario?.id
        );
      } else {
        // Operador: o escopo dele limita o que existe.
        const meu = sessao.perfil.escopo;
        if (meu === 'NF' || meu === 'MD') linhas = linhas.filter((b) => b.tipo_documento === meu);
      }

      if (tipo) linhas = linhas.filter((b) => b.tipo_documento === tipo);
      if (status !== 'todos') linhas = linhas.filter((b) => b.status === status);
      if (cc) linhas = linhas.filter((b) => b.cc === cc);

      if (busca) {
        const t = busca.toLowerCase();
        linhas = linhas.filter((b) =>
          [
            b.solicitante_nome, b.solicitante_sobrenome, b.solicitante_email,
            b.fornecedor_razao_social, b.fornecedor_cnpj, b.unidade_negocio,
            b.unidade_cnpj, b.numero_documento, b.cc, b.codigo_barras,
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(t))
        );
      }

      // A mesma regra do driver do Supabase: nulo vai para o topo quando se
      // ordena por vencimento crescente, porque "não sei quando vence" é mais
      // urgente que "vence em trinta dias".
      const nulos = nulosPrimeiro ?? (ordenarPor === 'vencimento' && ordem === 'asc');

      linhas.sort((a, b) => {
        // Prioridade primeiro, igual ao driver do Supabase.
        if (Boolean(a.prioridade) !== Boolean(b.prioridade)) {
          return a.prioridade ? -1 : 1;
        }

        const va = a[ordenarPor];
        const vb = b[ordenarPor];

        const aVazio = va == null || va === '';
        const bVazio = vb == null || vb === '';
        if (aVazio && bVazio) return 0;
        if (aVazio) return nulos ? -1 : 1;
        if (bVazio) return nulos ? 1 : -1;

        const cmp =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb), 'pt-BR');
        return ordem === 'asc' ? cmp : -cmp;
      });

      const total = linhas.length;
      const de = (pagina - 1) * porPagina;

      return {
        linhas: linhas.slice(de, de + porPagina).map(enfeitar),
        total,
        pagina,
        porPagina,
      };
    },

    async kpis(tipo = null) {
      const { linhas } = await this.listarBoletos({ escopo: 'todos', tipo, porPagina: 100000 });
      // Descartados ficam fora do total e do valor: o dinheiro de um boleto
      // descartado não existe, e somá-lo faria os cartões mentirem.
      const validos = linhas.filter((b) => b.status !== 'descartado');
      return {
        total_boletos: validos.length,
        valor_total: validos.reduce((t, b) => t + Number(b.valor ?? 0), 0),
        pendentes: linhas.filter((b) => b.status === 'pendente').length,
        associados: linhas.filter((b) => b.status === 'associado').length,
        recusados: linhas.filter((b) => b.status === 'recusado').length,
        descartados: linhas.filter((b) => b.status === 'descartado').length,
      };
    },

    async criarBoleto(registro, arquivo, aoProgredir) {
      // Simula os gatilhos do banco (db/13 e db/14): identidade e departamento
      // vêm do perfil autenticado, e o que o navegador manda é descartado. Se a
      // demonstração aceitasse, ela mentiria sobre a segurança do portal real.
      {
        const sAgora = await estado();
        const perfilAgora = montarSessao(sAgora).perfil;
        if (!perfilAgora) throw erro('Entre no portal antes de enviar.', 'sem_perfil');

        const informado = registro.solicitante_email;
        if (informado && informado.toLowerCase() !== perfilAgora.email.toLowerCase()) {
          registro.solicitante_informado =
            `informou ${informado}, mas está logado como ${perfilAgora.email}`;
        }
        registro.solicitante_email = perfilAgora.email;
        registro.solicitante_nome = perfilAgora.nome;
        registro.solicitante_sobrenome = perfilAgora.sobrenome;

        if (!perfilAgora.departamento) {
          throw erro('Escolha o seu departamento antes de enviar boletos.', 'sem_departamento');
        }
        registro.departamento = perfilAgora.departamento;

        // Mesma trava do db/17: prioridade sem motivo não entra.
        if (registro.prioridade && String(registro.motivo_prioridade ?? '').trim().length < 5) {
          throw erro('Descreva o motivo da priorização.', 'motivo_prioridade');
        }
      }

      // Simula o gatilho trg_carimbar_solicitante (db/13): o que o navegador
      // manda nos campos de identidade é DESCARTADO e substituído pelo perfil
      // autenticado. Se a demonstração aceitasse, ela mentiria sobre a
      // segurança do portal de verdade.
      {
        const sessaoAgora = montarSessao(await estado());
        const perfilAgora = sessaoAgora.perfil;
        if (!perfilAgora) throw erro('Entre no portal antes de enviar.', 'sem_perfil');

        const informado = registro.solicitante_email;
        if (informado && informado.toLowerCase() !== perfilAgora.email.toLowerCase()) {
          registro.solicitante_informado =
            `informou ${informado}, mas está logado como ${perfilAgora.email}`;
        }
        registro.solicitante_email = perfilAgora.email;
        registro.solicitante_nome = perfilAgora.nome;
        registro.solicitante_sobrenome = perfilAgora.sobrenome;
      }

      const s = await estado();
      const sessao = montarSessao(s);
      if (!sessao.usuario) throw erro('Você precisa estar logado.', 'sessao');

      aoProgredir?.(30);

      const id = uuid();
      let caminho = null;

      // Arquivos pequenos ficam guardados para o clipe funcionar de verdade.
      if (arquivo && arquivo.size < 1_200_000) {
        caminho = `demo/${id}`;
        s.arquivos[caminho] = await new Promise((ok, falha) => {
          const leitor = new FileReader();
          leitor.onload = () => ok(leitor.result);
          leitor.onerror = () => falha(new Error('Não consegui ler o arquivo.'));
          leitor.readAsDataURL(arquivo);
        });
      }

      aoProgredir?.(75);

      const novo = {
        id,
        numero_protocolo: 1000 + s.boletos.length,
        solicitante_id: sessao.usuario.id,
        solicitante_email: sessao.usuario.email,
        ...registro,
        arquivo_caminho: caminho,
        arquivo_nome: arquivo?.name ?? 'boleto.pdf',
        arquivo_tamanho: arquivo?.size ?? null,
        arquivo_tipo: arquivo?.type ?? null,
        status: 'pendente',
        data_envio: agora(),
        data_associacao: null,
        associado_por: null,
        associado_por_nome: null,
        associado_por_email: null,
        observacoes_operador: null,
      };

      s.boletos.unshift(novo);
      s.eventos.push({
        id: uuid(),
        boleto_id: id,
        tipo: 'criado',
        observacao: `${novo.tipo_documento}-${novo.numero_documento} · ${novo.fornecedor_razao_social}`,
        usuario_email: sessao.usuario.email,
        criado_em: agora(),
      });
      gravar(s);
      aoProgredir?.(100);
      return enfeitar(novo);
    },

    async associarBoleto(id, observacao = null) {
      const s = await estado();
      const sessao = montarSessao(s);
      if (sessao.perfil?.papel !== 'admin') throw erro('Só a equipe de operação pode associar.', 'permissao');

      const b = s.boletos.find((x) => x.id === id);
      if (!b) throw erro('Boleto não encontrado.', 'nao_encontrado');

      const meu = sessao.perfil.escopo;
      if (meu !== 'ambos' && b.tipo_documento !== meu) {
        throw erro(`Este boleto é do tipo ${b.tipo_documento} e você trabalha com ${meu}.`, 'escopo');
      }
      if (b.status === 'associado') {
        throw erro(`Já associado por ${b.associado_por_nome ?? 'alguém'}.`, 'ja_associado');
      }

      // A mesma trava do banco: boleto pela metade não vira pagamento.
      const faltando = pendenciasDe(b);
      if (faltando.length) {
        throw erro(`Antes de associar, preencha: ${faltando.join(', ')}.`, 'incompleto');
      }

      b.status = 'associado';
      b.data_associacao = agora();
      b.associado_por = sessao.usuario.id;
      b.associado_por_nome = sessao.perfil.nome_completo;
      b.associado_por_email = sessao.perfil.email;
      b.visto_pelo_solicitante_em = null;
      if (observacao) b.observacoes_operador = observacao;

      s.eventos.push({
        id: uuid(), boleto_id: id, tipo: 'status:associado',
        observacao: observacao ?? null, usuario_email: sessao.perfil.email, criado_em: agora(),
      });
      gravar(s);
      avisar();
      return enfeitar(b);
    },

    async recusarBoleto(id, motivo) {
      const s = await estado();
      const sessao = montarSessao(s);
      if (sessao.perfil?.papel !== 'admin') throw erro('Só a equipe de operação pode recusar.', 'permissao');
      if (!motivo || motivo.trim().length < 5) throw erro('Escreva o motivo da recusa.', 'motivo');

      const b = s.boletos.find((x) => x.id === id);
      if (!b) throw erro('Boleto não encontrado.', 'nao_encontrado');

      b.status = 'recusado';
      b.data_associacao = null;
      b.associado_por = null;
      b.associado_por_nome = null;
      b.observacoes_operador = motivo.trim();
      b.visto_pelo_solicitante_em = null;

      s.eventos.push({
        id: uuid(), boleto_id: id, tipo: 'status:recusado',
        observacao: motivo.trim(), usuario_email: sessao.perfil.email, criado_em: agora(),
      });
      gravar(s);
      avisar();
      return enfeitar(b);
    },

    async reabrirBoleto(id, observacao = 'Associação desfeita') {
      const s = await estado();
      const sessao = montarSessao(s);
      if (sessao.perfil?.papel !== 'admin') throw erro('Só a equipe de operação pode reabrir.', 'permissao');

      const b = s.boletos.find((x) => x.id === id);
      if (!b) throw erro('Boleto não encontrado.', 'nao_encontrado');

      b.status = 'pendente';
      b.data_associacao = null;
      b.associado_por = null;
      b.associado_por_nome = null;
      b.observacoes_operador = observacao;

      s.eventos.push({
        id: uuid(), boleto_id: id, tipo: 'status:pendente',
        observacao, usuario_email: sessao.perfil.email, criado_em: agora(),
      });
      gravar(s);
      avisar();
      return enfeitar(b);
    },

    async urlDownload(boleto) {
      const s = await estado();
      if (!boleto.arquivo_caminho) return null;
      return s.arquivos[boleto.arquivo_caminho] ?? null;
    },

    async descartarBoleto(id, motivo) {
      const s = await estado();
      const sessao = montarSessao(s);
      if (!sessao.perfil?.pode_descartar) {
        throw erro('Você não tem permissão para descartar boletos.', 'permissao_descarte');
      }
      if (!motivo || motivo.trim().length < 5) {
        throw erro('Escreva por que este boleto está sendo descartado.', 'motivo');
      }

      const b = s.boletos.find((x) => x.id === id);
      if (!b) throw erro('Boleto não encontrado.', 'nao_encontrado');
      if (b.status === 'associado') {
        throw erro('Este boleto está associado. Desfaça a associação antes de descartar.', 'associado');
      }
      if (b.status === 'descartado') throw erro('Este boleto já foi descartado.', 'ja_descartado');

      b.status = 'descartado';
      b.data_associacao = null;
      b.associado_por = null;
      b.associado_por_nome = null;
      b.observacoes_operador = motivo.trim();
      b.visto_pelo_solicitante_em = null;

      s.eventos.push({
        id: uuid(), boleto_id: id, tipo: 'descartado',
        observacao: motivo.trim(), usuario_email: sessao.perfil.email, criado_em: agora(),
      });
      gravar(s);
      avisar();
      return enfeitar(b);
    },

    async restaurarBoleto(id, observacao = null) {
      const s = await estado();
      const sessao = montarSessao(s);
      if (!sessao.perfil?.pode_descartar) {
        throw erro('Só quem pode descartar pode restaurar.', 'permissao_descarte');
      }

      const b = s.boletos.find((x) => x.id === id);
      if (!b) throw erro('Boleto não encontrado.', 'nao_encontrado');
      if (b.status !== 'descartado') throw erro('Este boleto não está descartado.', 'nao_descartado');

      b.status = 'pendente';
      b.observacoes_operador = observacao ?? 'descarte desfeito';
      b.visto_pelo_solicitante_em = null;

      s.eventos.push({
        id: uuid(), boleto_id: id, tipo: 'restaurado',
        observacao: b.observacoes_operador, usuario_email: sessao.perfil.email, criado_em: agora(),
      });
      gravar(s);
      avisar();
      return enfeitar(b);
    },

    async completarBoleto(id, dados = {}) {
      const s = await estado();
      const sessao = montarSessao(s);
      if (sessao.perfil?.papel !== 'admin') throw erro('Só a operação pode completar.', 'permissao');

      const b = s.boletos.find((x) => x.id === id);
      if (!b) throw erro('Boleto não encontrado.', 'nao_encontrado');
      if (b.status === 'associado') throw erro('Reabra o boleto antes de alterar.', 'ja_associado');

      // A conta saiu de cena (db/18). A empresa continua sendo validada contra
      // a planilha: o CNPJ dela é o que amarra o boleto ao grupo.
      if (dados.empresaDocumento) {
        const { acharEmpresa } = await import('./contas.js');
        const achado = await acharEmpresa(dados.empresaDocumento);
        if (!achado) throw erro('Empresa não encontrada na planilha.', 'empresa');
        b.unidade_cnpj = achado.empresa.documento;
        b.unidade_negocio = achado.empresa.razaoSocial;
      }

      const aplicar = (campo, valor) => { if (valor != null && valor !== '') b[campo] = valor; };
      aplicar('numero_documento', dados.numeroDocumento);
      aplicar('valor', dados.valor);
      aplicar('vencimento', dados.vencimento);
      aplicar('fornecedor_razao_social', dados.fornecedor);
      aplicar('fornecedor_cnpj', dados.fornecedorCnpj);
      aplicar('departamento', dados.departamento);
      if (dados.regularizado != null) b.documento_regularizado = dados.regularizado;
      if (dados.observacao) b.observacoes_operador = dados.observacao;

      s.eventos.push({
        id: uuid(), boleto_id: id, tipo: 'completado',
        observacao: 'dados completados pela operação',
        usuario_email: sessao.perfil.email, criado_em: agora(),
      });
      gravar(s);
      avisar();
      return enfeitar(b);
    },

    async definirMeuDepartamento(departamento) {
      const s = await estado();
      const sessao = montarSessao(s);
      const escolhido = String(departamento ?? '').trim();

      // Mesma regra do db/15: só vale o que está na lista.
      const oficial = DEPARTAMENTOS.find(
        (d) => d.toLocaleUpperCase('pt-BR') === escolhido.toLocaleUpperCase('pt-BR')
      );
      if (!oficial) throw erro(`"${escolhido}" não está na lista de departamentos.`, 'departamento');

      const conta = s.contas[sessao.usuario?.email];
      if (!conta) throw erro('Sua conta não tem perfil no portal.', 'sem_perfil');
      conta.departamento = oficial;
      gravar(s);
      return { ...conta };
    },

    async departamentosSugeridos() {
      return [...DEPARTAMENTOS];
    },

    async marcarComoVistos() {
      const s = await estado();
      const sessao = montarSessao(s);
      let n = 0;
      for (const b of s.boletos) {
        if (b.solicitante_email === sessao.usuario?.email
            && !b.visto_pelo_solicitante_em && b.status !== 'pendente') {
          b.visto_pelo_solicitante_em = agora();
          n += 1;
        }
      }
      gravar(s);
      return n;
    },

    async situacaoDoCodigo(codigo) {
      const s = await estado();
      const sessao = montarSessao(s);
      const digitos = String(codigo ?? '').replace(/\D+/g, '');
      if (digitos.length !== 44) return [];

      const souAdmin = sessao.perfil?.papel === 'admin';

      return s.boletos
        .filter((b) => b.codigo_barras === digitos)
        .sort((a, b) => String(b.data_envio).localeCompare(String(a.data_envio)))
        .map((b) => {
          const meu = b.solicitante_email === sessao.usuario?.email;
          const podeVer = meu || souAdmin;
          return {
            numero_protocolo: b.numero_protocolo,
            status: b.status,
            tipo_documento: b.tipo_documento,
            numero_documento: b.numero_documento,
            data_envio: b.data_envio,
            data_associacao: b.data_associacao,
            sou_eu: meu,
            quem_enviou: podeVer ? `${b.solicitante_nome} ${b.solicitante_sobrenome}`.trim() : null,
            valor: podeVer ? b.valor : null,
            fornecedor: podeVer ? b.fornecedor_razao_social : null,
            motivo_da_recusa: podeVer ? b.observacoes_operador : null,
          };
        });
    },

    async historico(boletoId) {
      const s = await estado();
      return s.eventos
        .filter((e) => e.boleto_id === boletoId)
        .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    },

    assinarMudancas(funcao) {
      // Entre abas do mesmo navegador, o evento "storage" avisa.
      const aoMudar = (ev) => {
        if (ev.key === CHAVE) funcao({ origem: 'outra-aba' });
      };
      window.addEventListener('storage', aoMudar);
      ouvintes.add(funcao);
      return () => {
        window.removeEventListener('storage', aoMudar);
        ouvintes.delete(funcao);
      };
    },

    async reiniciarDemo() {
      localStorage.removeItem(CHAVE);
      await semear();
      avisar();
      return { ok: true };
    },
  };
}

/**
 * O que falta neste boleto. É a mesma lista da função pendencias_do_boleto do
 * banco (db/10) — se uma mudar, a outra tem que mudar junto.
 */
function pendenciasDe(b) {
  return [
    !b.numero_documento && 'número do documento',
    !b.unidade_cnpj && 'unidade de negócio',
    !b.fornecedor_razao_social && 'fornecedor',
    b.valor == null && 'valor',
    !b.vencimento && 'vencimento',
    !b.departamento && 'departamento',
  ].filter(Boolean);
}

/** Acrescenta os campos calculados que a visão do banco entrega de graça. */
function enfeitar(b) {
  const hoje = new Date().toISOString().slice(0, 10);
  const dias = Math.round((new Date(b.vencimento) - new Date(hoje)) / 86400000);
  const pendencias = pendenciasDe(b);

  return {
    ...b,
    nome: `${b.solicitante_nome ?? ''} ${b.solicitante_sobrenome ?? ''}`.trim(),
    documento_rotulo: `${b.tipo_documento}-${b.numero_documento ?? 's/nº'}`,
    dias_para_vencer: b.vencimento ? dias : null,
    situacao_vencimento: !b.vencimento
      ? 'sem_data'
      : dias < 0 ? 'vencido' : dias <= 3 ? 'vence_em_breve' : 'em_dia',
    pendencias,
    qtd_pendencias: pendencias.length,
    sinal_revisao: pendencias.length
      ? 'incompleto'
      : b.extracao_confianca !== 'alta' ? 'conferir' : 'ok',
    novidade_para_solicitante: !b.visto_pelo_solicitante_em && b.status !== 'pendente',
  };
}
