# IG Media Downloader

Extensión de Chrome (Manifest V3) para descargar imágenes y videos de Instagram en máxima calidad. Soporta posts, carruseles, reels y stories.

## Funcionalidades

- **Extracción en máxima calidad** — selecciona automáticamente la resolución más alta disponible
- **Soporte completo** — posts individuales, carruseles (múltiples imágenes), reels y stories
- **Galería en popup** — previsualización de todos los medios detectados en una cuadrícula
- **Descarga individual** — botón de descarga en cada tarjeta de la galería
- **Selección múltiple** — checkboxes para seleccionar medios específicos y descargarlos como ZIP
- **Descarga total en ZIP** — empaqueta todos los medios de la publicación en un solo archivo ZIP
- **Barra de progreso** — indicador visual durante la creación del ZIP
- **Tema oscuro** — interfaz consistente con la estética de Instagram

## Estructura del Proyecto

```
ig-downloader-chrome-ext/
├── manifest.json                 # Manifiesto MV3 de la extensión
├── lib/jszip.min.js              # Librería JSZip para creación de ZIPs
├── icons/icon{16,48,128}.png     # Iconos de la extensión
├── content/extractor.js          # Content script: detección de página + extracción de medios
├── popup/
│   ├── popup.html                # Estructura de la galería
│   ├── popup.css                 # Estilos (tema oscuro)
│   └── popup.js                  # Renderizado, selección y triggers de descarga
└── background/service-worker.js  # Manejo de descargas y creación de ZIPs
```

## Arquitectura

### Flujo de Comunicación

```
Popup ──sendMessage──▸ Content Script (extrae medios de la página de IG)
Popup ──sendMessage──▸ Service Worker (dispara descargas / creación de ZIP)
Service Worker ──sendMessage──▸ Popup (actualizaciones de progreso)
```

### Estrategia de Extracción (3 capas con fallback)

El content script (`content/extractor.js`) utiliza un enfoque de 3 capas para maximizar la compatibilidad:

| Capa | Método | Descripción |
|------|--------|-------------|
| 1 | **REST API** | `GET /p/{shortcode}/?__a=1&__d=dis` — retorna JSON con `image_versions2.candidates[]` y `video_versions[]` |
| 2 | **GraphQL API** | `POST /api/graphql` con `doc_id` — retorna `xdt_shortcode_media` con URLs de máxima calidad |
| 3 | **DOM Scraping** | Parsea elementos `<video>` e `<img srcset>` directamente del HTML de la página |

Para **Stories** se usa una ruta diferente:
1. `/api/v1/users/web_profile_info/` para obtener el ID del usuario
2. `/api/v1/feed/reels_media/?reel_ids={id}` para obtener los items del story

Todas las llamadas API usan `credentials: 'include'` (cookies de sesión del usuario) + headers de autenticación de Instagram (`X-IG-App-ID`, CSRF token).

### Selección de Máxima Calidad

Para cada medio, se selecciona el candidato con el mayor `width * height` de los arrays `image_versions2.candidates[]` o `video_versions[]`.

### Creación de ZIP (Service Worker)

- Usa la librería **JSZip** cargada via `importScripts`
- Descarga cada URL de medio como blob en paralelo (concurrencia limitada a 4)
- Envía actualizaciones de progreso al popup durante la creación
- Dispara `chrome.downloads.download()` con `saveAs: true` para que el usuario elija dónde guardar

### Detección de Tipo de Página

| Tipo | Patrón de URL |
|------|---------------|
| Post | `/p/{shortcode}/` |
| Reel | `/reel/{shortcode}/` o `/reels/{shortcode}/` |
| Story | `/stories/{username}/{storyId}/` |

## Instalación

### Requisitos

- Google Chrome (o navegador basado en Chromium)
- Sesión activa en Instagram (debes estar logueado)

### Pasos

1. **Clonar o descargar** el repositorio:
   ```bash
   git clone <url-del-repositorio>
   ```

2. Abrir Chrome y navegar a:
   ```
   chrome://extensions/
   ```

3. Activar el **Modo de desarrollador** (esquina superior derecha)

4. Click en **"Cargar extensión sin empaquetar"** (Load unpacked)

5. Seleccionar la carpeta `ig-downloader-chrome-ext`

6. La extensión aparecerá en la barra de herramientas con su icono

## Uso

### Descarga Individual

1. Navega a cualquier post, reel o story de Instagram
2. Haz click en el icono de la extensión en la barra de herramientas
3. Se abrirá un popup con la galería de medios detectados
4. Haz click en el botón **↓** de cualquier tarjeta para descargar ese medio

### Descarga Selectiva (ZIP)

1. Haz click en las tarjetas para seleccionar los medios que deseas
2. El contador de selección se actualiza en el footer
3. Click en **"Download Selected (ZIP)"** para descargar los medios seleccionados en un archivo ZIP

### Descarga Total (ZIP)

1. Click en **"Download All (ZIP)"** para descargar todos los medios de la publicación en un solo ZIP
2. La barra de progreso muestra el estado de la descarga y creación del ZIP

### Seleccionar Todo

- Usa el checkbox **"Select All"** en el footer para seleccionar o deseleccionar todos los medios

## Permisos

| Permiso | Motivo |
|---------|--------|
| `activeTab` | Acceder a la pestaña activa para inyectar el content script |
| `downloads` | Disparar descargas de archivos |
| `host_permissions` en `instagram.com` | Ejecutar el content script y realizar llamadas API |
| `host_permissions` en CDNs de Instagram | Descargar los archivos de medios desde los servidores CDN |

## Limitaciones

- **Requiere sesión activa**: debes estar logueado en Instagram para que las APIs funcionen
- **Posts privados**: solo puedes descargar medios de cuentas que puedas ver con tu sesión
- **Rate limiting**: Instagram puede limitar las solicitudes si se hacen demasiadas en poco tiempo
- **Cambios en la API**: Instagram puede cambiar sus endpoints internos, lo que podría requerir actualizar la extensión
