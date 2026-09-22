# 🛠️ Registro Post-Mortem y Solución de Errores - WhatsApp Bot & Dashboard
> **Proyecto:** WhatsApp Bot Recordatorios & Finanzas  
> **Repositorio:** `juanbeltranf-a11y/Whatsapp_recordatorios`  
> **Fecha:** 2026-09-21  

---

## 1. Incidencia: Consumo Excesivo de Saldo y RAM en Railway ($4.45 / $5.00)
* **Fecha:** 2026-09-20 / 2026-09-21
* **Síntoma:** El proyecto en Railway consumió $4.45 de los $5.00 de crédito gratuito en pocos días, con advertencia de suspensión por falta de fondos ("$0.03 left").
* **Causa Raíz:**
  1. El 95% del costo ($4.22) provino del consumo de memoria RAM acumulada (18,256 GB-minutos).
  2. Railway factura por minuto de RAM consumida ($0.000231/GB/min).
  3. Al no tener un límite estricto de memoria configurado en el contenedor, el proceso de Chromium headless (`whatsapp-web.js`) y las descargas de medios generaron picos de hasta 8.49 GB de memoria.
  4. La base de datos PostgreSQL en Railway también consumía recursos de fondo continuamente.
* **Solución Aplicada:**
  1. Migración total de la infraestructura a la máquina virtual **Always Free de Oracle Cloud (OCI Bogotá)** con 24 GB de RAM y 4 OCPUs ARM64.
  2. Aislamiento con Docker (`docker-compose.yml` con PostgreSQL 16 Alpine local y bot con Chromium).
  3. Costo operativo reducido a **$0 USD / mes** sin límites artificiales de memoria ni riesgo de sobrecostos.
  4. Apagado y desprovisionamiento del servicio en Railway para frenar cualquier cobro adicional.

---

## 2. Incidencia: Dashboard no visible en Vercel
* **Fecha:** 2026-09-21
* **Síntoma:** El usuario reportó que el dashboard del bot ya no aparecía en su cuenta de Vercel.
* **Causa Raíz:** El enlace previo del proyecto Next.js en `dashboard/.vercel` apuntaba a una ID anterior y requería revinculación bajo la organización activa de Vercel (`laborium`).
* **Solución Aplicada:**
  1. Revinculación con `vercel link --yes` creando `laborium/dashboard`.
  2. Configuración de variables de entorno de producción en Vercel (`NEXT_PUBLIC_BOT_API_URL=https://bot.157.137.224.233.sslip.io` y `DASHBOARD_PIN=1234`).
  3. Despliegue de producción ejecutado con éxito: [https://dashboard-ebon-beta-17.vercel.app](https://dashboard-ebon-beta-17.vercel.app).

---

## 3. Coexistencia Segura con el Backend del Colegio en Oracle Cloud
* **Fecha:** 2026-09-21
* **Contexto:** El servidor de Oracle Cloud ya alojaba el backend de `colegio-gimnasio-latinoamericano` en el puerto 5000 administrado por PM2.
* **Medida de Prevención y Aislamiento:**
  1. El bot se aisló 100% dentro de contenedores Docker en el puerto local 3000 y directorio `/home/ubuntu/whatsapp-bot/`.
  2. El Colegio continúa en su directorio `/home/ubuntu/colegio-backend/` sin tocar sus archivos, librerías ni base de datos Supabase.
  3. Proxy inverso Caddy validado con `caddy validate` y recargado en caliente con `systemctl reload caddy` (zero downtime).
  4. Verificación automatizada inmediata de `https://gimnasiolatinoamericano.com/api/health` confirmando `HTTP/2 200 OK` continuo.

---

## 4. Incidencia: Datos de personas no se guardaban ("Aún no tienes nada guardado")
* **Fecha:** 2026-09-21
* **Síntoma:** Cuando un usuario enviaba datos personales en texto (por ejemplo: _"Guardame estos datos: 36155047 Elvira Reyes, es la cedula de la vecina"_), el bot respondía _"Datos guardados correctamente"_, pero al consultar _"¿Qué datos me tienes guardados?"_ o _"¿Cuál es la cédula de la vecina?"_, respondía que no había nada guardado.
* **Causa Raíz:**
  1. En `src/whatsapp.js`, la rama `save_item` solo implementaba lógica condicional para `if (isImg)` y `else if (isLink)`.
  2. Al recibir texto puro (`type === 'text'`), no entraba en ninguna de las dos ramas y caía al final del handler en `intent: other`, enviando el mensaje genérico sin ejecutar `saveUserItem` en Prisma.
  3. `groq.js` no instruía al modelo que `get_item` abarcaba preguntas sobre datos y cédulas (solo decía imágenes/enlaces), ni contaba con heurísticas deterministas para consultas de memoria ni borrado de datos.
* **Solución Aplicada:**
  1. Agregado bloque `else` en `save_item` para persistir datos personales, cédulas, notas y textos con título y contenido en Prisma (`SavedItem`).
  2. Motor de búsqueda semántica y numérica mejorado en `savedItems.js` con soporte para búsqueda por números de documento (cédulas), nombres de personas y palabras clave.
  3. Formateador categorizado `formatSavedItemsList` para WhatsApp y soporte para `delete_item`.
  4. Heurísticas deterministas de alta velocidad (0.01ms) en `groq.js` para `save_item`, `get_item`, `list_items` y `delete_item`.
  5. Creación de suites de pruebas automáticas `bot/tests/memory.test.js` y `bot/tests/memory_flow.test.js` validadas al 100%.
  6. Recompilación y redespliegue en caliente del contenedor Docker en Oracle Cloud.
