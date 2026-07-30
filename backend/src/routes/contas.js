/**
 * contas.js — Consultas de empresas e contas bancárias.
 *
 * O front-end normalmente le o arquivo JSON estatico, que e mais rapido.
 * Estas rotas existem para conferir se o JSON esta igual ao banco, e para outro
 * sistema poder consultar sem abrir o banco.
 */

import { Router } from 'express';
import { exigirLogin } from '../middleware/auth.js';

const rotas = Router();
rotas.use(exigirLogin());

/** GET /api/contas/empresas?busca=... — busca por nome ou CNPJ. */
rotas.get('/empresas', async (req, res, proximo) => {
  try {
    if (req.query.busca) {
      const { data, error } = await req.supabase.rpc('buscar_empresas', {
        p_termo: String(req.query.busca),
        p_limite: Math.min(100, Number(req.query.limite) || 30),
      });
      if (error) throw error;
      return res.json({ total: (data ?? []).length, empresas: data ?? [] });
    }

    const { data, error } = await req.supabase
      .from('vw_empresas')
      .select('*')
      .order('razao_social');
    if (error) throw error;
    res.json({ total: data.length, empresas: data });
  } catch (erro) {
    proximo(erro);
  }
});

/** GET /api/contas/empresas/:documento — as contas de uma empresa. */
rotas.get('/empresas/:documento', async (req, res, proximo) => {
  try {
    const { data, error } = await req.supabase.rpc('contas_da_empresa', {
      p_documento: req.params.documento,
    });
    if (error) throw error;
    res.json({ documento: req.params.documento, contas: data ?? [] });
  } catch (erro) {
    proximo(erro);
  }
});

/** GET /api/contas/:conta — o caminho inverso: a conta diz qual e a empresa. */
rotas.get('/:conta', async (req, res, proximo) => {
  try {
    const { data, error } = await req.supabase.rpc('empresa_da_conta', {
      p_conta: req.params.conta,
    });
    if (error) throw error;
    res.json({ conta: req.params.conta, empresas: data ?? [] });
  } catch (erro) {
    proximo(erro);
  }
});

export default rotas;
