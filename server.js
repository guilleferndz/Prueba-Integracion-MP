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
// IMPORTANTE: el backend debe usar la SERVICE ROLE key (nunca en el frontend).
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

// Servir archivos estáticos bajo la subruta
app.use('/paneldecontrol', express.static(path.join(__dirname, 'public')));
app.get('/paneldecontrol', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));

// Middleware para verificar el token de Google (Supabase JWT)
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No autorizado' });

  const token = authHeader.split(' ')[1];
  const { data: { user } = {}, error } = await supabase.auth.getUser(token);

  if (error || !user) return res.status(401).json({ error: 'Sesión inválida' });
  req.user = user;
  next();
}

// Helper global para el flujo de logs en tiempo real en la interfaz
function emitirLog(origen, mensaje) {
  pusher.trigger('canal-monitoreo', 'nuevo-evento', {
    timestamp: new Date().toLocaleTimeString('es-AR'),
    origen,
    mensaje
  }).catch(err => console.error('Error en Pusher logs:', err));
}

// ==========================================
// STATE FIRMADO PARA OAUTH (evita que alguien vincule su cuenta MP a otro usuario)
// ==========================================
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

// ==========================================
// ENDPOINT: GENERACIÓN DINÁMICA DE QR (ORIGEN: ESP32)
// ==========================================
app.post('/paneldecontrol/api/crear-qr', async (req, res) => {
  const { deviceId } = req.body;

  try {
    const { data: device, error: devErr } = await supabase
      .from('dispositivos')
      .select('*, usuarios(*)')
      .eq('device_id', deviceId)
      .single();

    if (devErr || !device) {
      emitirLog('ERROR', `Hardware no vinculado: ${deviceId}`);
      return res.status(404).json({ error: 'Dispositivo no registrado o sin dueño' });
    }

    const tokenCliente = device.usuarios?.mp_access_token;
    if (!tokenCliente) {
      emitirLog(deviceId, 'Fallo: El dueño no vinculó Mercado Pago');
      return res.status(400).json({ error: 'El dueño del equipo no configuró Mercado Pago' });
    }

    emitirLog(deviceId, `Solicitó QR para Dispenser. Monto: $${device.monto}`);

    // Checkout Preferences: genera el link de pago (init_point)
    const mpResponse = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenCliente}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        external_reference: deviceId,
        // El deviceId va en la URL para saber con qué token consultar el pago después
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

    res.json({
      success: true,
      qr_data: mpData.init_point
    });

  } catch (error) {
    console.error(error);
    emitirLog('ERROR', `Fallo generación QR: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// WEBHOOK DE MERCADO PAGO
// ==========================================
// Evita activar dos veces con el mismo pago (se reinicia si el servidor se reinicia;
// para algo más robusto guardá los payment_id en una tabla de Supabase).
const pagosProcesados = new Set();

app.post('/api/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const type = req.body?.type || req.query.type || req.query.topic;
    const paymentId = req.body?.data?.id || req.query['data.id'];
    const deviceId = req.query.device;

    if (type !== 'payment' || !paymentId || !deviceId) return;
    if (pagosProcesados.has(String(paymentId))) return;

    // El pago pertenece a la cuenta del VENDEDOR, así que se consulta con SU token
    const { data: device } = await supabase
      .from('dispositivos')
      .select('device_id, tiempo, usuarios(mp_access_token)')
      .eq('device_id', deviceId)
      .single();

    const tokenVendedor = device?.usuarios?.mp_access_token;
    if (!tokenVendedor) return;

    const paymentResponse = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { 'Authorization': `Bearer ${tokenVendedor}` }
    });
    const pagoInfo = await paymentResponse.json();
    if (!paymentResponse.ok) return;

    // Verificaciones: el pago debe corresponder a este dispenser
    if (pagoInfo.external_reference !== deviceId) return;

    emitirLog('MP_WEBHOOK', `Pago ID ${paymentId} - Dispenser: ${deviceId} - Estado: ${pagoInfo.status}`);

    if (pagoInfo.status === 'approved') {
      pagosProcesados.add(String(paymentId));
      const tiempoActivacion = device.tiempo || 5;

      await pusher.trigger(`device-${deviceId}`, 'pago-aprobado', {
        status: 'approved',
        amount: pagoInfo.transaction_amount,
        tiempo: tiempoActivacion
      });
      emitirLog('SERVER', `Pulso de activación de ${tiempoActivacion}s enviado al hardware ${deviceId}`);
    }
  } catch (error) {
    console.error('Error procesando Webhook:', error);
  }
});

// ==========================================
// FLUJO OAUTH: CALLBACK DE MERCADO PAGO
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

    // Email real del usuario (requiere service role)
    let email = 'oauth_user@puntoelectrico.ar';
    try {
      const { data } = await supabase.auth.admin.getUserById(userId);
      if (data?.user?.email) email = data.user.email;
    } catch (_) { /* se usa el valor por defecto */ }

    const { error: dbErr } = await supabase
      .from('usuarios')
      .upsert({
        id: userId,
        email,
        mp_access_token: tokenData.access_token,
        mp_refresh_token: tokenData.refresh_token,
        mp_user_id: String(tokenData.user_id)
      });
    if (dbErr) throw new Error(dbErr.message);

    res.redirect('/paneldecontrol?mp_connected=true');

  } catch (error) {
    console.error('Error OAuth MP:', error);
    res.redirect('/paneldecontrol?error=mp_auth_failed');
  }
});

// ==========================================
// API PRIVADA: GESTIÓN DE CONFIGURACIÓN DEL PANEL DE CONTROL
// ==========================================
app.get('/paneldecontrol/api/mis-datos', requireAuth, async (req, res) => {
  const { data: usuario } = await supabase.from('usuarios').select('*').eq('id', req.user.id).maybeSingle();
  const { data: dispositivos } = await supabase.from('dispositivos').select('*').eq('usuario_id', req.user.id);

  const mpVinculado = !!usuario?.mp_access_token;

  // La URL de autorización se arma en el servidor con un state firmado
  const oauthUrl = `https://auth.mercadopago.com.ar/authorization?client_id=${encodeURIComponent(process.env.MERCADO_PAGO_CLIENT_ID)}` +
    `&response_type=code&platform_id=mp` +
    `&state=${encodeURIComponent(firmarState(req.user.id))}` +
    `&redirect_uri=${encodeURIComponent(MP_REDIRECT_URI)}`;

  res.json({
    mp_vinculado: mpVinculado,
    mp_oauth_url: mpVinculado ? null : oauthUrl,
    dispositivos: dispositivos || []
  });
});

app.post('/paneldecontrol/api/vincular-dispositivo', requireAuth, async (req, res) => {
  const { deviceId } = req.body;
  if (!/^[a-zA-Z0-9]+-[a-zA-Z0-9]+-[a-zA-Z0-9]+$/.test(deviceId || '')) {
    return res.status(400).json({ error: 'Formato de ID inválido. Debe ser xxxx-xxxx-xxxx' });
  }

  // No permitir "robar" un equipo que ya tiene otro dueño
  const { data: existente } = await supabase
    .from('dispositivos')
    .select('usuario_id')
    .eq('device_id', deviceId)
    .maybeSingle();

  if (existente?.usuario_id && existente.usuario_id !== req.user.id) {
    return res.status(409).json({ error: 'Este equipo ya está vinculado a otra cuenta' });
  }

  const { error } = await supabase
    .from('dispositivos')
    .upsert({ device_id: deviceId, usuario_id: req.user.id });

  if (error) return res.status(400).json({ error: 'No se pudo vincular el equipo' });
  res.json({ success: true });
});

app.post('/paneldecontrol/api/configurar-parametros', requireAuth, async (req, res) => {
  const { deviceId, monto, tiempo } = req.body;
  const montoNum = Number(monto);
  const tiempoNum = Number(tiempo);

  if (!Number.isFinite(montoNum) || montoNum <= 0 || !Number.isFinite(tiempoNum) || tiempoNum <= 0) {
    return res.status(400).json({ error: 'Monto y tiempo deben ser números mayores a 0' });
  }

  const { error } = await supabase
    .from('dispositivos')
    .update({ monto: montoNum, tiempo: tiempoNum })
    .eq('device_id', deviceId)
    .eq('usuario_id', req.user.id);

  if (error) return res.status(400).json({ error: 'Error al actualizar parámetros' });
  res.json({ success: true });
});

// ==========================================
// INICIALIZACIÓN DEL SERVIDOR
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] Multi-tenant operativo en puerto ${PORT}`));
