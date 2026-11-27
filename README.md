# Controle de Vencimentos da Frota / OTNB-CX

Aplicação web em **HTML, CSS e JavaScript puro** integrada em tempo real ao **Firebase Firestore** para cadastrar viaturas e acompanhar o vencimento dos sistemas **Dielétrico** (6 meses), **Tacógrafo** (2 anos) e **Acústico** (1 ano), com semáforo visual (**alerta amarelo 15 dias antes**).

## Banco de Dados (Firebase Firestore)

O projeto já está conectado ao projeto Firebase `controle-veiculos-64b30` (coleção `viaturas`) em `config.js`:
- Cadastros, edições, **Observações**, renovações rápidas e exclusões são salvos automaticamente na nuvem e sincronizam em **tempo real** entre todos os dispositivos abertos.
- Códigos de prefixo como `0077-7` são gravados como texto puro (nunca convertidos em data).

### Importante: Regras do Firestore (para não expirar em 30 dias)
No **Console do Firebase → Firestore Database → Regras**, se você criou o banco em *Modo de teste*, a regra padrão expira em 30 dias. Para manter o painel funcionando continuamente sem login, use:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /viaturas/{docId} {
      allow read, write: if true;
    }
  }
}
```

## Importar Planilha Antiga & Exportar Relatórios

- **Importar do Google Sheets:** clique no botão **Firebase online** no topo, cole o link de uma planilha pública do Google Sheets e clique em **Importar para o Firebase**.
- **Exportar:** clique em **Exportar** no topo para baixar **Planilha Excel (.csv)**, **Relatório PDF / Imprimir** ou **Backup completo (.json)**.

## Publicar Online Gratuitamente

- **GitHub Pages:** suba os arquivos no repositório e ative **Settings → Pages → Branch `main`**.
- **Netlify Drop:** arraste a pasta `controle_veiculos` em [app.netlify.com/drop](https://app.netlify.com/drop).
