/**
 * Controle de Vencimentos de Viaturas - Backend Google Apps Script
 * Sistemas: Dielétrico, Tacógrafo e Acústico
 *
 * Como usar:
 * 1. Crie uma planilha no Google Sheets.
 * 2. Vá em Extensões > Apps Script.
 * 3. Apague o conteúdo existente e cole este arquivo inteiro.
 * 4. Salve e clique em Implantar > Nova implantação > App da Web.
 *    - Executar como: Eu
 *    - Quem pode acessar: Qualquer pessoa
 * 5. Copie a URL do App da Web gerada e cole no arquivo config.js (ou no botão "Planilha" da página).
 */

const SHEET_NAME = 'Viaturas';

const HEADERS = [
  'id',
  'prefixo',
  'placa',
  'modelo',
  'unidade',
  'dieletrico_vencimento',
  'dieletrico_laudo',
  'tacografo_vencimento',
  'tacografo_laudo',
  'acustico_vencimento',
  'acustico_laudo',
  'observacoes',
  'atualizado_em'
];

const HEADER_LABELS = [
  'ID',
  'Prefixo',
  'Placa',
  'Modelo / Tipo',
  'Base / Unidade',
  'Venc. Dielétrico',
  'Laudo Dielétrico',
  'Venc. Tacógrafo',
  'Cert. Tacógrafo',
  'Venc. Acústico',
  'Laudo Acústico',
  'Observações',
  'Última Atualização'
];

/**
 * Garante que a aba "Viaturas" existe com cabeçalho formatado.
 */
function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER_LABELS);
    const headerRange = sheet.getRange(1, 1, 1, HEADER_LABELS.length);
    headerRange
      .setBackground('#1A3A5C')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setHorizontalAlignment('left');
    sheet.setFrozenRows(1);

    // Larguras confortáveis para visualização direta na planilha
    const widths = [140, 110, 110, 210, 160, 130, 140, 130, 140, 130, 140, 260, 170];
    widths.forEach(function (w, idx) {
      sheet.setColumnWidth(idx + 1, w);
    });

    // Formata TODAS as colunas como texto simples (@) para impedir que códigos como "0077-7" virem datas
    sheet.getRange(2, 1, 999, HEADERS.length).setNumberFormat('@');
  }

  return sheet;
}

/**
 * Grava linhas sempre como Texto Simples (@) ANTES de setValues,
 * usando SpreadsheetApp.flush() para obrigar o Google Sheets a aplicar
 * o formato texto antes de receber os valores (evita "0077-7" virar data).
 */
function writeRowsAsPlainText_(sheet, startRow, rows) {
  if (!rows || rows.length === 0) return;
  const range = sheet.getRange(startRow, 1, rows.length, HEADERS.length);
  range.setNumberFormat('@');
  SpreadsheetApp.flush();
  range.setValues(rows);
}

/**
 * Normaliza valores de data que eventualmente tenham sido editados manualmente na planilha.
 */
function normalizeDateValue_(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  // Aceita formato brasileiro DD/MM/AAAA digitado diretamente no Google Sheets
  const brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return brMatch[3] + '-' + brMatch[2] + '-' + brMatch[1];
  }
  return str;
}

function rowToObject_(row, displayRow) {
  const obj = {};
  HEADERS.forEach(function (key, idx) {
    const rawVal = row[idx];
    const dispVal = displayRow ? String(displayRow[idx] || '').trim() : '';

    if (key.indexOf('_vencimento') !== -1) {
      obj[key] = normalizeDateValue_(rawVal);
    } else if (key === 'atualizado_em') {
      obj[key] = rawVal instanceof Date && !isNaN(rawVal.getTime())
        ? rawVal.toISOString()
        : (dispVal || String(rawVal || '').trim());
    } else {
      // Usa o texto exato exibido na célula (nunca converte prefixo/placa/laudo para ISO string com horário)
      obj[key] = dispVal;
    }
  });
  return obj;
}

function objectToRow_(item) {
  return HEADERS.map(function (key) {
    const val = item[key];
    if (val === null || val === undefined) return '';
    return String(val).trim();
  });
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET: Retorna todas as viaturas cadastradas.
 */
function doGet(e) {
  try {
    const sheet = getOrCreateSheet_();
    const lastRow = sheet.getLastRow();
    const vehicles = [];

    if (lastRow > 1) {
      const range = sheet.getRange(2, 1, lastRow - 1, HEADERS.length);
      const values = range.getValues();
      const displayValues = range.getDisplayValues();
      values.forEach(function (row, idx) {
        const disp = displayValues[idx];
        const id = String(disp[0] || '').trim();
        const prefixo = String(disp[1] || '').trim();
        const placa = String(disp[2] || '').trim();
        if (id || prefixo || placa) {
          const item = rowToObject_(row, disp);
          if (!item.id) {
            item.id = 'vtr-row-' + Utilities.getUuid().slice(0, 8);
            // Persiste o ID gerado na coluna A para permitir edições futuras pelo site
            const idCell = sheet.getRange(idx + 2, 1);
            idCell.setNumberFormat('@');
            SpreadsheetApp.flush();
            idCell.setValue(item.id);
          }
          vehicles.push(item);
        }
      });
    }

    return jsonResponse_({
      ok: true,
      vehicles: vehicles,
      sheetName: SHEET_NAME,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: err.message || String(err)
    });
  }
}

/**
 * POST: Cria, atualiza, remove ou importa viaturas.
 * O front-end envia Content-Type: text/plain para evitar bloqueio de preflight CORS.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);

    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    const action = body.action || '';
    const sheet = getOrCreateSheet_();

    if (action === 'create') {
      const vehicle = body.vehicle || {};
      if (!vehicle.id) {
        vehicle.id = 'vtr-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      }
      vehicle.atualizado_em = new Date().toISOString();

      const newRow = objectToRow_(vehicle);
      const nextRow = sheet.getLastRow() + 1;
      writeRowsAsPlainText_(sheet, nextRow, [newRow]);

      return jsonResponse_({ ok: true, vehicle: vehicle });
    }

    if (action === 'update') {
      const vehicle = body.vehicle || {};
      if (!vehicle.id) {
        return jsonResponse_({ ok: false, error: 'ID da viatura é obrigatório para atualizar.' });
      }
      vehicle.atualizado_em = new Date().toISOString();

      const rowIndex = findRowIndexById_(sheet, vehicle.id);
      if (rowIndex === -1) {
        return jsonResponse_({ ok: false, error: 'Viatura não encontrada na planilha.' });
      }

      const updatedRow = objectToRow_(vehicle);
      writeRowsAsPlainText_(sheet, rowIndex, [updatedRow]);

      return jsonResponse_({ ok: true, vehicle: vehicle });
    }

    if (action === 'delete') {
      const id = body.id;
      if (!id) {
        return jsonResponse_({ ok: false, error: 'ID da viatura é obrigatório para excluir.' });
      }
      const rowIndex = findRowIndexById_(sheet, id);
      if (rowIndex === -1) {
        return jsonResponse_({ ok: false, error: 'Viatura não encontrada na planilha.' });
      }
      sheet.deleteRow(rowIndex);
      return jsonResponse_({ ok: true, deletedId: id });
    }

    if (action === 'clear_all') {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.deleteRows(2, lastRow - 1);
      }
      return jsonResponse_({ ok: true, cleared: true });
    }

    if (action === 'import_batch') {
      const items = Array.isArray(body.vehicles) ? body.vehicles : [];
      if (items.length === 0) {
        return jsonResponse_({ ok: true, imported: 0 });
      }
      const now = new Date().toISOString();
      const rows = items.map(function (v) {
        v.id = v.id || 'vtr-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
        v.atualizado_em = v.atualizado_em || now;
        return objectToRow_(v);
      });

      const startRow = sheet.getLastRow() + 1;
      writeRowsAsPlainText_(sheet, startRow, rows);

      return jsonResponse_({ ok: true, imported: rows.length });
    }

    return jsonResponse_({ ok: false, error: 'Ação inválida: ' + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message || String(err) });
  } finally {
    lock.releaseLock();
  }
}

function findRowIndexById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      return i + 2;
    }
  }
  return -1;
}
