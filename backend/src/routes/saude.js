/**
 * saude.js — Rota de "voce esta vivo?".
 *
 * Serve para o front-end saber se vale a pena tentar usar o back-end, e para
 * voce conferir rapidamente se a configuracao foi lida direito.
 */

import { Router } from 'express';
import { resumoDaConfiguracao } from '../config.js';

const rotas = Router();

rotas.get('/', (_req, res) => {
  res.json({
    ok: true,
    servico: 'portal-boletos-serena',
    versao: '1.0.0',
    horaDoServidor: new Date().toISOString(),
    configuracao: resumoDaConfiguracao(),
  });
});

export default rotas;
