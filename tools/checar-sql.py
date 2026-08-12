#!/usr/bin/env python3
"""
checar-sql.py — Acha função redefinida com retorno diferente, sem DROP antes.

POR QUE ISTO EXISTE
-------------------
O Postgres recusa `create or replace function` quando o formato de retorno
mudou:

    42P13: cannot change return type of existing function
    HINT: Use DROP FUNCTION buscar_empresas(text,integer) first.

O parser do PostgreSQL não pega, porque a sintaxe está perfeita. O que está
errado é o histórico: a função já existia com outro retorno.

Rode antes de mandar uma migração nova:  python3 tools/checar-sql.py
"""
import re, glob, collections, sys, os

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'db')

def assinaturas(caminhos):
    achadas = collections.defaultdict(list)
    for arq in caminhos:
        s = open(arq, encoding='utf-8').read()
        # Corta o corpo ($$ ... $$) antes de analisar: "language" e parênteses
        # de dentro do corpo confundiriam a leitura.
        sem_corpo = re.sub(r'\$\$.*?\$\$', '$$CORPO$$', s, flags=re.S)
        for m in re.finditer(
            r'create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\((.*?)\)\s*returns\s+(.*?)\s+language',
            sem_corpo, re.I | re.S):
            achadas[m.group(1)].append((arq.split(os.sep)[-1], ' '.join(m.group(3).split())))
    return achadas

problemas = 0
for nome, ocorrencias in sorted(assinaturas(sorted(glob.glob(os.path.join(RAIZ, '*.sql')))).items()):
    if len({r for _, r in ocorrencias}) < 2:
        continue
    ultimo = ocorrencias[-1][0]
    tem_drop = re.search(rf'drop\s+function\s+if\s+exists\s+(public\.)?{nome}\s*\(',
                         open(os.path.join(RAIZ, ultimo), encoding='utf-8').read(), re.I)
    if not tem_drop:
        problemas += 1
    print(f"  {'OK (tem DROP)' if tem_drop else 'FALTA DROP':<16} {nome}()  em {', '.join(a for a, _ in ocorrencias)}")

print()
print('nenhuma função sem DROP' if not problemas else f'{problemas} ainda sem DROP')
sys.exit(1 if problemas else 0)
