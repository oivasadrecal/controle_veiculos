/**
 * Configuração do Painel de Controle de Viaturas
 *
 * Para deixar o site conectado definitivamente ao seu Google Sheets:
 * 1. No Google Sheets, vá em Arquivo > Compartilhar > Publicar na web (formato CSV)
 *    OU compartilhe como "Qualquer pessoa com o link pode ver".
 * 2. Cole o link entre as aspas de GOOGLE_SHEETS_URL abaixo.
 * 3. Salve e publique os arquivos (Netlify, GitHub Pages ou Vercel).
 */
window.FLEET_CONFIG = {
  // Cole o link do seu Google Sheets aqui:
  GOOGLE_SHEETS_URL: '',

  // Quantidade de dias antes do vencimento para acender o alerta amarelo
  ALERT_DAYS: 15,

  // Validade padrão de cada sistema (em meses) para cálculo automático do vencimento
  SYSTEM_VALIDITY_MONTHS: {
    dieletrico: 6,   // 6 meses
    tacografo: 24,   // 2 anos
    acustico: 12     // 1 ano
  },

  // Título exibido no cabeçalho do painel
  FLEET_TITLE: 'Controle de Vencimentos da Frota / OTNB-CX'
};
