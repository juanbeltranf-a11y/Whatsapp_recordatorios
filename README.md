# 🤖 WhatsApp Bot de Recordatorios, Multimedia y Asistente IA

Un asistente inteligente para **WhatsApp** impulsado por Inteligencia Artificial (**Groq / Llama 3** y **Whisper**) con persistencia en **PostgreSQL**, motor de recordatorios programados, almacenamiento de notas/imágenes y descarga de música.

---

## 🌟 Características Principales

1. **⏰ Recordatorios Inteligentes y Múltiples**
   - Reconoce recordatorios en lenguaje natural (fechas relativas, horas exactas, días recurrentes como *"los lunes a las 8am y los viernes a las 5pm"*).
   - Soporta agendar múltiples recordatorios en un único mensaje.
   - Envío puntual de alertas mediante un planificador robusto con reintentos y persistencia en PostgreSQL.

2. **🎙️ Notas de Voz (Transcripción con Whisper)**
   - Escucha y transcribe audios de WhatsApp en milisegundos mediante la API de **Groq Whisper** (`whisper-large-v3`).
   - Permite crear recordatorios, pedir canciones o interactuar simplemente enviando una nota de voz.

3. **📸 Guardado y Recuperación de Fotos y Enlaces**
   - **Guardar imágenes:** Envía una foto con el texto *"guarda esta imagen que es mi cédula"*.
   - **Recuperar imágenes:** Dile *"pásame la foto de mi cédula"* y el bot te enviará de vuelta la imagen original.
   - **Guardar enlaces:** Envía un link con contexto y pídelo después (*"¿cuál era el link del repositorio?"*).
   - **Listado:** Pregunta *"¿qué tengo guardado?"* para obtener un inventario de tus elementos.

4. **🎵 Buscador y Envío de Canciones en Audio**
   - Envía canciones completas en audio con solo pedirlas: *"Envíame la canción Fuentes de Ortiz"*.
   - Motor optimizado con búsqueda rápida en **SoundCloud** (2 a 4 segundos, sin bloqueos de bot) y fallback a **YouTube**.
   - Conversión automática a MP3 de alta compatibilidad mediante `ffmpeg`.

5. **🖥️ Dashboard Web (Next.js)**
   - Panel de control moderno para visualizar el código QR de vinculación, estado de la conexión y recordatorios activos.

---

## 🏗️ Arquitectura del Repositorio

El proyecto está organizado en dos componentes principales:

```
├── bot/                # Servicio Backend del Bot de WhatsApp
│   ├── src/
│   │   ├── index.js             # Punto de entrada y servidor Express (QR & API)
│   │   ├── whatsapp.js          # Cliente WhatsApp-Web.js, eventos y gestión de cola
│   │   ├── groq.js              # Procesamiento de lenguaje natural y clasificación de intents
│   │   ├── audioTranscriber.js  # Transcripción de notas de voz con Groq Whisper
│   │   ├── music.js             # Búsqueda y descarga de canciones (yt-dlp + ffmpeg)
│   │   ├── savedItems.js        # Almacenamiento y búsqueda de enlaces e imágenes
│   │   └── scheduler.js        # Motor de recordatorios y alertas programadas
│   ├── prisma/
│   │   └── schema.prisma        # Modelos PostgreSQL (User, Reminder, SavedItem)
│   ├── Dockerfile               # Configuración de despliegue en producción (Railway)
│   └── package.json
│
├── dashboard/          # Panel Frontend Web (Next.js + TailwindCSS)
│   ├── src/
│   │   ├── pages/               # Vistas y endpoints de API del dashboard
│   │   └── components/          # Componentes visuales interactivos
│   └── package.json
│
└── README.md
```

---

## 🛠️ Tecnologías Utilizadas

- **Runtime:** Node.js 20+
- **WhatsApp API:** [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) con Chromium Headless
- **Motor de Inteligencia Artificial:** [Groq Cloud SDK](https://console.groq.com) (Llama 3 70B & Whisper Large v3)
- **Base de Datos:** PostgreSQL con ORM [Prisma](https://www.prisma.io/)
- **Procesamiento Multimedia:** `yt-dlp` y `ffmpeg`
- **Frontend Dashboard:** Next.js 14, React 18, Tailwind CSS, Lucide Icons
- **Despliegue Recomendado:** [Railway](https://railway.app/) (Bot con Docker) y [Vercel](https://vercel.com/) (Dashboard)

---

## ⚙️ Configuración y Variables de Entorno

### 1. Variables del Bot (`bot/.env`)

```env
# Puerto del servidor
PORT=3000

# Base de datos PostgreSQL
DATABASE_URL="postgresql://usuario:password@host:puerto/basededatos?sslmode=require"

# API Key de Groq para LLM y Whisper
GROQ_API_KEY="gsk_xxxxxxxxxxxxxxxxxxxx"

# Ruta para persistir la sesión de WhatsApp (en Docker suele ser /app/data)
WWEBJS_DIR="./.wwebjs_auth"
```

### 2. Variables del Dashboard (`dashboard/.env.local`)

```env
NEXT_PUBLIC_BOT_API_URL="https://tu-bot-en-railway.up.railway.app"
DASHBOARD_PIN="1234"
```

---

## 🚀 Puesta en Marcha Local

### 1. Iniciar el Bot

```bash
cd bot
npm install
npx prisma generate
npx prisma db push
npm run start
```

Escanea el código QR que aparecerá en la consola o abre en el navegador `http://localhost:3000/api/qr`.

### 2. Iniciar el Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Abre `http://localhost:3000` para acceder a la interfaz.

---

## 📦 Despliegue en Producción

### Bot (Railway con Docker)
El repositorio incluye un `Dockerfile` optimizado en Debian Bookworm Slim con Chromium, fuentes de sistema, `ffmpeg` y `yt-dlp`:
1. Crea un nuevo servicio en Railway conectado a este repositorio o usa Railway CLI:
   ```bash
   railway up
   ```
2. Asigna un volumen persistente montado en `/app/data` para preservar la sesión de WhatsApp (`LocalAuth`) entre reinicios sin tener que re-escanear el QR.
3. Configura las variables de entorno (`DATABASE_URL`, `GROQ_API_KEY`, etc.).

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.
