/**
 * Configuração do Painel de Controle de Viaturas (OTNB-CX)
 * Banco de dados em tempo real: Firebase Firestore
 */
window.FLEET_CONFIG = {
  // Configuração do seu projeto Firebase
  FIREBASE_CONFIG: {
    apiKey: 'AIzaSyA_ZvcW-Ru71JWQi43Cg9XkOyh2tIF9KC4',
    authDomain: 'controle-veiculos-64b30.firebaseapp.com',
    projectId: 'controle-veiculos-64b30',
    storageBucket: 'controle-veiculos-64b30.firebasestorage.app',
    messagingSenderId: '100543743955',
    appId: '1:100543743955:web:6e7f12c60c9104d2ec1126'
  },

  // Nome da coleção no Firestore onde as viaturas ficam salvas
  FIRESTORE_COLLECTION: 'viaturas',

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
