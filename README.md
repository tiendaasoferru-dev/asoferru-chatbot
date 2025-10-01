# ASOFERRU Chatbot WhatsApp

Chatbot inteligente para ASOFERRU Urabá que atiende clientes por WhatsApp con IA y transferencia automática a humano.

## 🚀 Características

- ✅ **84 productos** con URLs directas a la tienda
- ✅ **IA integrada** con Groq (Llama 3.1)
- ✅ **Transferencia automática** a humano cuando se solicite
- ✅ **Hosting gratuito** en Railway
- ✅ **100% autónomo** - funciona sin intervención

## 📋 Variables de Entorno Requeridas

```env
PORT=80
WHATSAPP_ACCESS_TOKEN=tu_token_de_whatsapp
VERIFY_TOKEN=asoferru-token
HUMAN_PHONE_NUMBER=tu_numero_whatsapp
GROQ_API_KEY=tu_groq_api_key
```

## 🛠️ Instalación y Despliegue

### Opción 1: Railway (Recomendado)
1. Conecta tu repositorio GitHub a Railway
2. Configura las variables de entorno
3. ¡Listo! El bot estará funcionando

### Opción 2: Render
1. Conecta tu repositorio a Render
2. Configura las variables de entorno
3. Deploy automático

## 📱 Configuración WhatsApp

1. Crea una app en Meta for Developers
2. Configura WhatsApp Business API
3. Obtén tu ACCESS_TOKEN
4. Configura el webhook apuntando a tu dominio

## 🤖 Funcionamiento

- El bot responde automáticamente a todos los mensajes
- Busca productos relevantes basándose en palabras clave
- Cuando el usuario dice "hablar con humano", te notifica
- Solo maneja productos con URLs válidas de la tienda

## 📞 Transferencia a Humano

Palabras clave que activan la transferencia:
- "hablar con humano"
- "hablar con persona"
- "atención humana"
- "transferir"
- "vendedor humano"

## 🔧 Mantenimiento

- Productos se cargan desde `data/products_filtered.json`
- Logs en tiempo real en la consola de Railway
- Reinicio automático en caso de fallos

---

**Desarrollado para ASOFERRU Urabá** 🛠️
