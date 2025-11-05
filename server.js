const express = require('express');
const Groq = require('groq-sdk');
const Papa = require('papaparse');
const fetch = require('node-fetch');
const app = express();
const conversationHistory = {};
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 3000;

app.use(express.json());

// --- INICIO: CARGA DINÁMICA DE PRODUCTOS DESDE GOOGLE SHEETS ---

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

// --- FIN: CARGA DINÁMICA DE PRODUCTOS DESDE GOOGLE SHEETS ---


// --- INICIO: LÓGICA DE BÚSQUEDA SEMÁNTICA ---

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function generateEmbeddings(productList) {
    console.log('🧠 Generando mapa de significados para los productos...');
    const embeddingModel = 'text-embedding-3-small';
    productsWithEmbeddings = []; 
    for (const product of productList) {
        const productName = product.producto || '';
        const productDesc = product.descripcion || '';
        const inputText = `Producto: ${productName}. Descripción: ${productDesc}`;
        try {
            const embeddingResponse = await groq.embeddings.create({
                model: embeddingModel,
                input: inputText,
            });
            const embedding = embeddingResponse.data[0].embedding;
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
        const embeddingResponse = await groq.embeddings.create({
            model: 'text-embedding-3-small',
            input: userQuery,
        });
        const queryEmbedding = embeddingResponse.data[0].embedding;
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


// --- Función para enviar mensajes a WhatsApp ---
async function sendWhatsAppMessage(phoneNumberId, to, text) {
    // Esta es una función de marcador de posición. La implementación real dependería de cómo
    // estás enviando mensajes (por ejemplo, a través de la API de la nube de WhatsApp).
    // Asegúrate de que esta función esté correctamente implementada con tu proveedor de servicios de WhatsApp.
    console.log(`-> Enviando a ${to}: "${text}"`);
}


// --- Lógica Principal de la Aplicación ---
(async () => {
    products = await loadProductsFromSheet();
    await generateEmbeddings(products);

    app.get('/', (req, res) => {
        res.json({
            status: 'active',
            message: '¡El servidor del chatbot de Asoferru está activo!',
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

        // --- INICIO: GESTIÓN DE COMPROBANTES DE PAGO (IMÁGENES) ---
        if (message.type === 'image') {
            console.log(`📸 Imagen recibida de ${from}. Es un comprobante de pago.`);

            const userConfirmation = '¡Gracias! Hemos recibido tu comprobante. Un asesor humano se pondrá en contacto contigo en breve para coordinar el envío.';
            const agentNotification = `¡Alerta de Venta! 🔔\n\nEl cliente con el número *${from}* ha enviado un comprobante de pago.\n\nPor favor, revisa su chat para coordinar el envío.`
            
            const agentNumber = process.env.HUMAN_AGENT_NUMBER;

            if (!agentNumber) {
                console.error('ERROR: La variable de entorno HUMAN_AGENT_NUMBER no está configurada.');
            } else {
                // 1. Notificar al asesor
                await sendWhatsAppMessage(phoneNumberId, agentNumber, agentNotification);
            }
            
            // 2. Confirmar al usuario
            await sendWhatsAppMessage(phoneNumberId, from, userConfirmation);

            return res.status(200).send('EVENT_RECEIVED');
        }
        // --- FIN: GESTIÓN DE COMPROBANTES DE PAGO ---


        // Solo procesamos mensajes de texto a partir de aquí
        if (message.type !== 'text') {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const userMessage = message.text.body;
        console.log(`💬 Mensaje de ${from}: ${userMessage}`);
        
        // --- INICIO: PALABRAS CLAVE PARA PAGO ---
        const paymentKeywords = ['pagar', 'pago', 'comprobante', 'comprar'];
        const userMessageLower = userMessage.toLowerCase();
        
        if (paymentKeywords.some(keyword => userMessageLower.includes(keyword))) {
            console.log(`💰 El usuario ${from} mencionó una palabra clave de pago.`);
            const promptMessage = '¡Hola! Si deseas confirmar tu compra, por favor, envía en este chat la imagen de tu comprobante de pago y un asesor te contactará para coordinar la entrega.';
            await sendWhatsAppMessage(phoneNumberId, from, promptMessage);
            return res.status(200).send('EVENT_RECEIVED');
        }
        // --- FIN: PALABRAS CLAVE PARA PAGO ---


        // --- INICIO: LÓGICA DE BÚSQUEDA SEMÁNTICA (FALLBACK) ---
        try {
            const relevantProducts = await findRelevantProducts(userMessage);

            let productContext = "";
            if (relevantProducts.length > 0) {
                const productStrings = relevantProducts.map(p =>
                    `Nombre: ${p.producto}\nDescripción: ${p.descripcion}\nPrecio: ${p.precio}\nEnlace para ver y comprar: ${p.url_tienda}`
                );
                productContext = `He encontrado estos productos que podrían interesarte:\n\n${productStrings.join('\n\n')}`;
            } else {
                productContext = "No se encontraron productos que coincidan con la consulta. Sigue la REGLA 3 (FALLBACK OBLIGATORIO) de tu system prompt.";
            }

            const history = conversationHistory[from] || [];
            const systemMessage = `Eres Dayana... (resto del prompt sin cambios)`; 

            history.push({ role: "user", content: userMessage });

            const messagesToSent = [
                { role: "system", content: `${systemMessage}\n\nContexto de productos para esta consulta: ${productContext}` },
                ...history
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
        // --- FIN: LÓGICA DE BÚSQUEDA SEMÁNTICA ---

        res.status(200).send('EVENT_RECEIVED');
    });

    app.get('/webhook', (req, res) => {
        // ... (código de verificación sin cambios)
    });

    app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Servidor del chatbot ASOFERRU activo en puerto ${port}`);
    });
})();