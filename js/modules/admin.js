/**
 * MaintControl — Admin Module
 * CRUD panels: Áreas · Subáreas · Máquinas · Usuarios · Motivos · Config
 */

window.AdminModule = (() => {
  let activeTab = 'areas';

  // ─── Render ──────────────────────────────────────────────────────────
  function render(container) {
    if (!AuthService.hasLevel('supervisor')) {
      container.innerHTML = '<div class="empty-state">🔒 Sin permisos para esta sección.</div>';
      return;
    }

    const TAB_DEFS = [
      { id:'areas',      label:'🏭 Áreas',        perm:'manageAreas' },
      { id:'subareas',   label:'📍 Subáreas',      perm:'manageAreas' },
      { id:'machines',   label:'⚙️ Máquinas',      perm:'manageMachines' },
      { id:'users',      label:'👤 Usuarios',      perm:'manageUsers' },
      { id:'reasons',    label:'📋 Motivos',       perm:'manageReasons' },
      { id:'config',     label:'⚙ Configuración', perm:'manageAlerts' },
    ].filter(t => AuthService.can(t.perm));

    if (!TAB_DEFS.length) {
      container.innerHTML = '<div class="empty-state">🔒 Sin acceso a ningún panel.</div>';
      return;
    }

    // Ensure activeTab is still valid
    if (!TAB_DEFS.find(t => t.id === activeTab)) activeTab = TAB_DEFS[0].id;

    container.innerHTML = `
      <div class="module-header">
        <h2><span class="icon">🔧</span> Administración del Sistema</h2>
      </div>
      <div class="tabs" id="adminTabs">
        ${TAB_DEFS.map(t => `
          <button class="tab ${t.id===activeTab?'active':''}"
            onclick="AdminModule.switchTab('${t.id}')">${t.label}
          </button>`).join('')}
      </div>
      <div id="adminContent"></div>
    `;

    _renderTab(activeTab);
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab').forEach(el => {
      el.classList.toggle('active', el.textContent.trim().includes(
        { areas:'Áreas', subareas:'Subáreas', machines:'Máquinas',
          users:'Usuarios', reasons:'Motivos', config:'Config' }[tab] || tab
      ));
    });
    _renderTab(tab);
  }

  function _renderTab(tab) {
    const content = document.getElementById('adminContent');
    if (!content) return;
    const map = {
      areas:    _renderAreas,
      subareas: _renderSubareas,
      machines: _renderMachines,
      users:    _renderUsers,
      reasons:  _renderReasons,
      config:   _renderConfig,
    };
    map[tab]?.(content);
  }

  // ─── Generic list builder ─────────────────────────────────────────────
  function _genericPanel({ id, title, items, cols, rowFn, canCreate, canEdit, canDelete }) {
    return `
      <div class="admin-panel">
        <div class="panel-header">
          <h3>${title} <span class="count-badge">${items.length}</span></h3>
          ${canCreate ? `<button class="btn btn-primary btn-sm"
            onclick="AdminModule.openModal('${id}')">＋ Agregar</button>` : ''}
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr>
              ${cols.map(c=>`<th>${c}</th>`).join('')}
              <th>Acciones</th>
            </tr></thead>
            <tbody>
              ${items.length
                ? items.map(item => `<tr>
                    ${rowFn(item)}
                    <td class="actions">
                      ${canEdit   ? `<button class="btn-icon" onclick="AdminModule.openModal('${id}','${item.id}')">✏️</button>` : ''}
                      ${canDelete ? `<button class="btn-icon btn-icon-danger" onclick="AdminModule.deleteItem('${id}','${item.id}')">🗑️</button>` : ''}
                    </td>
                  </tr>`).join('')
                : `<tr><td colspan="${cols.length+1}" class="empty-cell">Sin registros</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
      <!-- Modal -->
      <div class="modal-overlay" id="modal_${id}" style="display:none">
        <div class="modal-card">
          <div class="modal-header">
            <h3 id="modal_${id}_title">Agregar ${title}</h3>
            <button class="modal-close" onclick="AdminModule.closeModal('${id}')">✕</button>
          </div>
          <div class="modal-body" id="modal_${id}_body"></div>
        </div>
      </div>`;
  }

  const _bool = v => v !== false && v !== 'false' && v !== 0;
  const _active = a => _bool(a?.active)
    ? '<span class="badge badge-green">Activo</span>'
    : '<span class="badge badge-red">Inactivo</span>';

  // ─── Panels ───────────────────────────────────────────────────────────
  function _renderAreas(c) {
    const isSA = AuthService.hasLevel('superadmin');
    c.innerHTML = _genericPanel({
      id: 'areas', title: 'Áreas',
      items: DataService.getAll('areas'),
      cols:  ['Código','Nombre','Descripción','Estado'],
      rowFn: a => `
        <td><code>${a.code}</code></td>
        <td><strong>${a.name}</strong></td>
        <td style="color:var(--text-2)">${a.description||'—'}</td>
        <td>${_active(a)}</td>`,
      canCreate: isSA, canEdit: isSA, canDelete: isSA,
    });
  }

  function _renderSubareas(c) {
    const isSA = AuthService.hasLevel('superadmin');
    const areas = DataService.getAll('areas');
    c.innerHTML = _genericPanel({
      id: 'subareas', title: 'Subáreas',
      items: DataService.getAll('subareas'),
      cols:  ['Código','Nombre','Área','Estado'],
      rowFn: s => {
        const area = areas.find(a => a.id === s.areaId);
        return `
          <td><code>${s.code}</code></td>
          <td><strong>${s.name}</strong></td>
          <td>${area?.name||'—'}</td>
          <td>${_active(s)}</td>`;
      },
      canCreate: isSA, canEdit: isSA, canDelete: isSA,
    });
  }

  function _renderMachines(c) {
    const can = AuthService.can('manageMachines');
    const subs  = DataService.getAll('subareas');
    const areas = DataService.getAll('areas');
    c.innerHTML = _genericPanel({
      id: 'machines', title: 'Máquinas',
      items: DataService.getAll('machines'),
      cols:  ['Código','Nombre','Tipo','Área › Subárea','Estado'],
      rowFn: m => {
        const sub  = subs.find(s => s.id === m.subareaId);
        const area = areas.find(a => a.id === sub?.areaId);
        return `
          <td><code>${m.code}</code></td>
          <td><strong>${m.name}</strong></td>
          <td><span class="badge badge-blue">${m.type||'—'}</span></td>
          <td>${area?.name||'—'} › ${sub?.name||'—'}</td>
          <td>${_active(m)}</td>`;
      },
      canCreate: can, canEdit: can, canDelete: can,
    });
  }

  function _renderUsers(c) {
    const can = AuthService.can('manageUsers');
    const me  = AuthService.getUser();
    c.innerHTML = _genericPanel({
      id: 'users', title: 'Usuarios',
      items: DataService.getAll('users'),
      cols:  ['Nombre','Email','Rol','Áreas','Estado'],
      rowFn: u => {
        const rc = AuthService.getRoleColor(u.role);
        const areaNames = (Array.isArray(u.areas) ? u.areas : [])
          .map(aid => DataService.getById('areas', aid)?.name||aid).join(', ') || 'Todas';
        return `
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:28px;height:28px;border-radius:50%;background:${rc}22;border:2px solid ${rc};
                          display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${rc}">
                ${u.name[0].toUpperCase()}
              </div>
              <strong>${u.name}</strong>
            </div>
          </td>
          <td style="color:var(--text-2)">${u.email}</td>
          <td><span class="badge" style="background:${rc}18;color:${rc};border-color:${rc}40">
            ${AuthService.getRoleLabel(u.role)}</span></td>
          <td style="font-size:12px;color:var(--text-2)">${areaNames}</td>
          <td>${_active(u)}</td>`;
      },
      canCreate: can, canEdit: can,
      canDelete: can && me.role === 'superadmin',
    });
  }

  function _renderReasons(c) {
    const can = AuthService.can('manageReasons');
    const CATS = ['Mecánica','Eléctrica','Preventivo','Operativa','Logística','Proceso','Otros'];
    const catColor = cat => ({'Mecánica':'badge-red','Eléctrica':'badge-yellow','Preventivo':'badge-blue',
      'Operativa':'badge-green','Logística':'badge-yellow','Proceso':'badge-blue'}[cat]||'');
    c.innerHTML = _genericPanel({
      id: 'stopReasons', title: 'Motivos de Parada',
      items: DataService.getAll('stopReasons'),
      cols:  ['Nombre','Categoría','Estado'],
      rowFn: r => `
        <td><strong>${r.name}</strong></td>
        <td><span class="badge ${catColor(r.category)}">${r.category||'—'}</span></td>
        <td>${_active(r)}</td>`,
      canCreate: can, canEdit: can, canDelete: can,
    });
  }

  function _renderConfig(c) {
    const cfg   = DataService.getAll('alertConfig')[0] || { prolongedStopMinutes: 60 };
    const queue = DataService.getAll('offlineQueue');
    c.innerHTML = `
      <div class="admin-panel">
        <div class="panel-header"><h3>⏰ Umbral de Alerta por Parada Prolongada</h3></div>
        <div style="max-width:460px;display:flex;flex-direction:column;gap:14px">
          <div class="form-group">
            <label>Minutos antes de generar alerta</label>
            <input type="number" id="cfgMin" class="input" value="${cfg.prolongedStopMinutes||60}" min="5" max="480" style="max-width:180px">
            <small>Se mostrará alerta visual y push notification al superar este tiempo.</small>
          </div>
          <button class="btn btn-primary" style="align-self:flex-start" onclick="AdminModule.saveConfig()">
            💾 Guardar configuración
          </button>
        </div>

        <div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--border)">
          <div class="panel-header"><h3>🔔 Notificaciones Push</h3></div>
          <p style="color:var(--text-2);font-size:13.5px;margin-bottom:12px">
            Activa las notificaciones para recibir alertas incluso cuando la app esté en segundo plano.
          </p>
          <button class="btn btn-ghost" onclick="AdminModule.requestPush()">
            🔔 Activar notificaciones push
          </button>
        </div>

        <div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--border)">
          <div class="panel-header"><h3>☁️ Sincronización Offline</h3></div>
          <p style="color:var(--text-2);font-size:13.5px;margin-bottom:12px">
            Registros pendientes de sincronizar con el servidor:
            <strong id="queueCount" style="color:var(--accent)">${queue.length}</strong>
          </p>
          <button class="btn btn-ghost" onclick="AdminModule.flushQueue()">
            ☁️ Sincronizar ahora
          </button>
        </div>

        <div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--border)">
          <div class="panel-header"><h3>🔄 Datos de Demostración</h3></div>
          <p style="color:var(--text-2);font-size:13.5px;margin-bottom:12px">
            Restaura los datos de ejemplo originales. <strong style="color:var(--red)">Borra todos los cambios locales.</strong>
          </p>
          <button class="btn btn-danger" onclick="AdminModule.resetDemo()">
            🗑️ Restaurar datos demo
          </button>
        </div>
      </div>`;
  }

  // ─── Config actions ───────────────────────────────────────────────────
  function saveConfig() {
    const min = parseInt(document.getElementById('cfgMin')?.value || 60);
    const existing = DataService.getAll('alertConfig');
    if (existing.length) {
      DataService.update('alertConfig', existing[0].id, { prolongedStopMinutes: min });
    } else {
      DataService.create('alertConfig', { prolongedStopMinutes: min });
    }
    NotificationService.showToast('Configuración guardada ✅', `Umbral: ${min} minutos`, 'success');
  }

  async function requestPush() {
    const granted = await NotificationService.requestPush();
    NotificationService.showToast(
      granted ? 'Notificaciones activadas ✅' : 'Permiso denegado',
      '', granted ? 'success' : 'warning'
    );
  }

  async function flushQueue() {
    const n = await DataService.flushOfflineQueue();
    const el = document.getElementById('queueCount');
    if (el) el.textContent = '0';
    NotificationService.showToast('Sincronización completada', `${n||0} registros enviados`, 'success');
  }

  function resetDemo() {
    if (!confirm('¿Restaurar los datos de demostración?\n\nEsto borrará todos los cambios locales.')) return;
    DataService.resetDemo();
    NotificationService.showToast('Datos restaurados ✅', 'Demo reiniciado', 'success');
    App.navigate('dashboard');
  }

  // ─── Modal CRUD ───────────────────────────────────────────────────────
  function openModal(collection, id = null) {
    const modal = document.getElementById(`modal_${collection}`);
    const title = document.getElementById(`modal_${collection}_title`);
    const body  = document.getElementById(`modal_${collection}_body`);
    if (!modal || !title || !body) return;

    const item = id ? DataService.getById(collection, id) : null;
    const labels = {
      areas:'Área', subareas:'Subárea', machines:'Máquina',
      users:'Usuario', stopReasons:'Motivo',
    };
    title.textContent = `${id?'Editar':'Agregar'} ${labels[collection]||''}`;

    body.innerHTML = _buildForm(collection, item);
    body.querySelector('form')?.addEventListener('submit', e => {
      e.preventDefault();
      _saveItem(collection, id, e.target);
    });

    modal.style.display = 'flex';
    modal.addEventListener('click', ev => { if (ev.target === modal) closeModal(collection); }, { once:true });
  }

  function _buildForm(collection, item) {
    const v  = (k, d='') => item?.[k] ?? d;
    const chk = k => _bool(item?.[k] ?? true) ? 'checked' : '';

    const statusRow = (label='Estado') => `
      <div class="form-group">
        <label>${label}</label>
        <label class="toggle">
          <input type="checkbox" name="active" ${chk('active')}>
          <span>Activo</span>
        </label>
      </div>`;

    const forms = {
      areas: `<form>
        <div class="form-grid">
          <div class="form-group"><label>Código *</label>
            <input class="input" name="code" value="${v('code')}" required placeholder="ej. PROD" maxlength="10"></div>
          <div class="form-group"><label>Nombre *</label>
            <input class="input" name="name" value="${v('name')}" required></div>
          <div class="form-group full"><label>Descripción</label>
            <input class="input" name="description" value="${v('description')}"></div>
          ${statusRow()}
        </div>
        ${_formActions('areas')}</form>`,

      subareas: `<form>
        <div class="form-grid">
          <div class="form-group"><label>Área *</label>
            <select class="input" name="areaId" required>
              ${DataService.getAll('areas').map(a =>
                `<option value="${a.id}" ${a.id===v('areaId')?'selected':''}>${a.name}</option>`
              ).join('')}
            </select></div>
          <div class="form-group"><label>Código *</label>
            <input class="input" name="code" value="${v('code')}" required maxlength="10"></div>
          <div class="form-group full"><label>Nombre *</label>
            <input class="input" name="name" value="${v('name')}" required></div>
          ${statusRow()}
        </div>
        ${_formActions('subareas')}</form>`,

      machines: `<form>
        <div class="form-grid">
          <div class="form-group"><label>Subárea *</label>
            <select class="input" name="subareaId" required>
              ${DataService.getAll('subareas').map(s =>
                `<option value="${s.id}" ${s.id===v('subareaId')?'selected':''}>${s.name}</option>`
              ).join('')}
            </select></div>
          <div class="form-group"><label>Código *</label>
            <input class="input" name="code" value="${v('code')}" required maxlength="15"></div>
          <div class="form-group"><label>Nombre *</label>
            <input class="input" name="name" value="${v('name')}" required></div>
          <div class="form-group"><label>Tipo</label>
            <input class="input" name="type" value="${v('type')}" placeholder="ej. Llenadora"></div>
          ${statusRow()}
        </div>
        ${_formActions('machines')}</form>`,

      users: `<form>
        <div class="form-grid">
          <div class="form-group full"><label>Nombre completo *</label>
            <input class="input" name="name" value="${v('name')}" required></div>
          <div class="form-group"><label>Email *</label>
            <input class="input" type="email" name="email" value="${v('email')}" required></div>
          <div class="form-group"><label>Contraseña ${item?'(vacío = sin cambio)':' *'}</label>
            <input class="input" type="password" name="password" ${item?'':'required'} placeholder="Mínimo 6 caracteres"></div>
          <div class="form-group"><label>Rol *</label>
            <select class="input" name="role" required>
              ${AuthService.getRoles().sort((a,b)=>b.level-a.level).map(r =>
                `<option value="${r.key}" ${r.key===v('role')?'selected':''}>${r.label}</option>`
              ).join('')}
            </select></div>
          <div class="form-group full"><label>Áreas asignadas (vacío = todas)</label>
            <div class="checkbox-group">
              ${DataService.getAll('areas').map(a => {
                const areas = Array.isArray(item?.areas) ? item.areas : [];
                return `<label class="checkbox-item">
                  <input type="checkbox" name="areas" value="${a.id}" ${areas.includes(a.id)?'checked':''}>
                  <span>${a.name}</span>
                </label>`;
              }).join('')}
            </div></div>
          ${statusRow()}
        </div>
        ${_formActions('users')}</form>`,

      stopReasons: `<form>
        <div class="form-grid">
          <div class="form-group full"><label>Nombre *</label>
            <input class="input" name="name" value="${v('name')}" required></div>
          <div class="form-group"><label>Categoría</label>
            <select class="input" name="category">
              ${['Mecánica','Eléctrica','Preventivo','Operativa','Logística','Proceso','Otros']
                .map(cat => `<option value="${cat}" ${cat===v('category')?'selected':''}>${cat}</option>`).join('')}
            </select></div>
          ${statusRow()}
        </div>
        ${_formActions('stopReasons')}</form>`,
    };

    return forms[collection] || '<p>Formulario no disponible para esta colección.</p>';
  }

  function _formActions(collection) {
    return `<div class="form-actions">
      <button type="button" class="btn btn-ghost" onclick="AdminModule.closeModal('${collection}')">Cancelar</button>
      <button type="submit" class="btn btn-primary">💾 Guardar</button>
    </div>`;
  }

  function _saveItem(collection, id, form) {
    const fd   = new FormData(form);
    const data = {};
    const areaValues = [];

    for (const [k, v] of fd.entries()) {
      if (k === 'areas') { areaValues.push(v); }
      else { data[k] = v; }
    }
    if (areaValues.length > 0) data.areas = areaValues;
    else if (form.querySelector('[name="areas"]')) data.areas = []; // unchecked = all

    // Checkbox: active
    data.active = !!form.querySelector('[name="active"]')?.checked;

    if (id) {
      if (!data.password) delete data.password; // don't overwrite with empty
      DataService.update(collection, id, data);
    } else {
      DataService.create(collection, data);
    }

    closeModal(collection);
    NotificationService.showToast('Guardado ✅', '', 'success');
    _renderTab(activeTab);
  }

  function closeModal(collection) {
    const modal = document.getElementById(`modal_${collection}`);
    if (modal) modal.style.display = 'none';
  }

  function deleteItem(collection, id) {
    const item = DataService.getById(collection, id);
    const name = item?.name || id;
    if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;
    DataService.remove(collection, id);
    NotificationService.showToast('Eliminado', name, 'info');
    _renderTab(activeTab);
  }

  return {
    render, switchTab, openModal, closeModal, deleteItem,
    saveConfig, requestPush, flushQueue, resetDemo,
  };
})();
