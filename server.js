require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const Pusher = require('pusher');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // necesario para la autenticación de canales privados de Pusher

// ==========================================
// CONFIGURACIÓN
// ==========================================
const BASE_URL = 'https://puntoelectrico.ar';
const MP_REDIRECT_URI = `${BASE_URL}/api/auth/callback`; // Debe coincidir EXACTO con la Redirect URL cargada en Mercado Pago
const MP_API = 'https://api.mercadopago.com';
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.MERCADO_PAGO_CLIENT_SECRET;

// ==========================================
// CLIENTES DE INFRAESTRUCTURA (SUPABASE & PUSHER)
// ==========================================
// El backend usa la SERVICE ROLE key (nunca en el frontend).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// Archivos estáticos
app.use('/paneldecontrol', express.static(path.join(__dirname, 'public')));
app.get('/paneldecontrol', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));

// ==========================================
// UTILIDADES
// ==========================================
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function hashesIguales(hashA, hashB) {
  if (!hashA || !hashB) return false;
  const a = Buffer.from(hashA);
  const b = Buffer.from(hashB);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Límite simple de intentos en memoria (anti fuerza bruta del código de vinculación)
const intentos = new Map();
function permitirIntento(clave, max = 5, ventanaMs = 10 * 60 * 1000) {
  const ahora = Date.now();
  const lista = (intentos.get(clave) || []).filter(t => ahora - t < ventanaMs);
  if (lista.length >= max) { intentos.set(clave, lista); return false; }
  lista.push(ahora);
  intentos.set(clave, lista);
  return true;
}

// Middleware: verifica el JWT de Supabase (Google o email/contraseña)
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No autorizado' });

  const token = authHeader.split(' ')[1];
  const { data: { user } = {}, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('[AUTH] Sesión inválida. Motivo:', error ? error.message : 'sin usuario', '| SUPABASE_URL:', process.env.SUPABASE_URL);
    return res.status(401).json({ error: 'Sesión inválida' });
  }
  req.user = user;
  next();
}

// Logs en tiempo real: cada usuario recibe SOLO los de sus equipos (canal privado)
function emitirLog(usuarioId, origen, mensaje) {
  if (!usuarioId) return;
  pusher.trigger(`private-user-${usuarioId}`, 'nuevo-evento', {
    timestamp: new Date().toLocaleTimeString('es-AR'),
    origen,
    mensaje
  }).catch(err => console.error('Error en Pusher logs:', err));
}

// State firmado para OAuth de Mercado Pago
function firmarState(userId) {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verificarState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) return null;
  const esperado = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.u || data.e < Date.now()) return null;
    return data.u;
  } catch {
    return null;
  }
}

// Asegura que exista la fila del usuario (primer login con Google o email)
async function asegurarUsuario(user) {
  await supabase
    .from('usuarios')
    .upsert({ id: user.id, email: user.email }, { onConflict: 'id', ignoreDuplicates: true });
}

// ==========================================
// ESP32: GENERACIÓN DE QR (autenticado con el secreto del equipo)
// ==========================================
app.post('/paneldecontrol/api/crear-qr', async (req, res) => {
  const { deviceId } = req.body;
  const secreto = req.headers['x-device-secret'];

  try {
    const { data: device, error: devErr } = await supabase
      .from('dispositivos')
      .select('*, usuarios(*)')
      .eq('device_id', deviceId)
      .single();

    if (devErr || !device || !hashesIguales(device.device_secret_hash, sha256(secreto || ''))) {
      return res.status(401).json({ error: 'Dispositivo no autorizado', code: 'NO_AUTORIZADO' });
    }

    if (!device.usuario_id) {
      return res.status(400).json({ error: 'El equipo todavía no fue vinculado a una cuenta', code: 'SIN_DUENO' });
    }

    const tokenCliente = device.usuarios?.mp_access_token;
    if (!tokenCliente) {
      emitirLog(device.usuario_id, deviceId, 'Fallo: Mercado Pago no está vinculado');
      return res.status(400).json({ error: 'El dueño del equipo no configuró Mercado Pago', code: 'SIN_MP' });
    }

    emitirLog(device.usuario_id, deviceId, `Solicitó QR. Monto: $${device.monto}`);

    const mpResponse = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenCliente}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        external_reference: deviceId,
        notification_url: `${BASE_URL}/api/webhook?device=${encodeURIComponent(deviceId)}`,
        items: [{
          title: `Vending Dispenser ${deviceId}`,
          description: `Servicio de Vending mtml por tiempo: ${device.tiempo}s`,
          quantity: 1,
          unit_price: Number(device.monto),
          currency_id: 'ARS'
        }]
      })
    });

    const mpData = await mpResponse.json();
    if (!mpResponse.ok) throw new Error(mpData.message || 'Error al crear preferencia en MP');

    res.json({ success: true, qr_data: mpData.init_point });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// WEBHOOK DE MERCADO PAGO
// ==========================================
const pagosProcesados = new Set(); // para algo más robusto, guardalos en una tabla

app.post('/api/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const type = req.body?.type || req.query.type || req.query.topic;
    const paymentId = req.body?.data?.id || req.query['data.id'];
    const deviceId = req.query.device;

    if (type !== 'payment' || !paymentId || !deviceId) return;
    if (pagosProcesados.has(String(paymentId))) return;

    const { data: device } = await supabase
      .from('dispositivos')
      .select('device_id, usuario_id, tiempo, usuarios(mp_access_token)')
      .eq('device_id', deviceId)
      .single();

    const tokenVendedor = device?.usuarios?.mp_access_token;
    if (!tokenVendedor) return;

    // El pago pertenece al vendedor: se consulta con SU token
    const paymentResponse = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { 'Authorization': `Bearer ${tokenVendedor}` }
    });
    const pagoInfo = await paymentResponse.json();
    if (!paymentResponse.ok) return;
    if (pagoInfo.external_reference !== deviceId) return;

    emitirLog(device.usuario_id, 'MP_WEBHOOK', `Pago ${paymentId} - ${deviceId} - Estado: ${pagoInfo.status}`);

    if (pagoInfo.status === 'approved') {
      pagosProcesados.add(String(paymentId));
      const tiempoActivacion = device.tiempo || 5;

      await pusher.trigger(`device-${deviceId}`, 'pago-aprobado', {
        status: 'approved',
        amount: pagoInfo.transaction_amount,
        tiempo: tiempoActivacion
      });
      emitirLog(device.usuario_id, 'SERVER', `Activación de ${tiempoActivacion}s enviada a ${deviceId}`);
    }
  } catch (error) {
    console.error('Error procesando Webhook:', error);
  }
});

// ==========================================
// OAUTH MERCADO PAGO: CALLBACK
// ==========================================
app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Faltan parámetros OAuth obligatorios.');

  const userId = verificarState(state);
  if (!userId) return res.status(400).send('State inválido o vencido. Volvé a intentar desde el panel.');

  try {
    const response = await fetch(`${MP_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_secret: process.env.MERCADO_PAGO_CLIENT_SECRET,
        client_id: process.env.MERCADO_PAGO_CLIENT_ID,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: MP_REDIRECT_URI
      })
    });

    const tokenData = await response.json();
    if (!response.ok || tokenData.error) {
      throw new Error(tokenData.message || 'Error en el intercambio de tokens');
    }

    const { error: dbErr } = await supabase
      .from('usuarios')
      .update({
        mp_access_token: tokenData.access_token,
        mp_refresh_token: tokenData.refresh_token,
        mp_user_id: String(tokenData.user_id)
      })
      .eq('id', userId);
    if (dbErr) throw new Error(dbErr.message);

    res.redirect('/paneldecontrol?mp_connected=true');

  } catch (error) {
    console.error('Error OAuth MP:', error);
    res.redirect('/paneldecontrol?error=mp_auth_failed');
  }
});

// ==========================================
// API PRIVADA DEL PANEL
// ==========================================

// Autoriza al navegador a suscribirse SOLO a su propio canal privado de logs
app.post('/paneldecontrol/api/pusher-auth', requireAuth, (req, res) => {
  const { socket_id, channel_name } = req.body;
  if (channel_name !== `private-user-${req.user.id}`) {
    return res.status(403).json({ error: 'Canal no permitido' });
  }
  res.send(pusher.authorizeChannel(socket_id, channel_name));
});

// Estado general: dispositivos vinculados, Mercado Pago y URL de autorización
app.get('/paneldecontrol/api/mis-datos', requireAuth, async (req, res) => {
  await asegurarUsuario(req.user);

  const { data: usuario } = await supabase
    .from('usuarios').select('mp_access_token').eq('id', req.user.id).maybeSingle();
  const { data: dispositivos } = await supabase
    .from('dispositivos').select('device_id, monto, tiempo').eq('usuario_id', req.user.id);

  const tieneDispositivos = (dispositivos || []).length > 0;
  const mpVinculado = !!usuario?.mp_access_token;

  // Paso 2: Mercado Pago solo se habilita cuando ya hay al menos un equipo vinculado
  let oauthUrl = null;
  if (tieneDispositivos && !mpVinculado) {
    oauthUrl = `https://auth.mercadopago.com.ar/authorization?client_id=${encodeURIComponent(process.env.MERCADO_PAGO_CLIENT_ID)}` +
      `&response_type=code&platform_id=mp` +
      `&state=${encodeURIComponent(firmarState(req.user.id))}` +
      `&redirect_uri=${encodeURIComponent(MP_REDIRECT_URI)}`;
  }

  res.json({
    user_id: req.user.id,
    mp_vinculado: mpVinculado,
    mp_oauth_url: oauthUrl,
    dispositivos: dispositivos || []
  });
});

// Paso 1: vincular un ESP32 con su ID + código de vinculación
app.post('/paneldecontrol/api/vincular-dispositivo', requireAuth, async (req, res) => {
  const deviceId = String(req.body.deviceId || '').trim().toLowerCase();
  const codigo = String(req.body.codigo || '').trim().toUpperCase();

  if (!/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(deviceId)) {
    return res.status(400).json({ error: 'Formato de ID inválido. Debe ser xxxx-xxxx-xxxx' });
  }
  if (!codigo) return res.status(400).json({ error: 'Ingresá el código de vinculación' });

  if (!permitirIntento(`vincular:${req.user.id}`)) {
    return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
  }

  const errorGenerico = { error: 'ID o código de vinculación incorrecto, o el equipo ya está vinculado' };

  const { data: device } = await supabase
    .from('dispositivos')
    .select('device_id, usuario_id, codigo_vinculacion_hash')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (!device || device.usuario_id || !hashesIguales(device.codigo_vinculacion_hash, sha256(codigo))) {
    return res.status(400).json(errorGenerico);
  }

  await asegurarUsuario(req.user);

  const { data: actualizado, error } = await supabase
    .from('dispositivos')
    .update({ usuario_id: req.user.id, vinculado_en: new Date().toISOString() })
    .eq('device_id', deviceId)
    .is('usuario_id', null) // evita carreras: solo si sigue sin dueño
    .select('device_id');

  if (error || !actualizado || actualizado.length === 0) return res.status(400).json(errorGenerico);

  emitirLog(req.user.id, 'PANEL', `Equipo ${deviceId} vinculado a tu cuenta`);
  res.json({ success: true });
});

// Paso 3: monto y tiempo (solo si ya vinculó Mercado Pago)
app.post('/paneldecontrol/api/configurar-parametros', requireAuth, async (req, res) => {
  const { deviceId, monto, tiempo } = req.body;
  const montoNum = Number(monto);
  const tiempoNum = Number(tiempo);

  if (!Number.isFinite(montoNum) || montoNum <= 0 || !Number.isFinite(tiempoNum) || tiempoNum <= 0) {
    return res.status(400).json({ error: 'Monto y tiempo deben ser números mayores a 0' });
  }

  const { data: usuario } = await supabase
    .from('usuarios').select('mp_access_token').eq('id', req.user.id).maybeSingle();
  if (!usuario?.mp_access_token) {
    return res.status(403).json({ error: 'Primero vinculá tu cuenta de Mercado Pago' });
  }

  const { data: actualizado, error } = await supabase
    .from('dispositivos')
    .update({ monto: montoNum, tiempo: tiempoNum })
    .eq('device_id', deviceId)
    .eq('usuario_id', req.user.id)
    .select('device_id');

  if (error || !actualizado || actualizado.length === 0) {
    return res.status(400).json({ error: 'No se pudo actualizar el equipo' });
  }
  res.json({ success: true });
});

// ==========================================
// INICIALIZACIÓN
// ==========================================
// Chequeo de variables de entorno al arrancar
['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MERCADO_PAGO_CLIENT_ID', 'MERCADO_PAGO_CLIENT_SECRET', 'PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER']
  .forEach(v => { if (!process.env[v]) console.warn(`[CONFIG] Falta la variable de entorno ${v}`); });
console.log('[CONFIG] SUPABASE_URL =', process.env.SUPABASE_URL);

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] Multi-tenant operativo en puerto ${PORT}`));
