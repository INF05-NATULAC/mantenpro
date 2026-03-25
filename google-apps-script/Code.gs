/**
 * MaintControl - Google Apps Script Backend
 * ==========================================
 * INSTRUCCIONES DE INSTALACIÓN:
 * 1. Abre tu Google Sheet
 * 2. Extensiones → Apps Script
 * 3. Pega TODO este código
 * 4. Guarda (Ctrl+S)
 * 5. Ejecutar → Implementar → Nueva implementación
 *    - Tipo: Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 6. Copia la URL generada y pégala en dataService.js → SheetsService.CONFIG.scriptUrl
 *
 * HOJAS REQUERIDAS (se crean automáticamente):
 * areas | subareas | machines | users | stopReasons | stopages | alertConfig
 */

// ──────────────────────────────────────────────────
// CONFIGURACIÓN
// ──────────────────────────────────────────────────
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

const SHEET_HEADERS = {
  areas:       ['id','name','code','description','active','createdAt','updatedAt'],
  subareas:    ['id','areaId','name','code','active','createdAt','updatedAt'],
  machines:    ['id','subareaId','name','code','type','active','createdAt','updatedAt'],
  users:       ['id','name','email','password','role','areas','active','createdAt','updatedAt'],
  stopReasons: ['id','name','category','active','createdAt','updatedAt'],
  stopages:    ['id','machineId','subareaId','areaId','reasonId','reasonFree','responsibleId','status','startAt','endAt','duration','notes','createdAt','updatedAt'],
  alertConfig: ['id','prolongedStopMinutes','notifyRoles','createdAt','updatedAt'],
};

// ──────────────────────────────────────────────────
// HTTP HANDLER
// ──────────────────────────────────────────────────
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const params = e.parameter || {};
    const action = params.action;
    let data = {};
    
    if (params.data) {
      try { data = JSON.parse(decodeURIComponent(params.data)); } catch(err) {}
    }
    if (e.postData?.contents) {
      try { data = JSON.parse(e.postData.contents); } catch(err) {}
    }

    let result;
    switch (action) {
      case 'getAll':       result = getAll(data.sheet); break;
      case 'getById':      result = getById(data.sheet, data.id); break;
      case 'create':       result = create(data.sheet, data.data); break;
      case 'update':       result = update(data.sheet, data.id, data.data); break;
      case 'delete':       result = deleteRecord(data.sheet, data.id); break;
      case 'bulkCreate':   result = bulkCreate(data.sheet, data.rows); break;
      case 'getStopages':  result = getStopages(data.filters || {}); break;
      case 'initSheets':   result = initAllSheets(); break;
      case 'ping':         result = { ok: true, timestamp: new Date().toISOString() }; break;
      default:             result = { error: 'Acción no reconocida: ' + action };
    }

    return buildResponse(result);
  } catch (err) {
    return buildResponse({ error: err.message, stack: err.stack });
  }
}

function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ──────────────────────────────────────────────────
// SHEET OPERATIONS
// ──────────────────────────────────────────────────
function getSheet(sheetName, createIfMissing = true) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet(sheetName);
    const headers = SHEET_HEADERS[sheetName];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#0f172a')
        .setFontColor('#00d4ff')
        .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function getAll(sheetName) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const lastCol = sheet.getLastColumn();
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0];
  
  return data.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let val = row[i];
        // Parse JSON arrays stored as strings
        if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
          try { val = JSON.parse(val); } catch(e) {}
        }
        // Parse booleans
        if (val === 'TRUE' || val === true) val = true;
        if (val === 'FALSE' || val === false) val = false;
        obj[h] = val;
      });
      return obj;
    });
}

function getById(sheetName, id) {
  const all = getAll(sheetName);
  return all.find(r => r.id === id) || null;
}

function create(sheetName, data) {
  const sheet = getSheet(sheetName);
  const headers = SHEET_HEADERS[sheetName] || Object.keys(data);
  
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  
  const now = new Date().toISOString();
  const record = {
    id: data.id || generateId(),
    ...data,
    createdAt: data.createdAt || now,
    updatedAt: now,
  };
  
  const row = headers.map(h => {
    const val = record[h];
    return Array.isArray(val) ? JSON.stringify(val) : (val ?? '');
  });
  
  sheet.appendRow(row);
  return { success: true, data: record };
}

function update(sheetName, id, data) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, error: 'No hay datos' };
  
  const lastCol = sheet.getLastColumn();
  const allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = allData[0];
  const idCol = headers.indexOf('id');
  
  if (idCol === -1) return { success: false, error: 'Columna id no encontrada' };
  
  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][idCol]) === String(id)) {
      const updatedRecord = { ...Object.fromEntries(headers.map((h, j) => [h, allData[i][j]])), ...data, updatedAt: new Date().toISOString() };
      const row = headers.map(h => {
        const val = updatedRecord[h];
        return Array.isArray(val) ? JSON.stringify(val) : (val ?? '');
      });
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { success: true, data: updatedRecord };
    }
  }
  return { success: false, error: `ID ${id} no encontrado` };
}

function deleteRecord(sheetName, id) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { success: false };
  
  const allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = allData[0];
  const idCol = headers.indexOf('id');
  
  for (let i = allData.length - 1; i >= 1; i--) {
    if (String(allData[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: `ID ${id} no encontrado` };
}

function bulkCreate(sheetName, rows) {
  const results = rows.map(r => create(sheetName, r));
  return { success: true, created: results.length };
}

// ──────────────────────────────────────────────────
// DOMAIN QUERIES
// ──────────────────────────────────────────────────
function getStopages(filters) {
  let stopages = getAll('stopages');
  
  if (filters.areaId)    stopages = stopages.filter(s => s.areaId === filters.areaId);
  if (filters.subareaId) stopages = stopages.filter(s => s.subareaId === filters.subareaId);
  if (filters.machineId) stopages = stopages.filter(s => s.machineId === filters.machineId);
  if (filters.status)    stopages = stopages.filter(s => s.status === filters.status);
  if (filters.responsibleId) stopages = stopages.filter(s => s.responsibleId === filters.responsibleId);
  if (filters.reasonId)  stopages = stopages.filter(s => s.reasonId === filters.reasonId);
  if (filters.dateFrom)  stopages = stopages.filter(s => String(s.startAt) >= filters.dateFrom);
  if (filters.dateTo)    stopages = stopages.filter(s => String(s.startAt) <= filters.dateTo + 'T23:59');
  
  return stopages.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// ──────────────────────────────────────────────────
// INIT / SEEDING
// ──────────────────────────────────────────────────
function initAllSheets() {
  Object.keys(SHEET_HEADERS).forEach(name => getSheet(name, true));
  
  // Seed areas if empty
  if (getAll('areas').length === 0) {
    const seedAreas = [
      { name:'Producción', code:'PROD', description:'Líneas de producción', active:true },
      { name:'Empaque', code:'EMP', description:'Área de empaque', active:true },
      { name:'Utilities', code:'UTL', description:'Servicios generales', active:true },
    ];
    seedAreas.forEach(a => create('areas', a));
  }
  
  return { success: true, message: 'Hojas inicializadas correctamente' };
}

// ──────────────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────────────
function generateId() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 16);
}

// ──────────────────────────────────────────────────
// EMAIL ALERTS (opcional)
// ──────────────────────────────────────────────────
function sendAlertEmail(stopageId) {
  try {
    const stopage = getById('stopages', stopageId);
    if (!stopage) return;
    
    const machine = getById('machines', stopage.machineId);
    const area = getById('areas', stopage.areaId);
    const reason = getById('stopReasons', stopage.reasonId);
    const responsible = getById('users', stopage.responsibleId);
    
    const subject = `[MaintControl] ⚠️ Parada: ${machine?.name || stopageId}`;
    const body = `
      Nueva parada registrada en MaintControl.
      
      Máquina: ${machine?.name || '—'}
      Área: ${area?.name || '—'}
      Motivo: ${reason?.name || '—'}
      ${stopage.reasonFree ? `Descripción: ${stopage.reasonFree}` : ''}
      Responsable: ${responsible?.name || '—'}
      Inicio: ${stopage.startAt}
      Estado: ${stopage.status}
      
      ---
      MaintControl - Sistema de Gestión de Paradas
    `;
    
    // Get supervisors/managers of this area
    const users = getAll('users').filter(u => 
      ['supervisor','jefe','gerente','admin','superadmin'].includes(u.role) &&
      (u.areas === '[]' || !u.areas || (Array.isArray(u.areas) ? u.areas.includes(stopage.areaId) : String(u.areas).includes(stopage.areaId)))
    );
    
    users.forEach(u => {
      if (u.email) {
        MailApp.sendEmail({ to: u.email, subject, body });
      }
    });
    
    return { success: true, notified: users.length };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ──────────────────────────────────────────────────
// TRIGGER: Prolonged stop check (run every 30 min)
// ──────────────────────────────────────────────────
function checkProlongedStops() {
  const config = getAll('alertConfig')[0];
  const threshold = config?.prolongedStopMinutes || 60;
  const now = new Date();
  
  const active = getAll('stopages').filter(s => s.status !== 'finalizado' && s.startAt);
  
  active.forEach(s => {
    const elapsed = Math.round((now - new Date(s.startAt)) / 60000);
    if (elapsed >= threshold) {
      const alreadyAlerted = PropertiesService.getScriptProperties().getProperty('alerted_' + s.id);
      if (!alreadyAlerted) {
        PropertiesService.getScriptProperties().setProperty('alerted_' + s.id, '1');
        sendAlertEmail(s.id);
      }
    }
  });
}

// ──────────────────────────────────────────────────
// SETUP TRIGGERS (run once manually)
// ──────────────────────────────────────────────────
function setupTriggers() {
  // Delete existing triggers
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  
  // Check prolonged stops every 30 minutes
  ScriptApp.newTrigger('checkProlongedStops')
    .timeBased()
    .everyMinutes(30)
    .create();
    
  Logger.log('Triggers configurados correctamente');
}
