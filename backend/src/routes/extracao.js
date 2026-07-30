/**
 * extracao.js — "Leia este boleto para mim".
 *
 * Esta e a unica rota que NAO precisa de banco de dados. Voce manda o arquivo,
 * ela devolve valor, vencimento e codigo de barras. Da para testar no terminal:
 *
 *   curl -F arquivo=@boleto.pdf http://localhost:3333/api/extracao/arquivo
 */

import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { extrairDoBuffer } from '../services/extrator-pdf.js';
import parser from '../../../frontend/js/boleto-parser.js';

const rotas = Router();

// O arquivo fica so na memoria: nada e gravado no disco do servidor.
const recebedor = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.tamanhoMaxArquivoMb * 1024 * 1024, files: 1 },
  fileFilter(_req, arquivo, aceitar) {
    const tipoOk =
      /^(application\/pdf|image\/(png|jpe?g|webp))$/i.test(arquivo.mimetype) ||
      /\.(pdf|png|jpe?g|webp)$/i.test(arquivo.originalname);
    aceitar(tipoOk ? null : new Error('Envie um arquivo PDF, PNG ou JPG.'), tipoOk);
  },
});

/** POST /api/extracao/arquivo — manda o arquivo, recebe os dados lidos. */
rotas.post('/arquivo', recebedor.single('arquivo'), async (req, res, proximo) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        erro: 'sem_arquivo',
        mensagem: 'Envie o arquivo no campo chamado "arquivo".',
      });
    }

    const inicio = Date.now();
    const lido = await extrairDoBuffer(req.file.buffer, {
      nomeArquivo: req.file.originalname,
      tipo: req.file.mimetype,
    });

    res.json({
      ok: true,
      arquivo: {
        nome: req.file.originalname,
        tamanho: req.file.size,
        tipo: req.file.mimetype,
      },
      milissegundos: Date.now() - inicio,
      ...lido,
    });
  } catch (erro) {
    proximo(erro);
  }
});

/**
 * POST /api/extracao/codigo — manda so os numeros (digitados na mao).
 * Corpo: { "codigo": "00190500954014481606906809350314337370000000100" }
 */
rotas.post('/codigo', (req, res) => {
  const digitos = parser.somenteDigitos(req.body?.codigo ?? '');

  if (digitos.length !== 44 && digitos.length !== 47 && digitos.length !== 48) {
    return res.status(400).json({
      erro: 'tamanho_invalido',
      mensagem:
        'Um boleto tem 47 digitos na linha digitavel (ou 44 no codigo de barras). ' +
        'Contas de consumo e tributos tem 48. ' +
        `Voce mandou ${digitos.length}.`,
    });
  }

  let codigo44 = digitos;
  let validacao = null;

  if (digitos.length === 47) {
    validacao = parser.validarCobranca47(digitos);
    codigo44 = parser.linha47ParaCodigo44(digitos);
  } else if (digitos.length === 48) {
    validacao = parser.validarArrecadacao48(digitos);
    codigo44 = parser.linha48ParaCodigo44(digitos);
  }

  const interpretado = parser.interpretarCodigo(codigo44);

  res.json({
    ok: true,
    codigoBarras: codigo44,
    linhaDigitavel: digitos.length === 44 ? parser.codigo44ParaLinha47(codigo44) : digitos,
    validacao,
    ...interpretado,
  });
});

export default rotas;
