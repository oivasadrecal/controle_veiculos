# Controle de Vencimentos da Frota / OTNB-CX

Aplicação web em **HTML, CSS e JavaScript puro** integrada ao **Google Sheets** para acompanhar e controlar os vencimentos dos sistemas **Dielétrico** (6 meses), **Tacógrafo** (2 anos) e **Acústico** (1 ano), com semáforo visual (**alerta amarelo 15 dias antes**).

## Como conectar ao Google Sheets (jeito simples, sem Apps Script)

1. Crie uma planilha no [Google Sheets](https://sheets.google.com) com as colunas na linha 1 (ou clique em **Google Sheets → Baixar modelo (.csv)** no site e importe):
   - `Prefixo`, `Placa`, `Modelo`, `Unidade`, `Venc. Dielétrico`, `Laudo Dielétrico`, `Venc. Tacógrafo`, `Cert. Tacógrafo`, `Venc. Acústico`, `Laudo Acústico`, `Observações`
2. No Google Sheets, escolha uma das duas opções:
   - **Arquivo → Compartilhar → Publicar na web → formato Valores separados por vírgula (.csv)**, **ou**
   - **Compartilhar → "Qualquer pessoa com o link pode ver"** e copie o link da planilha.
3. Cole o link no botão **Google Sheets** do site e clique em **Sincronizar agora** — ou cole fixo no campo `GOOGLE_SHEETS_URL` dentro de `config.js` antes de publicar online.

## Publicar Online Gratuitamente

- **Netlify Drop:** arraste a pasta `controle_veiculos` em [app.netlify.com/drop](https://app.netlify.com/drop) para receber o link `https://...netlify.app`.
- **GitHub Pages:** suba os arquivos em um repositório e ative **Settings → Pages**.

## Exportar Relatórios

Clique em **Exportar** no topo da página para:
- **Planilha Excel (.csv)** — compatível com Microsoft Excel em português.
- **Relatório PDF / Imprimir** — layout limpo em paisagem pronto para salvar como PDF.
- **Backup completo (.json)** — cópia de segurança dos cadastros.
