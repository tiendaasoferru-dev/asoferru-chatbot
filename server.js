const express = require('express');
const Groq = require('groq-sdk');
const Papa = require('papaparse');
const fetch = require('node-fetch');

const app = express();
const conversationHistory = {};
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 3000;

app.use(express.json());

// --- INICIO: LÓGICA DE PRODUCTOS Y BÚSQUEDA ---
const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1zZBPz8ELaa06X7lBfh5GJcJkhzVK6lZHq7-TvG4LIls/export?format=csv&gid=1827939452';
let products = [];

async function loadProductsFromSheet() {
    console.log('🔄 Cargando productos desde Google Sheets...');
    try {
        const response = await fetch(SPREADSHEET_URL);
        const csvText = await response.text();
        return new Promise(resolve => {
            Papa.parse(csvText, {
                header: true,
                dynamicTyping: true,
                complete: (results) => {
                    const loadedProducts = results.data.filter(p => p.producto && p.producto.trim() !== '');
                    console.log(`✅ ${loadedProducts.length} productos cargados correctamente.`);
                    resolve(loadedProducts);
                },
            });
        });
    } catch (error) {
        console.error('Error al descargar la hoja de cálculo:', error);
        return [];
    }
}

function normalizeText(text = '') {
    return text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findRelevantProductsByKeyword(userQuery, topK = 3) {
    const queryWords = normalizeText(userQuery).split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return [];

    const scoredProducts = products.map(product => {
        const productName = normalizeText(product.producto);
        const productDesc = normalizeText(product.descripcion);
        const productCat = normalizeText(product.categoria);

        let score = 0;
        queryWords.forEach(word => {
            if (productName.includes(word)) score += 10;
            if (productDesc.includes(word)) score += 2;
            if (productCat.includes(word)) score += 5;
        });

        return { ...product, score };
    });

    const relevantProducts = scoredProducts.filter(p => p.score > 0);
    relevantProducts.sort((a, b) => b.score - a.score);

    return relevantProducts.slice(0, topK);
}

// --- FIN: LÓGICA DE PRODUCTOS Y BÚSQUEDA ---


// --- Función para enviar mensajes a WhatsApp (con depuración de errores) ---
async function sendWhatsAppMessage(phoneNumberId, to, text, isDebugging = false) {
    const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

    if (!WHATSAPP_TOKEN) {
        console.error('ERROR: La variable de entorno WHATSAPP_TOKEN no está configurada.');
        return;
    }

    console.log(`-> Enviando a ${to}: "${text.substring(0, 60)}..."`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: to,
                text: { body: text },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error(`Error al enviar mensaje de WhatsApp: ${response.status} ${response.statusText}`, errorData);
            if (!isDebugging) {
                const errorString = JSON.stringify(errorData);
                await sendWhatsAppMessage(phoneNumberId, process.env.HUMAN_AGENT_NUMBER, `Error de API: ${errorString}`, true);
            }
        } else {
            console.log('✅ Mensaje enviado con éxito.');
        }
    } catch (error) {
        console.error('Error en la función sendWhatsAppMessage:', error);
        if (!isDebugging) {
            await sendWhatsAppMessage(phoneNumberId, process.env.HUMAN_AGENT_NUMBER, `Error de Código: ${error.message}`, true);
        }
    }
}


// --- Lógica Principal de la Aplicación ---
(async () => {
    products = await loadProductsFromSheet();

    app.get('/', (req, res) => {
        res.json({
            status: 'active',
            message: '¡El servidor del chatbot de Juan está activo!',
            timestamp: new Date().toISOString(),
            products_loaded: products.length
        });
    });

    app.post('/webhook', async (req, res) => {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!message) {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const from = message.from;
        const phoneNumberId = req.body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

        if (message.type === 'image') {
            const userConfirmation = '¡Gracias! Hemos recibido tu comprobante. Un asesor humano se pondrá en contacto contigo en breve para coordinar el envío.';
            const agentNotification = `¡Alerta de Venta! 🔔\n\nEl cliente con el número *${from}* ha enviado un comprobante de pago.\n\nPor favor, revisa su chat para coordinar el envío.`
            await sendWhatsAppMessage(phoneNumberId, process.env.HUMAN_AGENT_NUMBER, agentNotification);
            await sendWhatsAppMessage(phoneNumberId, from, userConfirmation);
            return res.status(200).send('EVENT_RECEIVED');
        }

        if (message.type !== 'text') {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const userMessage = message.text.body;
        console.log(`💬 Mensaje de ${from}: ${userMessage}`);

        const userMessageLower = userMessage.toLowerCase();
        const isGreeting = ['hola', 'buenos', 'buenas', 'que tal'].some(k => userMessageLower.startsWith(k));
        const isMenuRequest = ['menu', 'opciones', 'inicio'].some(k => userMessageLower.includes(k));

        // Si es la primera interacción o pide el menú, muestra el menú.
        if (!conversationHistory[from] || isGreeting || isMenuRequest) {
            const menuText = `Hola, soy Juan, tu Asesor de ASOFERRU Urabá, la ferretería más grande de Urabá.\n\nPor favor, elige una opción para continuar:\n*1. 🔎 Asesor de Productos*\n*2. 💳 Pagos*\n*3. 🚚 Envíos*\n\nResponde con el número o la palabra de la opción que necesites.`;
            await sendWhatsAppMessage(phoneNumberId, from, menuText);
            conversationHistory[from] = { lastAction: 'menu' };
            return res.status(200).send('EVENT_RECEIVED');
        }

        const lastAction = conversationHistory[from]?.lastAction;

        // Lógica para manejar la respuesta después de mostrar el menú
        if (lastAction === 'menu') {
            if (userMessageLower.includes('1') || userMessageLower.includes('asesor')) {
                await sendWhatsAppMessage(phoneNumberId, from, "Claro, dime qué producto estás buscando.");
                conversationHistory[from] = { lastAction: 'searching' };
                return res.status(200).send('EVENT_RECEIVED');
            }
            if (userMessageLower.includes('2') || userMessageLower.includes('pago')) {
                const response = "Para pagos, por favor envía la imagen de tu comprobante y un asesor te contactará.";
                await sendWhatsAppMessage(phoneNumberId, from, response);
                return res.status(200).send('EVENT_RECEIVED');
            }
            if (userMessageLower.includes('3') || userMessageLower.includes('envio')) {
                const response = "Un asesor se pondrá en contacto contigo para coordinar lo relacionado a tu envío.";
                await sendWhatsAppMessage(phoneNumberId, process.env.HUMAN_AGENT_NUMBER, `El cliente ${from} solicita información de envío.`);
                await sendWhatsAppMessage(phoneNumberId, from, response);
                return res.status(200).send('EVENT_RECEIVED');
            }
        }

        // Lógica de búsqueda de productos
        try {
            const relevantProducts = findRelevantProductsByKeyword(userMessage);
            let productContext = "";
            if (relevantProducts.length > 0) {
                const productStrings = relevantProducts.map(p =>
                    `*Nombre:* ${p.producto}\n*Descripción:* ${p.descripcion}\n*Precio:* ${p.precio}\n*Enlace:* ${p.url_tienda}`
                );
                productContext = `Claro, encontré esto para ti:\n\n${productStrings.join('\n\n')}`;
            } else {
                productContext = "No encontré un producto que coincida con tu búsqueda. ¿Puedes describirlo de otra manera?";
            }

            const systemMessage = `Eres Juan, un asesor de ventas de ASOFERRU Urabá. REGLAS ESTRICTAS: 1. Responde ÚNICAMENTE con el contexto que se te proporciona. No añadas conversación adicional. 2. Después de listar los productos, añade siempre en una nueva línea: "Puedes ver nuestro catálogo completo en https://asoferru.mitiendanube.com/productos/". 3. Si el contexto es que no se encontraron productos, responde solo con ese contexto. 4. NUNCA ofrezcas descuentos, promociones o regalos.`;
            
            const messagesToSent = [
                { role: "system", content: systemMessage },
                { role: "user", content: `Contexto: "${productContext}". Por favor, genera una respuesta basada en este contexto.`}
            ];

            const chatCompletion = await groq.chat.completions.create({
                messages: messagesToSent,
                model: "llama-3.1-8b-instant",
            });

            const aiResponse = chatCompletion.choices[0]?.message?.content || "Lo siento, no pude generar una respuesta.";
            await sendWhatsAppMessage(phoneNumberId, from, aiResponse);
        } catch (error) {
            console.error("Error en el procesamiento del webhook:", error);
        }

        res.status(200).send('EVENT_RECEIVED');
    });

    app.get('/webhook', (req, res) => {
        const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
        let mode = req.query['hub.mode'];
        let token = req.query['hub.verify_token'];
        let challenge = req.query['hub.challenge'];
        if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log('✅ WEBHOOK_VERIFIED');
                res.status(200).send(challenge);
            } else {
                res.sendStatus(403);
            }
        }
    });

    app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Servidor del chatbot ASOFERRU activo en puerto ${port}`);
    });
})();