# CV Dashboard

O conteúdo em `src/docs/` é a fonte de verdade. O site, o CV em Word e o PDF são derivados desses Markdown.

## Desenvolvimento local

Na primeira execução, instale as dependências dos dois aplicativos:

```bash
npm ci
npm --prefix src/backoffice ci
```

Inicie o backoffice, o preview VitePress e o watcher do CV juntos:

```bash
cd src/backoffice
npm run dev
```

Backoffice: http://127.0.0.1:3000  
Preview VitePress: http://127.0.0.1:5175

O backoffice salva edições nos Markdown e permite criar experiências. O watcher regenera os artefatos ao salvar páginas públicas.

## Artefatos e publicação

```bash
npm run cv:build
npm run docs:build
```

O DOCX gerado fica em `artifacts/LR - consolidated.docx`; o PDF publicado fica em `src/docs/public/LR - consolidated.pdf`. `docs:build` regenera ambos antes de construir o site.

O workflow do GitHub Pages executa `npm run docs:build` em cada push para `main`.