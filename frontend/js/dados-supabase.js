/**
 * dados-supabase.js — O modo real: conversa com o Supabase.
 * ---------------------------------------------------------------------------
 * Mesmos métodos do dados-demo.js. As telas não sabem qual está ativo.
 *
 * SOBRE O PRIMEIRO ACESSO
 * -----------------------
 * Este é o ponto que mais mudou, e vale explicar o raciocínio.
 *
 * O risco levantado foi: "os e-mails da equipe já estão no banco, então eu
 * poderia criar uma senha para todo mundo do meu time sem eles saberem".
 *
 * A defesa NÃO é esconder o botão de criar conta. É exigir que a pessoa prove
 * que tem acesso à CAIXA DE E-MAIL. É a única prova que existe: quem controla
 * o e-mail é a pessoa (e o TI da empresa), não quem está na tela.
 *
 * Por isso o primeiro acesso NÃO define senha na hora. Ele manda um link. Só
 * quem abre o link — ou seja, só quem tem acesso àquele e-mail — escolhe a
 * senha. Definir a senha antes da prova deixaria o problema exatamente igual.
 *
 * E a resposta é sempre a mesma, tenha o e-mail conta ou não: "se este e-mail
 * estiver liberado, enviamos o link". Isso evita que a tela funcione como uma
 * lista de quem trabalha aqui, que é o que aconteceria se ela respondesse
 * "esse e-mail não existe".
 */

import { CONFIG, problemaComEmail } from './config.js';

let cliente = null;

/* ========================================================================== *
 * Carregar a biblioteca
 * ========================================================================== */
async function carregarBiblioteca() {
  let ultimoErro = null;
  for (const endereco of CONFIG.CDN_SUPABASE) {
    try {
      return await import(/* @vite-ignore */ endereco);
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw new Error(
    'Não consegui carregar a biblioteca do Supabase. Confira sua conexão. ' +
      `Último erro: ${ultimoErro?.message ?? 'desconhecido'}`
  );
}

async function obterCliente() {
  if (cliente) return cliente;
  const { createClient } = await carregarBiblioteca();
  cliente = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  // Deixamos acessível no console para depurar (só leitura de sessão).
  globalThis.supabase = cliente;
  return cliente;
}

/* ========================================================================== *
 * Traduzir os erros
 * ========================================================================== */
const TRADUCOES = [
  [/Invalid login credentials/i, 'E-mail ou senha não conferem.'],
  [/Email not confirmed/i, 'Confirme seu e-mail antes de entrar. Veja o link que enviamos.'],
  [/User already registered/i, 'Este e-mail já tem conta. Tente entrar, ou use "Esqueci minha senha".'],
  [/Password should be at least/i, `A senha precisa ter pelo menos ${CONFIG.TAMANHO_MINIMO_SENHA} caracteres.`],
  [/For security purposes.*(\d+) seconds/i, 'Espere alguns segundos antes de tentar de novo.'],
  [/Email rate limit exceeded/i, 'Muitos e-mails enviados. O plano grátis permite 3 por hora.'],
  [/Token has expired|invalid.*token/i, 'Este link expirou. Peça um novo primeiro acesso.'],
  [/Somente e-mails/i, 'Somente e-mails @srna.co ou @ext.srna.co podem acessar este portal.'],
  [/CONTA_INVALIDA/, 'A conta escolhida não pertence a essa empresa, ou está encerrada.'],
  [/SEM_PERMISSAO/, 'Esta ação é só para a equipe de operação.'],
  [/FORA_DO_ESCOPO/, 'Este boleto não é do tipo de documento que você trabalha.'],
  [/JA_ASSOCIADO/, 'Este boleto já foi associado.'],
  [/INCOMPLETO:\s*(.+)/, 'Antes de associar, preencha: $1'],
  [/EMPRESA_OBRIGATORIA/, 'Escolha a empresa junto com a conta bancária.'],
  [/MOTIVO_OBRIGATORIO/, 'Escreva o motivo. Quem enviou o boleto vai ler isso.'],
  [
    /duplicate key.*codbarras/i,
    'Este boleto já está no portal — pode ter sido enviado por outra pessoa da equipe. ' +
      'Fale com a operação antes de tentar de novo.',
  ],
  [/Failed to fetch|NetworkError/i, 'Sem conexão com o banco. Confira sua internet.'],
];

function traduzirErro(erro) {
  const bruto = erro?.message ?? String(erro);
  for (const [padrao, texto] of TRADUCOES) {
    const m = bruto.match(padrao);
    if (!m) continue;
    // Se a tradução usa $1, o pedaço capturado entra ali. É como a lista de
    // pendências do banco chega inteira até a tela.
    if (texto.includes('$1') && m[1]) return texto.replace('$1', m[1]);
    if (m[1] && texto.includes('alguns')) return texto.replace('alguns', m[1]);
    return texto;
  }
  // Mensagens que nós mesmos escrevemos no banco vêm como "CODIGO: texto".
  const nossa = bruto.match(/^[A-Z_]+:\s*(.+)$/);
  if (nossa) return nossa[1];
  return bruto;
}

function lancar(erro) {
  const e = new Error(traduzirErro(erro));
  e.original = erro;
  throw e;
}

/* ========================================================================== *
 * O driver
 * ========================================================================== */
export function criarDriverSupabase() {
  const ouvintes = new Set();
  let canal = null;

  async function montarSessao(sessaoSupabase) {
    if (!sessaoSupabase?.user) return { usuario: null, perfil: null };

    const sb = await obterCliente();
    const { data: perfil } = await sb
      .from('profiles')
      .select('id, email, nome, sobrenome, nome_completo, papel, escopo, e_terceirizado')
      .eq('id', sessaoSupabase.user.id)
      .maybeSingle();

    return {
      usuario: {
        id: sessaoSupabase.user.id,
        email: sessaoSupabase.user.email,
        emailConfirmado: Boolean(sessaoSupabase.user.email_confirmed_at),
      },
      perfil: perfil ?? {
        id: sessaoSupabase.user.id,
        email: sessaoSupabase.user.email,
        nome: '',
        sobrenome: '',
        nome_completo: sessaoSupabase.user.email,
        papel: 'cliente',
        escopo: 'ambos',
      },
    };
  }

  return {
    modo: 'supabase',

    /* ------------------------------------------------------- sessão ------ */
    async sessaoAtual() {
      try {
        const sb = await obterCliente();
        const { data } = await sb.auth.getSession();
        return await montarSessao(data.session);
      } catch (erro) {
        console.error('Não consegui ler a sessão:', erro);
        return { usuario: null, perfil: null };
      }
    },

    aoMudarSessao(funcao) {
      ouvintes.add(funcao);
      obterCliente().then((sb) => {
        sb.auth.onAuthStateChange(async (_evento, sessaoSupabase) => {
          const s = await montarSessao(sessaoSupabase);
          ouvintes.forEach((f) => f(s));
        });
      });
      return () => ouvintes.delete(funcao);
    },

    async entrar({ email, senha }) {
      const problema = problemaComEmail(email);
      if (problema) {
        const e = new Error(problema);
        e.codigo = 'dominio';
        throw e;
      }

      try {
        const sb = await obterCliente();
        const { data, error } = await sb.auth.signInWithPassword({
          email: String(email).toLowerCase().trim(),
          password: senha,
        });
        if (error) throw error;
        return await montarSessao(data.session);
      } catch (erro) {
        const traduzido = new Error(traduzirErro(erro));
        // A tela usa este código para oferecer o "Primeiro acesso".
        if (/não conferem/.test(traduzido.message)) traduzido.codigo = 'credenciais';
        if (/Confirme seu e-mail/.test(traduzido.message)) traduzido.codigo = 'nao_confirmado';
        traduzido.original = erro;
        throw traduzido;
      }
    },

    /**
     * Primeiro acesso / redefinir senha — o link que chega no e-mail.
     * =======================================================================
     * POR QUE ISTO NÃO É UMA CHAMADA SÓ
     * =======================================================================
     * A primeira versão deste método chamava apenas `resetPasswordForEmail`,
     * e isso estava ERRADO de um jeito silencioso: essa função só envia e-mail
     * se a pessoa JÁ EXISTE em auth.users. Num primeiro acesso de verdade a
     * conta ainda não existe, então nada era enviado — e o pior é que a tela
     * dizia "link enviado" do mesmo jeito. A pessoa ficaria esperando um
     * e-mail que nunca chegaria.
     *
     * O Supabase tem dois caminhos diferentes para as duas situações, e não há
     * como saber de antemão qual usar sem revelar se o e-mail existe. Então
     * fazemos assim:
     *
     *   1. Tentamos `signUp` com uma senha aleatória e descartável.
     *      - Conta nova       -> o Supabase cria o usuário NÃO CONFIRMADO e
     *                            manda o e-mail de confirmação. É o que
     *                            queremos.
     *      - Conta existente  -> o Supabase não manda nada e devolve um
     *                            usuário "de fachada", com `identities` vazio.
     *                            Esse array vazio é o sinal documentado.
     *
     *   2. Se o sinal disser que já existia, chamamos `resetPasswordForEmail`,
     *      que aí sim envia.
     *
     * A senha aleatória do passo 1 nunca é mostrada nem guardada em lugar
     * nenhum. Ela existe porque o `signUp` exige uma senha, e só. Ninguém —
     * nem quem pediu o link — consegue entrar com ela. O único caminho para
     * dentro é o link do e-mail. É isso que faz o mecanismo ser seguro.
     */
    async solicitarPrimeiroAcesso(email) {
      const problema = problemaComEmail(email);
      if (problema) {
        const e = new Error(problema);
        e.codigo = 'dominio';
        throw e;
      }

      const limpo = String(email).toLowerCase().trim();
      const retorno = `${window.location.origin}${window.location.pathname}?definir-senha=1`;

      // Senha descartável: forte, aleatória, e jogada fora em seguida.
      const aleatoria = () => {
        const bytes = new Uint8Array(24);
        (globalThis.crypto ?? {}).getRandomValues?.(bytes);
        const texto = btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, '');
        return `Aa1!${texto.slice(0, 28)}`;
      };

      let jaExistia = false;
      let enviou = false;

      try {
        const sb = await obterCliente();

        // ---------------------------------------------------------- passo 1
        const { data, error } = await sb.auth.signUp({
          email: limpo,
          password: aleatoria(),
          options: { emailRedirectTo: retorno },
        });

        if (error) {
          // Alguns projetos respondem com erro explícito em vez do sinal.
          if (/already registered|already exists/i.test(error.message)) {
            jaExistia = true;
          } else if (/rate limit|security purposes|only request this after/i.test(error.message)) {
            throw error;
          } else if (/Signups not allowed|signup is disabled/i.test(error.message)) {
            throw new Error(
              'A criação de contas está desligada no Supabase. Ligue em ' +
                'Authentication > Providers > Email > "Allow new users to sign up".'
            );
          } else {
            throw error;
          }
        } else if (data?.user) {
          // identities vazio = o usuário já existia; o Supabase omite isso de
          // propósito para não revelar quem tem conta.
          const identidades = data.user.identities;
          jaExistia = Array.isArray(identidades) && identidades.length === 0;
          enviou = !jaExistia;

          // Veio sessão junto? Então "Confirm email" está DESLIGADO no projeto,
          // e nenhum e-mail foi enviado. Isso quebra o fluxo inteiro, então
          // avisamos em vez de deixar a pessoa esperando.
          if (data.session) {
            await sb.auth.signOut();
            throw new Error(
              'O projeto está com "Confirm email" DESLIGADO, então nenhum e-mail é ' +
                'enviado. Ligue em Authentication > Providers > Email > "Confirm email".'
            );
          }
        }

        // ---------------------------------------------------------- passo 2
        if (jaExistia) {
          const { error: erroReset } = await sb.auth.resetPasswordForEmail(limpo, {
            redirectTo: retorno,
          });
          if (erroReset) throw erroReset;
          enviou = true;
        }
      } catch (erro) {
        // Limite de envio e configuração errada a pessoa PRECISA ver.
        // O resto silenciamos, para a tela não virar um detector de e-mails.
        const mensagem = erro?.message ?? '';
        if (/rate limit|security purposes|only request this after|Confirm email|Signups not allowed|criação de contas/i.test(mensagem)) {
          lancar(erro);
        }
        console.warn('Primeiro acesso:', erro);
      }

      return {
        ok: true,
        simulado: false,
        enviou,
        mensagem:
          'Se este e-mail estiver liberado para o portal, o link acabou de ser enviado ' +
          'para ele. Abra a mensagem e escolha sua senha. Confira também o spam — ' +
          'o remetente pode aparecer como "Supabase Auth" na primeira vez.',
      };
    },

    async conferirTokenAtivacao() {
      // No Supabase o link já traz a sessão pronta na URL, então não existe
      // token para conferir na mão: se há sessão, o link era válido.
      const s = await this.sessaoAtual();
      if (!s.usuario) {
        const e = new Error('Este link expirou ou já foi usado. Peça um novo primeiro acesso.');
        e.codigo = 'token';
        throw e;
      }
      return { email: s.usuario.email, nome: s.perfil?.nome, sobrenome: s.perfil?.sobrenome };
    },

    async concluirPrimeiroAcesso({ senha, nome, sobrenome }) {
      try {
        const sb = await obterCliente();
        const atributos = { password: senha };
        if (nome || sobrenome) atributos.data = { nome, sobrenome };

        const { error } = await sb.auth.updateUser(atributos);
        if (error) throw error;

        // Guardamos o nome também no perfil, que é o que as telas leem.
        const s = await this.sessaoAtual();
        if (s.usuario && (nome || sobrenome)) {
          await sb
            .from('profiles')
            .update({ nome: nome ?? '', sobrenome: sobrenome ?? '' })
            .eq('id', s.usuario.id);
        }
        return await this.sessaoAtual();
      } catch (erro) {
        lancar(erro);
      }
    },

    async cadastrar({ email, senha, nome, sobrenome }) {
      const problema = problemaComEmail(email);
      if (problema) throw new Error(problema);

      try {
        const sb = await obterCliente();
        const { data, error } = await sb.auth.signUp({
          email: String(email).toLowerCase().trim(),
          password: senha,
          options: {
            data: { nome, sobrenome },
            emailRedirectTo: `${window.location.origin}${window.location.pathname}?verificado=1`,
          },
        });
        if (error) throw error;

        // Usuário sem sessão = o Supabase está esperando a confirmação.
        if (data.user && !data.session) {
          return {
            precisaVerificarEmail: true,
            mensagem: 'Conta criada. Abra o link que enviamos para o seu e-mail.',
          };
        }
        return await montarSessao(data.session);
      } catch (erro) {
        lancar(erro);
      }
    },

    async recuperarSenha(email) {
      const r = await this.solicitarPrimeiroAcesso(email);
      return { ...r, mensagem: 'Se este e-mail existir, o link para redefinir a senha foi enviado.' };
    },

    async reenviarVerificacao(email) {
      try {
        const sb = await obterCliente();
        const { error } = await sb.auth.resend({
          type: 'signup',
          email: String(email).toLowerCase().trim(),
          options: {
            emailRedirectTo: `${window.location.origin}${window.location.pathname}?verificado=1`,
          },
        });
        if (error) throw error;
        return { ok: true, mensagem: 'E-mail reenviado. Confira a caixa de entrada e o spam.' };
      } catch (erro) {
        lancar(erro);
      }
    },

    async definirNovaSenha(senha) {
      try {
        const sb = await obterCliente();
        const { error } = await sb.auth.updateUser({ password: senha });
        if (error) throw error;
        return { ok: true, mensagem: 'Senha atualizada.' };
      } catch (erro) {
        lancar(erro);
      }
    },

    async sair() {
      try {
        const sb = await obterCliente();
        if (canal) {
          await sb.removeChannel(canal);
          canal = null;
        }
        await sb.auth.signOut();
        return { ok: true };
      } catch (erro) {
        lancar(erro);
      }
    },

    /* -------------------------------------------------------- listas ----- */
    async listarDepartamentos() {
      const sb = await obterCliente();
      const { data, error } = await sb
        .from('departamentos')
        .select('nome')
        .eq('ativo', true)
        .order('ordem');
      if (error) lancar(error);
      return (data ?? []).map((d) => d.nome);
    },

    /* ------------------------------------------------------- boletos ----- */
    async listarBoletos({
      escopo = 'todos',
      status = 'todos',
      tipo = null,
      busca = '',
      cc = '',
      pagina = 1,
      porPagina = CONFIG.LINHAS_POR_PAGINA,
      ordenarPor = 'data_envio',
      ordem = 'desc',
    } = {}) {
      try {
        const sb = await obterCliente();
        const de = (pagina - 1) * porPagina;

        let consulta = sb
          .from('vw_boletos_operador')
          .select('*', { count: 'exact' })
          .order(ordenarPor, { ascending: ordem === 'asc' })
          .range(de, de + porPagina - 1);

        if (escopo === 'meus') {
          const { data } = await sb.auth.getUser();
          if (data?.user) consulta = consulta.eq('solicitante_id', data.user.id);
        }
        if (tipo) consulta = consulta.eq('tipo_documento', tipo);
        if (status !== 'todos') consulta = consulta.eq('status', status);
        if (cc) consulta = consulta.eq('cc', cc);

        if (busca) {
          const t = String(busca).replace(/[%,]/g, '');
          consulta = consulta.or(
            [
              `nome.ilike.%${t}%`,
              `solicitante_email.ilike.%${t}%`,
              `fornecedor_razao_social.ilike.%${t}%`,
              `unidade_negocio.ilike.%${t}%`,
              `unidade_cnpj.ilike.%${t}%`,
              `fornecedor_cnpj.ilike.%${t}%`,
              `numero_documento.ilike.%${t}%`,
              `cc.ilike.%${t}%`,
              `codigo_barras.ilike.%${t}%`,
            ].join(',')
          );
        }

        const { data, error, count } = await consulta;
        if (error) throw error;
        return { linhas: data ?? [], total: count ?? 0, pagina, porPagina };
      } catch (erro) {
        lancar(erro);
      }
    },

    async kpis(tipo = null) {
      try {
        const sb = await obterCliente();
        const { data, error } = await sb.rpc('kpis_boletos', { p_tipo: tipo });
        if (error) throw error;
        const linha = Array.isArray(data) ? (data[0] ?? {}) : data;
        return {
          total_boletos: Number(linha?.total_boletos ?? 0),
          valor_total: Number(linha?.valor_total ?? 0),
          pendentes: Number(linha?.pendentes ?? 0),
          associados: Number(linha?.associados ?? 0),
          recusados: Number(linha?.recusados ?? 0),
        };
      } catch (erro) {
        lancar(erro);
      }
    },

    async criarBoleto(registro, arquivo, aoProgredir) {
      const sb = await obterCliente();
      const { data: dadosUsuario } = await sb.auth.getUser();
      const usuario = dadosUsuario?.user;
      if (!usuario) throw new Error('Você precisa estar logado para enviar um boleto.');

      // 1. Sobe o arquivo. O caminho começa com o id da pessoa, e é isso que
      //    o RLS do Storage confere para ninguém abrir o arquivo de outro.
      const agora = new Date();
      const nomeLimpo = (arquivo.name ?? 'boleto')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .slice(-80);
      const caminho = `${usuario.id}/${agora.getFullYear()}/${String(agora.getMonth() + 1).padStart(2, '0')}/${Date.now()}-${nomeLimpo}`;

      aoProgredir?.(15);

      const { error: erroUpload } = await sb.storage
        .from('boletos')
        .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (erroUpload) lancar(erroUpload);

      aoProgredir?.(65);

      // 2. Grava a linha. Se falhar, apagamos o arquivo que acabou de subir —
      //    senão ele fica órfão no depósito para sempre.
      const { data, error } = await sb
        .from('boletos')
        .insert({
          ...registro,
          solicitante_id: usuario.id,
          solicitante_email: usuario.email,
          arquivo_caminho: caminho,
          arquivo_nome: arquivo.name,
          arquivo_tamanho: arquivo.size,
          arquivo_tipo: arquivo.type,
          status: 'pendente',
        })
        .select()
        .single();

      if (error) {
        await sb.storage.from('boletos').remove([caminho]).catch(() => {});
        lancar(error);
      }

      aoProgredir?.(100);
      return data;
    },

    async associarBoleto(id, observacao = null) {
      const sb = await obterCliente();
      const { data, error } = await sb.rpc('associar_boleto', {
        p_boleto_id: id,
        p_observacao: observacao,
      });
      if (error) lancar(error);
      return data;
    },

    async recusarBoleto(id, motivo) {
      const sb = await obterCliente();
      const { data, error } = await sb.rpc('recusar_boleto', { p_boleto_id: id, p_motivo: motivo });
      if (error) lancar(error);
      return data;
    },

    async reabrirBoleto(id, observacao = 'Associação desfeita pelo operador') {
      const sb = await obterCliente();
      const { data, error } = await sb.rpc('reabrir_boleto', {
        p_boleto_id: id,
        p_observacao: observacao,
      });
      if (error) lancar(error);
      return data;
    },

    async urlDownload(boleto) {
      if (!boleto?.arquivo_caminho) return null;
      const sb = await obterCliente();
      const { data, error } = await sb.storage
        .from('boletos')
        .createSignedUrl(boleto.arquivo_caminho, 300);
      if (error) lancar(error);
      return data.signedUrl;
    },

    /**
     * Este código de barras já passou pelo portal?
     *
     * Chama a função situacao_do_codigo do banco, que roda com poderes
     * elevados de propósito: o solicitante não pode LER o boleto de outra
     * pessoa, mas precisa saber que ele existe. A função devolve menos
     * informação do que tem acesso — ver db/09_duplicidade.sql.
     */
    /**
     * O operador preenche o que faltava. Só mexe no que vier diferente de
     * nulo, então dá para completar aos poucos.
     */
    async completarBoleto(id, dados = {}) {
      const sb = await obterCliente();
      const { data, error } = await sb.rpc('completar_boleto', {
        p_boleto_id: id,
        p_conta: dados.conta ?? null,
        p_empresa_doc: dados.empresaDocumento ?? null,
        p_numero_documento: dados.numeroDocumento ?? null,
        p_valor: dados.valor ?? null,
        p_vencimento: dados.vencimento ?? null,
        p_fornecedor: dados.fornecedor ?? null,
        p_fornecedor_cnpj: dados.fornecedorCnpj ?? null,
        p_departamento: dados.departamento ?? null,
        p_regularizado: dados.regularizado ?? null,
        p_observacao: dados.observacao ?? null,
      });
      if (error) lancar(error);
      return data;
    },

    /** O solicitante viu as novidades: apaga o marcador. */
    async marcarComoVistos() {
      try {
        const sb = await obterCliente();
        const { data, error } = await sb.rpc('marcar_boletos_como_vistos');
        if (error) throw error;
        return Number(data ?? 0);
      } catch (erro) {
        console.warn('Não consegui marcar como vistos:', erro);
        return 0;
      }
    },

    async situacaoDoCodigo(codigo) {
      const digitos = String(codigo ?? '').replace(/\D+/g, '');
      if (digitos.length !== 44) return [];

      try {
        const sb = await obterCliente();
        const { data, error } = await sb.rpc('situacao_do_codigo', { p_codigo: digitos });
        if (error) throw error;
        return data ?? [];
      } catch (erro) {
        // Um aviso que falhou não pode impedir o envio. Registramos e seguimos.
        console.warn('Não consegui conferir duplicidade:', erro);
        return [];
      }
    },

    async historico(boletoId) {
      const sb = await obterCliente();
      const { data, error } = await sb
        .from('boleto_eventos')
        .select('tipo, observacao, usuario_email, criado_em')
        .eq('boleto_id', boletoId)
        .order('criado_em', { ascending: true });
      if (error) lancar(error);
      return data ?? [];
    },

    assinarMudancas(funcao) {
      obterCliente().then((sb) => {
        if (canal) sb.removeChannel(canal);
        canal = sb
          .channel('boletos-ao-vivo')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'boletos' }, (aviso) => {
            funcao({
              origem: 'banco',
              evento: aviso.eventType,
              tipoDocumento: aviso.new?.tipo_documento ?? aviso.old?.tipo_documento ?? null,
            });
          })
          .subscribe();
      });

      return () => {
        obterCliente().then((sb) => {
          if (canal) {
            sb.removeChannel(canal);
            canal = null;
          }
        });
      };
    },

    async reiniciarDemo() {
      throw new Error('Isso só existe no modo demonstração.');
    },
  };
}
