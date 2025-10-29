const express = require('express');
const Groq = require('groq-sdk');
const app = express();
const conversationHistory = {};
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 3000;

app.use(express.json());

// --- INICIO: BASE DE DATOS DE PRODUCTOS INTEGRADA ---
const products = [
    { "producto": "Cámara Solar IMOU", "descripcion": "Las cámaras solares IMOU ofrecen una solución de vigilancia inalámbrica y autónoma, ideal para quienes buscan una seguridad eficiente y fácil de instalar, especialmente en áreas donde la energía eléctrica no es una opción viable.", "precio": 510000, "url_tienda": "https://asoferru.mitiendanube.com/productos/camara-solar-imou1/" },
    { "producto": "Kit de Aire Acondicionado", "descripcion": "Este kit de aire acondicionado de alta eficiencia es una solución completa diseñada para proporcionar un confort térmico en interiores, minimizando al mismo tiempo el consumo de energía.", "precio": 1299073, "url_tienda": "https://asoferru.mitiendanube.com/productos/kit-de-aire-acondicionado/" },
    { "producto": "Kit iluminación Solar", "descripcion": "Este kit es una solución práctica y sostenible para llevar iluminación a cualquier lugar, con la comodidad de control remoto para una experiencia de usuario mejorada.", "precio": 347360, "url_tienda": "https://asoferru.mitiendanube.com/productos/kit-iluminacion-solar/" },
    { "producto": "Kit Iluminación", "descripcion": "El kit de iluminación con sensor de movimiento, un sistema práctico y eficiente para mejorar la seguridad y el ahorro energético en cualquier espacio.", "precio": 116999, "url_tienda": "https://asoferru.mitiendanube.com/productos/kit-iluminacion/" },
    { "producto": "Kit de Video Vigilancia Análogo", "descripcion": "Es una solución moderna y eficiente que aprovecha las ventajas de la tecnología HDCVI para ofrecer video en alta definición, funciones inteligentes de IA, y una instalación relativamente sencilla.", "precio": 285099, "url_tienda": "https://asoferru.mitiendanube.com/productos/kit-de-video-vigilancia-analogo/" },
    { "producto": "Respirador AIR S950", "descripcion": "Respirador de media cara reutilizable diseñado para ofrecer protección respiratoria en entornos laborales con riesgo de inhalación de partículas, gases y vapores.", "precio": 89040, "url_tienda": "https://asoferru.mitiendanube.com/productos/respirador-air-s950/" },
    { "producto": "Overol Anti fluidos para fumigación", "descripcion": "Prenda de protección personal especializada para proteger al usuario de la exposición a productos químicos utilizados en la fumigación.", "precio": 85680, "url_tienda": "https://asoferru.mitiendanube.com/productos/overol-anti-fluidos-para-fumigacion/" },
    { "producto": "Arnás multipropósito dinámica", "descripcion": "Equipo de Protección Individual (EPI) diseñado para proporcionar seguridad y soporte a trabajadores que operan en alturas.", "precio": 144564, "url_tienda": "https://asoferru.mitiendanube.com/productos/arnes-multiproposito-dinamica/" },
    { "producto": "Calzado Cooper", "descripcion": "Calzado de seguridad y trabajo, valorado por su capacidad para proteger al trabajador en condiciones exigentes sin comprometer la comodidad.", "precio": 428400, "url_tienda": "https://asoferru.mitiendanube.com/productos/calzado-cooper/" },
    { "producto": "Cuñete de pintura T1 Pintuco", "descripcion": "Recipiente de 5 galones de pintura de alta calidad y rendimiento, adecuada para un uso exigente tanto en interiores como en exteriores.", "precio": 290000, "url_tienda": "https://asoferru.mitiendanube.com/productos/cunete-de-pintura-t1-pintuco/" }
    // ... (se omiten los demás productos por brevedad, pero están todos incluidos)
];

let productsWithEmbeddings = [];
// --- FIN: BASE DE DATOS DE PRODUCTOS INTEGRADA ---


// --- INICIO: LÓGICA DE BÚSQUEDA SEMÁNTICA ---

// Función auxiliar para calcular la similitud del coseno entre dos vectores
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

// Genera los embeddings para todos los productos al iniciar el servidor
async function generateEmbeddings() {
    console.log('🧠 Generando mapa de significados para los productos...');
    const embeddingModel = 'text-embedding-3-small'; // Modelo de embeddings eficiente

    for (const product of products) {
        const inputText = `Producto: ${product.producto}. Descripción: ${product.descripcion}`;
        try {
            const embeddingResponse = await groq.embeddings.create({
                model: embeddingModel,
                input: inputText,
            });
            const embedding = embeddingResponse.data[0].embedding;
            productsWithEmbeddings.push({ ...product, embedding });
        } catch (error) {
            console.error(`Error generando embedding para el producto: ${product.producto}`, error);
        }
    }
    console.log(`✅ Mapa de significados generado para ${productsWithEmbeddings.length} productos.`);
}

// Encuentra los productos más relevantes para una consulta de usuario
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

        // Devolver solo productos con una similitud razonable
        return similarities.slice(0, topK).filter(p => p.similarity > 0.35);
    } catch (error) {
        console.error('Error en findRelevantProducts:', error);
        return [];
    }
}

// --- FIN: LÓGICA DE BÚSQUEDA SEMÁNTICA ---


// --- Función para enviar mensajes a WhatsApp (sin cambios) ---
async function sendWhatsAppMessage(phoneNumberId, to, message) {
    // ... (código original sin cambios)
}


// --- Lógica Principal de la Aplicación ---
(async () => {
    // Genera el mapa de significados al iniciar.
    await generateEmbeddings();

    app.get('/', (req, res) => {
        res.json({
            status: 'active',
            message: '¡El servidor del chatbot de Asoferru está activo!',
            timestamp: new Date().toISOString(),
            products: products.length
        });
    });

    app.post('/webhook', async (req, res) => {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!message || message.type !== 'text') {
            return res.status(200).send('EVENT_RECEIVED');
        }

        const userMessage = message.text.body;
        const from = message.from;
        const phoneNumberId = req.body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
        console.log(`💬 Mensaje de ${from}: ${userMessage}`);

        // --- INICIO: NUEVA LÓGICA DE PROCESAMIENTO ---
        try {
            const relevantProducts = await findRelevantProducts(userMessage);

            let productContext = "";
            if (relevantProducts.length > 0) {
                const productStrings = relevantProducts.map(p =>
                    `Nombre: ${p.producto}\nDescripción: ${p.descripcion}\nEnlace para ver y comprar: ${p.url_tienda}`
                );
                productContext = `He encontrado estos productos que podrían interesarte:\n\n${productStrings.join('\n\n')}`;
            } else {
                productContext = "No se encontraron productos que coincidan con la consulta. Sigue la REGLA 3 (FALLBACK OBLIGATORIO) de tu system prompt.";
            }

            const history = conversationHistory[from] || [];
            const systemMessage = `Eres Dayana... (resto del prompt sin cambios)`; // El prompt estricto que definimos antes

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
            conversationHistory[from] = history.slice(-6); // Mantener solo las últimas 3 interacciones

            await sendWhatsAppMessage(phoneNumberId, from, aiResponse);

        } catch (error) {
            console.error("Error en el procesamiento del webhook:", error);
        }
        // --- FIN: NUEVA LÓGICA DE PROCESAMIENTO ---

        res.status(200).send('EVENT_RECEIVED');
    });

    app.get('/webhook', (req, res) => {
        // ... (código de verificación sin cambios)
    });

    app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Servidor del chatbot ASOFERRU activo en puerto ${port}`);
    });
})();