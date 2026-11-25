(() => {
  'use strict';

  const STORAGE_KEYS = {
    LOCAL_VEHICLES: 'controle_veiculos_local_v1',
    CUSTOM_URL: 'controle_veiculos_sheets_url_v1',
    ALERT_DAYS: 'controle_veiculos_alert_days_v1'
  };

  const SYSTEMS = [
    { key: 'dieletrico', label: 'Dielétrico', docLabel: 'Laudo', defaultMonths: 6, validityLabel: '6 meses' },
    { key: 'tacografo', label: 'Tacógrafo', docLabel: 'Cert.', defaultMonths: 24, validityLabel: '2 anos' },
    { key: 'acustico', label: 'Acústico', docLabel: 'Laudo', defaultMonths: 12, validityLabel: '1 ano' }
  ];

  const state = {
    vehicles: [],
    statusFilter: 'all',     // all | expired | warning | ok
    systemFilter: 'all',     // all | dieletrico | tacografo | acustico
    search: '',
    sortBy: 'urgency',
    loading: false,
    saving: false,
    connectionError: false,
    pendingDeleteId: null,
    renewTarget: null        // { vehicleId, sysKey, activeMonths }
  };

  // ---------- Helpers de Configuração ----------
  function getSheetUrl() {
    const cfg = window.FLEET_CONFIG || {};
    const fromConfig = cfg.GOOGLE_SHEETS_URL || cfg.APPS_SCRIPT_URL || '';
    const fromStorage = localStorage.getItem(STORAGE_KEYS.CUSTOM_URL) || '';
    return (fromStorage || fromConfig).trim();
  }

  function hasSheetConfigured() {
    return Boolean(getSheetUrl());
  }

  function isAppsScriptUrl(url) {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(String(url || '').trim());
  }

  function isWritableCloudMode() {
    return isAppsScriptUrl(getSheetUrl());
  }

  function getAlertDays() {
    const stored = parseInt(localStorage.getItem(STORAGE_KEYS.ALERT_DAYS) || '', 10);
    if (!Number.isNaN(stored) && stored >= 1 && stored <= 180) return stored;
    const fromConfig = window.FLEET_CONFIG && Number(window.FLEET_CONFIG.ALERT_DAYS);
    return fromConfig && fromConfig >= 1 ? fromConfig : 15;
  }

  function getValidityMonths(sysKey) {
    const cfgMap = window.FLEET_CONFIG && window.FLEET_CONFIG.SYSTEM_VALIDITY_MONTHS;
    if (cfgMap && Number(cfgMap[sysKey]) > 0) return Number(cfgMap[sysKey]);
    const found = SYSTEMS.find((s) => s.key === sysKey);
    return found ? found.defaultMonths : 12;
  }

  // ---------- Helpers de Data (sem bug de fuso horário) ----------
  function getTodayStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function parseISODate(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return null;
    const match = isoStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const dt = new Date(year, month, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month || dt.getDate() !== day) return null;
    return dt;
  }

  function normalizeFlexibleDate(raw) {
    const str = String(raw || '').trim();
    if (!str) return '';

    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      const y = isoMatch[1];
      const m = isoMatch[2].padStart(2, '0');
      const d = isoMatch[3].padStart(2, '0');
      const candidate = `${y}-${m}-${d}`;
      return parseISODate(candidate) ? candidate : '';
    }

    const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (brMatch) {
      let y = brMatch[3];
      if (y.length === 2) y = `20${y}`;
      const m = brMatch[2].padStart(2, '0');
      const d = brMatch[1].padStart(2, '0');
      const candidate = `${y}-${m}-${d}`;
      return parseISODate(candidate) ? candidate : '';
    }

    return '';
  }

  function toISODate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addMonthsToISO(isoStr, months) {
    const base = parseISODate(isoStr) || getTodayStart();
    const targetMonthIndex = base.getMonth() + months;
    const targetYear = base.getFullYear() + Math.floor(targetMonthIndex / 12);
    const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
    const clampedDay = Math.min(base.getDate(), lastDayOfTargetMonth);
    return toISODate(new Date(targetYear, normalizedMonth, clampedDay));
  }

  function formatDateBR(isoStr) {
    const dt = parseISODate(isoStr);
    if (!dt) return '—';
    const d = String(dt.getDate()).padStart(2, '0');
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const y = dt.getFullYear();
    return `${d}/${m}/${y}`;
  }

  function evaluateSystem(dateStr) {
    const dt = parseISODate(dateStr);
    if (!dt) {
      return {
        status: 'none',
        daysDiff: null,
        pillText: 'Sem data',
        dateFormatted: 'Não informado',
        rank: 999999
      };
    }

    const today = getTodayStart();
    const msPerDay = 24 * 60 * 60 * 1000;
    const diff = Math.round((dt.getTime() - today.getTime()) / msPerDay);
    const alertDays = getAlertDays();

    if (diff < 0) {
      const absDays = Math.abs(diff);
      return {
        status: 'expired',
        daysDiff: diff,
        pillText: absDays === 1 ? 'Vencido há 1 dia' : `Vencido há ${absDays} dias`,
        dateFormatted: formatDateBR(dateStr),
        rank: diff
      };
    }

    if (diff === 0) {
      return {
        status: 'warning',
        daysDiff: 0,
        pillText: 'Vence hoje',
        dateFormatted: formatDateBR(dateStr),
        rank: 0
      };
    }

    if (diff <= alertDays) {
      return {
        status: 'warning',
        daysDiff: diff,
        pillText: diff === 1 ? 'Vence amanhã' : `Vence em ${diff} dias`,
        dateFormatted: formatDateBR(dateStr),
        rank: diff
      };
    }

    return {
      status: 'ok',
      daysDiff: diff,
      pillText: `Em dia · ${diff}d`,
      dateFormatted: formatDateBR(dateStr),
      rank: diff
    };
  }

  function evaluateVehicle(vehicle) {
    const evals = {};
    let hasExpired = false;
    let hasWarning = false;
    let hasOk = false;
    let minRank = 999999;

    for (const sys of SYSTEMS) {
      const ev = evaluateSystem(vehicle[`${sys.key}_vencimento`]);
      evals[sys.key] = ev;
      if (ev.status === 'expired') hasExpired = true;
      else if (ev.status === 'warning') hasWarning = true;
      else if (ev.status === 'ok') hasOk = true;
      if (ev.rank < minRank) minRank = ev.rank;
    }

    let overallStatus = 'none';
    if (hasExpired) overallStatus = 'expired';
    else if (hasWarning) overallStatus = 'warning';
    else if (hasOk) overallStatus = 'ok';

    return { evals, overallStatus, minRank };
  }

  // ---------- Armazenamento Local (sem dados de demonstração) ----------
  function loadLocalVehicles() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_VEHICLES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Remove registros fictícios antigos caso existam no navegador
          const cleaned = parsed.filter((v) => v && !String(v.id || '').startsWith('vtr-demo-'));
          if (cleaned.length !== parsed.length) {
            saveLocalVehicles(cleaned);
          }
          return cleaned;
        }
      }
    } catch (_) {
      // ignora erro de parse
    }
    return [];
  }

  function saveLocalVehicles(list) {
    localStorage.setItem(STORAGE_KEYS.LOCAL_VEHICLES, JSON.stringify(list));
  }

  // ---------- Google Sheets (CSV direto: Publicar na Web ou Link Compartilhado) ----------
  function resolveGoogleSheetsCsvUrls(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return [];

    // 1. Link publicado na web (/spreadsheets/d/e/2PACX-.../pub...)
    if (/docs\.google\.com\/spreadsheets\/d\/e\//i.test(trimmed)) {
      let pubUrl = trimmed.replace(/\/pubhtml(\b|$)/i, '/pub');
      try {
        const u = new URL(pubUrl);
        u.searchParams.set('output', 'csv');
        return [u.toString()];
      } catch (_) {
        const sep = pubUrl.includes('?') ? '&' : '?';
        return [pubUrl.includes('output=csv') ? pubUrl : `${pubUrl}${sep}output=csv`];
      }
    }

    // 2. Link normal de compartilhamento (/spreadsheets/d/<ID>/...)
    const idMatch = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
    if (idMatch) {
      const sheetId = idMatch[1];
      const gidMatch = trimmed.match(/[?&#]gid=(\d+)/i);
      const gid = gidMatch ? gidMatch[1] : '';
      const gidParam = gid ? `&gid=${gid}` : '';
      return [
        // export?format=csv preserva exatamente o texto exibido nas células (evita bugs de tipo da API gviz)
        `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`,
        `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gidParam}`
      ];
    }

    // 3. Qualquer URL CSV direta
    return [trimmed];
  }

  function detectCSVDelimiter(firstLine) {
    let commas = 0;
    let semicolons = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === ',') commas++;
      else if (!inQuotes && ch === ';') semicolons++;
    }
    return semicolons > commas ? ';' : ',';
  }

  function parseCSV(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const firstBreak = clean.search(/\r?\n/);
    const headerLine = firstBreak === -1 ? clean : clean.slice(0, firstBreak);
    const delimiter = detectCSVDelimiter(headerLine);

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      const next = clean[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field.trim());
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field.trim());
      rows.push(row);
    }

    return rows.filter((r) => r.some((cell) => cell !== ''));
  }

  function normalizeHeader(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function mapColumnsFromHeaders(headers) {
    const map = {};
    headers.forEach((raw, idx) => {
      const h = normalizeHeader(raw);
      if (!h) return;

      if (map.id === undefined && h === 'id') {
        map.id = idx;
      } else if (map.prefixo === undefined && /(prefixo|viatura|codigo|frota|veiculo)/.test(h)) {
        map.prefixo = idx;
      } else if (map.placa === undefined && /placa/.test(h)) {
        map.placa = idx;
      } else if (map.modelo === undefined && /(modelo|equipamento|tipo|descricao)/.test(h)) {
        map.modelo = idx;
      } else if (map.unidade === undefined && /(unidade|base|setor|local|regional)/.test(h)) {
        map.unidade = idx;
      } else if (/dieletric/.test(h)) {
        if (/(laudo|cert|num|numero)/.test(h)) {
          if (map.dieletrico_laudo === undefined) map.dieletrico_laudo = idx;
        } else if (!/(status|situacao)/.test(h)) {
          if (map.dieletrico_vencimento === undefined) map.dieletrico_vencimento = idx;
        }
      } else if (/tacograf/.test(h)) {
        if (/(laudo|cert|inmetro|num|numero)/.test(h)) {
          if (map.tacografo_laudo === undefined) map.tacografo_laudo = idx;
        } else if (!/(status|situacao)/.test(h)) {
          if (map.tacografo_vencimento === undefined) map.tacografo_vencimento = idx;
        }
      } else if (/acustic/.test(h)) {
        if (/(laudo|cert|num|numero)/.test(h)) {
          if (map.acustico_laudo === undefined) map.acustico_laudo = idx;
        } else if (!/(status|situacao)/.test(h)) {
          if (map.acustico_vencimento === undefined) map.acustico_vencimento = idx;
        }
      } else if (map.observacoes === undefined && /(obs|observac)/.test(h)) {
        map.observacoes = idx;
      }
    });
    return map;
  }

  // ---------- Correção automática de prefixos que o Google Sheets converte em data ----------
  function recoverPrefixFromDateParts(yearNum, monthNum, dayNum) {
    const currentYear = new Date().getFullYear();
    if (yearNum < 1930) {
      return `${String(yearNum).padStart(4, '0')}-${monthNum}`;
    }
    if (yearNum === currentYear && dayNum !== 1) {
      return `00${String(dayNum).padStart(2, '0')}-${monthNum}`;
    }
    const yy = String(yearNum).slice(-2).padStart(2, '0');
    return `00${yy}-${monthNum}`;
  }

  function sanitizePrefixo(raw) {
    const str = String(raw || '').trim();
    if (!str) return '';

    // 1. ISO date / timestamp: "1977-07-01", "1977-7-1", "1977-07-01T03:00:00.000Z", "1977-07-01 00:00:00"
    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if (isoMatch) {
      return recoverPrefixFromDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    }

    // 2. Data BR/US: "01/07/1977", "1/7/1977", "07/01/1977", com ou sem horário
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s.*)?$/);
    if (slashMatch) {
      const a = Number(slashMatch[1]);
      const b = Number(slashMatch[2]);
      let y = Number(slashMatch[3]);
      if (y < 100) y += y >= 30 ? 1900 : 2000;
      // Se um dos lados for 1 (dia padrão gerado pelo Sheets para XX-M), o outro é o mês
      let dayNum = a;
      let monthNum = b;
      if (b === 1 && a >= 1 && a <= 12) {
        monthNum = a;
        dayNum = 1;
      } else if (a > 12 && b <= 12) {
        dayNum = a;
        monthNum = b;
      }
      return recoverPrefixFromDateParts(y, monthNum, dayNum);
    }

    // 3. Mês abreviado: "jul/77", "jul-1977", "jul. de 1977", "Fri Jul 01 1977 ..."
    const monthNames = {
      jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5,
      jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10,
      nov: 11, dez: 12, dec: 12
    };

    const jsDateMatch = str.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b/);
    if (jsDateMatch) {
      const m = monthNames[jsDateMatch[1].toLowerCase()];
      if (m) return recoverPrefixFromDateParts(Number(jsDateMatch[3]), m, Number(jsDateMatch[2]));
    }

    const ptMonthMatch = str.match(/^([A-Za-zç]{3})[a-z.]*(?:\s+de\s+|\s*[/\-\s]\s*)(\d{2,4})$/i);
    if (ptMonthMatch) {
      const m = monthNames[ptMonthMatch[1].toLowerCase().slice(0, 3)];
      if (m) {
        let y = Number(ptMonthMatch[2]);
        if (y < 100) y += y >= 30 ? 1900 : 2000;
        return recoverPrefixFromDateParts(y, m, 1);
      }
    }

    return str;
  }

  function normalizeVehicleList(list) {
    return (Array.isArray(list) ? list : []).map((v) => ({
      ...v,
      prefixo: sanitizePrefixo(v.prefixo)
    }));
  }

  function parseVehiclesFromCSV(csvText) {
    const trimmed = String(csvText || '').trim();
    if (!trimmed) return [];
    if (/^<!doctype html|^<html/i.test(trimmed)) {
      throw new Error('A planilha não está pública. Em Compartilhar, marque "Qualquer pessoa com o link pode ver" ou publique como CSV.');
    }

    const matrix = parseCSV(trimmed);
    if (matrix.length < 2) return [];

    const headers = matrix[0];
    const colMap = mapColumnsFromHeaders(headers);

    if (colMap.prefixo === undefined && colMap.placa === undefined) {
      throw new Error('Cabeçalhos não reconhecidos. Use colunas como Prefixo, Placa, Dielétrico, Tacógrafo e Acústico na linha 1.');
    }

    const now = new Date().toISOString();
    const vehicles = [];

    for (let i = 1; i < matrix.length; i++) {
      const r = matrix[i];
      const get = (key) => (colMap[key] !== undefined ? String(r[colMap[key]] || '').trim() : '');

      const prefixo = sanitizePrefixo(get('prefixo'));
      const placaRaw = get('placa');
      if (!prefixo && !placaRaw) continue;

      vehicles.push({
        id: get('id') || `vtr-sheet-${i}-${(prefixo || placaRaw).replace(/[^a-zA-Z0-9]/g, '')}`,
        prefixo: prefixo || placaRaw,
        placa: placaRaw ? formatPlate(placaRaw) : '',
        modelo: get('modelo'),
        unidade: get('unidade'),
        dieletrico_vencimento: normalizeFlexibleDate(get('dieletrico_vencimento')),
        dieletrico_laudo: get('dieletrico_laudo'),
        tacografo_vencimento: normalizeFlexibleDate(get('tacografo_vencimento')),
        tacografo_laudo: get('tacografo_laudo'),
        acustico_vencimento: normalizeFlexibleDate(get('acustico_vencimento')),
        acustico_laudo: get('acustico_laudo'),
        observacoes: get('observacoes'),
        atualizado_em: now
      });
    }

    return vehicles;
  }

  async function fetchGoogleSheetCSV(rawUrl) {
    const candidates = resolveGoogleSheetsCsvUrls(rawUrl);
    let lastError = null;

    for (const candidate of candidates) {
      try {
        const sep = candidate.includes('?') ? '&' : '?';
        const res = await fetch(`${candidate}${sep}_t=${Date.now()}`, {
          method: 'GET',
          redirect: 'follow'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        return parseVehiclesFromCSV(text);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('Não foi possível acessar a planilha.');
  }

  // ---------- Suporte opcional a Apps Script (caso seja usada URL /exec) ----------
  async function apiListVehicles(url) {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}t=${Date.now()}`, {
      method: 'GET',
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro ao ler planilha.');
    return Array.isArray(data.vehicles) ? data.vehicles : [];
  }

  async function apiPost(payload) {
    const url = getSheetUrl();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro ao gravar na planilha.');
    return data;
  }

  async function loadVehicles({ silent = false } = {}) {
    state.loading = true;
    state.connectionError = false;
    renderSyncStatus();
    if (!silent) renderBoard();

    const refreshBtn = document.getElementById('btn-refresh');
    refreshBtn.classList.add('is-spinning');

    try {
      const url = getSheetUrl();
      if (url) {
        if (isAppsScriptUrl(url)) {
          state.vehicles = normalizeVehicleList(await apiListVehicles(url));
        } else {
          state.vehicles = normalizeVehicleList(await fetchGoogleSheetCSV(url));
          saveLocalVehicles(state.vehicles);
        }
      } else {
        state.vehicles = normalizeVehicleList(loadLocalVehicles());
      }
    } catch (err) {
      state.connectionError = true;
      state.vehicles = normalizeVehicleList(loadLocalVehicles());
      showToast(`Erro ao sincronizar planilha: ${err.message}`, 'error');
    } finally {
      state.loading = false;
      refreshBtn.classList.remove('is-spinning');
      renderAll();
    }
  }

  // ---------- Escape de HTML ----------
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatPlate(raw) {
    const cleaned = String(raw || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (cleaned.length === 7 && !cleaned.includes('-')) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    }
    return cleaned || 'SEM PLACA';
  }

  // ---------- Toasts ----------
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.2s ease';
      setTimeout(() => el.remove(), 220);
    }, 3600);
  }

  // ---------- Renderização ----------
  function renderSyncStatus() {
    const pill = document.getElementById('btn-sheets-status');
    const label = document.getElementById('sync-status-label');
    const days = getAlertDays();

    document.getElementById('alert-days-display').textContent = days;
    document.querySelectorAll('.js-alert-days').forEach((el) => {
      el.textContent = days;
    });

    pill.classList.remove('is-local', 'is-connected', 'is-error');

    if (hasSheetConfigured()) {
      if (state.connectionError) {
        pill.classList.add('is-error');
        label.textContent = 'Erro na planilha';
      } else {
        pill.classList.add('is-connected');
        label.textContent = 'Google Sheets conectado';
      }
    } else {
      label.textContent = 'Google Sheets';
    }
  }

  function renderSemaphore() {
    let vExpired = 0;
    let vWarning = 0;
    let vOk = 0;

    let itemExpired = 0;
    let itemWarning = 0;
    let itemOk = 0;
    let itemNone = 0;

    const perSystem = {
      dieletrico: { expired: 0, warning: 0, ok: 0 },
      tacografo: { expired: 0, warning: 0, ok: 0 },
      acustico: { expired: 0, warning: 0, ok: 0 }
    };

    for (const v of state.vehicles) {
      const { evals, overallStatus } = evaluateVehicle(v);
      if (overallStatus === 'expired') vExpired++;
      else if (overallStatus === 'warning') vWarning++;
      else if (overallStatus === 'ok') vOk++;

      for (const sys of SYSTEMS) {
        const st = evals[sys.key].status;
        if (st === 'expired') { itemExpired++; perSystem[sys.key].expired++; }
        else if (st === 'warning') { itemWarning++; perSystem[sys.key].warning++; }
        else if (st === 'ok') { itemOk++; perSystem[sys.key].ok++; }
        else { itemNone++; }
      }
    }

    document.getElementById('count-expired').textContent = vExpired;
    document.getElementById('count-warning').textContent = vWarning;
    document.getElementById('count-ok').textContent = vOk;
    document.getElementById('count-total').textContent = state.vehicles.length;

    document.querySelectorAll('.signal-card').forEach((btn) => {
      const active = btn.dataset.statusFilter === state.statusFilter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const totalItems = itemExpired + itemWarning + itemOk + itemNone;
    const datedItems = itemExpired + itemWarning + itemOk;
    const pct = (n) => (totalItems > 0 ? `${(n / totalItems) * 100}%` : '0%');

    document.getElementById('bar-red').style.width = pct(itemExpired);
    document.getElementById('bar-amber').style.width = pct(itemWarning);
    document.getElementById('bar-green').style.width = pct(itemOk);
    document.getElementById('bar-neutral').style.width = pct(itemNone);

    const summaryEl = document.getElementById('readiness-summary');
    if (datedItems === 0) {
      summaryEl.textContent = 'Nenhum vencimento cadastrado ainda';
    } else {
      const okPct = Math.round((itemOk / datedItems) * 100);
      summaryEl.textContent = `${okPct}% dos laudos em dia · ${itemExpired} vencido(s) · ${itemWarning} a vencer`;
    }

    for (const sys of SYSTEMS) {
      const m = perSystem[sys.key];
      const el = document.getElementById(`metrics-${sys.key}`);
      const parts = [];
      if (m.expired > 0) parts.push(`<span class="metric-dot-red">${m.expired} venc.</span>`);
      if (m.warning > 0) parts.push(`<span class="metric-dot-amber">${m.warning} alerta</span>`);
      if (parts.length === 0) {
        parts.push(m.ok > 0
          ? `<span class="metric-dot-green">Tudo em dia</span>`
          : `<span>Sem datas</span>`);
      }
      el.innerHTML = parts.join('<span>·</span>');

      const chip = document.querySelector(`.system-chip[data-system-quick="${sys.key}"]`);
      if (chip) {
        chip.classList.toggle('is-active', state.systemFilter === sys.key);
      }
    }
  }

  function getFilteredVehicles() {
    const q = state.search.trim().toLowerCase();

    const enriched = state.vehicles.map((v) => {
      const meta = evaluateVehicle(v);
      return { vehicle: v, ...meta };
    });

    const filtered = enriched.filter(({ vehicle, evals, overallStatus }) => {
      if (q) {
        const hay = [
          vehicle.prefixo,
          vehicle.placa,
          vehicle.modelo,
          vehicle.unidade,
          vehicle.dieletrico_laudo,
          vehicle.tacografo_laudo,
          vehicle.acustico_laudo,
          vehicle.observacoes
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (state.systemFilter !== 'all') {
        const sysEval = evals[state.systemFilter];
        if (state.statusFilter !== 'all') {
          return sysEval.status === state.statusFilter;
        }
        return true;
      }

      if (state.statusFilter !== 'all') {
        return overallStatus === state.statusFilter;
      }

      return true;
    });

    filtered.sort((a, b) => {
      if (state.sortBy === 'urgency') {
        const rankA = state.systemFilter !== 'all' ? a.evals[state.systemFilter].rank : a.minRank;
        const rankB = state.systemFilter !== 'all' ? b.evals[state.systemFilter].rank : b.minRank;
        if (rankA !== rankB) return rankA - rankB;
        return (a.vehicle.prefixo || '').localeCompare(b.vehicle.prefixo || '', 'pt-BR', { numeric: true });
      }
      if (state.sortBy === 'prefixo') {
        return (a.vehicle.prefixo || '').localeCompare(b.vehicle.prefixo || '', 'pt-BR', { numeric: true });
      }
      if (state.sortBy === 'placa') {
        return (a.vehicle.placa || '').localeCompare(b.vehicle.placa || '', 'pt-BR');
      }
      if (state.sortBy === 'unidade') {
        return (a.vehicle.unidade || '').localeCompare(b.vehicle.unidade || '', 'pt-BR');
      }
      return 0;
    });

    return filtered;
  }

  function renderSystemCellHTML(vehicle, sys, ev) {
    const laudo = vehicle[`${sys.key}_laudo`];
    const dimmed = state.systemFilter !== 'all' && state.systemFilter !== sys.key;
    return `
      <div class="sys-cell" style="${dimmed ? 'opacity:0.45' : ''}">
        <div class="sys-cell-top">
          <span class="status-pill status-${ev.status}">${esc(ev.pillText)}</span>
          <button type="button" class="quick-renew-btn" data-action="renew" data-id="${esc(vehicle.id)}" data-sys="${sys.key}" title="Renovar ${sys.label}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Renovar
          </button>
        </div>
        <span class="sys-date-line">${esc(ev.dateFormatted)}</span>
        ${laudo ? `<span class="sys-laudo">${sys.docLabel}: ${esc(laudo)}</span>` : ''}
      </div>
    `;
  }

  function renderBoard() {
    const loadingEl = document.getElementById('loading-state');
    const emptyEl = document.getElementById('empty-state');
    const tableWrap = document.getElementById('table-wrapper');
    const cardsWrap = document.getElementById('cards-wrapper');
    const tbody = document.getElementById('fleet-tbody');
    const resultsCount = document.getElementById('results-count');
    const clearBtn = document.getElementById('btn-clear-filters');
    const clearAllBtn = document.getElementById('btn-clear-all');

    const hasActiveFilter = state.statusFilter !== 'all' || state.systemFilter !== 'all' || state.search.trim() !== '';
    clearBtn.hidden = !hasActiveFilter;
    clearAllBtn.hidden = state.loading || state.vehicles.length === 0;

    document.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.systemFilter === state.systemFilter);
    });

    if (state.loading) {
      loadingEl.hidden = false;
      emptyEl.hidden = true;
      tableWrap.hidden = true;
      cardsWrap.hidden = true;
      resultsCount.textContent = 'Sincronizando...';
      return;
    }

    loadingEl.hidden = true;
    const rows = getFilteredVehicles();

    if (state.vehicles.length === 0) {
      resultsCount.textContent = '0 viaturas cadastradas';
      tableWrap.hidden = true;
      cardsWrap.hidden = true;
      emptyEl.hidden = false;
      document.getElementById('empty-title').textContent = 'Nenhuma viatura cadastrada';
      document.getElementById('empty-desc').textContent = 'Cadastre uma viatura abaixo ou conecte sua planilha do Google Sheets no botão do topo.';
      const emptyBtn = document.getElementById('btn-empty-action');
      emptyBtn.textContent = 'Cadastrar primeira viatura';
      emptyBtn.dataset.emptyAction = 'new';
      return;
    }

    if (rows.length === 0) {
      resultsCount.textContent = `0 de ${state.vehicles.length} viaturas exibidas`;
      tableWrap.hidden = true;
      cardsWrap.hidden = true;
      emptyEl.hidden = false;
      document.getElementById('empty-title').textContent = 'Nenhuma viatura corresponde ao filtro';
      document.getElementById('empty-desc').textContent = 'Limpe os filtros ou ajuste o termo de busca para visualizar toda a frota.';
      const emptyBtn = document.getElementById('btn-empty-action');
      emptyBtn.textContent = 'Limpar filtros';
      emptyBtn.dataset.emptyAction = 'clear';
      return;
    }

    emptyEl.hidden = true;
    tableWrap.hidden = false;
    cardsWrap.hidden = false;
    resultsCount.textContent = rows.length === state.vehicles.length
      ? `${rows.length} viatura(s) monitorada(s)`
      : `Exibindo ${rows.length} de ${state.vehicles.length} viaturas`;

    // Render Desktop Table
    tbody.innerHTML = rows.map(({ vehicle, evals, overallStatus }) => {
      const plateFormatted = formatPlate(vehicle.placa);
      return `
        <tr class="row-${overallStatus}">
          <td>
            <div class="vehicle-id-top">
              <span class="vehicle-prefixo">${esc(vehicle.prefixo || 'Sem prefixo')}</span>
              <span class="mercosul-plate" aria-label="Placa ${esc(plateFormatted)}">
                <span class="mercosul-plate-bar">BRASIL</span>
                <span class="mercosul-plate-code">${esc(plateFormatted)}</span>
              </span>
            </div>
            <div class="vehicle-meta">
              ${vehicle.modelo ? `<span>${esc(vehicle.modelo)}</span>` : ''}
              ${vehicle.unidade ? `<span class="vehicle-unidade">${esc(vehicle.unidade)}</span>` : ''}
            </div>
            ${vehicle.observacoes ? `<div class="vehicle-obs-badge" title="${esc(vehicle.observacoes)}">${esc(vehicle.observacoes)}</div>` : ''}
          </td>
          <td>${renderSystemCellHTML(vehicle, SYSTEMS[0], evals.dieletrico)}</td>
          <td>${renderSystemCellHTML(vehicle, SYSTEMS[1], evals.tacografo)}</td>
          <td>${renderSystemCellHTML(vehicle, SYSTEMS[2], evals.acustico)}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn btn-ghost btn-icon" data-action="edit" data-id="${esc(vehicle.id)}" title="Editar viatura" aria-label="Editar ${esc(vehicle.prefixo)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </button>
              <button type="button" class="btn btn-ghost-danger btn-icon" data-action="delete" data-id="${esc(vehicle.id)}" title="Excluir viatura" aria-label="Excluir ${esc(vehicle.prefixo)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Render Mobile Cards
    cardsWrap.innerHTML = rows.map(({ vehicle, evals, overallStatus }) => {
      const plateFormatted = formatPlate(vehicle.placa);
      const sysRows = SYSTEMS.map((sys) => {
        const ev = evals[sys.key];
        const laudo = vehicle[`${sys.key}_laudo`];
        return `
          <div class="card-sys-row">
            <div class="card-sys-left">
              <span class="card-sys-label">${sys.label}</span>
              <span class="sys-date-line">${esc(ev.dateFormatted)}${laudo ? ` · ${esc(laudo)}` : ''}</span>
            </div>
            <div class="card-sys-right">
              <span class="status-pill status-${ev.status}">${esc(ev.pillText)}</span>
              <button type="button" class="btn btn-xs btn-secondary" data-action="renew" data-id="${esc(vehicle.id)}" data-sys="${sys.key}">Renovar</button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <article class="vehicle-card row-${overallStatus}">
          <div class="card-head">
            <div>
              <div class="vehicle-prefixo">${esc(vehicle.prefixo || 'Sem prefixo')}</div>
              <div class="vehicle-meta">
                ${vehicle.modelo ? `<span>${esc(vehicle.modelo)}</span>` : ''}
                ${vehicle.unidade ? `<span class="vehicle-unidade">${esc(vehicle.unidade)}</span>` : ''}
              </div>
            </div>
            <span class="mercosul-plate">
              <span class="mercosul-plate-bar">BRASIL</span>
              <span class="mercosul-plate-code">${esc(plateFormatted)}</span>
            </span>
          </div>
          ${vehicle.observacoes ? `<div class="vehicle-obs-badge">${esc(vehicle.observacoes)}</div>` : ''}
          <div class="card-systems">${sysRows}</div>
          <div class="card-foot">
            <button type="button" class="btn btn-sm btn-secondary" data-action="edit" data-id="${esc(vehicle.id)}">Editar</button>
            <button type="button" class="btn btn-sm btn-ghost-danger" data-action="delete" data-id="${esc(vehicle.id)}">Excluir</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderAll() {
    renderSyncStatus();
    renderSemaphore();
    renderBoard();
  }

  // ---------- Drawer: Cadastrar / Editar Viatura ----------
  function updateFormPreview(sysKey) {
    const input = document.getElementById(`field-${sysKey}-venc`);
    const badge = document.getElementById(`preview-${sysKey}`);
    const ev = evaluateSystem(input.value);
    badge.className = `preview-badge status-${ev.status}`;
    badge.textContent = ev.pillText;
  }

  function openVehicleDrawer(vehicle = null) {
    const drawer = document.getElementById('vehicle-drawer');
    const isEdit = Boolean(vehicle);

    document.getElementById('drawer-title').textContent = isEdit
      ? `Editar ${vehicle.prefixo}`
      : 'Cadastrar viatura';
    document.getElementById('btn-save-vehicle').textContent = isEdit
      ? 'Salvar alterações'
      : 'Salvar viatura';

    document.getElementById('field-id').value = isEdit ? vehicle.id : '';
    document.getElementById('field-prefixo').value = isEdit ? (vehicle.prefixo || '') : '';
    document.getElementById('field-placa').value = isEdit ? (vehicle.placa || '') : '';
    document.getElementById('field-modelo').value = isEdit ? (vehicle.modelo || '') : '';
    document.getElementById('field-unidade').value = isEdit ? (vehicle.unidade || '') : '';
    document.getElementById('field-dieletrico-realizacao').value = '';
    document.getElementById('field-dieletrico-venc').value = isEdit ? (vehicle.dieletrico_vencimento || '') : '';
    document.getElementById('field-dieletrico-laudo').value = isEdit ? (vehicle.dieletrico_laudo || '') : '';
    document.getElementById('field-tacografo-realizacao').value = '';
    document.getElementById('field-tacografo-venc').value = isEdit ? (vehicle.tacografo_vencimento || '') : '';
    document.getElementById('field-tacografo-laudo').value = isEdit ? (vehicle.tacografo_laudo || '') : '';
    document.getElementById('field-acustico-realizacao').value = '';
    document.getElementById('field-acustico-venc').value = isEdit ? (vehicle.acustico_vencimento || '') : '';
    document.getElementById('field-acustico-laudo').value = isEdit ? (vehicle.acustico_laudo || '') : '';
    document.getElementById('field-observacoes').value = isEdit ? (vehicle.observacoes || '') : '';

    SYSTEMS.forEach((s) => updateFormPreview(s.key));

    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('field-prefixo').focus(), 40);
  }

  function closeVehicleDrawer() {
    const drawer = document.getElementById('vehicle-drawer');
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
  }

  async function handleSaveVehicle(e) {
    e.preventDefault();
    if (state.saving) return;

    const existingId = document.getElementById('field-id').value.trim();
    const isEdit = Boolean(existingId);

    const payload = {
      id: existingId || `vtr-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      prefixo: document.getElementById('field-prefixo').value.trim(),
      placa: formatPlate(document.getElementById('field-placa').value.trim()),
      modelo: document.getElementById('field-modelo').value.trim(),
      unidade: document.getElementById('field-unidade').value.trim(),
      dieletrico_vencimento: document.getElementById('field-dieletrico-venc').value.trim(),
      dieletrico_laudo: document.getElementById('field-dieletrico-laudo').value.trim(),
      tacografo_vencimento: document.getElementById('field-tacografo-venc').value.trim(),
      tacografo_laudo: document.getElementById('field-tacografo-laudo').value.trim(),
      acustico_vencimento: document.getElementById('field-acustico-venc').value.trim(),
      acustico_laudo: document.getElementById('field-acustico-laudo').value.trim(),
      observacoes: document.getElementById('field-observacoes').value.trim(),
      atualizado_em: new Date().toISOString()
    };

    if (!payload.prefixo || !payload.placa || payload.placa === 'SEM PLACA') {
      showToast('Preencha o prefixo e a placa da viatura.', 'warning');
      return;
    }

    const saveBtn = document.getElementById('btn-save-vehicle');
    const originalText = saveBtn.textContent;
    state.saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';

    try {
      if (isWritableCloudMode()) {
        const res = await apiPost({
          action: isEdit ? 'update' : 'create',
          vehicle: payload
        });
        const saved = res.vehicle || payload;
        if (isEdit) {
          state.vehicles = state.vehicles.map((v) => (v.id === saved.id ? saved : v));
        } else {
          state.vehicles.push(saved);
        }
        showToast(isEdit ? 'Viatura atualizada na planilha.' : 'Viatura salva na planilha.', 'success');
      } else {
        if (isEdit) {
          state.vehicles = state.vehicles.map((v) => (v.id === payload.id ? payload : v));
        } else {
          state.vehicles.push(payload);
        }
        saveLocalVehicles(state.vehicles);
        showToast(isEdit ? 'Viatura atualizada.' : 'Viatura cadastrada.', 'success');
      }

      closeVehicleDrawer();
      renderAll();
    } catch (err) {
      showToast(`Erro ao salvar: ${err.message}`, 'error');
    } finally {
      state.saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  }

  // ---------- Modal: Renovação Rápida ----------
  function highlightRenewPreset(months) {
    document.querySelectorAll('[data-renew-months]').forEach((btn) => {
      btn.classList.toggle('btn-preset-default', Number(btn.dataset.renewMonths) === months);
    });
  }

  function openRenewModal(vehicleId, sysKey) {
    const vehicle = state.vehicles.find((v) => v.id === vehicleId);
    const sys = SYSTEMS.find((s) => s.key === sysKey);
    if (!vehicle || !sys) return;

    const defaultMonths = getValidityMonths(sysKey);
    const todayISO = toISODate(getTodayStart());

    state.renewTarget = { vehicleId, sysKey, activeMonths: defaultMonths };
    document.getElementById('renew-title').textContent = `Renovar ${sys.label}`;
    const currentVal = vehicle[`${sysKey}_vencimento`];
    document.getElementById('renew-subtitle').textContent =
      `${vehicle.prefixo} (${formatPlate(vehicle.placa)}) · Atual: ${currentVal ? formatDateBR(currentVal) : 'Sem data'}`;

    document.getElementById('renew-rule-help').textContent =
      `Validade padrão de ${sys.label}: ${sys.validityLabel} a partir da data de realização.`;
    document.getElementById('renew-realizacao').value = todayISO;
    document.getElementById('renew-date').value = addMonthsToISO(todayISO, defaultMonths);
    document.getElementById('renew-laudo').value = vehicle[`${sysKey}_laudo`] || '';
    highlightRenewPreset(defaultMonths);

    openModal('renew-modal');
  }

  async function handleConfirmRenew(e) {
    e.preventDefault();
    if (!state.renewTarget || state.saving) return;

    const { vehicleId, sysKey } = state.renewTarget;
    const vehicle = state.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return;

    const newDate = document.getElementById('renew-date').value.trim();
    const newLaudo = document.getElementById('renew-laudo').value.trim();
    if (!newDate) return;

    const updated = {
      ...vehicle,
      [`${sysKey}_vencimento`]: newDate,
      [`${sysKey}_laudo`]: newLaudo,
      atualizado_em: new Date().toISOString()
    };

    const btn = document.getElementById('btn-confirm-renew');
    state.saving = true;
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      if (isWritableCloudMode()) {
        const res = await apiPost({ action: 'update', vehicle: updated });
        const saved = res.vehicle || updated;
        state.vehicles = state.vehicles.map((v) => (v.id === saved.id ? saved : v));
      } else {
        state.vehicles = state.vehicles.map((v) => (v.id === updated.id ? updated : v));
        saveLocalVehicles(state.vehicles);
      }
      const sysLabel = SYSTEMS.find((s) => s.key === sysKey)?.label || '';
      showToast(`${sysLabel} de ${vehicle.prefixo} renovado até ${formatDateBR(newDate)}.`, 'success');
      closeModal('renew-modal');
      renderAll();
    } catch (err) {
      showToast(`Erro ao renovar: ${err.message}`, 'error');
    } finally {
      state.saving = false;
      btn.disabled = false;
      btn.textContent = 'Confirmar renovação';
    }
  }

  // ---------- Modal: Excluir Viatura ----------
  function openDeleteModal(vehicleId) {
    const vehicle = state.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return;
    state.pendingDeleteId = vehicleId;
    document.getElementById('delete-message').textContent =
      `Excluir a viatura ${vehicle.prefixo} (${formatPlate(vehicle.placa)})? Esta ação não pode ser desfeita.`;
    openModal('delete-modal');
  }

  async function handleConfirmDelete() {
    if (!state.pendingDeleteId || state.saving) return;
    const id = state.pendingDeleteId;
    const btn = document.getElementById('btn-confirm-delete');

    state.saving = true;
    btn.disabled = true;
    btn.textContent = 'Excluindo...';

    try {
      if (isWritableCloudMode()) {
        await apiPost({ action: 'delete', id });
      }
      state.vehicles = state.vehicles.filter((v) => v.id !== id);
      if (!isWritableCloudMode()) {
        saveLocalVehicles(state.vehicles);
      }
      showToast('Viatura excluída.', 'success');
      closeModal('delete-modal');
      renderAll();
    } catch (err) {
      showToast(`Erro ao excluir: ${err.message}`, 'error');
    } finally {
      state.saving = false;
      btn.disabled = false;
      btn.textContent = 'Excluir viatura';
      state.pendingDeleteId = null;
    }
  }

  // ---------- Modal: Limpar Tudo ----------
  function openClearAllModal() {
    const count = state.vehicles.length;
    if (count === 0) return;

    document.getElementById('clear-all-message').textContent =
      `Apagar todas as ${count} viatura(s) cadastradas para começar a digitar do zero?`;

    const hasCustomUrl = Boolean(localStorage.getItem(STORAGE_KEYS.CUSTOM_URL));
    const disconnectWrap = document.getElementById('clear-all-disconnect-wrap');
    const disconnectChk = document.getElementById('clear-all-disconnect');
    disconnectWrap.hidden = !hasCustomUrl;
    disconnectChk.checked = hasCustomUrl;

    openModal('clear-all-modal');
  }

  async function handleConfirmClearAll() {
    if (state.saving) return;
    const btn = document.getElementById('btn-confirm-clear-all');
    const disconnectChk = document.getElementById('clear-all-disconnect');
    const shouldDisconnect = !document.getElementById('clear-all-disconnect-wrap').hidden && disconnectChk.checked;

    state.saving = true;
    btn.disabled = true;
    btn.textContent = 'Limpando...';

    try {
      if (isWritableCloudMode() && !shouldDisconnect) {
        await apiPost({ action: 'clear_all' });
      }
      if (shouldDisconnect) {
        localStorage.removeItem(STORAGE_KEYS.CUSTOM_URL);
      }
      localStorage.removeItem(STORAGE_KEYS.LOCAL_VEHICLES);
      state.vehicles = [];
      state.statusFilter = 'all';
      state.systemFilter = 'all';
      state.search = '';
      state.connectionError = false;
      document.getElementById('search-input').value = '';

      closeModal('clear-all-modal');
      renderAll();
      showToast('Tudo limpo! Pronto para cadastrar do zero.', 'success');
    } catch (err) {
      showToast(`Erro ao limpar tudo: ${err.message}`, 'error');
    } finally {
      state.saving = false;
      btn.disabled = false;
      btn.textContent = 'Limpar tudo';
    }
  }

  // ---------- Modal: Sincronizar com Google Sheets ----------
  function openSheetsModal() {
    const url = getSheetUrl();
    const connected = Boolean(url);
    const cfg = window.FLEET_CONFIG || {};
    const fixedInConfig = Boolean(cfg.GOOGLE_SHEETS_URL || cfg.APPS_SCRIPT_URL);

    document.getElementById('sheets-url-input').value = url;
    document.getElementById('alert-days-input').value = getAlertDays();

    const badge = document.getElementById('modal-conn-badge');
    const desc = document.getElementById('modal-conn-desc');
    const disconnectBtn = document.getElementById('btn-disconnect-sheets');

    badge.textContent = connected ? 'Planilha conectada' : 'Sem planilha conectada';
    badge.classList.toggle('is-connected', connected);
    desc.textContent = connected
      ? 'Ao abrir a página ou clicar em Atualizar (↻), os dados são puxados automaticamente do Google Sheets.'
      : 'Cole o link da sua planilha do Google Sheets abaixo para carregar as viaturas automaticamente.';

    disconnectBtn.hidden = !connected || fixedInConfig;
    openModal('sheets-modal');
  }

  async function handleSaveSheetsConfig(e) {
    e.preventDefault();
    const urlInput = document.getElementById('sheets-url-input').value.trim();
    const daysVal = parseInt(document.getElementById('alert-days-input').value, 10);

    if (!Number.isNaN(daysVal) && daysVal >= 1 && daysVal <= 180) {
      localStorage.setItem(STORAGE_KEYS.ALERT_DAYS, String(daysVal));
    }

    const btn = document.getElementById('btn-save-sheets');
    btn.disabled = true;
    btn.textContent = 'Sincronizando...';

    try {
      if (urlInput) {
        if (!/^https?:\/\//i.test(urlInput)) {
          showToast('Cole um link válido começando com https://', 'warning');
          return;
        }
        const vehicles = normalizeVehicleList(
          isAppsScriptUrl(urlInput)
            ? await apiListVehicles(urlInput)
            : await fetchGoogleSheetCSV(urlInput)
        );

        localStorage.setItem(STORAGE_KEYS.CUSTOM_URL, urlInput);
        state.vehicles = vehicles;
        state.connectionError = false;
        saveLocalVehicles(vehicles);
        renderAll();
        showToast(`Sincronizado com o Google Sheets! ${vehicles.length} viatura(s) carregada(s).`, 'success');
      } else {
        localStorage.removeItem(STORAGE_KEYS.CUSTOM_URL);
        state.connectionError = false;
        renderAll();
        showToast('Configurações salvas.', 'success');
      }
      closeModal('sheets-modal');
    } catch (err) {
      showToast(`Não foi possível ler a planilha: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sincronizar agora';
    }
  }

  function downloadTemplateCSV() {
    const headers = [
      'Prefixo',
      'Placa',
      'Modelo',
      'Unidade',
      'Venc. Dielétrico',
      'Laudo Dielétrico',
      'Venc. Tacógrafo',
      'Cert. Tacógrafo',
      'Venc. Acústico',
      'Laudo Acústico',
      'Observações'
    ];
    const csvContent = '\uFEFF' + headers.join(';') + '\r\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo-planilha-viaturas.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Modelo de planilha baixado! Importe no Google Sheets.', 'success');
  }

  // ---------- Helpers de Modal ----------
  function openModal(id) {
    const el = document.getElementById(id);
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
  }

  // ---------- Exportar Planilha (Excel / CSV / PDF / Backup JSON) ----------
  function csvCell(val) {
    const str = String(val ?? '').replace(/\r?\n/g, ' ').trim();
    if (/[;"\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function statusLabelBR(status) {
    if (status === 'expired') return 'Vencido';
    if (status === 'warning') return 'A vencer';
    if (status === 'ok') return 'Em dia';
    return 'Sem data';
  }

  function exportSpreadsheetCSV() {
    const rows = getFilteredVehicles();
    if (rows.length === 0) {
      showToast('Não há viaturas na lista atual para exportar.', 'warning');
      return;
    }

    const headers = [
      'Prefixo',
      'Placa',
      'Modelo / Equipamento',
      'Base / Unidade',
      'Status Geral',
      'Dielétrico - Vencimento',
      'Dielétrico - Situação',
      'Dielétrico - Laudo',
      'Tacógrafo - Vencimento',
      'Tacógrafo - Situação',
      'Tacógrafo - Certificado',
      'Acústico - Vencimento',
      'Acústico - Situação',
      'Acústico - Laudo',
      'Observações'
    ];

    const lines = [headers.map(csvCell).join(';')];

    for (const { vehicle, evals, overallStatus } of rows) {
      const cols = [
        vehicle.prefixo || '',
        formatPlate(vehicle.placa),
        vehicle.modelo || '',
        vehicle.unidade || '',
        statusLabelBR(overallStatus),
        vehicle.dieletrico_vencimento ? formatDateBR(vehicle.dieletrico_vencimento) : '',
        evals.dieletrico.pillText,
        vehicle.dieletrico_laudo || '',
        vehicle.tacografo_vencimento ? formatDateBR(vehicle.tacografo_vencimento) : '',
        evals.tacografo.pillText,
        vehicle.tacografo_laudo || '',
        vehicle.acustico_vencimento ? formatDateBR(vehicle.acustico_vencimento) : '',
        evals.acustico.pillText,
        vehicle.acustico_laudo || '',
        vehicle.observacoes || ''
      ];
      lines.push(cols.map(csvCell).join(';'));
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const todayStr = toISODate(getTodayStart());
    const link = document.createElement('a');
    link.href = url;
    link.download = `controle-viaturas-${todayStr}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const isFiltered = rows.length !== state.vehicles.length;
    showToast(
      isFiltered
        ? `Planilha exportada com ${rows.length} viatura(s) filtrada(s).`
        : `Planilha exportada com ${rows.length} viatura(s).`,
      'success'
    );
  }

  function exportBackupJSON() {
    if (state.vehicles.length === 0) {
      showToast('Não há viaturas cadastradas para exportar backup.', 'warning');
      return;
    }

    const payload = {
      exportado_em: new Date().toISOString(),
      alerta_dias: getAlertDays(),
      total_viaturas: state.vehicles.length,
      viaturas: state.vehicles
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const todayStr = toISODate(getTodayStart());
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-viaturas-${todayStr}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast(`Backup JSON exportado (${state.vehicles.length} viaturas).`, 'success');
  }

  function setExportMenuOpen(open) {
    const wrap = document.getElementById('export-menu-wrap');
    const menu = document.getElementById('export-menu');
    const toggle = document.getElementById('btn-export-toggle');
    if (!wrap || !menu || !toggle) return;
    wrap.classList.toggle('is-open', open);
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  // ---------- Eventos ----------
  function bindEvents() {
    document.getElementById('btn-export-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('export-menu');
      setExportMenuOpen(menu.hidden);
    });

    document.getElementById('btn-export-csv').addEventListener('click', () => {
      setExportMenuOpen(false);
      exportSpreadsheetCSV();
    });

    document.getElementById('btn-export-print').addEventListener('click', () => {
      setExportMenuOpen(false);
      window.print();
    });

    document.getElementById('btn-export-json').addEventListener('click', () => {
      setExportMenuOpen(false);
      exportBackupJSON();
    });

    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('export-menu-wrap');
      if (wrap && !wrap.contains(e.target)) {
        setExportMenuOpen(false);
      }
    });

    document.getElementById('btn-new-vehicle').addEventListener('click', () => openVehicleDrawer(null));
    document.getElementById('btn-refresh').addEventListener('click', () => loadVehicles());
    document.getElementById('btn-sheets-status').addEventListener('click', openSheetsModal);

    // Filtros do Semáforo
    document.querySelectorAll('.signal-card').forEach((card) => {
      card.addEventListener('click', () => {
        state.statusFilter = card.dataset.statusFilter;
        renderSemaphore();
        renderBoard();
      });
    });

    // Chips rápidos por sistema
    document.querySelectorAll('.system-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const sys = chip.dataset.systemQuick;
        state.systemFilter = state.systemFilter === sys ? 'all' : sys;
        renderSemaphore();
        renderBoard();
      });
    });

    // Filtro segmentado por sistema
    document.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.systemFilter = btn.dataset.systemFilter;
        renderSemaphore();
        renderBoard();
      });
    });

    // Busca e Ordenação
    document.getElementById('search-input').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderBoard();
    });

    document.getElementById('sort-select').addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderBoard();
    });

    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      state.statusFilter = 'all';
      state.systemFilter = 'all';
      state.search = '';
      document.getElementById('search-input').value = '';
      renderAll();
    });

    document.getElementById('btn-empty-action').addEventListener('click', (e) => {
      if (e.currentTarget.dataset.emptyAction === 'clear') {
        state.statusFilter = 'all';
        state.systemFilter = 'all';
        state.search = '';
        document.getElementById('search-input').value = '';
        renderAll();
      } else {
        openVehicleDrawer(null);
      }
    });

    // Delegação de ações na tabela e cards mobile
    document.querySelector('.fleet-board').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'edit') {
        const vehicle = state.vehicles.find((v) => v.id === id);
        if (vehicle) openVehicleDrawer(vehicle);
      } else if (action === 'delete') {
        openDeleteModal(id);
      } else if (action === 'renew') {
        openRenewModal(id, btn.dataset.sys);
      }
    });

    // Drawer: fechar & formulário
    document.querySelectorAll('[data-close-drawer]').forEach((btn) => {
      btn.addEventListener('click', closeVehicleDrawer);
    });
    document.getElementById('vehicle-drawer').addEventListener('click', (e) => {
      if (e.target.id === 'vehicle-drawer') closeVehicleDrawer();
    });
    document.getElementById('vehicle-form').addEventListener('submit', handleSaveVehicle);

    // Previews ao vivo e cálculo automático a partir da data de realização
    SYSTEMS.forEach((sys) => {
      document.getElementById(`field-${sys.key}-realizacao`).addEventListener('input', (e) => {
        const val = e.target.value;
        if (!val) return;
        const vencInput = document.getElementById(`field-${sys.key}-venc`);
        vencInput.value = addMonthsToISO(val, getValidityMonths(sys.key));
        updateFormPreview(sys.key);
      });

      document.getElementById(`field-${sys.key}-venc`).addEventListener('input', () => {
        updateFormPreview(sys.key);
      });
    });

    // Modal Renovação Rápida
    document.getElementById('renew-realizacao').addEventListener('input', (e) => {
      if (!state.renewTarget || !e.target.value) return;
      const months = state.renewTarget.activeMonths || getValidityMonths(state.renewTarget.sysKey);
      document.getElementById('renew-date').value = addMonthsToISO(e.target.value, months);
    });

    document.querySelectorAll('[data-renew-months]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const months = Number(btn.dataset.renewMonths);
        const baseISO = document.getElementById('renew-realizacao').value || toISODate(getTodayStart());
        if (state.renewTarget) state.renewTarget.activeMonths = months;
        document.getElementById('renew-date').value = addMonthsToISO(baseISO, months);
        highlightRenewPreset(months);
      });
    });
    document.getElementById('renew-form').addEventListener('submit', handleConfirmRenew);

    // Modal Excluir e Limpar Tudo
    document.getElementById('btn-confirm-delete').addEventListener('click', handleConfirmDelete);
    document.getElementById('btn-clear-all').addEventListener('click', openClearAllModal);
    document.getElementById('btn-confirm-clear-all').addEventListener('click', handleConfirmClearAll);

    // Modal Google Sheets
    document.getElementById('sheets-form').addEventListener('submit', handleSaveSheetsConfig);
    document.getElementById('btn-download-template').addEventListener('click', downloadTemplateCSV);
    document.getElementById('btn-disconnect-sheets').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEYS.CUSTOM_URL);
      state.connectionError = false;
      closeModal('sheets-modal');
      renderAll();
      showToast('Planilha desconectada.', 'info');
    });

    // Fechar modais via botão ou clique no backdrop
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal(backdrop.id);
      });
    });

    // ESC fecha drawer/modais e menu Exportar
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      setExportMenuOpen(false);
      closeVehicleDrawer();
      ['renew-modal', 'sheets-modal', 'delete-modal', 'clear-all-modal'].forEach(closeModal);
    });
  }

  // ---------- Inicialização ----------
  function init() {
    if (window.FLEET_CONFIG && window.FLEET_CONFIG.FLEET_TITLE) {
      document.getElementById('fleet-title').textContent = window.FLEET_CONFIG.FLEET_TITLE;
    }
    bindEvents();
    loadVehicles();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
