/**
 * MaintControl — Stopages Module
 * CRUD completo para registros de paradas de máquinas.
 * Filtros avanzados · Exportación Excel/PDF · Modal de edición
 */

window.StopagesModule = (() => {
  let currentFilters = {};
  let editingId      = null;

  // ─── Render ──────────────────────────────────────────────────────────
  function render(container, param) {
    const canCreate = AuthService.can('createStopage');
    const canExport = AuthService.can('exportReports');

    container.innerHTML = `
      <div class="module-header">
        <h2><span class="icon">🛑</span> Registro de Paradas</h2>
        <div class="header-actions">
          ${canCreate ? `<button class="btn btn-primary" onclick="StopagesModule.openForm()">＋ Nueva Parada</button>` : ''}
          ${canExport ? `
            <button class="btn btn-ghost btn-sm" onclick="StopagesModule.exportExcel()">📊 Excel</button>
            <button class="btn btn-ghost btn-sm" onclick="StopagesModule.exportPDF()">📄 PDF</button>
          ` : ''}
        </div>
      </div>

      <!-- Filtros -->
      <div class="filter-bar">
        <div class="filter-row">
          <select id="fArea" class="input-sm" onchange="StopagesModule.onAreaChange()">
            <option value="">Todas las áreas</option>
            ${DataService.getAll('areas')
              .filter(a => AuthService.canAccessArea(a.id))
              .map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
          </select>
          <select id="fSubarea" class="input-sm" onchange="StopagesModule.onSubareaChange()">
            <option value="">Todas las subáreas</option>
          </select>
          <select id="fMachine" class="input-sm" onchange="StopagesModule.applyFilters()">
            <option value="">Todas las máquinas</option>
          </select>
          <select id="fStatus" class="input-sm" onchange="StopagesModule.applyFilters()">
            <option value="">Todos los estados</option>
            <option value="pendiente">🔴 Pendiente</option>
            <option value="en_proceso">🟡 En Proceso</option>
            <option value="finalizado">🟢 Finalizado</option>
          </select>
          <select id="fReason" class="input-sm" onchange="StopagesModule.applyFilters()">
            <option value="">Todos los motivos</option>
            ${DataService.getAll('stopReasons').map(r =>
              `<option value="${r.id}">${r.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="filter-row">
          <label style="font-size:12px;color:var(--text-3);white-space:nowrap">Desde</label>
          <input type="date" id="fDateFrom" class="input-sm" onchange="StopagesModule.applyFilters()">
          <label style="font-size:12px;color:var(--text-3);white-space:nowrap">Hasta</label>
          <input type="date" id="fDateTo"   class="input-sm" onchange="StopagesModule.applyFilters()">
          <button class="btn btn-sm btn-ghost" onclick="StopagesModule.clearFilters()">✕ Limpiar filtros</button>
          <span id="resultsCount" style="font-size:12px;color:var(--text-3);margin-left:4px"></span>
        </div>
      </div>

      <!-- Tabla -->
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Máquina</th>
              <th>Área / Subárea</th>
              <th>Motivo</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Duración</th>
              <th>Responsable</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="stopagesBody"></tbody>
        </table>
      </div>

      <!-- Modal de parada -->
      <div class="modal-overlay" id="stopageModal" style="display:none">
        <div class="modal-card">
          <div class="modal-header">
            <h3 id="modalTitle">Nueva Parada</h3>
            <button class="modal-close" onclick="StopagesModule.closeForm()">✕</button>
          </div>
          <div class="modal-body" id="modalBody"></div>
        </div>
      </div>
    `;

    applyFilters();

    // Deep-link: openForm if param = "edit:ID"
    if (param?.startsWith('edit:')) {
      setTimeout(() => openForm(param.slice(5)), 120);
    }
  }

  // ─── Filtros ──────────────────────────────────────────────────────────
  function onAreaChange() {
    const areaId = _val('fArea');
    _populateSelect('fSubarea',
      DataService.getAll('subareas').filter(s => !areaId || s.areaId === areaId),
      'Todas las subáreas'
    );
    _populateSelect('fMachine', [], 'Todas las máquinas');
    applyFilters();
  }

  function onSubareaChange() {
    const subId = _val('fSubarea');
    _populateSelect('fMachine',
      DataService.getAll('machines').filter(m => !subId || m.subareaId === subId),
      'Todas las máquinas'
    );
    applyFilters();
  }

  function applyFilters() {
    const f = {
      areaId:    _val('fArea'),
      subareaId: _val('fSubarea'),
      machineId: _val('fMachine'),
      status:    _val('fStatus'),
      reasonId:  _val('fReason'),
      dateFrom:  _val('fDateFrom'),
      dateTo:    _val('fDateTo'),
    };
    // Remove empty keys
    Object.keys(f).forEach(k => { if (!f[k]) delete f[k]; });
    currentFilters = f;
    renderTable(DataService.getStopages(f));
  }

  function clearFilters() {
    ['fArea','fSubarea','fMachine','fStatus','fReason','fDateFrom','fDateTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    currentFilters = {};
    onAreaChange();   // repopulate cascades
  }

  // ─── Table ────────────────────────────────────────────────────────────
  function renderTable(rows) {
    const body  = document.getElementById('stopagesBody');
    const count = document.getElementById('resultsCount');
    if (!body) return;

    if (count) count.textContent = `${rows.length} resultado${rows.length !== 1 ? 's' : ''}`;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty-cell">No hay paradas con los filtros seleccionados</td></tr>`;
      return;
    }

    const STATUS = {
      pendiente:  { icon:'🔴', cls:'badge-red',    label:'Pendiente'  },
      en_proceso: { icon:'🟡', cls:'badge-yellow', label:'En Proceso' },
      finalizado: { icon:'🟢', cls:'badge-green',  label:'Finalizado' },
    };

    body.innerHTML = rows.map(s => {
      const machine  = DataService.getById('machines',    s.machineId);
      const area     = DataService.getById('areas',       s.areaId);
      const subarea  = DataService.getById('subareas',    s.subareaId);
      const reason   = DataService.getById('stopReasons', s.reasonId);
      const user     = DataService.getById('users',       s.responsibleId);
      const st       = STATUS[s.status] || { icon:'⚪', cls:'', label: s.status };

      const durCell = s.duration != null
        ? `${Math.floor(s.duration/60)}h ${s.duration%60}m`
        : s.status === 'finalizado'
          ? '—'
          : `<span class="live-dur" data-start="${s.startAt}">…</span>`;

      const canEdit = AuthService.can('editStopage');
      const canDel  = AuthService.can('deleteStopage');

      return `<tr class="${s.status==='en_proceso'?'row-active':''}">
        <td><span class="badge ${st.cls}">${st.icon} ${st.label}</span></td>
        <td>
          <strong>${machine?.name || '—'}</strong>
          <small>${machine?.code || ''}</small>
        </td>
        <td>
          ${area?.name || '—'}
          <small>${subarea?.name || '—'}</small>
        </td>
        <td>
          ${reason?.name || '—'}
          ${s.reasonFree ? `<small style="color:var(--text-3)">${s.reasonFree}</small>` : ''}
        </td>
        <td>${s.startAt ? _fmtDT(s.startAt) : '—'}</td>
        <td>${s.endAt   ? _fmtDT(s.endAt)   : '—'}</td>
        <td class="mono">${durCell}</td>
        <td>${user?.name || '—'}</td>
        <td class="actions">
          ${canEdit ? `<button class="btn-icon" onclick="StopagesModule.openForm('${s.id}')" title="Editar">✏️</button>` : ''}
          ${canDel  ? `<button class="btn-icon btn-icon-danger" onclick="StopagesModule.deleteStopage('${s.id}')" title="Eliminar">🗑️</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  // ─── Form modal ───────────────────────────────────────────────────────
  function openForm(id = null) {
    editingId = id;
    const modal = document.getElementById('stopageModal');
    const title = document.getElementById('modalTitle');
    const body  = document.getElementById('modalBody');
    if (!modal || !title || !body) return;

    const stopage = id ? DataService.getById('stopages', id) : null;
    const authUser   = AuthService.getUser();
    const canTime    = AuthService.can('editStartEndTime');
    const canStatus  = AuthService.can('changeStatus');

    const areas    = DataService.getAll('areas').filter(a => AuthService.canAccessArea(a.id));
    const selArea  = stopage?.areaId  || areas[0]?.id || '';
    const subs     = DataService.getAll('subareas').filter(s => s.areaId === selArea);
    const selSub   = stopage?.subareaId || subs[0]?.id || '';
    const machs    = DataService.getAll('machines').filter(m => m.subareaId === selSub);
    const reasons  = DataService.getAll('stopReasons').filter(r => r.active !== false);
    const now      = new Date().toISOString().slice(0,16);

    title.textContent = id ? 'Editar Parada' : 'Nueva Parada';

    body.innerHTML = `
      <form id="stopageForm" autocomplete="off">
        <div class="form-grid">

          <div class="form-group">
            <label>Área *</label>
            <select id="fmArea" class="input" required onchange="StopagesModule._formAreaChange()">
              ${areas.map(a => `<option value="${a.id}" ${a.id===selArea?'selected':''}>${a.name}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Subárea *</label>
            <select id="fmSub" class="input" required onchange="StopagesModule._formSubChange()">
              ${subs.map(s => `<option value="${s.id}" ${s.id===selSub?'selected':''}>${s.name}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Máquina *</label>
            <select id="fmMach" class="input" required>
              ${machs.map(m => `<option value="${m.id}" ${m.id===stopage?.machineId?'selected':''}>${m.name}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Motivo *</label>
            <select id="fmReason" class="input" required>
              ${reasons.map(r => `<option value="${r.id}" ${r.id===stopage?.reasonId?'selected':''}>${r.name}</option>`).join('')}
            </select>
          </div>

          <div class="form-group full">
            <label>Descripción adicional</label>
            <input type="text" id="fmReasonFree" class="input"
              value="${stopage?.reasonFree||''}"
              placeholder="Detalles del motivo (opcional)">
          </div>

          <div class="form-group">
            <label>Fecha/Hora Inicio ${canTime?'':'<small>(solo lectura)</small>'}</label>
            <input type="datetime-local" id="fmStart" class="input"
              value="${stopage?.startAt || now}"
              ${canTime?'':'readonly'} required>
          </div>

          <div class="form-group">
            <label>Fecha/Hora Fin <small>(automática al finalizar)</small></label>
            <input type="datetime-local" id="fmEnd" class="input"
              value="${stopage?.endAt||''}"
              ${(!canTime && stopage?.status==='finalizado')?'readonly':''}>
          </div>

          <div class="form-group">
            <label>Estado *</label>
            <select id="fmStatus" class="input" ${canStatus?'':'disabled'}>
              <option value="pendiente"  ${stopage?.status==='pendiente'?'selected':''}>🔴 Pendiente</option>
              <option value="en_proceso" ${stopage?.status==='en_proceso'?'selected':(!stopage?'selected':'')}>🟡 En Proceso</option>
              <option value="finalizado" ${stopage?.status==='finalizado'?'selected':''}>🟢 Finalizado</option>
            </select>
          </div>

          <div class="form-group">
            <label>Responsable</label>
            <input type="text" class="input" value="${authUser?.name||''}" readonly>
          </div>

          <div class="form-group full">
            <label>Notas / Observaciones</label>
            <textarea id="fmNotes" class="input" rows="3"
              placeholder="Descripción del problema, acciones tomadas…">${stopage?.notes||''}</textarea>
          </div>

        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="StopagesModule.closeForm()">Cancelar</button>
          <button type="submit" class="btn btn-primary">💾 Guardar Parada</button>
        </div>
      </form>`;

    document.getElementById('stopageForm').addEventListener('submit', _submitForm);

    // Show modal
    modal.style.display = 'flex';
    modal.addEventListener('click', e => { if (e.target === modal) closeForm(); }, { once: true });
  }

  function _formAreaChange() {
    const areaId = _val('fmArea');
    const subs   = DataService.getAll('subareas').filter(s => s.areaId === areaId);
    _populateSelect('fmSub', subs, null, item => `<option value="${item.id}">${item.name}</option>`);
    _formSubChange();
  }

  function _formSubChange() {
    const subId = _val('fmSub');
    const machs = DataService.getAll('machines').filter(m => m.subareaId === subId && m.active !== false);
    _populateSelect('fmMach', machs, null, item => `<option value="${item.id}">${item.name}</option>`);
  }

  function _submitForm(e) {
    e.preventDefault();
    const user    = AuthService.getUser();
    const startAt = _val('fmStart');
    const endAt   = _val('fmEnd') || null;
    const status  = _val('fmStatus') || 'pendiente';

    // Auto-close: if finalizado with no end, set now
    const resolvedEnd = (status === 'finalizado' && !endAt)
      ? new Date().toISOString().slice(0,16)
      : endAt;
    const duration = DataService.calcDuration(startAt, resolvedEnd);

    const data = {
      areaId:        _val('fmArea'),
      subareaId:     _val('fmSub'),
      machineId:     _val('fmMach'),
      reasonId:      _val('fmReason'),
      reasonFree:    _val('fmReasonFree'),
      startAt,
      endAt:         resolvedEnd,
      status,
      duration,
      notes:         _val('fmNotes'),
      responsibleId: user.id,
    };

    if (editingId) {
      DataService.update('stopages', editingId, data);
      NotificationService.showToast('Parada actualizada', 'Cambios guardados correctamente', 'success');
    } else {
      DataService.create('stopages', data);
      NotificationService.showToast('Parada registrada', 'Nuevo evento creado', 'success');
    }

    closeForm();
    applyFilters();
    window.dispatchEvent(new CustomEvent('data-changed'));
  }

  function closeForm() {
    const modal = document.getElementById('stopageModal');
    if (modal) modal.style.display = 'none';
    editingId = null;
  }

  function deleteStopage(id) {
    if (!confirm('¿Eliminar esta parada? No se puede deshacer.')) return;
    DataService.remove('stopages', id);
    NotificationService.showToast('Parada eliminada', '', 'info');
    applyFilters();
    window.dispatchEvent(new CustomEvent('data-changed'));
  }

  // ─── Export Excel ─────────────────────────────────────────────────────
  function exportExcel() {
    if (!window.XLSX) {
      NotificationService.showToast('Error', 'Librería XLSX no cargada', 'error'); return;
    }
    const rows = DataService.getStopages(currentFilters).map(s => ({
      'Estado':          s.status,
      'Área':            DataService.getById('areas',       s.areaId)?.name || '',
      'Subárea':         DataService.getById('subareas',    s.subareaId)?.name || '',
      'Máquina':         DataService.getById('machines',    s.machineId)?.name || '',
      'Cód. Máquina':    DataService.getById('machines',    s.machineId)?.code || '',
      'Motivo':          DataService.getById('stopReasons', s.reasonId)?.name || '',
      'Categoría':       DataService.getById('stopReasons', s.reasonId)?.category || '',
      'Descripción':     s.reasonFree || '',
      'Inicio':          s.startAt || '',
      'Fin':             s.endAt || '',
      'Duración (min)':  s.duration ?? '',
      'Responsable':     DataService.getById('users', s.responsibleId)?.name || '',
      'Notas':           s.notes || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = Array(13).fill({ wch: 20 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Paradas');
    XLSX.writeFile(wb, `paradas_${_today()}.xlsx`);
    NotificationService.showToast('Excel exportado ✅', `${rows.length} registros`, 'success');
  }

  // ─── Export PDF ───────────────────────────────────────────────────────
  function exportPDF() {
    const rows = DataService.getStopages(currentFilters);
    const h = m => m != null ? `${Math.floor(m/60)}h ${m%60}m` : '—';
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html lang="es"><head>
      <meta charset="UTF-8">
      <title>Reporte de Paradas — ${_today()}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Segoe UI',sans-serif;font-size:11px;color:#111;padding:24px}
        h1{font-size:18px;margin-bottom:4px;color:#0f172a}
        .sub{color:#64748b;font-size:12px;margin-bottom:20px}
        .kpis{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
        .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;text-align:center;min-width:90px}
        .kv{font-size:20px;font-weight:700;color:#0ea5e9}
        .kl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
        table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:10.5px}
        th{background:#0f172a;color:#fff;padding:7px 9px;text-align:left;font-weight:600}
        td{padding:6px 9px;border-bottom:1px solid #e2e8f0}
        tr:nth-child(even) td{background:#f8fafc}
        .footer{margin-top:20px;text-align:center;color:#94a3b8;font-size:10px;padding-top:10px;border-top:1px solid #e2e8f0}
      </style></head><body>
      <h1>⚙ MaintControl — Reporte de Paradas</h1>
      <p class="sub">Generado: ${new Date().toLocaleString('es-MX')} · Total: ${rows.length} registros</p>
      <div class="kpis">
        <div class="kpi"><div class="kv">${rows.length}</div><div class="kl">Total</div></div>
        <div class="kpi"><div class="kv">${rows.filter(s=>s.status==='pendiente').length}</div><div class="kl">Pendientes</div></div>
        <div class="kpi"><div class="kv">${rows.filter(s=>s.status==='en_proceso').length}</div><div class="kl">En Proceso</div></div>
        <div class="kpi"><div class="kv">${rows.filter(s=>s.status==='finalizado').length}</div><div class="kl">Finalizados</div></div>
        <div class="kpi"><div class="kv">${h(rows.reduce((a,s)=>a+(s.duration||0),0))}</div><div class="kl">Tiempo Total</div></div>
      </div>
      <table>
        <thead><tr><th>Fecha</th><th>Máquina</th><th>Área</th><th>Motivo</th><th>Estado</th><th>Duración</th><th>Responsable</th></tr></thead>
        <tbody>
          ${rows.map(s => {
            const m = DataService.getById('machines',    s.machineId);
            const a = DataService.getById('areas',       s.areaId);
            const r = DataService.getById('stopReasons', s.reasonId);
            const u = DataService.getById('users',       s.responsibleId);
            return `<tr>
              <td>${s.startAt?new Date(s.startAt).toLocaleDateString('es-MX'):''}</td>
              <td>${m?.name||'—'}</td>
              <td>${a?.name||'—'}</td>
              <td>${r?.name||'—'}</td>
              <td>${s.status}</td>
              <td>${h(s.duration)}</td>
              <td>${u?.name||'—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="footer">MaintControl © ${new Date().getFullYear()}</div>
    </body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────
  function _val(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function _fmtDT(dt) {
    return new Date(dt).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' });
  }

  function _today() {
    return new Date().toISOString().split('T')[0];
  }

  function _populateSelect(id, items, placeholder, renderOpt) {
    const el = document.getElementById(id);
    if (!el) return;
    const def  = placeholder ? `<option value="">${placeholder}</option>` : '';
    const opts = renderOpt
      ? items.map(renderOpt).join('')
      : items.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    el.innerHTML = def + opts;
  }

  return {
    render, openForm, closeForm,
    applyFilters, clearFilters,
    onAreaChange, onSubareaChange,
    deleteStopage, exportExcel, exportPDF,
    // internal helpers exposed for inline onchange handlers
    _formAreaChange, _formSubChange,
  };
})();
