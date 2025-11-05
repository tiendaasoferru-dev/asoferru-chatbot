const express = require('express');
const Groq = require('groq-sdk');
const Papa = require('papaparse');
const fetch = require('node-fetch');
const { pipeline } = require('@xenova/transformers');

const app = express();
const conversationHistory = {};
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 3000;

app.use(express.json());

// --- INICIO: CARGA DINÁMICA DE PRODUCTOS ---
const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1zZBPz8ELaa06X7lBfh5GJcJkhzVK6lZHq7-TvG4LIls/export?format=csv&gid=1827939452';
let products = [];
let productsWithEmbeddings = [];

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
                error: (error) => {
                    console.error('Error al parsear el CSV:', error);
                    resolve([]);
                }
            });
        });
    } catch (error) {
        console.error('Error al descargar la hoja de cálculo:', error);
        return [];
    }
}

// --- FIN: CARGA DINÁMICA DE PRODUCTOS ---


// --- INICIO: LÓGICA DE BÚSQUEDA SEMÁNTICA (LOCAL) ---

let extractorPromise = null;
const getExtractor = () => {
    if (extractorPromise === null) {
        console.log('⏳ Cargando modelo de embeddings local por primera vez (puede tardar un momento)...');
        extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return extractorPromise;
};

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function generateEmbeddings(productList) {
    console.log('🧠 Generando mapa de significados para los productos (localmente)...');
    const extractor = await getExtractor();
    productsWithEmbeddings = [];
    for (const product of productList) {
        const productName = product.producto || '';
        const productDesc = product.descripcion || '';
        const inputText = `Producto: ${productName}. Descripción: ${productDesc}`;
        try {
            const output = await extractor(inputText, { pooling: 'mean', normalize: true });
            const embedding = Array.from(output.data);
            productsWithEmbeddings.push({ ...product, embedding });
        } catch (error) {
            console.error(`Error generando embedding para el producto: ${productName}`, error);
        }
    }
    console.log(`✅ Mapa de significados generado para ${productsWithEmbeddings.length} productos.`);
}

async function findRelevantProducts(userQuery, topK = 3) {
    if (productsWithEmbeddings.length === 0) return [];
    try {
        const extractor = await getExtractor();
        const output = await extractor(userQuery, { pooling: 'mean', normalize: true });
        const queryEmbedding = Array.from(output.data);

        const similarities = productsWithEmbeddings.map(product => ({
            ...product,
            similarity: cosineSimilarity(queryEmbedding, product.embedding)
        }));

        similarities.sort((a, b) => b.similarity - a.similarity);
        return similarities.slice(0, topK).filter(p => p.similarity > 0.35);
    } catch (error) {
        console.error('Error en findRelevantProducts:', error);
        return [];
    }
}

// --- FIN: LÓGICA DE BÚSQUEDA SEMÁNTICA ---


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
            // Si no es un mensaje de depuración, envía el error al asesor
            if (!isDebugging) {
                const errorString = JSON.stringify(errorData);
                await sendWhatsAppMessage(phoneNumberId, process.env.HUMAN_AGENT_NUMBER, `Error de API: ${errorString}`, true);
            }
        } else {
            console.log('✅ Mensaje enviado con éxito.');
        }
    } catch (error) {
        console.error('Error en la función sendWhatsAppMessage:', error);
        // Si no es un mensaje de depuración, envía el error al asesor
        if (!isDebugging) {
            await sendWhatsAppMessage(phoneNumberId, process.env.HUMAN_AGENT_NUMBER, `Error de Código: ${error.message}`, true);
        }
    }
}


// --- Lógica Principal de la Aplicación ---
(async () => {
    products = await loadProductsFromSheet();
    await generateEmbeddings(products);

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
            console.log(`📸 Imagen recibida de ${from}. Es un comprobante de pago.`);
            const userConfirmation = '¡Gracias! Hemos recibido tu comprobante. Un asesor humano se pondrá en contacto contigo en breve para coordinar el envío.';
            const agentNotification = `¡Alerta de Venta! 🔔\n\nEl cliente con el número *${from}* ha enviado un comprobante de pago.\n\nPor favor, revisa su chat para coordinar el envío.`
            const agentNumber = process.env.HUMAN_AGENT_NUMBER;
            if (!agentNumber) {
                console.error('ERROR: La variable de entorno HUMAN_AGENT_NUMBER no está configurada.');
            } else {
                await sendWhatsAppMessage(phoneNumberId, agentNumber, agentNotification);
            }
            await sendWhatsAppMessage(phoneNumberId, from, userConfirmation);
            return res.status(200).send('EVENT_RECEIVED');
        }

        if (message.type !== 'text') {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const userMessage = message.text.body;
        console.log(`💬 Mensaje de ${from}: ${userMessage}`);

        const userMessageLower = userMessage.toLowerCase();
        const greetingKeywords = ['hola', 'buenos', 'buenas', 'que tal'];

        if (greetingKeywords.some(keyword => userMessageLower.startsWith(keyword))) {
            const greeting = "Hola, soy Juan, tu Asesor de ASOFERRU Urabá. la Ferreteria mas grande de el Uraba";
            await sendWhatsAppMessage(phoneNumberId, from, greeting);
            return res.status(200).send('EVENT_RECEIVED');
        }
        
        const paymentKeywords = ['pagar', 'pago', 'comprobante', 'comprar'];
        if (paymentKeywords.some(keyword => userMessageLower.includes(keyword))) {
            console.log(`💰 El usuario ${from} mencionó una palabra clave de pago.`);
            const promptMessage = '¡Hola! Si deseas confirmar tu compra, por favor, envía en este chat la imagen de tu comprobante de pago y un asesor te contactará para coordinar la entrega.';
            await sendWhatsAppMessage(phoneNumberId, from, promptMessage);
            return res.status(200).send('EVENT_RECEIVED');
        }

        try {
            const relevantProducts = await findRelevantProducts(userMessage);
            let productContext = "";
            if (relevantProducts.length > 0) {
                const productStrings = relevantProducts.map(p =>
                    `*Nombre:* ${p.producto}\n*Descripción:* ${p.descripcion}\n*Precio:* ${p.precio}\n*Enlace:* ${p.url_tienda}`
                );
                productContext = `Claro, encontré esto para ti:\n\n${productStrings.join('\n\n')}`;
            } else {
                productContext = "No encontré un producto que coincida con tu búsqueda. ¿Puedes describirlo de otra manera?";
            }

            const systemMessage = `Eres Juan, un asesor de ventas directo y eficiente de ASOFERRU Urabá. REGLAS ESTRICTAS: 1. Responde ÚNICAMENTE con el contexto que se te proporciona. No añadas conversación adicional. 2. Después de listar los productos, añade siempre en una nueva línea: "Puedes ver nuestro catálogo completo en https://asoferru.mitiendanube.com/productos/". 3. Si el contexto es que no se encontraron productos, responde solo con ese contexto.`;
            
            history.push({ role: "user", content: userMessage });

            const messagesToSent = [
                { role: "system", content: systemMessage },
                { role: "user", content: `Contexto: "${productContext}". Por favor, genera una respuesta basada en este contexto.`}
            ];

            const chatCompletion = await groq.chat.completions.create({
                messages: messagesToSent,
                model: "llama-3.1-8b-instant",
            });

            const aiResponse = chatCompletion.choices[0]?.message?.content || "Lo siento, no pude generar una respuesta.";
            history.push({ role: "assistant", content: aiResponse });
            conversationHistory[from] = history.slice(-6); 
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