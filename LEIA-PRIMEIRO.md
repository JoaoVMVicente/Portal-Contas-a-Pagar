# Leia antes de mexer

## 1. Nunca extraia este zip sobre uma pasta antiga

O Windows, ao colar uma pasta sobre outra de mesmo nome, **substitui os
arquivos iguais, acrescenta os novos e nunca remove os que sumiram**. Resultado:
arquivos de versões antigas ficam no meio dos novos, e você acaba abrindo o
errado sem perceber.

Foi isso que aconteceu antes com o `07_seed_unidades.sql` — um arquivo da
primeira versão, que não existe mais, e que deu erro no Supabase por procurar
uma tabela que já não existe.

**Extraia sempre numa pasta nova e vazia.** Se quiser conferir depois que não
sobrou nada de versão antiga, rode na raiz do projeto:

```powershell
Get-ChildItem -Recurse -Force -Include 07_seed_unidades.sql,unidades.js,unidades-negocio.json
```

Se não devolver nada, está limpo.

## 2. A pasta que se publica é `frontend`

O portal inteiro está em `frontend/`. Na raiz do projeto **não** deve existir
`index.html`, `js/`, `css/`, `assets/` nem `paginas/`. Se você vir isso, tem
cópia velha ou reorganização no meio.

Para rodar local:

```powershell
cd frontend
npx serve -l 8081
```

**Não mova os arquivos do `frontend` para a raiz** para deixar o endereço do
GitHub Pages mais curto. O portal usa caminhos relativos (`./js/...`,
`./cliente.html`) e mover as telas quebra a navegação.

O jeito certo de ter o endereço limpo já está pronto:
`.github/workflows/publicar.yml`. Ele publica só a pasta `frontend` como se
fosse a raiz. Basta ir em **Settings > Pages > Source: GitHub Actions**.

## 3. Falta uma coisa no `config.js`

`frontend/js/config.js` já vem com a URL do Supabase. Falta a **Publishable
key** (`sb_publishable_...`), que está em **Settings > API Keys**.

Copie pelo **botão de copiar** do painel. Selecionar com o mouse pega só o
pedaço visível, porque o painel mostra a chave abreviada com `...`.

Se a linha terminar com `...`, está cortada e o portal não vai conectar.

## 4. Por onde começar

| Quero | Leia |
|---|---|
| Rodar na minha máquina | `docs/01-COMO-RODAR.md` |
| Entender o que foi construído e por quê | `PRD.md` |
| Configurar o banco | `docs/02-SUPABASE-SETUP.md` |
| Publicar | `docs/03-DEPLOY-GITHUB-PAGES.md` |
| Entender login, papéis e NF/MD | `docs/07-ACESSO-E-PAPEIS.md` |
| Fazer o e-mail chegar de verdade | `docs/08-EMAIL-DE-VERDADE.md` |
