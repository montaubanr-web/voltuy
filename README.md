# AutosEléctricos.uy · portal de vehículos eléctricos de Uruguay

Sitio estático (HTML + CSS + JS, sin compilación) con datos en JSON, una API mínima para
debates, cotizaciones y newsletter, y agentes que actualizan la información.
Nombre del sitio: AutosEléctricos.uy (dominio autoselectricos.uy).

## Estructura

| Carpeta / archivo | Qué es |
|---|---|
| `index.html`, `assets/` | El sitio: inicio, catálogo, comparador, noticias, normativa, calculadora, debates |
| `data/*.json` | Toda la información. Los agentes solo tocan estos archivos |
| `functions/api/[[route]].js` | API (Cloudflare Pages Functions): comentarios moderados, leads, newsletter |
| `schema.sql` | Tablas de la base D1 |
| `agents/actualizar_*.py` + `.github/workflows/actualizar.yml` | Agentes diarios gratuitos: nafta (ANCAP), noticias, tests y cargadores |
| `agents/PROMPT_agente_claude.md` | Agente editorial semanal (precios, normativa, resúmenes) |

## Publicarlo gratis (unos 30 minutos)

1. **GitHub**: creá un repositorio público `voltuy` y subí esta carpeta. En repos públicos
   GitHub Actions es gratis, así que el agente diario no cuesta nada.
2. **Cloudflare Pages** (plan gratuito): *Workers & Pages → Create → Pages → Connect to Git*,
   elegí el repo. Build command: vacío. Output directory: `/`. Cada commit del agente
   republica el sitio solo. Quedás con una dirección `voltuy.pages.dev`.
3. **Base de datos D1** (gratis): `npx wrangler d1 create voltuy`, luego
   `npx wrangler d1 execute voltuy --remote --file=schema.sql`. En el proyecto de Pages:
   *Settings → Bindings → D1* con nombre `DB`, y *Variables → Secret* `ADMIN_TOKEN`
   con una clave larga.
4. **Moderar comentarios**: `GET /api/admin/pendientes` y `POST /api/admin/moderar`
   con `Authorization: Bearer <ADMIN_TOKEN>` (o pedile a Claude que los modere por vos).

## Debates: decisión tomada

Comentarios propios con moderación previa, sin obligar a crear cuenta (menos fricción para
el público general). Antispam: campo trampa + máximo 5 comentarios por hora por IP
(guardada como hash). Si la comunidad crece, el siguiente paso es Discourse o login con Google.

## Monetización (preparada desde el día uno)

| Vía | Cómo está implementada | Cuándo activarla |
|---|---|---|
| Publicidad (AdSense u otra red) | Espacios `.ad-slot` en inicio, catálogo y calculadora; comentario en `<head>` para el script | Con dominio propio y tráfico; AdSense no aprueba subdominios gratuitos |
| Leads a concesionarios | Botón «Cotizar» → tabla `leads` con consentimiento explícito | Ya: se vende por lead o por mes a importadores |
| Listados destacados | `"destacado": true` en `modelos.json` → sello y primer lugar | Paquete mensual para marcas |
| Patrocinio de secciones | Espacio en la calculadora (cargadores domiciliarios, seguros) | Acuerdos directos |
| Newsletter | Tabla `suscriptores` | Patrocinio del envío semanal cuando haya audiencia |

El único gasto recomendado a corto plazo es el dominio propio (anual), necesario para AdSense.

## Agentes

Todos corren gratis en GitHub Actions, todos los días a las 07:17 de Uruguay, y hacen commit
solo si algo cambió (Cloudflare republica el sitio automáticamente).

| Agente | Fuente | Qué actualiza |
|---|---|---|
| `actualizar_combustible.py` | Ficha de la Súper 95 en ancap.com.uy | Precio que usa la calculadora |
| `actualizar_noticias.py` | Google Noticias Uruguay, Electrek, InsideEVs, electrive | Noticias Uruguay e internacionales |
| `actualizar_tests.py` | Pruebas de medios uruguayos (vía Google Noticias), InsideEVs, medios en español | Sección Tests y botón «tests» de cada modelo |
| `actualizar_cargadores.py` | Open Charge Map (CC BY 4.0) + OpenStreetMap (ODbL) | Mapa de cargadores |
| `actualizar_ursea.py` | Registro de Etiquetado Vehicular de URSEA (CSV público) | `data/ursea.json` y consumo/batería/autonomía homologados en el catálogo |

Para el mapa conviene crear una clave gratuita en openchargemap.org y guardarla como secreto
`OCM_API_KEY` del repositorio; sin clave usa la exportación pública (se actualiza con menos frecuencia).
Fuentes de noticias editables en `agents/fuentes.json`.

### Costos de energía y planificador de viaje
- `data/tarifas.json`: tarifas residenciales de UTE (Doble y Triple Horario, sin IVA; el sitio suma 22%) y red
  pública UTE (cargo base + kWh + minuto inactivo). Cambian una o dos veces por año: las revisa el agente semanal.
- `data/combustible.json`: Súper 95, Premium 97, Gasoil 10-S y 50-S desde ANCAP, todos los días.
- Planificador: ruta por calle vía `/api/ruta`, que usa OpenRouteService si guardás una clave gratuita como secreto
  `ORS_API_KEY` en Cloudflare (recomendado: el servidor público de OSRM es solo para pruebas) y cachea cada ruta
  una semana. Origen y destino libres se geocodifican con Nominatim (OpenStreetMap).
- Consumo por modelo: rendimiento homologado de URSEA (km/kWh) cuando la asociación con el catálogo es confiable;
  si no, estimación por segmento. URSEA publica el rendimiento redondeado a entero y algunos registros tienen datos
  dudosos (p. ej. batería), por eso cada asociación lleva un nivel de certeza y las de certeza baja no se usan.

### Espera en cargadores
- Hoy: estimación orientativa (hora, día, temporada, potencia y cantidad de conectores) + reportes
  de usuarios (`/api/reportes`), que pasan a mostrarse como mediana real por cargador.
- Google Maps y Waze no sirven para esto: miden tránsito en calles, no ocupación de cargadores, y
  sus datos no son abiertos.
- La fuente ideal es UTE: su app UTE Mueve ya muestra en tiempo real cuántos cargadores están libres
  u ocupados por estación. Conviene pedirle a UTE acceso a esos datos (convenio o datos abiertos);
  con eso la espera pasa de estimada a real.
- **Editorial semanal (Claude)**: tarea programada de Claude con `agents/PROMPT_agente_claude.md`.
  Verifica precios, agrega modelos, revisa normativa y escribe resúmenes propios. Necesita
  acceso de escritura al repositorio.

## Probar en tu computadora

`python3 -m http.server 8000` dentro de la carpeta y abrí http://localhost:8000
(la API solo funciona publicada en Cloudflare o con `npx wrangler pages dev .`).

## Newsletter y correo de contacto (costo cero)

**Correo de contacto**
- Ya: crear una casilla gratuita dedicada (p. ej. Gmail) y cargarla como `CONTACTO_EMAIL`.
- Con dominio propio: Cloudflare Email Routing (gratis) reenvía hola@, anuncios@ y prensa@ a esa casilla.
  Para responder *desde* hola@dominio, configurar en Gmail «Enviar como» con el SMTP gratuito de Brevo.
- El sitio no muestra la dirección: usa el formulario «Escribinos» (`/api/contacto`), que guarda el mensaje en D1
  y, con Brevo configurado, lo reenvía por correo con «responder a» del remitente. Antispam: campo trampa + 3/hora por IP.

**Newsletter (Brevo, plan gratuito: 300 correos por día, contactos ilimitados)**
1. Crear cuenta en Brevo, una lista («Suscriptores web») y una plantilla de doble confirmación.
2. Secretos/variables en Cloudflare: `BREVO_API_KEY`, `BREVO_LIST_ID`, `BREVO_DOI_TEMPLATE`, `SITIO_URL`.
   Desde ese momento el formulario del sitio da de alta con doble confirmación (obligatoria por buenas prácticas
   y para no caer en spam). Sin Brevo, los correos quedan guardados en D1.
3. En GitHub: secreto `BREVO_API_KEY` y variables `BREVO_LIST_ID`, `SITIO_URL`, `SITIO_NOMBRE`,
   `NEWSLETTER_REMITENTE`, `CONTACTO_EMAIL`.
4. Cada jueves `agents/generar_newsletter.py` arma el número con los datos de la semana y lo deja como
   **borrador** en Brevo. Se revisa y se envía a mano. El HTML queda archivado en `newsletter/`.
- Límite gratuito: 300 correos/día. Con más suscriptores, Brevo reparte el envío en varios días o se pasa
  al plan Starter (desde US$ 9/mes). El pie del correo incluye «Darte de baja» (obligatorio).
- Formato: noticias de la semana · precios que cambiaron · nafta vs. eléctrico cada 100 km · test destacado ·
  cargadores nuevos · debate de la semana · espacio patrocinado.

## Comunidad (consumo real, problemas, debates con encuesta)
- Formulario «Contá tu experiencia» → `POST /api/experiencias` (tabla `experiencias`; el texto libre queda pendiente de moderación).
- `GET /api/comunidad` devuelve las experiencias anónimas (sin texto ni IP) y los votos; el sitio calcula medianas por modelo (mínimo 3 dueños, valores entre 6 y 40 kWh/100 km).
- Encuesta por debate: opciones en `data/debates.json` → `POST /api/votos` (un voto por persona y debate).
- Agente semanal `agents/analizar_comunidad.py` (en el workflow del jueves, antes del newsletter): lee `/api/admin/export` con `ADMIN_TOKEN`, extrae consumos citados en comentarios, clasifica problemas y escribe `data/comunidad.json` (resúmenes de debates y «lo que dejó la semana»). Prueba local: `python agents/analizar_comunidad.py --archivo export.json`.
- No se leen otras redes: Facebook eliminó su API de grupos, Reddit exige contrato para uso comercial y YouTube prohíbe métricas derivadas de comentarios.
- Moderar textos de experiencias: `POST /api/admin/moderar` con `{"id":…, "accion":"aprobar", "tipo":"experiencia"}`.

## Precios y modelos (agente diario + revisión semanal)
- `agents/actualizar_precios.py` corre todos los días. Fuentes por prioridad: sitios de importadores (`agents/fuentes/importadores.json`), tiendas oficiales de MercadoLibre (API; secretos `ML_CLIENT_ID` y `ML_CLIENT_SECRET`) y mielectrico.uy solo como control cruzado.
- Aplica solo cambios de fuentes oficiales menores al 15 %. Lo demás (cambios grandes, modelos nuevos, posibles discontinuados, diferencias con la referencia) va a `data/precios_revision.json` y a un issue de GitHub con etiqueta `precios`.
- La tarea editorial semanal de Claude completa las URLs de importadores y resuelve el issue.
- Credenciales de MercadoLibre: crear una aplicación gratuita en https://developers.mercadolibre.com.uy (menú "Mis aplicaciones"), copiar el Client ID y el Client Secret y guardarlos como secretos del repositorio. El agente pide el token solo.
- `agents/importar_relevamiento.py` sirvió para la carga inicial desde un relevamiento de referencia (`agents/fuentes/`).
