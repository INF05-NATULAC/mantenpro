/**
 * MaintControl — Main Application Shell
 * SPA router · PWA bootstrap · Permission-gated navigation
 */

window.App = (() => {
  let currentRoute  = null;
  let currentModule = null;
  let liveTimer     = null;

  const ROUTES = {
    dashboard: { label:'Dashboard',     icon:'📊', module:'DashboardModule', permission: null },
    kanban:    { label:'Tablero Kanban', icon:'🗂️', module:'KanbanModule',   permission: null },
    stopages:  { label:'Paradas',        icon:'🛑', module:'StopagesModule',  permission:'createStopage' },
    reports:   { label:'Reportes',       icon:'📈', module:'ReportsModule',   permission:'viewReports' },
    admin:     { label:'Administración', icon:'🔧', module:'AdminModule',     permission:'manageReasons' },
    profile:   { label:'Mi Perfil',      icon:'👤', module: null,             permission: null },
  };

  /* ─── Boot ─────────────────────────────────────────────────────────────── */
  function init() {
    DataService.init();
    AuthService.init();
    registerSW();

    window.addEventListener('online',       handleOnline);
    window.addEventListener('offline',      handleOffline);
    window.addEventListener('data-changed', () => updateNavBadges());
    window.addEventListener('hashchange',   handleHashChange);

    AuthService.isLoggedIn() ? renderShell() : renderLogin();
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller)
              NotificationService.showToast('Actualización disponible', 'Recarga para aplicar cambios', 'info', 12000);
          });
        });
      }).catch(e => console.warn('[SW]', e));

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SYNC_START')
        NotificationService.showToast('Sincronizando…', '', 'info');
    });
  }

  function handleOnline()  {
    updateConnStatus();
    NotificationService.showToast('Conexión restaurada ✅', 'Datos offline sincronizándose', 'success');
    DataService.flushOfflineQueue();
  }
  function handleOffline() {
    updateConnStatus();
    NotificationService.showToast('Sin conexión', 'Modo offline — datos guardados localmente', 'warning');
  }
  function handleHashChange() {
    const hash = window.location.hash.replace('#','').split('/')[0];
    if (hash && ROUTES[hash] && hash !== currentRoute) navigate(hash);
  }

  /* ─── Login ─────────────────────────────────────────────────────────────── */
  function renderLogin() {
    document.body.innerHTML = `
      <div class="login-screen">
        <div class="login-bg">
          <div class="login-orb lo1"></div>
          <div class="login-orb lo2"></div>
          <div class="login-grid-bg"></div>
        </div>
        <div class="login-card">
          <div class="login-logo">
            <div class="login-gear-wrap"><span class="login-gear">⚙</span></div>
            <h1>Maint<strong>Control</strong></h1>
            <p>Sistema de Gestión de Paradas Industriales</p>
          </div>

          <form id="loginForm">
            <div class="form-group">
              <label>Correo electrónico</label>
              <input type="email" id="loginEmail" class="input" placeholder="usuario@planta.com"
                required autocomplete="username">
            </div>
            <div class="form-group">
              <label>Contraseña</label>
              <div style="position:relative">
                <input type="password" id="loginPass" class="input" placeholder="••••••••"
                  required autocomplete="current-password" style="padding-right:44px">
                <button type="button" id="eyeBtn"
                  style="position:absolute;right:12px;top:50%;transform:translateY(-50%);
                         background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px">
                  👁
                </button>
              </div>
            </div>
            <div id="loginError" class="form-error" style="display:none"></div>
            <button type="submit" id="loginBtn" class="btn btn-primary btn-full" style="margin-top:4px;height:44px;font-size:15px">
              Iniciar Sesión →
            </button>
          </form>

          <div class="login-divider"><span>Acceso rápido (demo)</span></div>
          <div class="demo-chips">
            <button onclick="App.demoLogin('superadmin@plant.com')">👑 Super Admin</button>
            <button onclick="App.demoLogin('admin@plant.com')">🛡 Admin</button>
            <button onclick="App.demoLogin('supervisor@plant.com')">🔭 Supervisor</button>
            <button onclick="App.demoLogin('tecnico@plant.com')">🔧 Técnico</button>
          </div>
          <p style="text-align:center;font-size:11px;color:var(--text-muted);margin-top:8px">
            Contraseña demo: <code style="color:var(--accent)">admin123</code>
          </p>
        </div>
      </div>`;

    setTimeout(() => NotificationService.init(), 50);

    document.getElementById('eyeBtn').onclick = () => {
      const i = document.getElementById('loginPass');
      i.type = i.type === 'password' ? 'text' : 'password';
    };

    document.getElementById('loginForm').addEventListener('submit', e => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      btn.disabled = true; btn.textContent = 'Verificando…';
      setTimeout(() => {
        const res = AuthService.login(
          document.getElementById('loginEmail').value,
          document.getElementById('loginPass').value
        );
        if (res.success) { renderShell(); }
        else {
          const err = document.getElementById('loginError');
          err.textContent = res.error; err.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Iniciar Sesión →';
        }
      }, 250);
    });
  }

  function demoLogin(email) {
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPass').value  = 'admin123';
    document.getElementById('loginForm').dispatchEvent(new Event('submit'));
  }

  /* ─── Shell ─────────────────────────────────────────────────────────────── */
  function renderShell() {
    const user = AuthService.getUser();
    const rc   = AuthService.getRoleColor(user.role);

    const visibleRoutes = Object.entries(ROUTES).filter(([, r]) =>
      !r.permission || AuthService.can(r.permission)
    );

    document.body.innerHTML = `
      <div id="installBanner" class="install-banner" style="display:none">
        <span>📱 Instala MaintControl como app nativa</span>
        <button class="btn btn-sm btn-primary" id="installBtn">Instalar</button>
        <button class="btn btn-sm btn-ghost" onclick="this.parentElement.style.display='none'">✕</button>
      </div>

      <div id="toast-container"></div>

      <div class="app-shell">

        <!-- Sidebar overlay (mobile) -->
        <div class="sidebar-overlay" id="sidebarOverlay" onclick="App.toggleSidebar()"></div>

        <!-- Sidebar -->
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-header">
            <div class="app-brand">
              <span class="brand-gear">⚙</span>
              <span class="brand-name">Maint<strong>Control</strong></span>
            </div>
            <button class="sidebar-close-btn" onclick="App.toggleSidebar()">✕</button>
          </div>

          <nav class="sidebar-nav">
            ${visibleRoutes.map(([key, r]) => `
              <button class="nav-item" data-route="${key}" onclick="App.navigate('${key}')">
                <span class="nav-icon">${r.icon}</span>
                <span class="nav-label">${r.label}</span>
                <span class="nav-badge" id="badge_${key}" style="display:none"></span>
              </button>`).join('')}
          </nav>

          <div class="sidebar-footer">
            <button class="user-chip" onclick="App.navigate('profile')">
              <div class="user-av" style="background:${rc}22;border-color:${rc};color:${rc}">
                ${user.name[0].toUpperCase()}
              </div>
              <div class="user-text">
                <strong>${user.name}</strong>
                <span style="color:${rc}">${AuthService.getRoleLabel(user.role)}</span>
              </div>
            </button>
            <div id="connStatus" class="conn-status-pill"></div>
            <button class="btn btn-ghost btn-sm btn-full" style="margin-top:8px" onclick="App.logout()">
              ⏻ Cerrar sesión
            </button>
          </div>
        </aside>

        <!-- Main -->
        <div class="app-main">
          <header class="topbar">
            <button class="topbar-ham" onclick="App.toggleSidebar()">☰</button>
            <div class="topbar-brand">⚙ Maint<strong>Control</strong></div>
            <div class="topbar-actions">
              <span id="topbarConn" class="topbar-conn"></span>
              ${AuthService.can('createStopage') ? `
                <button class="btn btn-primary btn-sm" onclick="App.quickNewStop()">＋ Parada</button>
              ` : ''}
            </div>
          </header>
          <main class="content-wrap" id="contentArea"></main>
        </div>
      </div>`;

    NotificationService.init();
    setupPWAInstall();
    updateConnStatus();
    updateNavBadges();
    liveTimer = setInterval(tickLive, 30000);

    const hash = window.location.hash.replace('#','');
    navigate(hash && ROUTES[hash] ? hash : 'dashboard');
  }

  /* ─── Navigate ──────────────────────────────────────────────────────────── */
  function navigate(route, param = null) {
    if (!ROUTES[route]) return;
    const def = ROUTES[route];

    if (def.permission && !AuthService.can(def.permission)) {
      NotificationService.showToast('Acceso denegado', 'No tienes permiso para esta sección', 'error');
      return;
    }

    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.route === route)
    );

    if (window.innerWidth < 900) closeSidebar();

    try { if (currentModule && window[currentModule]?.destroy) window[currentModule].destroy(); } catch(e) {}

    currentRoute  = route;
    currentModule = def.module;

    const area = document.getElementById('contentArea');
    if (!area) return;

    area.style.cssText += 'opacity:0;transform:translateY(10px);transition:none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (route === 'profile') renderProfile(area);
        else if (def.module && window[def.module]) window[def.module].render(area, param);
        area.style.cssText += 'opacity:1;transform:translateY(0);transition:opacity .25s ease,transform .25s ease';
      });
    });

    window.history.replaceState(null,'','#' + route);
  }

  function quickNewStop() {
    navigate('stopages');
    setTimeout(() => StopagesModule.openForm(), 300);
  }

  /* ─── Profile ───────────────────────────────────────────────────────────── */
  function renderProfile(area) {
    const user = AuthService.getUser();
    const rc   = AuthService.getRoleColor(user.role);
    const areaNames = (user.areas?.length
      ? user.areas.map(id => DataService.getById('areas',id)?.name||id).join(', ')
      : 'Todas las áreas');
    const stops   = DataService.getStopages({ responsibleId: user.id });
    const done    = stops.filter(s => s.status==='finalizado').length;
    const active  = stops.filter(s => s.status==='en_proceso').length;
    const pending = stops.filter(s => s.status==='pendiente').length;

    const PERM_LABELS = {
      manageAreas:'Gestionar Áreas', manageSubareas:'Gestionar Subáreas',
      manageMachines:'Gestionar Máquinas', manageUsers:'Gestionar Usuarios',
      manageReasons:'Gestionar Motivos', manageAlerts:'Config. Alertas',
      createStopage:'Crear Paradas', editStopage:'Editar Paradas',
      deleteStopage:'Eliminar Paradas', editStartEndTime:'Editar Fechas',
      changeStatus:'Cambiar Estado', exportReports:'Exportar Datos',
      viewAllAreas:'Ver Todas las Áreas', viewDashboard:'Dashboard',
      viewReports:'Reportes Avanzados',
    };

    area.innerHTML = `
      <div class="module-header">
        <h2><span class="icon">👤</span> Mi Perfil</h2>
      </div>
      <div class="profile-grid">

        <!-- Left column -->
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card profile-hero-card">
            <div class="hero-av" style="background:${rc}18;border-color:${rc};color:${rc}">
              ${user.name[0].toUpperCase()}
            </div>
            <h3 class="hero-name">${user.name}</h3>
            <span class="badge" style="background:${rc}18;color:${rc};border-color:${rc}40;font-size:12px">
              ${AuthService.getRoleLabel(user.role)}
            </span>
            <div class="hero-stats">
              <div class="hero-stat"><strong>${stops.length}</strong><span>Total</span></div>
              <div class="hero-stat"><strong style="color:var(--red)">${pending}</strong><span>Pend.</span></div>
              <div class="hero-stat"><strong style="color:var(--yellow)">${active}</strong><span>Activas</span></div>
              <div class="hero-stat"><strong style="color:var(--green)">${done}</strong><span>Listas</span></div>
            </div>
            <div class="hero-info">
              <div class="hi-row"><span>✉</span><span>${user.email}</span></div>
              <div class="hi-row"><span>🏭</span><span>${areaNames}</span></div>
              <div class="hi-row"><span>📅</span><span>Miembro desde ${new Date(user.createdAt||'2024-01-01').toLocaleDateString('es-MX',{year:'numeric',month:'long'})}</span></div>
            </div>
          </div>

          <div class="card">
            <h3 style="font-size:13px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin-bottom:16px">🔑 Cambiar contraseña</h3>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div class="form-group">
                <label>Contraseña actual</label>
                <input type="password" id="pOld" class="input" placeholder="••••••••">
              </div>
              <div class="form-group">
                <label>Nueva contraseña</label>
                <input type="password" id="pNew" class="input" placeholder="Mínimo 6 caracteres">
              </div>
              <div class="form-group">
                <label>Confirmar nueva</label>
                <input type="password" id="pConfirm" class="input" placeholder="Repite la nueva">
              </div>
              <button class="btn btn-primary" onclick="App.changePassword()">💾 Actualizar</button>
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="card">
          <h3 style="font-size:13px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin-bottom:16px">🛡 Mis permisos</h3>
          <div class="perms-grid">
            ${Object.keys(AuthService.PERMISSIONS).map(p => {
              const ok = AuthService.can(p);
              return `<div class="perm-chip ${ok?'perm-ok':'perm-no'}">
                <span>${ok?'✓':'✕'}</span>
                <span>${PERM_LABELS[p]||p}</span>
              </div>`;
            }).join('')}
          </div>

          <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border)">
            <h3 style="font-size:13px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">📋 Mis últimas paradas</h3>
            ${stops.slice(0,5).map(s => {
              const m = DataService.getById('machines', s.machineId);
              const r = DataService.getById('stopReasons', s.reasonId);
              const sc = {pendiente:'badge-red',en_proceso:'badge-yellow',finalizado:'badge-green'}[s.status];
              return `<div class="stopage-row" onclick="App.navigate('stopages','edit:${s.id}')">
                <div class="stopage-info">
                  <strong>${m?.name||'—'}</strong>
                  <span>${r?.name||'—'}</span>
                </div>
                <div style="text-align:right">
                  <span class="badge ${sc}">${s.status}</span>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:3px">
                    ${new Date(s.startAt).toLocaleDateString('es-MX')}
                  </div>
                </div>
              </div>`;
            }).join('') || '<p style="color:var(--text-muted);font-size:13px">Sin paradas registradas</p>'}
          </div>
        </div>
      </div>`;
  }

  function changePassword() {
    const old  = document.getElementById('pOld')?.value;
    const neu  = document.getElementById('pNew')?.value;
    const conf = document.getElementById('pConfirm')?.value;
    const user = AuthService.getUser();
    const stored = DataService.getById('users', user.id);

    if (!stored || stored.password !== old) {
      return NotificationService.showToast('Error', 'La contraseña actual es incorrecta', 'error');
    }
    if (!neu || neu.length < 6) {
      return NotificationService.showToast('Error', 'Nueva contraseña: mínimo 6 caracteres', 'error');
    }
    if (neu !== conf) {
      return NotificationService.showToast('Error', 'Las contraseñas nuevas no coinciden', 'error');
    }
    DataService.update('users', user.id, { password: neu });
    ['pOld','pNew','pConfirm'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    NotificationService.showToast('Contraseña actualizada ✅', '', 'success');
  }

  /* ─── Sidebar ───────────────────────────────────────────────────────────── */
  function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebarOverlay');
    const isOpen = sb?.classList.toggle('open');
    ov?.classList.toggle('visible', !!isOpen);
  }
  function closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('visible');
  }

  /* ─── Status ────────────────────────────────────────────────────────────── */
  function updateConnStatus() {
    const online = navigator.onLine;
    const q = DataService.getAll('offlineQueue').length;
    const html = online
      ? `<span class="dot-online"></span> Online`
      : `<span class="dot-offline"></span> Offline${q ? ` (${q})` : ''}`;
    const cs = document.getElementById('connStatus');
    if (cs) cs.innerHTML = html;
    const tc = document.getElementById('topbarConn');
    if (tc) tc.innerHTML = online ? `<span class="dot-online"></span>` : `<span class="dot-offline"></span>`;
  }

  function updateNavBadges() {
    const stops = DataService.getAll('stopages');
    const inProg = stops.filter(s => s.status==='en_proceso').length;
    const notDone= stops.filter(s => s.status!=='finalizado').length;
    setBadge('stopages', inProg);
    setBadge('kanban',   notDone);
  }

  function setBadge(route, count) {
    const el = document.getElementById('badge_' + route);
    if (!el) return;
    el.textContent = count > 99 ? '99+' : count;
    el.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  function tickLive() {
    document.querySelectorAll('.live-dur').forEach(el => {
      const elapsed = Math.round((Date.now() - new Date(el.dataset.start)) / 60000);
      el.textContent = `${Math.floor(elapsed/60)}h ${elapsed%60}m ⏳`;
    });
  }

  /* ─── PWA install ───────────────────────────────────────────────────────── */
  function setupPWAInstall() {
    let prompt;
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); prompt = e;
      const b = document.getElementById('installBanner');
      if (b) b.style.display = 'flex';
      document.getElementById('installBtn')?.addEventListener('click', async () => {
        prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
          b.style.display = 'none';
          NotificationService.showToast('App instalada 🎉','','success');
        }
        prompt = null;
      });
    });
  }

  /* ─── Logout ────────────────────────────────────────────────────────────── */
  function logout() {
    try { if (currentModule && window[currentModule]?.destroy) window[currentModule].destroy(); } catch(e){}
    if (liveTimer) clearInterval(liveTimer);
    NotificationService.stopPolling();
    AuthService.logout();
    renderLogin();
  }

  return { init, navigate, toggleSidebar, logout, demoLogin, changePassword, quickNewStop };
})();

document.addEventListener('DOMContentLoaded', App.init);
