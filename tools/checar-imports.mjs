#!/usr/bin/env node
/**
 * checar-imports.mjs — Acha função usada sem ter sido importada.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O `node --check` confere sintaxe, não referências. Um arquivo pode usar
 * `comBotaoOcupado(...)` sem importar a função, passar na checagem de sintaxe,
 * e só quebrar quando a pessoa clica no botão — em produção.
 *
 * Foi exatamente o que aconteceu: o formulário de completar boleto do operador
 * usava `comBotaoOcupado` sem o import, e o erro só apareceu na hora de salvar,
 * depois de a pessoa preencher tudo.
 *
 * Este script carrega cada módulo do front-end, descobre o que ele exporta, e
 * confere se todo arquivo que chama uma dessas funções realmente a importou.
 *
 * Rode antes de subir:  node tools/checar-imports.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const JS = path.resolve(AQUI, '../frontend/js');

// Módulos que exportam funções usadas pelos outros. Os que dependem do
// navegador (dados.js escolhe driver, por exemplo) entram do mesmo jeito:
// só precisamos da lista de nomes exportados, não de executá-los.
const MODULOS = [
  'ui.js', 'contas.js', 'sessao.js', 'layout.js', 'extrator.js',
  'boleto-parser.js', 'boleto-campos.js', 'leitor-grafico.js',
  'config.js', 'dados.js',
];

// O carregamento de alguns módulos toca em APIs de navegador. Um mínimo basta.
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window ??= { addEventListener() {}, location: { search: '', origin: '', pathname: '/' } };
globalThis.document ??= { addEventListener() {} };

const exportadosPor = {};
for (const m of MODULOS) {
  try {
    exportadosPor[m] = Object.keys(await import(path.join(JS, m)));
  } catch (erro) {
    console.warn(`  aviso: não consegui carregar ${m} (${erro.message.slice(0, 60)})`);
    exportadosPor[m] = [];
  }
}

const arquivos = fs.readdirSync(JS).filter((f) => f.endsWith('.js'));
let problemas = 0;

for (const arq of arquivos) {
  const src = fs.readFileSync(path.join(JS, arq), 'utf8');
  const faltas = [];

  for (const m of MODULOS) {
    if (m === arq) continue;

    const escapado = m.replace('.', '\\.');
    const bloco = src.match(new RegExp(`import\\s*\\{([^}]+)\\}\\s*from '\\./${escapado}'`, 's'));
    const comNamespace = new RegExp(`import\\s+\\w+\\s+from '\\./${escapado}'`).test(src);

    // Não importa este módulo de forma alguma? Então não há o que conferir.
    if (!bloco && !comNamespace) continue;
    // Import de namespace (import x from) dá acesso a tudo via x.algo.
    if (comNamespace && !bloco) continue;

    const importados = new Set();
    for (const pedaco of (bloco?.[1] ?? '').split(',')) {
      const [original, apelido] = pedaco.trim().split(/\s+as\s+/);
      if (original) importados.add(original.trim());
      if (apelido) importados.add(apelido.trim());
    }

    for (const nome of exportadosPor[m]) {
      if (nome === 'default' || importados.has(nome)) continue;
      // Chamada direta: `nome(` sem ponto nem letra antes.
      if (new RegExp(`(?<![\\w.])${nome}\\s*\\(`).test(src)) {
        faltas.push(`${nome} (de ${m})`);
      }
    }
  }

  if (faltas.length) {
    problemas += faltas.length;
    console.log(`  \x1b[31mFALTA\x1b[0m  ${arq}`);
    faltas.forEach((f) => console.log(`         usa ${f} sem importar`));
  }
}

console.log('');
if (problemas) {
  console.log(`\x1b[31m${problemas} referência(s) sem import em ${arquivos.length} arquivos.\x1b[0m`);
  console.log('Isso não quebra na abertura da página — quebra quando alguém usa a função.');
  process.exit(1);
}
console.log(`\x1b[32mNenhuma função usada sem import. ${arquivos.length} arquivos conferidos.\x1b[0m`);
