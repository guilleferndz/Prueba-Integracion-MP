require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { MercadoPagoConfig, PaymentCardToken } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Sirve tu index.html desde la carpeta public

// CONFIGURACIÓN DE MERCADO PAGO
// Asegurate de cargar tu ACCESS_TOKEN en las variables de entorno de Render
const client = new MercadoPagoConfig({ 
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || 'TU_ACCESS_TOKEN_DE_PRUEBA' 
});

// Almacenamiento temporal para conectar los dispositivos ESP32 por WebSocket
const dispositivosConectados = new Map();

// RUTA HTTP: El ESP32 CYD o tu web llaman acá para generar el QR de cobro
app.post('/api/crear-qr', async (req, res) => {
    const { deviceId, monto } = req.body;
    console.log(`[HTTP] Solicitud de QR recibida de ${deviceId} por un monto de $${monto}`);

    try {
        // Acá irá tu lógica oficial de Mercado Pago para generar la orden/QR dinámico
        // Simulamos una respuesta exitosa devolviendo un string string_qr para el micro
        const qrSimulado = `https://mercadopago.com.ar{deviceId}-${monto}`;
        
        res.json({
            success: true,
            qr_data: qrSimulado
        });
    } catch (error) {
        console.error('[HTTP] Error al generar el QR:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// RUTA HTTP (WEBHOOK): Mercado Pago te avisa acá cuando un pago cambia de estado
app.post('/api/webhook', (req, res) => {
    console.log('[WEBHOOK] Notificación recibida de Mercado Pago:', req.body);
    
    // Respondemos rápido a Mercado Pago para evitar reintentos innecesarios
    res.sendStatus(200);

    // SIMULACIÓN DE COMPRA EXITOSA: 
    // Cuando impacte un pago aprobado, buscamos el dispositivo y le enviamos la alerta por WS
    const deviceIdDestino = "ESP32_CYD_001"; // Esto lo vas a mapear dinámicamente según el pago
    const wsCliente = dispositivosConectados.get(deviceIdDestino);

    if (wsCliente && wsCliente.readyState === 1) { // 1 significa abierto/OPEN
        console.log(`[WS] Enviando señal de PAGO_APROBADO a dispositivo: ${deviceIdDestino}`);
        wsCliente.send(JSON.stringify({
            evento: "PAGO_APROBADO",
            status: "approved"
        }));
    } else {
        console.log(`[WS] El dispositivo ${deviceIdDestino} no está conectado actualmente.`);
    }
});

// CORRECCIÓN PARA RENDER: Escuchar en el puerto dinámico de la plataforma
const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Servidor Express corriendo en el puerto ${PORT}`);
});

// CONFIGURACIÓN DEL SERVIDOR WEBSOCKET
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('[WS] Nueva conexión física establecida.');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Cuando el ESP32 se conecta, envía su ID para quedar registrado en el mapa
            if (data.evento === "REGISTRAR_DISPOSITIVO") {
                const deviceId = data.deviceId;
                dispositivosConectados.set(deviceId, ws);
                console.log(`[WS] Dispositivo registrado con éxito: ID -> ${deviceId}`);
            }
        } catch (e) {
            console.error('[WS] Error al procesar mensaje JSON entrante:', e.message);
        }
    });

    ws.on('close', () => {
        // Limpieza del mapa al desconectarse el microcontrolador
        for (let [id, clientWs] of dispositivosConectados.entries()) {
            if (clientWs === ws) {
                dispositivosConectados.delete(id);
                console.log(`[WS] Dispositivo desconectado: ID -> ${id}`);
                break;
            }
        }
    });
});
