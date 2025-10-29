const express = require('express');
const Groq = require('groq-sdk');

const app = express();
const conversationHistory = {};
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});
const port = process.env.PORT || 3000;

app.use(express.json());

// --- Función para enviar mensajes a WhatsApp ---
async function sendWhatsAppMessage(phoneNumberId, to, message) {
  try {
    const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        text: { body: message }
      })
    });

    if (response.ok) {
      console.log('✅ Mensaje enviado exitosamente a WhatsApp.');
      return true;
    } else {
      const errorData = await response.json();
      console.error('Error al enviar mensaje a WhatsApp:', errorData);
      return false;
    }
  } catch (error) {
    console.error('Error en sendWhatsAppMessage:', error);
    return false;
  }
}

// --- Cargar productos desde archivo local ---
const Papa = require('papaparse');

async function loadProducts() {
  try {
    console.log('Cargando productos desde Google Sheet...');
    const response = await fetch('https://docs.google.com/spreadsheets/d/1zZBPz8ELaa06X7lBfh5GJcJkhzVK6lZHq7-TvG4LIls/export?format=csv');
    const csvData = await response.text();
    const parsedProducts = Papa.parse(csvData, { header: true }).data;

    // ¡AÑADIMOS EL FILTRO AQUÍ!
    // Esto elimina cualquier fila que esté vacía o no tenga un nombre de producto.
    const products = parsedProducts.filter(p => p.producto && p.producto.trim() !== '');

    console.log(`${products.length} productos cargados desde Google Sheet.`);
    return products;
  } catch (error) {
    console.error('Error al cargar productos:', error);
    return [];
  }
}


// --- Lógica Principal de la Aplicación ---
(async () => {
  // Carga los productos desde archivo local al iniciar.
  const products = await loadProducts();

  app.get('/', (req, res) => {
    res.json({
      status: 'active',
      message: '¡El servidor del chatbot de Asoferru está activo!',
      timestamp: new Date().toISOString(),
      products: products.length
    });
  });

  // Endpoint de salud para monitoreo
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  });

  app.post('/webhook', async (req, res) => {
    try {
      console.log('📨 Webhook recibido:', JSON.stringify(req.body, null, 2));
    } catch (error) {
      console.error('Error al procesar webhook:', error);
    }

    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const phoneNumberId = req.body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    if (message && message.type === 'text') {
      const userMessage = message.text.body.toLowerCase();
      const from = message.from;

      console.log(`💬 Mensaje de ${from}: ${userMessage}`);

      // --- Detectar solicitud de hablar con humano ---
      const humanKeywords = [
        'hablar con humano', 'hablar con persona', 'hablar con alguien',
        'atencion humana', 'atencion personal', 'atender humano',
        'transferir', 'conectar con', 'hablar con vendedor',
        'vendedor humano', 'persona real', 'asesor humano',
        'quiero hablar', 'necesito hablar', 'conversar con'
      ];

      const wantsHuman = humanKeywords.some(keyword => userMessage.includes(keyword));

      if (wantsHuman) {
        // Enviar mensaje de transferencia al cliente
        const transferMessage = `¡Por supuesto! Te voy a conectar con nuestro asesor humano. En un momento te contactará directamente. 

Mientras tanto, puedes seguir explorando nuestros productos en: https://asoferru.mitiendanube.com

¡Gracias por contactar ASOFERRU Urabá! 🛠️`;

        await sendWhatsAppMessage(phoneNumberId, from, transferMessage);

        // Notificar al número humano (tu número)
        const humanNumber = process.env.HUMAN_PHONE_NUMBER || 'tu_numero_aqui';
        const notificationMessage = `🔔 NUEVA SOLICITUD DE ATENCIÓN HUMANA

Cliente: ${from}
Mensaje: "${message.text.body}"

El cliente ${from} solicita hablar con un asesor humano. Por favor, contáctalo directamente.

Chat iniciado: ${new Date().toLocaleString()}`;

        await sendWhatsAppMessage(phoneNumberId, humanNumber, notificationMessage);
        
        console.log(`🔄 Transferencia solicitada por ${from} - Notificación enviada a ${humanNumber}`);
        return;
      }

      try {
        const keywords = userMessage.split(' ').filter(kw => kw.length > 2);

        let relevantProducts = [];
        if (keywords.length > 0 && products.length > 0) {
            relevantProducts = products.filter(product => {
              if (!product || !product.nombre) {
                return false;
              }
              const productName = product.nombre.toLowerCase();
              const productDesc = product.descripcion ? product.descripcion.toLowerCase() : '';
              return keywords.some(kw => productName.includes(kw) || productDesc.includes(kw));
            });
        }

        let productContext = "";
        if (relevantProducts.length > 0) {
          const productStrings = relevantProducts.map(p =>
            `Nombre: ${p.producto}\nDescripción: ${p.descripcion}\nEnlace para ver y comprar: ${p.url_tienda}`
          );
          productContext = `He encontrado estos productos que coinciden con tu búsqueda:\n\n${productStrings.join('\n\n')}`;
        } else {
          // Si no hay productos, se le instruye al bot que siga la regla de fallback.
          productContext = "No se encontraron productos que coincidan con la consulta. Sigue la REGLA 3 (FALLBACK OBLIGATORIO) de tu system prompt.";
        }

        const greetings = ['hola', 'buenos', 'buenas', 'qué tal', 'que tal'];
        if (keywords.length === 0 || greetings.some(g => userMessage.startsWith(g))) {
          // Si es un saludo, se le da un contexto neutral para que se presente.
          productContext = "El cliente está saludando. Preséntate cordialmente como Dayana de ASOFERRU Urabá y ofrécele tu ayuda.";
        }

        const history = conversationHistory[from] || [];
        let systemMessage = `Eres Dayana, una vendedora experta de ASOFERRU Urabá. Tu única fuente de verdad es la lista de productos proporcionada en el 'Contexto de productos'.

**REGLAS ABSOLUTAS:**
1.  **PROHIBIDO INVENTAR:** No puedes mencionar, sugerir o crear promociones, descuentos, ofertas, regalos o cualquier información que no esté explícitamente en la descripción de un producto del contexto. Si te preguntan por descuentos, responde: "No tengo información sobre promociones actuales, pero puedes ver los detalles y precios finales en el enlace de cada producto".
2.  **CÍÑETE AL CONTEXTO:** SOLO puedes hablar de los productos encontrados en el 'Contexto de productos'. No asumas la existencia de otros productos.
3.  **FALLBACK OBLIGATORIO:** Si la pregunta del cliente no puede ser respondida con la información del 'Contexto de productos', tu ÚNICA respuesta debe ser en dos partes: Primero, dirigirlo a la tienda online. Segundo, ofrecer ayuda de un humano. Responde exactamente así: "No encontré un producto específico para tu consulta, pero puedes explorar nuestro catálogo completo en nuestra tienda online: https://asoferru.mitiendanube.com/productos/ . Si prefieres, también puedo comunicarte con un asesor. ¿Qué te gustaría hacer?".
4.  **NO DES PRECIOS:** Nunca menciones el precio directamente. Siempre dirige al cliente al enlace del producto para ver el precio y más detalles.
5.  **IDENTIDAD:** Mantén un tono cordial y profesional como Dayana. Tu objetivo es asistir y guiar al cliente hacia la compra a través de los enlaces proporcionados.`;

        history.push({ role: "user", content: userMessage });

        const messagesToSent = [
            {
              role: "system",
              content: `${systemMessage}\n\nContexto de productos para esta consulta: ${productContext}`
            },
            ...history
          ];

        console.log("📦 Payload enviado a Groq:", JSON.stringify(messagesToSent, null, 2));

        const chatCompletion = await groq.chat.completions.create({
          messages: messagesToSent,
          model: "llama-3.1-8b-instant",
        });

        const aiResponse = chatCompletion.choices[0]?.message?.content || "Lo siento, no pude generar una respuesta.";
        console.log(`🤖 Respuesta de la IA para ${from}: ${aiResponse}`);

        history.push({ role: "assistant", content: aiResponse });
        conversationHistory[from] = history;

        await sendWhatsAppMessage(phoneNumberId, from, aiResponse);

      } catch (error) {
        console.error("Error en el procesamiento del webhook:", error);
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  });

  app.get('/webhook', (req, res) => {
    const verify_token = process.env.VERIFY_TOKEN || 'asoferru-token';

    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verify_token) {
        console.log('✅ WEBHOOK_VERIFIED - WhatsApp conectado');
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    }
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Servidor del chatbot ASOFERRU activo en puerto ${port}`);
    console.log(`📱 Webhook: http://localhost:${port}/webhook`);
    console.log(`💚 Salud: http://localhost:${port}/health`);
    console.log(`📊 Productos cargados: ${products.length}`);
  });

})();