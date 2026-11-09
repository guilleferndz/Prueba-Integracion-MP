require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Pusher = require('pusher');
const { createClient } = require('@supabase/supabase-client');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// CLIENTES DE INFRAESTRUCTURA (SUPABASE & PUSHER)
// ==========================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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
    if (!authHeader) return res.status(401).json({ error: "No autorizado" });
    
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) return res.status(401).json({ error: "Sesión inválida" });
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
// ENDPOINT: GENERACIÓN DINÁMICA DE QR (ORIGEN: ESP32)
// ==========================================
app.post('/paneldecontrol/api/crear-qr', async (req, res) => {
    const { deviceId } = req.body; // Ej: mtml-26oc-0001
    
    try {
        // 1. Buscar dispositivo y su configuración en DB
        const { data: device, error: devErr } = await supabase
            .from('dispositivos')
            .select('*, usuarios(*)')
            .eq('device_id', deviceId)
            .single();

        if (devErr || !device) {
            emitirLog("ERROR", `Hardware no vinculado: ${deviceId}`);
            return res.status(404).json({ error: "Dispositivo no registrado o sin dueño" });
        }

        const tokenCliente = device.usuarios?.mp_access_token;
        if (!tokenCliente) {
            emitirLog(deviceId, "Fallo: El dueño no vinculó Mercado Pago");
            return res.status(400).json({ error: "El dueño del equipo no configuró Mercado Pago" });
        }

        emitirLog(deviceId, `Solicitó QR para Dispenser. Monto: $${device.monto}`);

        // 2. Crear el QR en Mercado Pago usando el Access Token del USUARIO DUEÑO
        // Nota: Usamos fetch directo a la API de MP v1 porque la librería oficial 'mercadopago' SDK v2 
        // asume una configuración global única en el constructor, bloqueando el comportamiento multi-tenant.
        const mpResponse = await fetch('https://api.mercadopago.com/v1/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenCliente}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                external_reference: deviceId,
                title: `Vending Dispenser ${deviceId}`,
                description: `Servicio de Vending mtml por tiempo: ${device.tiempo}s`,
                notification_url: `https://puntoelectrico.ar`, // Endpoint raíz limpio
                total_amount: Number(device.monto),
                items: [{
                    title: `Expendedora ${deviceId}`,
                    quantity: 1,
                    unit_price: Number(device.monto)
                }]
            })
        });

        const mpData = await mpResponse.json();
        
        if (!mpResponse.ok) throw new Error(mpData.message || "Error al crear preferencia en MP");

        res.json({
            success: true,
            qr_data: mpData.init_point // URL o string de datos del QR listo para el ESP32
        });

    } catch (error) {
        console.error(error);
        emitirLog("ERROR", `Fallo generación QR: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// RUTA DEL WEBHOOK DE MERCADO PAGO (Raíz)
// ==========================================
app.post('/api/webhook', async (req, res) => {
    res.sendStatus(200); // Responder rápido a Mercado Pago
    const { type, data } = req.body;

    if (type === 'payment' && data?.id) {
        try {
            // Buscamos temporalmente el pago con privilegios del sistema para identificar el external_reference.
            // Para un entorno estricto multi-tenant de producción, se recomienda inspeccionar el ID de recurso o usar el token guardado.
            const paymentResponse = await fetch(`https://mercadopago.com{data.id}`, {
                headers: { 'Authorization': `Bearer ${process.env.MERCADO_PAGO_MASTER_TOKEN || process.env.MERCADO_PAGO_ACCESS_TOKEN}` }
            });
            const pagoInfo = await paymentResponse.json();
            
            const deviceIdDestino = pagoInfo.external_reference;
            const estado = pagoInfo.status;

            if (deviceIdDestino) {
                emitirLog("MP_WEBHOOK", `Pago ID ${data.id} - Dispenser: ${deviceIdDestino} - Estado: ${estado}`);

                if (estado === 'approved') {
                    // Consultar los segundos asignados a este dispositivo
                    const { data: dev } = await supabase.from('dispositivos').select('tiempo').eq('device_id', deviceIdDestino).single();
                    const tiempoActivacion = dev?.tiempo || 5;

                    // Alerta directa por WebSockets al canal privado del ESP32 físico
                    pusher.trigger(`device-${deviceIdDestino}`, 'pago-aprobado', {
                        status: 'approved',
                        amount: pagoInfo.transaction_amount,
                        tiempo: tiempoActivacion
                    });
                    emitirLog("SERVER", `Pulso de activación de ${tiempoActivacion}s enviado al hardware ${deviceIdDestino}`);
                }
            }
        } catch (error) {
            console.error('Error procesando Webhook:', error);
        }
    }
});

// ==========================================
// FLUJO OAUTH: RECEPCIÓN DEL CALLBACK DE MERCADO PAGO
// ==========================================
app.get('/api/auth/callback', async (req, res) => {
    const { code, state } = req.query; // 'state' contendrá el UUID del usuario de nuestra plataforma
    
    if (!code || !state) return res.status(400).send("Faltan parámetros OAuth obligatorios.");

    try {
        // Intercambiar el Code temporal por el Access Token de producción definitivo del cliente
        const response = await fetch('https://mercadopago.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_secret: process.env.MERCADO_PAGO_CLIENT_SECRET,
                client_id: process.env.MERCADO_PAGO_CLIENT_ID,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: `https://puntoelectrico.ar`
            })
        });

        const tokenData = await response.json();

        if (tokenData.error) throw new Error(tokenData.message || "Error en el intercambio de tokens con MP");

        // Almacenar las credenciales obtenidas de forma segura en el registro del usuario correspondiente
        await supabase
            .from('usuarios')
            .upsert({
                id: state,
                mp_access_token: tokenData.access_token,
                mp_refresh_token: tokenData.refresh_token,
                mp_user_id: tokenData.user_id
            });

        // Redirigir de regreso al Panel de Control con bandera de éxito
        res.redirect('/paneldecontrol?mp_connected=true');

    } catch (error) {
        console.error("Error OAuth MP:", error);
        res.redirect('/paneldecontrol?error=mp_auth_failed');
    }
});

// ==========================================
// API PRIVADA: GESTIÓN DE CONFIGURACIÓN DEL PANEL DE CONTROL
// ==========================================
app.get('/paneldecontrol/api/mis-datos', requireAuth, async (req, res) => {
    const { data: usuario } = await supabase.from('usuarios').select('*').eq('id', req.user.id).single();
    const { data: dispositivos } = await supabase.from('dispositivos').select('*').eq('usuario_id', req.user.id);
    
    res.json({
        mp_vinculado: !!usuario?.mp_access_token,
        dispositivos: dispositivos || []
    });
});

app.post('/paneldecontrol/api/vincular-dispositivo', requireAuth, async (req, res) => {
    const { deviceId } = req.body;
    if (!/^[a-zA-Z0-9]+-[a-zA-Z0-9]+-[a-zA-Z0-9]+$/.test(deviceId)) {
        return res.status(400).json({ error: "Formato de ID inválido. Debe ser xxxx-xxxx-xxxx" });
    }

    const { error } = await supabase
        .from('dispositivos')
        .upsert({ device_id: deviceId, usuario_id: req.user.id });

    if (error) return res.status(400).json({ error: "No se pudo vincular el equipo o ya tiene dueño" });
    res.json({ success: true });
});

app.post('/paneldecontrol/api/configurar-parametros', requireAuth, async (req, res) => {
    const { deviceId, monto, tiempo } = req.body;
    
    const { error } = await supabase
        .from('dispositivos')
        .update({ monto: Number(monto), tiempo: Number(tiempo) })
        .eq('device_id', deviceId)
        .eq('usuario_id', req.user.id);
    if (error) return res.status(400).json({ error: "Error al actualizar parámetros" });
    res.json({ success: true });
});
    const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log([SERVER] Multi-tenant operativo en puerto ${PORT}));
