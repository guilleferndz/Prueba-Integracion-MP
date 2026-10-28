const express = require('express');
const bodyParser = require('body-parser');
const { MercadoPagoConfig, PaymentMethod, Preference } = require('mercadopago'); // Ajustado a checkout/preferencias para QR digital
const Pusher = require('pusher');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Servir el frontend de monitoreo

// 1. Configuración de Mercado Pago
const mpClient = new MercadoPagoConfig({ accessToken: 'TU_MERCADO_PAGO_ACCESS_TOKEN' });

// 2. Configuración de Pusher
const pusher = new Pusher({
  appId: "TU_PUSHER_APP_ID",
  key: "TU_PUSHER_KEY",
  secret: "TU_PUSHER_SECRET",
  cluster: "TU_PUSHER_CLUSTER",
  useTLS: true
});

// Historial temporal en memoria para el Frontend de Monitoreo
let historialEventos = [];

function registrarEvento(origen, mensaje) {
  const evento = { timestamp: new Date().toLocaleTimeString(), origen, mensaje };
  historialEventos.unshift(evento); // Agregar al inicio
  if (historialEventos.length > 20) historialEventos.pop(); // Limitar a 20 items
  
  // Avisar al panel de monitoreo por un canal de Pusher dedicado a la web
  pusher.trigger("canal-monitoreo", "nuevo-evento", evento);
}

// ENDPOINT 1: El CYD (ESP32) pide un QR enviando monto
app.post('/api/solicitar-qr', async (req, res) => {
  const { monto, esp32_id } = req.body;
  registrarEvento("ESP32 CYD", `Solicitó QR por un monto de $${monto}`);

  try {
    // Para mostrar un QR en pantalla, generamos una preferencia de pago (Mercado Pago de caja abierta/link)
    // O puedes usar la API de QR e integrar el string "qr_data" que devuelve MP.
    // Para pruebas rápidas, creamos un Link de Pago y lo transformamos en QR:
    const preference = new Preference(mpClient);
    const response = await preference.create({
      body: {
        external_reference: esp32_id,
        notification_url: "https://onrender.com", // Tu URL pública de Render
        items: [
          {
            title: "Crédito Máquina ESP32",
            quantity: 1,
            unit_price: parseFloat(monto),
            currency_id: "ARS"
          }
        ]
      }
    });

    const linkDePago = response.init_point; // URL para pagar

    // Convertimos la URL de pago en un String Base64 de código QR (o un array de bytes para el ESP32)
    // Para simplificar la vida del ESP32, el backend puede devolver el texto puro del QR y el ESP32 lo dibuja,
    // o enviarle un link a una imagen pequeña (ej. 120x120 px) que el CYD pueda descargar.
    const textoQr = linkDePago; 

    registrarEvento("Mercado Pago", `Preferencia creada con éxito. Link generado.`);
    
    res.status(200).json({ 
      status: "OK", 
      qr_string: textoQr, // El ESP32 puede usar esto para generar el QR localmente si tiene la librería, o:
      qr_image_url: `https://qrserver.com{encodeURIComponent(textoQr)}` // Link directo a imagen 150x150
    });

  } catch (error) {
    console.error(error);
    registrarEvento("ERROR", "No se pudo generar el cobro en Mercado Pago");
    res.status(500).json({ error: "Error en Mercado Pago" });
  }
});

// ENDPOINT 2: El Webhook de Mercado Pago
app.post('/api/webhook-mp', async (req, res) => {
  const notification = req.body;
  
  // Detectar intento de aviso de Mercado Pago
  registrarEvento("Webhook MP", `Notificación recibida tipo: ${notification.type || notification.topic}`);

  // Simulación de validación de pago aprobado (reemplazar con tu lógica de producción)
  if (req.query.id || notification.data?.id) {
    const idDelEsp32 = "CYD_ESP32_01"; 

    registrarEvento("Sistema Web", `¡Pago Aprobado detectado! Notificando al ESP32 vía Pusher...`);

    // Enviar señal al ESP32
    pusher.trigger("canal-esp32", "activar-rele", {
      dispositivo: idDelEsp32,
      accion: "ENCENDER",
      tiempo_ms: 4000
    });
  }

  res.status(200).send('OK');
});

// ENDPOINT 3: Para que el Frontend cargue el historial al abrir la página
app.get('/api/historial', (req, res) => {
  res.json(historialEventos);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
