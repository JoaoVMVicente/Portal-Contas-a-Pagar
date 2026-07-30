/**
 * boletos.js — As rotas dos boletos.
 *
 * IMPORTANTE: estas rotas NAO tem regra de seguranca propria inventada aqui.
 * Elas repassam o pedido ao banco usando o cracha da pessoa, e o RLS do
 * Postgres decide o que pode. Assim existe UM lugar so com as regras, e nao
 * dois lugares que podem discordar.
 */

import { Router } from 'express';
import { exigirLogin } from '../middleware/auth.js';
import parser from '../../../frontend/js/boleto-parser.js';

const rotas = Router();
rotas.use(exigirLogin());

const LINHAS_POR_PAGINA_PADRAO = 25;

/** GET /api/boletos — a fila. Cliente ve os proprios; operador ve todos. */
rotas.get('/', async (req, res, proximo) => {
  try {
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const porPagina = Math.min(500, Number(req.query.porPagina) || LINHAS_POR_PAGINA_PADRAO);
    const de = (pagina - 1) * porPagina;

    const ordenarPor = String(req.query.ordenarPor ?? 'data_envio');
    const crescente = String(req.query.ordem ?? 'desc') === 'asc';

    // Lista branca: so deixamos ordenar por colunas que existem de verdade.
    const colunasOrdenaveis = new Set([
      'data_envio',
      'vencimento',
      'valor',
      'nome',
      'cc',
      'unidade_negocio',
      'fornecedor_razao_social',
      'documento_rotulo',
      'data_associacao',
      'numero_protocolo',
      'status',
    ]);
    const coluna = colunasOrdenaveis.has(ordenarPor) ? ordenarPor : 'data_envio';

    let consulta = req.supabase
      .from('vw_boletos_operador')
      .select('*', { count: 'exact' })
      .order(coluna, { ascending: crescente })
      .range(de, de + porPagina - 1);

    if (req.query.status && req.query.status !== 'todos') {
      consulta = consulta.eq('status', String(req.query.status));
    }
    if (req.query.cc) {
      consulta = consulta.eq('cc', String(req.query.cc));
    }
    if (req.query.tipo) {
      consulta = consulta.eq('tipo_documento', String(req.query.tipo));
    }
    if (req.query.busca) {
      // Tiramos % e vírgula para a pessoa nao conseguir mexer no filtro.
      const termo = String(req.query.busca).replace(/[%,]/g, '');
      consulta = consulta.or(
        [
          `nome.ilike.%${termo}%`,
          `solicitante_email.ilike.%${termo}%`,
          `fornecedor_razao_social.ilike.%${termo}%`,
          `unidade_negocio.ilike.%${termo}%`,
          `unidade_cnpj.ilike.%${termo}%`,
          `fornecedor_cnpj.ilike.%${termo}%`,
          `numero_documento.ilike.%${termo}%`,
          `cc.ilike.%${termo}%`,
          `codigo_barras.ilike.%${termo}%`,
        ].join(',')
      );
    }

    const { data, error, count } = await consulta;
    if (error) throw error;

    res.json({
      linhas: data ?? [],
      total: count ?? 0,
      pagina,
      porPagina,
      totalDePaginas: Math.ceil((count ?? 0) / porPagina) || 1,
    });
  } catch (erro) {
    proximo(erro);
  }
});

/** GET /api/boletos/kpis — os quatro cartoes do topo. */
rotas.get('/kpis', async (req, res, proximo) => {
  try {
    const { data, error } = await req.supabase.rpc('kpis_boletos', {
      p_tipo: req.query.tipo ?? null,
    });
    if (error) throw error;
    // A funcao devolve uma linha so.
    res.json(Array.isArray(data) ? (data[0] ?? {}) : data);
  } catch (erro) {
    proximo(erro);
  }
});

/** GET /api/boletos/:id — um boleto, com o historico. */
rotas.get('/:id', async (req, res, proximo) => {
  try {
    const { data: boleto, error } = await req.supabase
      .from('vw_boletos_operador')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!boleto) {
      return res.status(404).json({ erro: 'nao_encontrado', mensagem: 'Boleto nao encontrado.' });
    }

    const { data: eventos } = await req.supabase
      .from('boleto_eventos')
      .select('tipo, observacao, usuario_email, criado_em')
      .eq('boleto_id', req.params.id)
      .order('criado_em', { ascending: true });

    // Devolvemos tambem a linha digitavel formatada, que e o que se digita no banco.
    const linhaDigitavel =
      boleto.linha_digitavel ?? parser.codigo44ParaLinha47(boleto.codigo_barras ?? '');

    res.json({
      ...boleto,
      linha_digitavel_formatada: linhaDigitavel ? parser.formatarLinha47(linhaDigitavel) : null,
      historico: eventos ?? [],
    });
  } catch (erro) {
    proximo(erro);
  }
});

/** GET /api/boletos/:id/arquivo — devolve um link temporario para baixar. */
rotas.get('/:id/arquivo', async (req, res, proximo) => {
  try {
    const { data: boleto, error } = await req.supabase
      .from('boletos')
      .select('arquivo_caminho, arquivo_nome')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!boleto?.arquivo_caminho) {
      return res.status(404).json({ erro: 'sem_arquivo', mensagem: 'Este boleto nao tem arquivo.' });
    }

    const { data, error: erroLink } = await req.supabase.storage
      .from('boletos')
      .createSignedUrl(boleto.arquivo_caminho, 300);
    if (erroLink) throw erroLink;

    res.json({
      url: data.signedUrl,
      nome: boleto.arquivo_nome,
      validoPorSegundos: 300,
    });
  } catch (erro) {
    proximo(erro);
  }
});

/** POST /api/boletos/:id/associar — o operador assume o boleto. */
rotas.post('/:id/associar', exigirLogin({ exigirOperador: true }), async (req, res, proximo) => {
  try {
    const { data, error } = await req.supabase.rpc('associar_boleto', {
      p_boleto_id: req.params.id,
      p_observacao: req.body?.observacao ?? null,
    });
    if (error) throw error;
    res.json({ ok: true, boleto: data });
  } catch (erro) {
    proximo(erro);
  }
});

/** POST /api/boletos/:id/recusar — devolve ao solicitante, com o motivo. */
rotas.post('/:id/recusar', exigirLogin({ exigirOperador: true }), async (req, res, proximo) => {
  try {
    const motivo = String(req.body?.motivo ?? '').trim();
    if (motivo.length < 5) {
      return res.status(400).json({
        erro: 'motivo_curto',
        mensagem: 'Escreva o motivo da recusa. Quem enviou o boleto vai ler isso.',
      });
    }
    const { data, error } = await req.supabase.rpc('recusar_boleto', {
      p_boleto_id: req.params.id,
      p_motivo: motivo,
    });
    if (error) throw error;
    res.json({ ok: true, boleto: data });
  } catch (erro) {
    proximo(erro);
  }
});

/** POST /api/boletos/:id/reabrir — desfaz a associacao. */
rotas.post('/:id/reabrir', exigirLogin({ exigirOperador: true }), async (req, res, proximo) => {
  try {
    const { data, error } = await req.supabase.rpc('reabrir_boleto', {
      p_boleto_id: req.params.id,
      p_observacao: req.body?.observacao ?? 'Associacao desfeita pelo operador',
    });
    if (error) throw error;
    res.json({ ok: true, boleto: data });
  } catch (erro) {
    proximo(erro);
  }
});

export default rotas;
