/* =========================================================
   MATEMETAL QR · Application Logic (Demo Sandbox)
   ========================================================= */
(() => {
  // 1. ICONOS SVG (coinciden con data-icon del HTML)
  const ICONS = {
    'layout-dashboard': '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    'building-2': '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    'radio-tower': '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    'receipt-text': '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>',
    'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    'map-pinned': '<path d="M18 8c0 4.5-6 9-6 9s-6-4.5-6-9a6 6 0 0 1 12 0"/><circle cx="12" cy="8" r="2"/><path d="M8.835 14H5a1 1 0 0 0-.9.7l-2 6c-.1.1-.1.2-.1.3 0 .6.4 1 1 1h18c.6 0 1-.4 1-1 0-.1 0-.2-.1-.3l-2-6a1 1 0 0 0-.9-.7h-3.835"/>',
    'chart-column-increasing': '<path d="M13 17V9"/><path d="M18 17V5"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-3"/>',
    'settings-2': '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    'menu': '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
    'sun-moon': '<path d="M12 8a2.83 2.83 0 0 0 4 4 4 4 0 1 1-4-4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>'
  };

  function renderIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      const name = el.getAttribute('data-icon');
      if (ICONS[name]) {
        el.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
      }
    });
  }

  // 2. DATOS DE DEMOSTRACIÓN
  const state = {
    page: 'dashboard',
    establishments: [
      { id: 'EST-01', name: 'Estación de Servicio Ruta 14', city: 'San Vicente, Misiones', devices: 2, revenue: 148500, x: 34, y: 42 },
      { id: 'EST-02', name: 'Lavadero Autoservicio Centro', city: 'Posadas, Misiones', devices: 2, revenue: 214000, x: 64, y: 65 },
      { id: 'EST-03', name: 'Complejo Deportivo Norte', city: 'Oberá, Misiones', devices: 1, revenue: 76200, x: 52, y: 28 }
    ],
    devices: [
      { id: 'mtml-26oc-0001', name: 'Dispenser Agua Caliente #1', est: 'Estación de Servicio Ruta 14', status: 'online', monto: 500, tiempo: 12, firmware: 'v2.4.1', rssi: '-58 dBm' },
      { id: 'mtml-26oc-0002', name: 'Inflador Neumáticos QR', est: 'Estación de Servicio Ruta 14', status: 'online', monto: 800, tiempo: 45, firmware: 'v2.4.1', rssi: '-63 dBm' },
      { id: 'mtml-26oc-0003', name: 'Hidrolavadora Box 1', est: 'Lavadero Autoservicio Centro', status: 'online', monto: 1500, tiempo: 180, firmware: 'v2.4.0', rssi: '-52 dBm' },
      { id: 'mtml-26oc-0004', name: 'Aspiradora Industrial Box 2', est: 'Lavadero Autoservicio Centro', status: 'warning', monto: 1000, tiempo: 120, firmware: 'v2.3.8', rssi: '-79 dBm' },
      { id: 'mtml-26oc-0005', name: 'Dispenser Bebidas Isotónicas', est: 'Complejo Deportivo Norte', status: 'offline', monto: 1200, tiempo: 8, firmware: 'v2.3.5', rssi: 'Sin señal' }
    ],
    transactions: [
      { id: 'MP-9948102', time: 'Hoy 08:14', device: 'mtml-26oc-0003', est: 'Lavadero Autoservicio Centro', amount: 1500, seconds: 180, status: 'Aprobado' },
      { id: 'MP-9948089', time: 'Hoy 08:02', device: 'mtml-26oc-0001', est: 'Estación de Servicio Ruta 14', amount: 500, seconds: 12, status: 'Aprobado' },
      { id: 'MP-9947954', time: 'Hoy 07:45', device: 'mtml-26oc-0002', est: 'Estación de Servicio Ruta 14', amount: 800, seconds: 45, status: 'Aprobado' },
      { id: 'MP-9947811', time: 'Ayer 22:31', device: 'mtml-26oc-0004', est: 'Lavadero Autoservicio Centro', amount: 1000, seconds: 120, status: 'Aprobado' },
      { id: 'MP-9947600', time: 'Ayer 21:10', device: 'mtml-26oc-0001', est: 'Estación de Servicio Ruta 14', amount: 500, seconds: 12, status: 'Rechazado' }
    ],
    logs: [
      { time: '08:14:09', device: 'mtml-26oc-0003', type: 'PAGO', detail: 'Webhook MP aprobado ($1.500). Relé activado 180s.' },
      { time: '08:02:41', device: 'mtml-26oc-0001', type: 'PAGO', detail: 'Webhook MP aprobado ($500). Relé activado 12s.' },
      { time: '07:50:00', device: 'mtml-26oc-0004', type: 'ALERTA', detail: 'Señal Wi-Fi débil (-79 dBm) detectada en ESP32-2432S028.' },
      { time: '06:15:22', device: 'mtml-26oc-0005', type: 'OFFLINE', detail: 'Equipo sin heartbeat desde hace 2 horas.' }
    ],
    notifications: [
      { id: 1, title: 'Terminal desconectada', body: 'mtml-26oc-0005 (Complejo Deportivo Norte) no responde pings.', level: 'danger', unread: true },
      { id: 2, title: 'Señal Wi-Fi baja', body: 'mtml-26oc-0004 reporta -79 dBm. Revisar repetidor.', level: 'warning', unread: true },
      { id: 3, title: 'Liquidación Mercado Pago', body: 'Se acreditaron $42.300 en tu cuenta vinculada.', level: 'success', unread: false }
    ],
    weeklyRevenue: [
      { day: 'Lun', val: 48500 },
      { day: 'Mar', val: 56200 },
      { day: 'Mié', val: 51900 },
      { day: 'Jue', val: 68400 },
      { day: 'Vie', val: 79100 },
      { day: 'Sáb', val: 92300 },
      { day: 'Dom', val: 42300 }
    ]
  };

  const PAGE_TITLES = {
    dashboard: 'Inicio',
    establishments: 'Establecimientos',
    devices: 'Dispositivos',
    history: 'Historial de dispositivos',
    transactions: 'Transacciones',
    notifications: 'Notificaciones',
    map: 'Ubicaciones',
    reports: 'Informes',
    settings: 'Ajustes'
  };

  const formatARS = (n) => '$' + Number(n).toLocaleString('es-AR');

  function toast(msg) {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.getElementById('toastRoot').appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  function statusBadge(st) {
    if (st === 'online' || st === 'Aprobado') return `<span class="badge badge-success"><span class="badge-dot"></span>${st === 'online' ? 'En línea' : st}</span>`;
    if (st === 'warning') return `<span class="badge badge-warning"><span class="badge-dot"></span>Señal débil</span>`;
    return `<span class="badge badge-danger"><span class="badge-dot"></span>${st === 'offline' ? 'Sin conexión' : st}</span>`;
  }

  // 3. SIMULADOR DE COBRO EN VIVO (MODO DEMO)
  function simulatePayment() {
    const onlineDevs = state.devices.filter(d => d.status === 'online');
    const dev = onlineDevs[Math.floor(Math.random() * onlineDevs.length)];
    const txId = 'MP-' + Math.floor(1000000 + Math.random() * 8999999);
    const now = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    state.transactions.unshift({
      id: txId,
      time: 'Ahora ' + now,
      device: dev.id,
      est: dev.est,
      amount: dev.monto,
      seconds: dev.tiempo,
      status: 'Aprobado'
    });
    state.logs.unshift({
      time: now + ':00',
      device: dev.id,
      type: 'PAGO',
      detail: `Simulación QR aprobada (${formatARS(dev.monto)}). Pulso de ${dev.tiempo}s enviado.`
    });
    state.weeklyRevenue[state.weeklyRevenue.length - 1].val += dev.monto;
    toast(`Pago simulado ${formatARS(dev.monto)} en ${dev.id}`);
    renderPage();
  }

  // 4. MODAL DE EDICIÓN DE PARÁMETROS ESP32
  function openDeviceModal(deviceId) {
    const dev = state.devices.find(d => d.id === deviceId);
    if (!dev) return;
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal-box" role="dialog" aria-modal="true">
          <div class="modal-head">
            <strong>Configurar ${dev.id}</strong>
            <button class="icon-button" id="closeModal" type="button">✕</button>
          </div>
          <div class="modal-body">
            <div class="field">
              <label>Nombre descriptivo</label>
              <input class="input" id="mName" value="${dev.name}"/>
            </div>
            <div class="field">
              <label>Monto por operación ($ ARS)</label>
              <input class="input mono" id="mMonto" type="number" min="1" value="${dev.monto}"/>
            </div>
            <div class="field">
              <label>Tiempo de activación de salida (segundos)</label>
              <input class="input mono" id="mTiempo" type="number" min="1" value="${dev.tiempo}"/>
            </div>
          </div>
          <div class="modal-foot">
          Cancelar
Guardar cambios


`;
const close = () => { root.innerHTML = ''; };
document.getElementById('closeModal').onclick = close;
document.getElementById('cancelModal').onclick = close;
document.getElementById('modalBackdrop').onclick = (e) => { if (e.target.id === 'modalBackdrop') close(); };
document.getElementById('saveModal').onclick = () => {
dev.name = document.getElementById('mName').value.trim() || dev.name;
dev.monto = Math.max(1, Number(document.getElementById('mMonto').value) || dev.monto);
dev.tiempo = Math.max(1, Number(document.getElementById('mTiempo').value) || dev.tiempo);
state.logs.unshift({
time: new Date().toLocaleTimeString('es-AR'),
device: dev.id,
type: 'CONFIG',
detail: Parámetros actualizados: ${formatARS(dev.monto)} / ${dev.tiempo}s
});
close();
toast(Configuración guardada en ${dev.id});
renderPage();
};
}
// 5. RENDERIZADO DE VISTAS
function renderPage() {
const main = document.getElementById('main');
document.getElementById('breadcrumb').textContent = PAGE_TITLES[state.page] || 'Inicio';
const totalRev = state.weeklyRevenue.reduce((a, b) => a + b.val, 0);
const onlineCount = state.devices.filter(d => d.status === 'online').length;
const maxBar = Math.max(...state.weeklyRevenue.map(d => d.val), 1);
if (state.page === 'dashboard') {
main.innerHTML = `


Resumen operativo
Monitoreo centralizado de terminales QR ESP32 y acreditaciones en tiempo real.


+ Simular cobro QR
Gestionar dispositivos

Recaudación semanalMP Directo
${formatARS(totalRev)}
▲ +14,2% vs. semana anterior


Terminales activas
${onlineCount} / ${state.devices.length}
● ${state.devices.length - onlineCount} requieren atención


Operaciones hoy
${state.transactions.filter(t => t.status === 'Aprobado').length}
Tiempo medio de activación: 1,2s


Establecimientos
${state.establishments.length}
Misiones, Argentina

Ingresos últimos 7 días ($ ARS)
Actualizado en vivo



${state.weeklyRevenue.map(d =>  <div class="bar-col"> <span class="bar-val">${Math.round(d.val / 1000)}k</span> <div class="bar-fill" style="height:${Math.round((d.val / maxBar) * 125)}px" title="${formatARS(d.val)}"></div> <span class="bar-lbl">${d.day}</span> </div>).join('')}


Eventos recientes
Ver todo


${state.logs.slice(0, 4).map(l =>  <div style="border-left:3px solid var(--accent);padding-left:10px"> <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--text-muted)"> <strong class="mono" style="color:var(--text-primary)">${l.device}</strong> <span>${l.time}</span> </div> <div style="font-size:12.5px;color:var(--text-secondary);margin-top:2px">${l.detail}</div> </div>).join('')}


Últimas transacciones Mercado Pago
Historial completo

${state.transactions.slice(0, 5).map(t => `
`).join('')}

Operación	Fecha	Terminal	Establecimiento	Monto	Tiempo	Estado
${t.id}
	${t.time}	${t.device}	${t.est}	${formatARS(t.amount)}	${t.seconds}s	${statusBadge(t.status)}

; } else if (state.page === 'devices') { main.innerHTML = 


Dispositivos ESP32
Configurá tarifas por QR, tiempos de relé y verificá estado de conectividad.

+ Simular pago en terminal


${state.devices.map(d => `
`).join('')}

ID Hardware	Descripción	Establecimiento	Tarifa QR	Pulso	Señal	Estado	Acciones
${d.id}
	${d.name}	${d.est}	${formatARS(d.monto)}	${d.tiempo}s	${d.rssi}	${statusBadge(d.status)}	

; } else if (state.page === 'establishments') { main.innerHTML = 


Establecimientos
Puntos comerciales donde operan tus dispensers.



${state.establishments.map(e =>  <div class="kpi-card"> <div class="kpi-top"><span class="mono">${e.id}</span><span class="badge badge-info">${e.devices} equipos</span></div> <div style="font-size:16px;font-weight:700;margin:10px 0 4px">${e.name}</div> <div style="font-size:12.5px;color:var(--text-secondary);margin-bottom:12px">${e.city}</div> <div style="border-top:1px solid var(--border-subtle);padding-top:10px;display:flex;justify-content:space-between"> <span style="color:var(--text-muted);font-size:12px">Facturación mensual</span> <strong class="mono">${formatARS(e.revenue)}</strong> </div> </div>).join('')}
; } else if (state.page === 'history') { main.innerHTML = 

Historial de dispositivosBitácora técnica de eventos, webhooks y cambios de configuración.


${state.logs.map(l => `
`).join('')}

Hora	Dispositivo	Evento	Detalle técnico
${l.time}
	${l.device}	${l.type}	${l.detail}

; } else if (state.page === 'transactions') { main.innerHTML = 

TransaccionesPagos procesados mediante QR dinámico de Mercado Pago.
Exportar CSV


${state.transactions.map(t => `
`).join('')}

ID Pago	Fecha	Dispositivo	Establecimiento	Importe	Activación	Estado
${t.id}
	${t.time}	${t.device}	${t.est}	${formatARS(t.amount)}	${t.seconds}s	${statusBadge(t.status)}

; } else if (state.page === 'notifications') { main.innerHTML = 

NotificacionesAlertas de conectividad, mantenimiento y acreditaciones.
Marcar todas como leídas



${state.notifications.map(n =>  <div style="padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:${n.unread ? 'var(--bg-elevated)' : 'transparent'};display:flex;justify-content:space-between;align-items:center;gap:12px"> <div> <strong>${n.title}</strong> ${n.unread ? '<span class="badge badge-warning">Nueva</span>' : ''} <div style="color:var(--text-secondary);font-size:13px;margin-top:3px">${n.body}</div> </div> </div>).join('')}

; } else if (state.page === 'map') { main.innerHTML = 

UbicacionesDistribución geográfica de establecimientos activos.




${state.establishments.map(e =>  <button class="map-pin" style="left:${e.x}%;top:${e.y}%" type="button" onclick="alert('${e.name} — ${e.city} (${e.devices} equipos)')"> <span class="pin-pulse"></span> <span class="pin-label">${e.name}</span> </button>).join('')}


; } else if (state.page === 'reports') { main.innerHTML = 

Informes y rendimientoComparativa de recaudación por punto de venta.


Distribución por establecimiento

${state.establishments.map(e => {
const pct = Math.round((e.revenue / 438700) * 100);
return  <div> <div style="display:flex;justify-content:space-between;margin-bottom:6px"> <strong>${e.name}</strong> <span class="mono">${formatARS(e.revenue)} (${pct}%)</span> </div> <div style="height:10px;background:var(--bg-elevated);border-radius:999px;overflow:hidden"> <div style="width:${pct}%;height:100%;background:var(--accent)"></div> </div> </div>;
}).join('')}

; } else if (state.page === 'settings') { main.innerHTML = 

Ajustes del sistemaPreferencias de entorno y conexión con backend Punto Eléctrico.



Endpoint API Producción
Modo de ejecución
Ir al Panel Real con Mercado Pago →


`;
}
// Bindings dinámicos dentro de cada vista
const btnSim = document.getElementById('btnSimPay');
if (btnSim) btnSim.onclick = simulatePayment;
main.querySelectorAll('[data-goto]').forEach(b => {
b.onclick = () => navigateTo(b.getAttribute('data-goto'));
});
main.querySelectorAll('[data-edit-dev]').forEach(b => {
b.onclick = () => openDeviceModal(b.getAttribute('data-edit-dev'));
});
const btnCsv = document.getElementById('btnExportCsv');
if (btnCsv) {
btnCsv.onclick = () => {
const rows = [['ID', 'Fecha', 'Terminal', 'Establecimiento', 'Monto', 'Tiempo', 'Estado'],
...state.transactions.map(t => [t.id, t.time, t.device, t.est, t.amount, t.seconds, t.status])];
const csv = rows.map(r => r.join(',')).join('\n');
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
a.download = 'transacciones-matemetal-qr.csv';
a.click();
toast('Archivo CSV descargado');
};
}
const btnRead = document.getElementById('btnMarkRead');
if (btnRead) {
btnRead.onclick = () => {
state.notifications.forEach(n => { n.unread = false; });
toast('Notificaciones marcadas como leídas');
renderPage();
};
}
}
// 6. NAVEGACIÓN, TEMA Y MENÚ MÓVIL
function navigateTo(page) {
state.page = page;
document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
btn.classList.toggle('active', btn.getAttribute('data-page') === page);
});
document.getElementById('sidebar').classList.remove('open');
document.getElementById('mobileShade').classList.remove('open');
renderPage();
}
document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-page')));
});
document.getElementById('themeToggle').addEventListener('click', () => {
const html = document.documentElement;
const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
html.setAttribute('data-theme', next);
localStorage.setItem('mtml-theme', next);
});
const savedTheme = localStorage.getItem('mtml-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
const sidebar = document.getElementById('sidebar');
const shade = document.getElementById('mobileShade');
document.getElementById('menuToggle').addEventListener('click', () => {
sidebar.classList.toggle('open');
shade.classList.toggle('open');
});
shade.addEventListener('click', () => {
sidebar.classList.remove('open');
shade.classList.remove('open');
});
renderIcons();
renderPage();
})();
