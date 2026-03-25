/**
 * MaintControl - Kanban Module
 * Vista de tablero para paradas activas y seguimiento en tiempo real.
 */

window.KanbanModule = (() => {
  let refreshTimer = null;
  let dragSrc = null;

  function render(container) {
    container.innerHTML = `
      <div class="module-header">
        <h2><span class="icon">🗂️</span> Tablero de Paradas</h2>
        <div class="header-actions">
          <select id="kbArea" class="input-sm" onchange="KanbanModule.refresh()">
            <option value="">Todas las áreas</option>
            ${DataService.getAll('areas').filter(a => AuthService.canAccessArea(a.id))
              .map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
          </select>
          ${AuthService.can('createStopage') ? `<button class="btn btn-primary btn-sm" onclick="StopagesModule.openForm()">+ Nueva Parada</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="KanbanModule.refresh()">↻</button>
        </div>
      </div>

      <div class="kanban-legend">
        <span class="legend-dot" style="background:#ef4444"></span> Pendiente
        <span class="legend-dot" style="background:#f59e0b"></span> En Proceso
        <span class="legend-dot" style="background:#10b981"></span> Finalizado
        <span class="legend-sep">|</span>
        <span style="font-size:12px;color:var(--text-muted)">Arrastra tarjetas para cambiar estado</span>
      </div>

      <div class="kanban-board" id="kanbanBoard"></div>

      <!-- Stopage form modal (re-use StopagesModule) -->
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

    refresh();
    startAutoRefresh();
  }

  function refresh() {
    const areaId = document.getElementById('kbArea')?.value || '';
    const filters = {};
    if (areaId) filters.areaId = areaId;
    const stopages = DataService.getStopages(filters);

    const columns = [
      { status: 'pendiente',  label: '🔴 Pendiente',  color: '#ef4444', items: [] },
      { status: 'en_proceso', label: '🟡 En Proceso',  color: '#f59e0b', items: [] },
      { status: 'finalizado', label: '🟢 Finalizado',  color: '#10b981', items: [] },
    ];

    stopages.forEach(s => {
      const col = columns.find(c => c.status === s.status);
      if (col) col.items.push(s);
    });

    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    board.innerHTML = columns.map(col => `
      <div class="kanban-col" data-status="${col.status}"
           ondragover="KanbanModule.onDragOver(event)"
           ondrop="KanbanModule.onDrop(event,'${col.status}')">
        <div class="kanban-col-header" style="border-top-color:${col.color}">
          <span>${col.label}</span>
          <span class="count-badge" style="background:${col.color}22;color:${col.color};border-color:${col.color}44">${col.items.length}</span>
        </div>
        <div class="kanban-col-body" id="col_${col.status}">
          ${col.items.map(s => renderCard(s, col.color)).join('')}
          ${!col.items.length ? `<div class="kanban-empty">Sin paradas</div>` : ''}
        </div>
      </div>
    `).join('');
  }

  function renderCard(s, color) {
    const machine = DataService.getById('machines', s.machineId);
    const area = DataService.getById('areas', s.areaId);
    const subarea = DataService.getById('subareas', s.subareaId);
    const reason = DataService.getById('stopReasons', s.reasonId);
    const responsible = DataService.getById('users', s.responsibleId);

    const now = new Date();
    const elapsed = s.startAt ? Math.round((now - new Date(s.startAt)) / 60000) : 0;
    const alertConfig = DataService.getAll('alertConfig')[0] || { prolongedStopMinutes: 60 };
    const isProlonged = s.status !== 'finalizado' && elapsed >= alertConfig.prolongedStopMinutes;
    const dur = s.duration != null
      ? `${Math.floor(s.duration / 60)}h ${s.duration % 60}m`
      : `${Math.floor(elapsed / 60)}h ${elapsed % 60}m ⏳`;

    const canDrag = AuthService.can('changeStatus');

    return `
      <div class="kanban-card ${isProlonged ? 'card-alert' : ''}"
           draggable="${canDrag}"
           data-id="${s.id}"
           ondragstart="KanbanModule.onDragStart(event,'${s.id}')"
           onclick="KanbanModule.openDetail('${s.id}')">
        ${isProlonged ? '<div class="card-alarm-badge">⚠️ PROLONGADA</div>' : ''}
        <div class="card-machine">
          <span class="card-machine-name">${machine?.name || '—'}</span>
          <span class="card-machine-code">${machine?.code || ''}</span>
        </div>
        <div class="card-area">${area?.name || '—'} › ${subarea?.name || '—'}</div>
        <div class="card-reason">${reason?.name || '—'}${s.reasonFree ? ` · ${s.reasonFree}` : ''}</div>
        <div class="card-footer">
          <div class="card-time">
            <span class="card-dur" style="color:${isProlonged ? '#ef4444' : color}">${dur}</span>
            <span class="card-date">${new Date(s.startAt).toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'})}</span>
          </div>
          <div class="card-responsible">
            <div class="card-avatar">${responsible?.name?.[0] || '?'}</div>
            <span>${responsible?.name || '—'}</span>
          </div>
        </div>
        ${canDrag ? `
          <div class="card-actions">
            ${s.status !== 'pendiente' ? `<button class="card-btn" onclick="event.stopPropagation();KanbanModule.moveCard('${s.id}','pendiente')" title="Mover a Pendiente">◀</button>` : ''}
            ${s.status !== 'en_proceso' ? `<button class="card-btn" onclick="event.stopPropagation();KanbanModule.moveCard('${s.id}','en_proceso')" title="En Proceso">▶</button>` : ''}
            ${s.status !== 'finalizado' ? `<button class="card-btn card-btn-green" onclick="event.stopPropagation();KanbanModule.moveCard('${s.id}','finalizado')" title="Finalizar">✓</button>` : ''}
          </div>` : ''}
      </div>
    `;
  }

  function openDetail(id) {
    if (AuthService.can('editStopage')) {
      StopagesModule.openForm(id);
    }
  }

  function moveCard(id, newStatus) {
    if (!AuthService.can('changeStatus')) return;
    const updates = { status: newStatus };
    if (newStatus === 'finalizado') {
      const s = DataService.getById('stopages', id);
      if (s && !s.endAt) {
        updates.endAt = new Date().toISOString().slice(0, 16);
        updates.duration = DataService.calcDuration(s.startAt, updates.endAt);
      }
    }
    DataService.update('stopages', id, updates);
    NotificationService.showToast('Estado actualizado', `Parada movida a: ${newStatus}`, 'success');
    refresh();
    window.dispatchEvent(new CustomEvent('data-changed'));
  }

  // ─── Drag & Drop ──────────────────────────────────────────────────────
  function onDragStart(e, id) {
    dragSrc = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    e.currentTarget.classList.add('dragging');
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const col = e.currentTarget;
    col.classList.add('drag-over');
    setTimeout(() => col.classList.remove('drag-over'), 200);
  }

  function onDrop(e, newStatus) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragSrc;
    if (!id) return;
    const s = DataService.getById('stopages', id);
    if (!s || s.status === newStatus) return;
    moveCard(id, newStatus);
    dragSrc = null;
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 30000);
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
  }

  return { render, refresh, moveCard, openDetail, onDragStart, onDragOver, onDrop, destroy };
})();
