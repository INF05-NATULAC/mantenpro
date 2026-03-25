/**
 * MaintControl - Reports Module
 * Análisis avanzado por periodos, KPIs de eficiencia, y exportación completa.
 */

window.ReportsModule = (() => {
  let charts = {};

  function render(container) {
    if (!AuthService.can('viewReports')) {
      container.innerHTML = '<div class="empty-state">🔒 No tienes permisos para ver reportes.</div>';
      return;
    }

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    container.innerHTML = `
      <div class="module-header">
        <h2><span class="icon">📈</span> Reportes y Análisis</h2>
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" onclick="ReportsModule.exportExcel()">📊 Exportar Excel</button>
          <button class="btn btn-ghost btn-sm" onclick="ReportsModule.exportPDF()">📄 Exportar PDF</button>
        </div>
      </div>

      <!-- Period Selector -->
      <div class="report-filters card">
        <div class="filter-row" style="align-items:flex-end;gap:16px;flex-wrap:wrap">
          <div class="form-group" style="min-width:130px">
            <label>Período</label>
            <select id="rPeriod" class="input-sm" onchange="ReportsModule.onPeriodChange()">
              <option value="month">Este mes</option>
              <option value="last_month">Mes anterior</option>
              <option value="quarter">Este trimestre</option>
              <option value="year">Este año</option>
              <option value="custom">Personalizado</option>
            </select>
          </div>
          <div class="form-group custom-range" style="display:none">
            <label>Desde</label>
            <input type="date" id="rFrom" class="input-sm" value="${firstDay}">
          </div>
          <div class="form-group custom-range" style="display:none">
            <label>Hasta</label>
            <input type="date" id="rTo" class="input-sm" value="${today}">
          </div>
          <div class="form-group" style="min-width:150px">
            <label>Área</label>
            <select id="rArea" class="input-sm">
              <option value="">Todas las áreas</option>
              ${DataService.getAll('areas').filter(a => AuthService.canAccessArea(a.id))
                .map(a => `<option value="${a.id}">${a.name}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary btn-sm" onclick="ReportsModule.generate()">🔍 Generar</button>
        </div>
      </div>

      <!-- Report Content (injected on generate) -->
      <div id="reportContent"></div>
    `;

    generate();
  }

  function onPeriodChange() {
    const period = document.getElementById('rPeriod')?.value;
    document.querySelectorAll('.custom-range').forEach(el => {
      el.style.display = period === 'custom' ? 'flex' : 'none';
    });
  }

  function getDateRange() {
    const period = document.getElementById('rPeriod')?.value || 'month';
    const now = new Date();
    let from, to = new Date();

    switch (period) {
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_month':
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'quarter':
        const q = Math.floor(now.getMonth() / 3);
        from = new Date(now.getFullYear(), q * 3, 1);
        break;
      case 'year':
        from = new Date(now.getFullYear(), 0, 1);
        break;
      case 'custom':
        from = new Date(document.getElementById('rFrom')?.value || now);
        to = new Date(document.getElementById('rTo')?.value || now);
        break;
      default:
        from = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    return {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0]
    };
  }

  function generate() {
    const { from, to } = getDateRange();
    const areaId = document.getElementById('rArea')?.value || '';
    const filters = { dateFrom: from, dateTo: to };
    if (areaId) filters.areaId = areaId;

    const stopages = DataService.getStopages(filters);
    const areas = DataService.getAll('areas');
    const machines = DataService.getAll('machines');
    const users = DataService.getAll('users');
    const reasons = DataService.getAll('stopReasons');

    // Compute analytics
    const analytics = computeAnalytics(stopages, areas, machines, users, reasons);

    renderReport(analytics, stopages, from, to);
  }

  function computeAnalytics(stopages, areas, machines, users, reasons) {
    const completed = stopages.filter(s => s.duration != null);
    const totalDur = stopages.reduce((a, s) => a + (s.duration || 0), 0);
    const avgDur = completed.length ? Math.round(totalDur / completed.length) : 0;

    // By reason category
    const byReason = {};
    reasons.forEach(r => { byReason[r.id] = { name: r.name, category: r.category, count: 0, duration: 0 }; });
    stopages.forEach(s => {
      if (byReason[s.reasonId]) {
        byReason[s.reasonId].count++;
        byReason[s.reasonId].duration += (s.duration || 0);
      }
    });

    // By responsible
    const byUser = {};
    users.forEach(u => { byUser[u.id] = { name: u.name, role: u.role, count: 0, duration: 0 }; });
    stopages.forEach(s => {
      if (byUser[s.responsibleId]) {
        byUser[s.responsibleId].count++;
        byUser[s.responsibleId].duration += (s.duration || 0);
      }
    });

    // By machine (top 10)
    const byMachine = {};
    machines.forEach(m => { byMachine[m.id] = { name: m.name, code: m.code, count: 0, duration: 0, mtbf: 0 }; });
    stopages.forEach(s => {
      if (byMachine[s.machineId]) {
        byMachine[s.machineId].count++;
        byMachine[s.machineId].duration += (s.duration || 0);
      }
    });

    // By area
    const byArea = {};
    areas.forEach(a => { byArea[a.id] = { name: a.name, count: 0, duration: 0 }; });
    stopages.forEach(s => {
      if (byArea[s.areaId]) { byArea[s.areaId].count++; byArea[s.areaId].duration += (s.duration || 0); }
    });

    // By hour of day
    const byHour = Array(24).fill(0);
    stopages.forEach(s => {
      if (s.startAt) {
        const h = new Date(s.startAt).getHours();
        byHour[h]++;
      }
    });

    // By weekday
    const byDay = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(d => ({ day: d, count: 0 }));
    stopages.forEach(s => {
      if (s.startAt) byDay[new Date(s.startAt).getDay()].count++;
    });

    // Weekly trend (last 8 weeks)
    const weeklyTrend = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const ws = weekStart.toISOString().split('T')[0];
      const we = weekEnd.toISOString().split('T')[0];
      const weekStops = stopages.filter(s => s.startAt >= ws && s.startAt <= we + 'T23:59');
      weeklyTrend.push({
        label: `S${8-i}`,
        count: weekStops.length,
        duration: weekStops.reduce((a, s) => a + (s.duration || 0), 0)
      });
    }

    // MTTR (Mean Time To Repair)
    const mttr = completed.length ? Math.round(totalDur / completed.length) : 0;

    // Availability estimation: assume 8h/day work shift
    // Downtime / (Downtime + Uptime) - simplified
    const daysInPeriod = Math.max(1, stopages.length > 0 ? 30 : 1);
    const plannedMinutes = daysInPeriod * 8 * 60;
    const availability = plannedMinutes > 0
      ? Math.max(0, Math.min(100, Math.round((1 - totalDur / plannedMinutes) * 100)))
      : 100;

    return {
      total: stopages.length,
      totalDur,
      avgDur,
      mttr,
      availability,
      byStatus: {
        pendiente: stopages.filter(s => s.status === 'pendiente').length,
        en_proceso: stopages.filter(s => s.status === 'en_proceso').length,
        finalizado: stopages.filter(s => s.status === 'finalizado').length,
      },
      byReason: Object.values(byReason).filter(r => r.count > 0).sort((a, b) => b.count - a.count),
      byUser: Object.values(byUser).filter(u => u.count > 0).sort((a, b) => b.count - a.count),
      byMachine: Object.values(byMachine).filter(m => m.count > 0).sort((a, b) => b.count - a.count).slice(0, 10),
      byArea: Object.values(byArea).filter(a => a.count > 0).sort((a, b) => b.count - a.count),
      byHour,
      byDay,
      weeklyTrend,
    };
  }

  function renderReport(analytics, stopages, from, to) {
    const content = document.getElementById('reportContent');
    if (!content) return;

    const h = m => { const hr = Math.floor(m / 60); const min = m % 60; return hr ? `${hr}h ${min}m` : `${m}m`; };

    content.innerHTML = `
      <!-- Summary KPIs -->
      <div class="kpi-grid" style="margin-top:20px">
        <div class="kpi-card" style="--kpi-color:#00d4ff">
          <div class="kpi-icon">🛑</div>
          <div class="kpi-value" style="color:#00d4ff">${analytics.total}</div>
          <div class="kpi-label">Total Paradas</div>
        </div>
        <div class="kpi-card" style="--kpi-color:#f59e0b">
          <div class="kpi-icon">⏱️</div>
          <div class="kpi-value" style="color:#f59e0b">${h(analytics.totalDur)}</div>
          <div class="kpi-label">Tiempo Total</div>
        </div>
        <div class="kpi-card" style="--kpi-color:#a855f7">
          <div class="kpi-icon">📊</div>
          <div class="kpi-value" style="color:#a855f7">${h(analytics.mttr)}</div>
          <div class="kpi-label">MTTR Promedio</div>
        </div>
        <div class="kpi-card" style="--kpi-color:${analytics.availability >= 85 ? '#10b981' : analytics.availability >= 70 ? '#f59e0b' : '#ef4444'}">
          <div class="kpi-icon">${analytics.availability >= 85 ? '🟢' : analytics.availability >= 70 ? '🟡' : '🔴'}</div>
          <div class="kpi-value" style="color:${analytics.availability >= 85 ? '#10b981' : analytics.availability >= 70 ? '#f59e0b' : '#ef4444'}">${analytics.availability}%</div>
          <div class="kpi-label">Disponibilidad Est.</div>
        </div>
        <div class="kpi-card" style="--kpi-color:#ef4444">
          <div class="kpi-icon">🔴</div>
          <div class="kpi-value" style="color:#ef4444">${analytics.byStatus.pendiente}</div>
          <div class="kpi-label">Pendientes</div>
        </div>
        <div class="kpi-card" style="--kpi-color:#10b981">
          <div class="kpi-icon">✅</div>
          <div class="kpi-value" style="color:#10b981">${analytics.byStatus.finalizado}</div>
          <div class="kpi-label">Resueltas</div>
        </div>
      </div>

      <!-- Charts Row 1 -->
      <div class="charts-grid" style="margin-top:20px">
        <div class="chart-card wide">
          <h3>Tendencia Semanal</h3>
          <canvas id="rChartWeekly" height="180"></canvas>
        </div>
        <div class="chart-card">
          <h3>Paradas por Hora del Día</h3>
          <canvas id="rChartHour" height="220"></canvas>
        </div>
        <div class="chart-card">
          <h3>Paradas por Día de Semana</h3>
          <canvas id="rChartDay" height="220"></canvas>
        </div>
      </div>

      <!-- Tables -->
      <div class="reports-tables">
        <!-- By Reason -->
        <div class="card">
          <h3 style="margin-bottom:14px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px">Top Motivos de Parada</h3>
          <table class="data-table">
            <thead><tr><th>Motivo</th><th>Categoría</th><th>Paradas</th><th>Tiempo Total</th><th>% del Total</th></tr></thead>
            <tbody>
              ${analytics.byReason.slice(0, 8).map(r => `
                <tr>
                  <td><strong>${r.name}</strong></td>
                  <td><span class="badge badge-yellow">${r.category || '—'}</span></td>
                  <td>${r.count}</td>
                  <td class="mono">${h(r.duration)}</td>
                  <td>
                    <div class="progress-bar-wrap">
                      <div class="progress-bar" style="width:${analytics.total > 0 ? Math.round(r.count/analytics.total*100) : 0}%"></div>
                      <span>${analytics.total > 0 ? Math.round(r.count/analytics.total*100) : 0}%</span>
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>

        <!-- By Machine -->
        <div class="card">
          <h3 style="margin-bottom:14px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px">Top Máquinas Críticas</h3>
          <table class="data-table">
            <thead><tr><th>Máquina</th><th>Código</th><th>Paradas</th><th>Tiempo Total</th><th>Criticidad</th></tr></thead>
            <tbody>
              ${analytics.byMachine.slice(0, 8).map((m, i) => {
                const crit = i === 0 ? ['🔴','Crítica'] : i < 3 ? ['🟡','Alta'] : ['🟢','Normal'];
                return `<tr>
                  <td><strong>${m.name}</strong></td>
                  <td><code>${m.code || '—'}</code></td>
                  <td>${m.count}</td>
                  <td class="mono">${h(m.duration)}</td>
                  <td>${crit[0]} <span style="font-size:12px">${crit[1]}</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- By Responsible -->
        <div class="card">
          <h3 style="margin-bottom:14px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px">Actividad por Responsable</h3>
          <table class="data-table">
            <thead><tr><th>Responsable</th><th>Rol</th><th>Paradas Atendidas</th><th>Tiempo Total</th></tr></thead>
            <tbody>
              ${analytics.byUser.map(u => `
                <tr>
                  <td><strong>${u.name}</strong></td>
                  <td><span class="badge" style="font-size:10px">${AuthService.getRoleLabel(u.role)}</span></td>
                  <td>${u.count}</td>
                  <td class="mono">${h(u.duration)}</td>
                </tr>`).join('')}
              ${!analytics.byUser.length ? '<tr><td colspan="4" class="empty-cell">Sin datos</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        <!-- Pareto Analysis -->
        <div class="card">
          <h3 style="margin-bottom:14px;font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px">Análisis Pareto (Regla 80/20)</h3>
          <canvas id="rChartPareto" height="260"></canvas>
        </div>
      </div>

      <!-- Full Stopage Log -->
      <div class="card" style="margin-top:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="font-size:14px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px">Registro Completo del Período</h3>
          <span class="count-badge">${stopages.length} registros</span>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr><th>Fecha</th><th>Máquina</th><th>Área</th><th>Motivo</th><th>Estado</th><th>Duración</th><th>Responsable</th></tr>
            </thead>
            <tbody>
              ${stopages.slice(0, 50).map(s => {
                const m = DataService.getById('machines', s.machineId);
                const a = DataService.getById('areas', s.areaId);
                const r = DataService.getById('stopReasons', s.reasonId);
                const u = DataService.getById('users', s.responsibleId);
                const statusBadge = { pendiente: 'badge-red', en_proceso: 'badge-yellow', finalizado: 'badge-green' }[s.status] || '';
                const dur = s.duration != null ? h(s.duration) : '—';
                return `<tr>
                  <td>${new Date(s.startAt).toLocaleDateString('es-MX')}</td>
                  <td>${m?.name || '—'}</td>
                  <td>${a?.name || '—'}</td>
                  <td>${r?.name || '—'}</td>
                  <td><span class="badge ${statusBadge}">${s.status}</span></td>
                  <td class="mono">${dur}</td>
                  <td>${u?.name || '—'}</td>
                </tr>`;
              }).join('')}
              ${stopages.length > 50 ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:12px">... y ${stopages.length - 50} más. Exporta a Excel para ver todos.</td></tr>` : ''}
              ${!stopages.length ? '<tr><td colspan="7" class="empty-cell">No hay registros en este período</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;

    renderReportCharts(analytics);
  }

  function renderReportCharts(analytics) {
    const darkScale = {
      ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } },
      grid: { color: 'rgba(148,163,184,0.08)' }
    };

    Object.keys(charts).forEach(k => { if (charts[k]) { charts[k].destroy(); } });
    charts = {};

    // Weekly trend
    const wEl = document.getElementById('rChartWeekly');
    if (wEl && window.Chart) {
      charts.weekly = new Chart(wEl, {
        type: 'bar',
        data: {
          labels: analytics.weeklyTrend.map(w => w.label),
          datasets: [
            {
              label: 'Paradas',
              data: analytics.weeklyTrend.map(w => w.count),
              backgroundColor: 'rgba(0,212,255,0.6)',
              borderColor: '#00d4ff',
              borderWidth: 1,
              borderRadius: 4,
              yAxisID: 'y',
            },
            {
              label: 'Horas de parada',
              data: analytics.weeklyTrend.map(w => Math.round(w.duration / 60 * 10) / 10),
              type: 'line',
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.1)',
              tension: 0.4,
              pointRadius: 5,
              pointBackgroundColor: '#f59e0b',
              fill: true,
              yAxisID: 'y1',
            }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: {
            x: darkScale,
            y: { ...darkScale, title: { display: true, text: 'Paradas', color: '#94a3b8' } },
            y1: { ...darkScale, position: 'right', title: { display: true, text: 'Horas', color: '#94a3b8' } }
          }
        }
      });
    }

    // By hour heatmap-style
    const hEl = document.getElementById('rChartHour');
    if (hEl && window.Chart) {
      const max = Math.max(...analytics.byHour, 1);
      charts.hour = new Chart(hEl, {
        type: 'bar',
        data: {
          labels: analytics.byHour.map((_, i) => `${i}:00`),
          datasets: [{
            label: 'Paradas',
            data: analytics.byHour,
            backgroundColor: analytics.byHour.map(v => `rgba(0,212,255,${0.15 + (v/max)*0.75})`),
            borderColor: analytics.byHour.map(v => v === max ? '#00d4ff' : 'transparent'),
            borderWidth: 1,
            borderRadius: 2,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { x: { ...darkScale, ticks: { ...darkScale.ticks, maxRotation: 90 } }, y: darkScale }
        }
      });
    }

    // By weekday
    const dEl = document.getElementById('rChartDay');
    if (dEl && window.Chart) {
      charts.day = new Chart(dEl, {
        type: 'radar',
        data: {
          labels: analytics.byDay.map(d => d.day),
          datasets: [{
            label: 'Paradas',
            data: analytics.byDay.map(d => d.count),
            backgroundColor: 'rgba(0,212,255,0.15)',
            borderColor: '#00d4ff',
            pointBackgroundColor: '#00d4ff',
            pointRadius: 4,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            r: {
              ticks: { color: '#94a3b8', backdropColor: 'transparent' },
              grid: { color: 'rgba(148,163,184,0.15)' },
              pointLabels: { color: '#94a3b8', font: { size: 12 } }
            }
          }
        }
      });
    }

    // Pareto chart
    const pEl = document.getElementById('rChartPareto');
    if (pEl && window.Chart && analytics.byReason.length) {
      const reasons = analytics.byReason.slice(0, 8);
      const total = reasons.reduce((a, r) => a + r.count, 0);
      let cumulative = 0;
      const cumData = reasons.map(r => {
        cumulative += r.count;
        return Math.round(cumulative / total * 100);
      });

      charts.pareto = new Chart(pEl, {
        type: 'bar',
        data: {
          labels: reasons.map(r => r.name.length > 14 ? r.name.substr(0,14)+'…' : r.name),
          datasets: [
            {
              label: 'Frecuencia',
              data: reasons.map(r => r.count),
              backgroundColor: 'rgba(168,85,247,0.6)',
              borderColor: '#a855f7',
              borderWidth: 1,
              borderRadius: 4,
              yAxisID: 'y',
            },
            {
              label: '% Acumulado',
              type: 'line',
              data: cumData,
              borderColor: '#f59e0b',
              pointBackgroundColor: '#f59e0b',
              pointRadius: 5,
              tension: 0.1,
              yAxisID: 'y1',
            }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: {
            x: darkScale,
            y: { ...darkScale, title: { display: true, text: 'Frecuencia', color: '#94a3b8' } },
            y1: { ...darkScale, position: 'right', max: 100, title: { display: true, text: '% Acum.', color: '#94a3b8' } }
          }
        }
      });
    }
  }

  function exportExcel() {
    if (!window.XLSX) { NotificationService.showToast('Error', 'Librería no disponible', 'error'); return; }
    const { from, to } = getDateRange();
    const areaId = document.getElementById('rArea')?.value || '';
    const filters = { dateFrom: from, dateTo: to };
    if (areaId) filters.areaId = areaId;

    const stopages = DataService.getStopages(filters);
    const h = m => m != null ? `${Math.floor(m/60)}h ${m%60}m` : '';

    const sheetData = stopages.map(s => ({
      'ID': s.id,
      'Fecha Inicio': s.startAt ? new Date(s.startAt).toLocaleString('es-MX') : '',
      'Fecha Fin': s.endAt ? new Date(s.endAt).toLocaleString('es-MX') : '',
      'Duración (min)': s.duration ?? '',
      'Duración (h:m)': h(s.duration),
      'Estado': s.status,
      'Área': DataService.getById('areas', s.areaId)?.name || '',
      'Subárea': DataService.getById('subareas', s.subareaId)?.name || '',
      'Máquina': DataService.getById('machines', s.machineId)?.name || '',
      'Cód. Máquina': DataService.getById('machines', s.machineId)?.code || '',
      'Motivo': DataService.getById('stopReasons', s.reasonId)?.name || '',
      'Categoría': DataService.getById('stopReasons', s.reasonId)?.category || '',
      'Descripción': s.reasonFree || '',
      'Responsable': DataService.getById('users', s.responsibleId)?.name || '',
      'Notas': s.notes || '',
    }));

    const wb = XLSX.utils.book_new();

    // Sheet 1: Data
    const ws1 = XLSX.utils.json_to_sheet(sheetData);
    ws1['!cols'] = Object.keys(sheetData[0] || {}).map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Paradas');

    // Sheet 2: Summary by area
    const analytics = computeAnalytics(stopages,
      DataService.getAll('areas'), DataService.getAll('machines'),
      DataService.getAll('users'), DataService.getAll('stopReasons'));

    const areaSummary = analytics.byArea.map(a => ({
      'Área': a.name,
      'Total Paradas': a.count,
      'Tiempo Total (min)': a.duration,
      'Tiempo Total': h(a.duration),
    }));
    if (areaSummary.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(areaSummary), 'Por Área');
    }

    // Sheet 3: Reasons
    const reasonSummary = analytics.byReason.map(r => ({
      'Motivo': r.name,
      'Categoría': r.category,
      'Frecuencia': r.count,
      'Tiempo Total (min)': r.duration,
    }));
    if (reasonSummary.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reasonSummary), 'Por Motivo');
    }

    const filename = `reporte_paradas_${from}_${to}.xlsx`;
    XLSX.writeFile(wb, filename);
    NotificationService.showToast('Excel exportado', filename, 'success');
  }

  function exportPDF() {
    const { from, to } = getDateRange();
    const areaId = document.getElementById('rArea')?.value || '';
    const filters = { dateFrom: from, dateTo: to };
    if (areaId) filters.areaId = areaId;
    const stopages = DataService.getStopages(filters);
    const analytics = computeAnalytics(stopages,
      DataService.getAll('areas'), DataService.getAll('machines'),
      DataService.getAll('users'), DataService.getAll('stopReasons'));
    const h = m => m != null ? `${Math.floor(m/60)}h ${m%60}m` : '—';

    const printWin = window.open('', '_blank');
    printWin.document.write(`<!DOCTYPE html><html lang="es"><head>
      <meta charset="UTF-8">
      <title>Reporte MaintControl ${from} — ${to}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Segoe UI',sans-serif;font-size:12px;color:#1e293b;padding:30px}
        h1{font-size:22px;color:#0f172a;margin-bottom:4px}
        .subtitle{color:#64748b;margin-bottom:20px}
        .kpi-row{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}
        .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;min-width:120px}
        .kpi-val{font-size:22px;font-weight:700;color:#0ea5e9}
        .kpi-lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
        table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:11px}
        th{background:#0f172a;color:#fff;padding:8px 10px;text-align:left;font-weight:600}
        td{padding:7px 10px;border-bottom:1px solid #e2e8f0}
        tr:nth-child(even) td{background:#f8fafc}
        h2{font-size:14px;color:#0f172a;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #0ea5e9}
        .footer{margin-top:30px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px}
        @media print{body{padding:15px}}
      </style>
    </head><body>
      <h1>⚙ MaintControl — Reporte de Paradas</h1>
      <p class="subtitle">Período: ${from} al ${to} · Generado: ${new Date().toLocaleString('es-MX')}</p>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-val">${analytics.total}</div><div class="kpi-lbl">Total Paradas</div></div>
        <div class="kpi"><div class="kpi-val">${h(analytics.totalDur)}</div><div class="kpi-lbl">Tiempo Total</div></div>
        <div class="kpi"><div class="kpi-val">${h(analytics.mttr)}</div><div class="kpi-lbl">MTTR</div></div>
        <div class="kpi"><div class="kpi-val">${analytics.availability}%</div><div class="kpi-lbl">Disponibilidad Est.</div></div>
        <div class="kpi"><div class="kpi-val">${analytics.byStatus.pendiente}</div><div class="kpi-lbl">Pendientes</div></div>
        <div class="kpi"><div class="kpi-val">${analytics.byStatus.finalizado}</div><div class="kpi-lbl">Resueltas</div></div>
      </div>

      <h2>Top Motivos de Parada</h2>
      <table><thead><tr><th>Motivo</th><th>Cat.</th><th>Paradas</th><th>Tiempo</th><th>%</th></tr></thead><tbody>
        ${analytics.byReason.slice(0,8).map(r=>`<tr><td>${r.name}</td><td>${r.category||'—'}</td><td>${r.count}</td><td>${h(r.duration)}</td><td>${analytics.total>0?Math.round(r.count/analytics.total*100):0}%</td></tr>`).join('')}
      </tbody></table>

      <h2>Máquinas Críticas</h2>
      <table><thead><tr><th>Máquina</th><th>Código</th><th>Paradas</th><th>Tiempo Total</th></tr></thead><tbody>
        ${analytics.byMachine.slice(0,8).map(m=>`<tr><td>${m.name}</td><td>${m.code||'—'}</td><td>${m.count}</td><td>${h(m.duration)}</td></tr>`).join('')}
      </tbody></table>

      <h2>Registro del Período (${Math.min(stopages.length,100)} de ${stopages.length})</h2>
      <table><thead><tr><th>Fecha</th><th>Máquina</th><th>Área</th><th>Motivo</th><th>Estado</th><th>Duración</th><th>Responsable</th></tr></thead><tbody>
        ${stopages.slice(0,100).map(s=>{
          const m=DataService.getById('machines',s.machineId);
          const a=DataService.getById('areas',s.areaId);
          const r=DataService.getById('stopReasons',s.reasonId);
          const u=DataService.getById('users',s.responsibleId);
          return `<tr><td>${new Date(s.startAt).toLocaleDateString('es-MX')}</td><td>${m?.name||'—'}</td><td>${a?.name||'—'}</td><td>${r?.name||'—'}</td><td>${s.status}</td><td>${h(s.duration)}</td><td>${u?.name||'—'}</td></tr>`;
        }).join('')}
      </tbody></table>
      <div class="footer">MaintControl © ${new Date().getFullYear()} · Sistema de Gestión de Paradas Industriales</div>
    </body></html>`);
    printWin.document.close();
    setTimeout(() => printWin.print(), 500);
  }

  function destroy() {
    Object.values(charts).forEach(c => { if (c) c.destroy(); });
    charts = {};
  }

  return { render, generate, onPeriodChange, exportExcel, exportPDF, destroy };
})();
