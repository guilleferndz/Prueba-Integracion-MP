require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const Pusher = require('pusher');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// CONFIGURACIÓN DE RUTAS DE FRONTEND
// ==========================================

// 1. Servir los archivos estáticos de la carpeta 'public' BAJO el prefijo '/paneldecontrol'
app.use('/paneldecontrol', express.static(path.join(__dirname, 'public')));

// 2. Servir el index.html (Dashboard) cuando entren a la subruta
app.get('/paneldecontrol', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3. NUEVO: Servir la página principal (Landing con botón) en la raíz sin redirección
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});


// ==========================================
// CONFIGURACIÓN DE MERCADO PAGO
// ==========================================
const client = new MercadoPagoConfig({ 
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN
});
const payment = new Payment(client);

// ==========================================
// CONFIGURACIÓN DE PUSHER
// ==========================================
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

const historialEventos = [];

function registrarYNotificarEvento(origen, mensaje) {
    const nuevoEvento = {
        timestamp: new Date().toLocaleTimeString('es-AR'),
        origen: origen,
        mensaje: mensaje,
        message: mensaje
    };
    historialEventos.unshift(nuevoEvento);
    if (historialEventos.length > 50) historialEventos.pop();

    pusher.trigger('canal-monitoreo', 'nuevo-evento', nuevoEvento)
        .then(() => console.log(`[PUSHER SUCCESS] Evento enviado en vivo desde: ${origen}`))
        .catch(err => console.error('[PUSHER ERROR] No se pudo enviar el evento en vivo:', err));
}

// ==========================================
// RUTAS DE LA API RECONFIGURADAS A /paneldecontrol
// ==========================================

app.get('/paneldecontrol/api/historial', (req, res) => {
    res.json(historialEventos);
});

// Generación Real de QR / Preferencia de Mercado Pago
app.post('/paneldecontrol/api/crear-qr', async (req, res) => {
    const { deviceId, monto } = req.body;
    console.log(`[HTTP] Solicitud de QR: ${deviceId} por $${monto}`);
    registrarYNotificarEvento(deviceId || "CYD_ESP32", `Solicitó QR de cobro por $${monto}`);

    try {
        const preference = new Preference(client);
        const response = await preference.create({
            body: {
                items: [{
                    title: `Carga Punto Eléctrico - ${deviceId}`,
                    quantity: 1,
                    unit_price: Number(monto),
                    currency_id: 'ARS'
                }],
                // Importante: El webhook se mantiene en el dominio raíz limpio para evitar inconvenientes con MP
                notification_url: `https://puntoelectrico.ar`,
                external_reference: deviceId
            }
        });

        res.json({
            success: true,
            qr_data: response.init_point 
        });
    } catch (error) {
        console.error('[HTTP] Error generando QR:', error);
        registrarYNotificarEvento("ERROR", `Fallo al generar QR: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// RUTA DEL WEBHOOK (Mantenida en la raíz)
// ==========================================
app.post('/api/webhook', async (req, res) => {
    res.sendStatus(200); // Responder rápido a MP
    const { type, data } = req.body;

    if (type === 'payment' && data && data.id) {
        try {
            const pagoInfo = await payment.get({ id: data.id });
            const estado = pagoInfo.status;
            const deviceIdDestino = pagoInfo.external_reference || "CYD_ESP32_01";

            registrarYNotificarEvento("MP_WEBHOOK", `Pago ID ${data.id} - Estado: ${estado}`);

            if (estado === 'approved') {
                pusher.trigger(`device-${deviceIdDestino}`, 'pago-aprobado', {
                    status: 'approved',
                    amount: pagoInfo.transaction_amount
                });
                registrarYNotificarEvento("SERVER", `Alerta enviada al hardware ${deviceIdDestino}`);
            }
        } catch (error) {
            console.error('[WEBHOOK] Error procesando pago:', error);
            registrarYNotificarEvento("ERROR_MP", `Error Pago ID ${data.id}: ${error.message}`);
        }
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Corriendo en puerto ${PORT}`);
});
