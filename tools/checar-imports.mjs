#!/usr/bin/env node
/**
 * checar-imports.mjs — Acha função chamada que não existe no módulo.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 * ===========================================================================
 * O `node --check` confere sintaxe, não referências. Um arquivo pode chamar
 * uma função que não existe, passar na checagem, e só quebrar quando alguém
 * clica no botão — em produção.
 *
 * Aconteceu duas vezes neste projeto, de formas diferentes:
 *
 *   1. `comBotaoOcupado(...)` usado sem constar na lista de import.
 *      Quebrava ao salvar o formulário de completar boleto.
 *
 *   2. `sessao.podeDescartar()` chamado quando o sessao.js na pasta era de uma
 *      versão anterior e não tinha a função. Este derrubou o painel INTEIRO,
 *      porque a chamada acontece ao montar a tela.
 *
 * O segundo é o mais perigoso e o mais fácil de acontecer: basta uma atualização
 * parcial, em que um arquivo é copiado e outro não.
 *
 * ===========================================================================
 * OS DOIS CASOS QUE ELE CONFERE
 * ===========================================================================
 *   import { algo } from './ui.js'      ->  `algo` consta na lista?
 *   import * as sessao from './x.js'    ->  `sessao.algo` existe em x.js?
 *
 * Rode antes de subir:  node tools/checar-imports.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const JS = path.resolve(AQUI, '../frontend/js');

const MODULOS = [
  'ui.js', 'contas.js', 'sessao.js', 'layout.js', 'extrator.js',
  'boleto-parser.js', 'boleto-campos.js', 'leitor-grafico.js',
  'config.js', 'dados.js',
];

// Carregar alguns módulos toca em APIs de navegador. Um mínimo resolve.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window ??= { addEventListener() {}, location: { search: '', origin: '', pathname: '/' } };
globalThis.document ??= { addEventListener() {} };

/* ------------------------------------------------- o que cada um exporta -- */
const exportadosPor = {};
for (const m of MODULOS) {
  try {
    exportadosPor[m] = Object.keys(await import(path.join(JS, m)));
  } catch (erro) {
    console.warn(`  aviso: não consegui carregar ${m} — ${erro.message.slice(0, 70)}`);
    exportadosPor[m] = null; // null = não sei, então não acuso nada
  }
}

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------------------------------------------------------- a conferência - */
const arquivos = fs.readdirSync(JS).filter((f) => f.endsWith('.js'));
let problemas = 0;

for (const arq of arquivos) {
  const src = fs.readFileSync(path.join(JS, arq), 'utf8');
  const faltas = [];

  for (const m of MODULOS) {
    if (m === arq) continue;
    const exportados = exportadosPor[m];
    if (!exportados) continue;

    const alvo = escapar(`./${m}`);

    // ---------- caso 1: import * as apelido ----------
    const comNamespace = src.match(new RegExp(`import\\s*\\*\\s*as\\s+(\\w+)\\s+from '${alvo}'`));
    if (comNamespace) {
      const apelido = comNamespace[1];
      const chamadas = new Set(
        [...src.matchAll(new RegExp(`\\b${apelido}\\.(\\w+)\\s*\\(`, 'g'))].map((x) => x[1])
      );
      for (const chamada of chamadas) {
        if (!exportados.includes(chamada)) {
          faltas.push(`${apelido}.${chamada}() — não existe em ${m}`);
        }
      }
    }

    // ---------- caso 2: import { a, b as c } ----------
    const comChaves = src.match(new RegExp(`import\\s*\\{([^}]+)\\}\\s*from '${alvo}'`, 's'));
    if (comChaves) {
      const importados = new Set();
      for (const pedaco of comChaves[1].split(',')) {
        const [original, apelido] = pedaco.trim().split(/\s+as\s+/);
        if (original) importados.add(original.trim());
        if (apelido) importados.add(apelido.trim());
      }
      for (const nome of exportados) {
        if (nome === 'default' || importados.has(nome)) continue;
        // Chamada direta: `nome(` sem ponto nem letra antes.
        if (new RegExp(`(?<![\\w.])${escapar(nome)}\\s*\\(`).test(src)) {
          faltas.push(`${nome}() — está em ${m} mas não foi importado`);
        }
      }
    }
  }

  if (faltas.length) {
    problemas += faltas.length;
    console.log(`  \x1b[31mFALTA\x1b[0m  ${arq}`);
    faltas.forEach((f) => console.log(`         ${f}`));
  }
}

console.log('');
if (problemas) {
  console.log(`\x1b[31m${problemas} problema(s) em ${arquivos.length} arquivos.\x1b[0m`);
  console.log('Nenhum destes quebra na sintaxe — quebram quando o código roda.');
  process.exit(1);
}
console.log(`\x1b[32mNenhum problema. ${arquivos.length} arquivos conferidos.\x1b[0m`);
