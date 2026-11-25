// API de AutosEléctricosUY para Cloudflare Pages Functions + base de datos D1 (plan gratuito).
// Rutas:
//   GET  /api/comentarios?tema=ID      -> comentarios aprobados (con id y padre para las respuestas)
//   POST /api/comentarios               -> {tema, nombre, texto, padre?, email?, avisar?} queda "pendiente"
//   GET  /api/comentarios/confirmar?t=  -> confirma el correo para avisos de respuesta · GET /api/comentarios/baja?t= -> deja de avisar
//   GET  /api/comentarios/respuestas?h=RAIZ:DESDE,... -> respuestas aprobadas a mis conversaciones (campanita)
//   POST /api/leads                     -> pedido de cotización (para vender leads a concesionarios)
//   POST /api/newsletter                -> {email}  (con BREVO_API_KEY: alta con doble confirmación en Brevo)
//   POST /api/contacto                  -> {nombre, email, motivo, mensaje} (con BREVO_API_KEY: aviso por correo a CONTACTO_EMAIL)
//   GET  /api/ruta?o=lat,lon&d=lat,lon  -> ruta por calle (OpenRouteService si hay ORS_API_KEY; si no, OSRM público)
//   GET  /api/cargadores/estado          -> estado en vivo de los cargadores (mapa interoperable), con caché de 2 min
//   GET  /api/reportes?id=CARGADOR      -> mediana de espera reportada (últimos 90 días)
//   POST /api/reportes                  -> {cargador, espera (min), funciona (bool)}
//   POST /api/experiencias              -> {modelo, kwh100, uso, estacion, km, departamento, nota, problemas[], texto} (texto moderado)
//   GET  /api/comunidad                 -> experiencias anónimas (sin texto ni IP) + votos, para los promedios
//   POST /api/votos                     -> {tema, opcion} un voto por persona y debate
//   GET  /api/admin/export              -> datos aprobados para el agente semanal (con token)
//   GET  /api/admin/pendientes          -> requiere cabecera Authorization: Bearer <ADMIN_TOKEN>
//   POST /api/admin/moderar             -> {id, accion:"aprobar"|"rechazar"} con el mismo token
//   POST /api/alertas                   -> {email, modelo_id, objetivo?} alerta de precio (confirmación por correo)
//   GET  /api/alertas/confirmar?t=      -> confirma la alerta · GET /api/alertas/baja?t= -> la borra
//   GET  /api/alojamientos              -> alojamientos aprobados (destacados vigentes primero)
//   POST /api/alojamientos              -> alta de un alojamiento (plan básico o destacado; el destacado devuelve link de pago)
//   POST /api/mp/webhook                -> notificación de Mercado Pago (se verifica consultando el pago)
//   GET  /api/admin/alertas · POST /api/admin/alertas/avisado · GET /api/admin/alojamientos · POST /api/admin/alojamientos/aprobar
// Mercado Pago (opcional): MP_ACCESS_TOKEN. Precios de destacados: MP_PRECIO_TEMPORADA y MP_PRECIO_ANUAL (en $, por defecto 2490 y 5990).
// Variables a configurar en Cloudflare: binding D1 "DB" y secreto "ADMIN_TOKEN".
// Opcionales (newsletter y contacto con Brevo, plan gratuito): BREVO_API_KEY, BREVO_LIST_ID,
// BREVO_DOI_TEMPLATE (plantilla de confirmación), CONTACTO_EMAIL, SITIO_URL.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const clean = (s, max) => String(s ?? "").trim().slice(0, max);

async function hashIp(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "voltuy"));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}


const token = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const escH = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
async function correo(env, to, subject, html) {
  if (!env.BREVO_API_KEY || !env.CONTACTO_EMAIL) return false;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ sender: { name: "AutosEléctricosUY", email: env.CONTACTO_EMAIL }, to: [{ email: to }], subject, htmlContent: html }) });
  return r.ok;
}
// Respuestas y avisos: agrega las columnas nuevas a "comentarios" si la base es anterior (una vez por instancia).
let esquemaOk = false;
async function asegurarEsquema(db) {
  if (esquemaOk) return;
  const { results } = await db.prepare("PRAGMA table_info(comentarios)").all();
  const hay = new Set(results.map((c) => c.name));
  for (const [col, tipo] of [["padre", "INTEGER"], ["email", "TEXT"], ["avisar", "INTEGER NOT NULL DEFAULT 0"], ["avisado", "INTEGER NOT NULL DEFAULT 0"]])
    if (!hay.has(col)) await db.prepare(`ALTER TABLE comentarios ADD COLUMN ${col} ${tipo}`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_com_padre ON comentarios (padre, estado)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS avisos_correo (email TEXT PRIMARY KEY, token TEXT NOT NULL, confirmado INTEGER NOT NULL DEFAULT 0, baja INTEGER NOT NULL DEFAULT 0, enviado TEXT, creado TEXT NOT NULL DEFAULT (datetime('now')))").run();
  esquemaOk = true;
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Cuando se aprueba una respuesta: avisa por correo a quien abrió la conversación y a quienes respondieron antes,
// solo si lo pidieron y confirmaron su correo. Nunca al autor de la respuesta.
async function avisarRespuesta(db, env, base, id) {
  const r = await db.prepare("SELECT id, tema, nombre, texto, padre, email, avisado FROM comentarios WHERE id = ? AND estado = 'aprobado'").bind(id).first();
  if (!r || !r.padre || r.avisado) return;
  await db.prepare("UPDATE comentarios SET avisado = 1 WHERE id = ?").bind(id).run();
  const { results } = await db.prepare(
    `SELECT c.id, c.email, c.nombre, a.token FROM comentarios c JOIN avisos_correo a ON a.email = c.email
     WHERE (c.id = ? OR (c.padre = ? AND c.id < ?)) AND c.estado = 'aprobado' AND c.avisar = 1 AND a.confirmado = 1 AND a.baja = 0`).bind(r.padre, r.padre, r.id).all();
  const yo = (r.email || "").toLowerCase(), enviados = new Set();
  for (const d of results) {
    const e = d.email.toLowerCase();
    if (e === yo || enviados.has(e)) continue;
    enviados.add(e);
    const propio = d.id === r.padre;
    const link = `${base}/#debates/${encodeURIComponent(r.tema)}/c${r.id}`;
    await correo(env, d.email, `${r.nombre} te respondió en AutosEléctricosUY`,
      `<p>Hola ${escH(d.nombre)}: <b>${escH(r.nombre)}</b> respondió ${propio ? "a tu comentario" : "en una conversación en la que participaste"}:</p>
       <blockquote style="border-left:3px solid #16A34A;margin:12px 0;padding:4px 12px;color:#333">${escH(r.texto.slice(0, 400))}${r.texto.length > 400 ? "…" : ""}</blockquote>
       <p><a href="${link}">Ver la conversación y responder</a></p>
       <p style="color:#888;font-size:12px">Recibís este correo porque pediste que te avisemos cuando te respondan. <a href="${base}/api/comentarios/baja?t=${d.token}">No quiero más avisos</a></p>`);
  }
}
const PLANES = { destacado: { dias: 120, nombre: "Destacado temporada" }, destacado_anual: { dias: 365, nombre: "Destacado anual" } };

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const route = (params.route || []).join("/");
  const method = request.method;
  const db = env.DB;
  if (route === "cargadores/estado") {
    // Una sola consulta cada 2 minutos al mapa interoperable, sin importar cuántas personas miren el mapa.
    const cache = caches.default, clave = new Request("https://voltuy.cache/cargadores-estado");
    let r = await cache.match(clave);
    if (!r) {
      try {
        const res = await fetch("https://back-app.eve-move.com/eve/miem", { headers: { "user-agent": "AutosElectricosUY/1.0" } });
        const texto = await res.text();
        const fin = texto.indexOf("\n[");  // a veces el servicio devuelve dos listas pegadas
        const datos = JSON.parse(fin > 0 ? texto.slice(0, fin) : texto);
        const S = { Available: "L", Charging: "C", Unavailable: "F" };
        const lista = datos.filter((e) => e.latitude != null).map((e) => ({
          lat: +(+e.latitude).toFixed(5), lon: +(+e.longitude).toFixed(5),
          c: (e.cnns || []).map((k) => S[k.status] || "F").join("") }));
        r = new Response(JSON.stringify({ ok: true, hora: new Date().toISOString(), estaciones: lista }), {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120" } });
        await cache.put(clave, r.clone());
      } catch (e) {
        return json({ ok: false, error: "Estado en vivo no disponible" }, 502);
      }
    }
    return r;
  }
  if (!db) return json({ ok: false, error: "D1 no configurada" }, 500);

  try {
    if (route.startsWith("comentarios") || route === "admin/moderar") await asegurarEsquema(db);
    const baseUrl = env.SITIO_URL || url.origin;

    if (route === "comentarios" && method === "GET") {
      const tema = clean(url.searchParams.get("tema"), 60);
      const { results } = await db
        .prepare("SELECT id, padre, nombre, texto, strftime('%d/%m/%Y', creado) AS fecha FROM comentarios WHERE tema = ? AND estado = 'aprobado' ORDER BY id ASC LIMIT 500")
        .bind(tema).all();
      return json({ ok: true, comentarios: results, avisos: !!(env.BREVO_API_KEY && env.CONTACTO_EMAIL) });
    }

    if (route === "comentarios" && method === "POST") {
      const b = await request.json();
      if (b.web) return json({ ok: true, estado: "pendiente" });
      const tema = clean(b.tema, 60), nombre = clean(b.nombre, 40), texto = clean(b.texto, 1500);
      if (!tema || !nombre || texto.length < 5) return json({ ok: false, error: "Datos incompletos" }, 400);
      const email = clean(b.email, 120).toLowerCase();
      if (email && !EMAIL_RE.test(email)) return json({ ok: false, error: "Correo inválido" }, 400);
      const avisar = email && b.avisar ? 1 : 0;
      const ip = await hashIp(request.headers.get("cf-connecting-ip") || "");
      // Límite simple: 5 comentarios por hora por IP
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM comentarios WHERE ip = ? AND creado > datetime('now','-1 hour')").bind(ip).first();
      if (n >= 5) return json({ ok: false, error: "Demasiados comentarios, probá más tarde" }, 429);
      // Las respuestas siempre cuelgan del comentario que abrió la conversación (un solo nivel).
      let padre = null;
      if (Number(b.padre) > 0) {
        const p = await db.prepare("SELECT id, padre FROM comentarios WHERE id = ? AND tema = ? AND estado = 'aprobado'").bind(Number(b.padre), tema).first();
        if (!p) return json({ ok: false, error: "El comentario que querés responder no existe" }, 400);
        padre = p.padre || p.id;
      }
      const ins = await db.prepare("INSERT INTO comentarios (tema, nombre, texto, ip, padre, email, avisar) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(tema, nombre, texto, ip, padre, email || null, avisar).run();
      let confirmar = false;
      if (avisar) {
        await db.prepare("INSERT OR IGNORE INTO avisos_correo (email, token) VALUES (?, ?)").bind(email, token()).run();
        const a = await db.prepare("SELECT token, confirmado, baja, enviado FROM avisos_correo WHERE email = ?").bind(email).first();
        // Sin confirmar, o dado de baja antes: se vuelve a pedir confirmación (nadie puede reactivar avisos de otro).
        if (!a.confirmado || a.baja) {
          confirmar = true;
          // Un correo de confirmación por día como máximo, para que nadie use el formulario para molestar a otro.
          const reciente = a.enviado && Date.parse(a.enviado.replace(" ", "T") + "Z") > Date.now() - 86400000;
          if (!reciente && await correo(env, email, "Confirmá tu correo para recibir respuestas en AutosEléctricosUY",
            `<p>Hola ${escH(nombre)}: pediste que te avisemos cuando alguien responda tus comentarios en AutosEléctricosUY.</p><p><a href="${baseUrl}/api/comentarios/confirmar?t=${a.token}">Confirmar mi correo</a></p><p style="color:#888;font-size:12px">Lo pedís una sola vez. Si no fuiste vos, ignorá este correo y no te vamos a escribir.</p>`))
            await db.prepare("UPDATE avisos_correo SET enviado = datetime('now') WHERE email = ?").bind(email).run();
        }
      }
      return json({ ok: true, estado: "pendiente", id: ins.meta.last_row_id, raiz: padre || ins.meta.last_row_id, confirmar });
    }

    if (route === "comentarios/confirmar" || route === "comentarios/baja") {
      const t = clean(url.searchParams.get("t"), 64);
      const ok = t && (await db.prepare(route === "comentarios/confirmar" ? "UPDATE avisos_correo SET confirmado = 1, baja = 0 WHERE token = ?" : "UPDATE avisos_correo SET baja = 1 WHERE token = ?").bind(t).run()).meta.changes;
      return Response.redirect(`${baseUrl}/#debates/${ok ? (route === "comentarios/confirmar" ? "aviso-confirmado" : "aviso-baja") : "aviso-invalido"}`, 302);
    }

    if (route === "comentarios/respuestas" && method === "GET") {
      // h = "raiz:desde,raiz:desde" (máx. 40): respuestas aprobadas posteriores a mi comentario en cada conversación.
      const pares = clean(url.searchParams.get("h"), 800).split(",").map((p) => p.split(":").map(Number)).filter(([r, d]) => r > 0 && d > 0).slice(0, 40);
      if (!pares.length) return json({ ok: true, respuestas: [] });
      const where = pares.map(() => "(padre = ? AND id > ?)").join(" OR ");
      const { results } = await db.prepare(`SELECT id, padre, tema, nombre, strftime('%d/%m/%Y', creado) AS fecha FROM comentarios WHERE estado = 'aprobado' AND (${where}) ORDER BY id DESC LIMIT 50`)
        .bind(...pares.flat()).all();
      return json({ ok: true, respuestas: results });
    }

    if (route === "leads" && method === "POST") {
      const b = await request.json();
      if (!b.email || !b.nombre) return json({ ok: false }, 400);
      await db.prepare("INSERT INTO leads (modelo, nombre, email, telefono, departamento) VALUES (?, ?, ?, ?, ?)")
        .bind(clean(b.modelo, 60), clean(b.nombre, 80), clean(b.email, 120), clean(b.telefono, 40), clean(b.departamento, 40)).run();
      return json({ ok: true });
    }

    if (route === "newsletter" && method === "POST") {
      const b = await request.json();
      const email = clean(b.email, 120).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false }, 400);
      await db.prepare("INSERT OR IGNORE INTO suscriptores (email) VALUES (?)").bind(email).run();
      if (env.BREVO_API_KEY && env.BREVO_LIST_ID && env.BREVO_DOI_TEMPLATE) {
        // Doble confirmación: Brevo manda un correo y recién al confirmar entra a la lista
        await fetch("https://api.brevo.com/v3/contacts/doubleOptinConfirmation", {
          method: "POST", headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ email, includeListIds: [Number(env.BREVO_LIST_ID)], templateId: Number(env.BREVO_DOI_TEMPLATE),
            redirectionUrl: `${env.SITIO_URL || url.origin}/#gracias` }),
        });
        return json({ ok: true, confirmar: true });
      }
      return json({ ok: true });
    }

    if (route === "contacto" && method === "POST") {
      const b = await request.json();
      if (b.web) return json({ ok: true }); // trampa para bots
      const nombre = clean(b.nombre, 80), email = clean(b.email, 120), motivo = clean(b.motivo, 40), mensaje = clean(b.mensaje, 3000);
      if (!nombre || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || mensaje.length < 5) return json({ ok: false }, 400);
      const ip = await hashIp(request.headers.get("cf-connecting-ip") || "");
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM contactos WHERE ip = ? AND creado > datetime('now','-1 hour')").bind(ip).first();
      if (n >= 3) return json({ ok: false, error: "Demasiados mensajes" }, 429);
      await db.prepare("INSERT INTO contactos (nombre, email, motivo, mensaje, ip) VALUES (?, ?, ?, ?, ?)").bind(nombre, email, motivo, mensaje, ip).run();
      if (env.BREVO_API_KEY && env.CONTACTO_EMAIL) {
        const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST", headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ sender: { name: "Web AutosEléctricosUY", email: env.CONTACTO_EMAIL }, to: [{ email: env.CONTACTO_EMAIL }],
            replyTo: { email, name: nombre }, subject: `[Contacto · ${motivo}] ${nombre}`,
            htmlContent: `<p><b>${esc(nombre)}</b> (${esc(email)}) · ${esc(motivo)}</p><p>${esc(mensaje).replace(/\n/g, "<br>")}</p>` }),
        });
      }
      return json({ ok: true });
    }

    if (route === "ruta" && method === "GET") {
      const coord = (x) => (x || "").split(",").map(Number);
      const [olat, olon] = coord(url.searchParams.get("o")), [dlat, dlon] = coord(url.searchParams.get("d"));
      if ([olat, olon, dlat, dlon].some((n) => !Number.isFinite(n))) return json({ ok: false }, 400);
      const cache = caches.default, clave = new Request(`https://cache.voltuy/ruta/${olat.toFixed(3)},${olon.toFixed(3)}/${dlat.toFixed(3)},${dlon.toFixed(3)}`);
      const hit = await cache.match(clave); if (hit) return hit;
      let res;
      if (env.ORS_API_KEY) {
        const r = await fetch(`https://api.openrouteservice.org/v2/directions/driving-car/geojson`, {
          method: "POST", headers: { Authorization: env.ORS_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ coordinates: [[olon, olat], [dlon, dlat]] }) });
        const j = await r.json(), f = j.features && j.features[0];
        if (f) res = { ok: true, km: f.properties.summary.distance / 1000, min: f.properties.summary.duration / 60, coords: f.geometry.coordinates.map(([lo, la]) => [la, lo]) };
      }
      if (!res) {
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${olon},${olat};${dlon},${dlat}?overview=full&geometries=geojson`, { headers: { "User-Agent": "AutosElectricosUY/1.0" } });
        const j = await r.json(), rt = j.routes && j.routes[0];
        if (rt) res = { ok: true, km: rt.distance / 1000, min: rt.duration / 60, coords: rt.geometry.coordinates.map(([lo, la]) => [la, lo]) };
      }
      if (!res) return json({ ok: false }, 502);
      const resp = new Response(JSON.stringify(res), { headers: { "content-type": "application/json", "cache-control": "public, max-age=604800" } });
      await cache.put(clave, resp.clone());
      return resp;
    }

    if (route === "reportes" && method === "GET") {
      const id = clean(url.searchParams.get("id"), 60);
      const { results } = await db.prepare(
        "SELECT espera, funciona FROM reportes WHERE cargador = ? AND creado > datetime('now','-90 days') ORDER BY espera").bind(id).all();
      if (!results.length) return json({ ok: false });
      const fallas = (await db.prepare(
        "SELECT COUNT(*) AS n FROM reportes WHERE cargador = ? AND funciona = 0 AND creado > datetime('now','-7 days')").bind(id).first()).n;
      return json({ ok: true, n: results.length, mediana: results[Math.floor(results.length / 2)].espera, fallas });
    }

    if (route === "reportes" && method === "POST") {
      const b = await request.json();
      const id = clean(b.cargador, 60), espera = Math.max(0, Math.min(240, parseInt(b.espera, 10) || 0));
      if (!id) return json({ ok: false }, 400);
      const ip = await hashIp(request.headers.get("cf-connecting-ip") || "");
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM reportes WHERE ip = ? AND creado > datetime('now','-1 hour')").bind(ip).first();
      if (n >= 6) return json({ ok: false, error: "Demasiados reportes" }, 429);
      await db.prepare("INSERT INTO reportes (cargador, espera, funciona, hora, ip) VALUES (?, ?, ?, ?, ?)")
        .bind(id, espera, b.funciona ? 1 : 0, new Date().getUTCHours(), ip).run();
      return json({ ok: true });
    }

    const PROB = ["carga_publica", "espera_carga", "posventa", "repuestos", "software", "bateria", "cargador_casa", "terminaciones", "entrega"];
    if (route === "experiencias" && method === "POST") {
      const b = await request.json();
      if (b.web) return json({ ok: true });
      const modelo = clean(b.modelo, 60), kwh = Number(b.kwh100);
      if (!modelo || !(kwh >= 3 && kwh <= 60)) return json({ ok: false, error: "Datos incompletos" }, 400);
      const ip = await hashIp(request.headers.get("cf-connecting-ip") || "");
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM experiencias WHERE ip = ? AND creado > datetime('now','-1 day')").bind(ip).first();
      if (n >= 3) return json({ ok: false, error: "Ya registraste experiencias hoy" }, 429);
      const uso = ["ciudad", "mixto", "ruta"].includes(b.uso) ? b.uso : "mixto";
      const est = ["verano", "otono", "invierno", "primavera"].includes(b.estacion) ? b.estacion : null;
      const nota = Number.isInteger(b.nota) && b.nota >= 1 && b.nota <= 5 ? b.nota : null;
      const probs = (Array.isArray(b.problemas) ? b.problemas : []).filter((x) => PROB.includes(x)).join(",");
      const texto = clean(b.texto, 800);
      await db.prepare("INSERT INTO experiencias (modelo, kwh100, uso, estacion, km, departamento, nota, problemas, texto, texto_estado, ip) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(modelo, Math.round(kwh * 10) / 10, uso, est, Math.max(0, Math.min(500000, parseInt(b.km, 10) || 0)) || null, clean(b.departamento, 40) || null,
          nota, probs, texto || null, texto ? "pendiente" : null, ip).run();
      return json({ ok: true });
    }

    if (route === "comunidad" && method === "GET") {
      const cache = caches.default, clave = new Request("https://cache.voltuy/comunidad");
      const hit = await cache.match(clave); if (hit) return hit;
      const { results } = await db.prepare(
        "SELECT modelo, kwh100, uso, estacion, nota, problemas FROM experiencias WHERE creado > datetime('now','-24 months') ORDER BY creado DESC LIMIT 5000").all();
      const experiencias = results.map((r) => ({ ...r, problemas: r.problemas ? r.problemas.split(",") : [] }));
      const votos = {};
      (await db.prepare("SELECT tema, opcion, COUNT(*) AS n FROM votos GROUP BY tema, opcion").all()).results
        .forEach((v) => { (votos[v.tema] = votos[v.tema] || {})[v.opcion] = v.n; });
      const resp = new Response(JSON.stringify({ ok: true, experiencias, votos }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
      await cache.put(clave, resp.clone());
      return resp;
    }

    if (route === "votos" && method === "POST") {
      const b = await request.json();
      const tema = clean(b.tema, 60), opcion = clean(b.opcion, 60);
      if (!tema || !opcion) return json({ ok: false }, 400);
      const ip = await hashIp(request.headers.get("cf-connecting-ip") || "");
      await db.prepare("INSERT OR IGNORE INTO votos (tema, opcion, ip) VALUES (?, ?, ?)").bind(tema, opcion, ip).run();
      return json({ ok: true });
    }

    const base = env.SITIO_URL || url.origin;
    if (route === "alertas" && method === "POST") {
      const b = await request.json();
      if (b.web) return json({ ok: true });
      const email = clean(b.email, 120).toLowerCase(), modelo = clean(b.modelo_id, 80), objetivo = Number(b.objetivo) > 0 ? Math.round(Number(b.objetivo)) : null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !modelo) return json({ ok: false, error: "Datos inválidos" }, 400);
      const ip = await hashIp(request.headers.get("cf-connecting-ip") || "");
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM alertas WHERE ip = ? AND creado > datetime('now','-1 day')").bind(ip).first();
      if (n >= 10) return json({ ok: false, error: "Demasiadas alertas hoy" }, 429);
      const t = token();
      await db.prepare("INSERT INTO alertas (email, modelo_id, objetivo, token, ip) VALUES (?,?,?,?,?) ON CONFLICT(email, modelo_id) DO UPDATE SET objetivo = excluded.objetivo")
        .bind(email, modelo, objetivo, t, ip).run();
      const row = await db.prepare("SELECT token, confirmado FROM alertas WHERE email = ? AND modelo_id = ?").bind(email, modelo).first();
      if (!row.confirmado) await correo(env, email, "Confirmá tu alerta de precio en AutosEléctricosUY",
        `<p>Hola: pediste que te avisemos cuando baje el precio de <b>${escH(modelo)}</b>${objetivo ? ` por debajo de US$ ${objetivo}` : ""}.</p><p><a href="${base}/api/alertas/confirmar?t=${row.token}">Confirmar la alerta</a></p><p style="color:#888;font-size:12px">Si no fuiste vos, ignorá este correo.</p>`);
      return json({ ok: true });
    }
    if (route === "alertas/confirmar" || route === "alertas/baja") {
      const t = clean(url.searchParams.get("t"), 64);
      if (route === "alertas/confirmar") await db.prepare("UPDATE alertas SET confirmado = 1 WHERE token = ?").bind(t).run();
      else await db.prepare("DELETE FROM alertas WHERE token = ?").bind(t).run();
      return Response.redirect(`${base}/#${route === "alertas/confirmar" ? "alerta-confirmada" : "alerta-borrada"}`, 302);
    }

    if (route === "alojamientos" && method === "GET") {
      const { results } = await db.prepare(
        "SELECT id, nombre, tipo, localidad, departamento, lat, lon, cargador, acceso, url, foto, CASE WHEN destacado_hasta > datetime('now') THEN 1 ELSE 0 END AS destacado FROM alojamientos WHERE estado = 'aprobado' ORDER BY destacado DESC, nombre").all();
      return json({ ok: true, alojamientos: results.map((r) => ({ ...r, id: "a" + r.id, destacado: !!r.destacado })) });
    }
    if (route === "alojamientos" && method === "POST") {
      const b = await request.json();
      if (b.web) return json({ ok: true });
      const email = clean(b.email, 120), nombre = clean(b.nombre, 120), plan = ["basico", "destacado", "destacado_anual"].includes(b.plan) ? b.plan : "basico";
      if (!nombre || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "Datos incompletos" }, 400);
      const ip = await hashIp(request.headers.get("cf-connecting-ip") || "");
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM alojamientos WHERE ip = ? AND creado > datetime('now','-1 day')").bind(ip).first();
      if (n >= 3) return json({ ok: false, error: "Ya recibimos tu alta" }, 429);
      const r = await db.prepare("INSERT INTO alojamientos (nombre, tipo, localidad, cargador, acceso, url, email, plan, ip) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(nombre, clean(b.tipo, 40), clean(b.localidad, 80), clean(b.cargador, 60), clean(b.acceso, 60), clean(b.url, 300) || null, email, plan, ip).run();
      const id = r.meta.last_row_id;
      if (env.CONTACTO_EMAIL) await correo(env, env.CONTACTO_EMAIL, `[Alojamiento · ${plan}] ${nombre}`, `<p>${escH(nombre)} (${escH(b.localidad)}) · ${escH(email)} · ${escH(b.url || "")}</p>`);
      if (plan !== "basico" && env.MP_ACCESS_TOKEN) {
        const precio = Number(plan === "destacado" ? env.MP_PRECIO_TEMPORADA || 2490 : env.MP_PRECIO_ANUAL || 5990);
        const pref = await fetch("https://api.mercadopago.com/checkout/preferences", { method: "POST",
          headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ items: [{ title: `AutosEléctricosUY · ${PLANES[plan].nombre} · ${nombre}`, quantity: 1, unit_price: precio, currency_id: "UYU" }],
            payer: { email }, external_reference: `aloj:${id}:${plan}`, notification_url: `${base}/api/mp/webhook`,
            back_urls: { success: `${base}/#alojamientos`, failure: `${base}/#alojamientos`, pending: `${base}/#alojamientos` }, auto_return: "approved" }) });
        if (pref.ok) { const pj = await pref.json(); return json({ ok: true, pago: pj.init_point }); }
      }
      return json({ ok: true });
    }
    if (route === "mp/webhook" && method === "POST") {
      const b = await request.json().catch(() => ({}));
      const pid = (b.data && b.data.id) || url.searchParams.get("data.id") || url.searchParams.get("id");
      if (!pid || !env.MP_ACCESS_TOKEN) return json({ ok: true });
      const pr = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pid)}`, { headers: { authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
      if (!pr.ok) return json({ ok: true });
      const pago = await pr.json(), ref = String(pago.external_reference || "").split(":");
      if (pago.status === "approved" && ref[0] === "aloj" && PLANES[ref[2]]) {
        await db.prepare(`UPDATE alojamientos SET pago_id = ?, destacado_hasta = datetime(MAX(COALESCE(destacado_hasta, datetime('now')), datetime('now')), '+${PLANES[ref[2]].dias} days') WHERE id = ? AND (pago_id IS NULL OR pago_id != ?)`)
          .bind(String(pago.id), Number(ref[1]), String(pago.id)).run();
      }
      return json({ ok: true });
    }

    if (route.startsWith("admin/")) {
      if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false }, 401);
      if (route === "admin/alertas") {
        const { results } = await db.prepare("SELECT id, email, modelo_id, objetivo, precio_alta, ultimo_aviso_precio, token FROM alertas WHERE confirmado = 1").all();
        return json({ ok: true, alertas: results });
      }
      if (route === "admin/alertas/avisado" && method === "POST") {
        const b = await request.json();
        await db.prepare("UPDATE alertas SET ultimo_aviso_precio = ?, ultimo_aviso = datetime('now'), precio_alta = COALESCE(precio_alta, ?) WHERE id = ?").bind(Number(b.precio), Number(b.precio), Number(b.id)).run();
        return json({ ok: true });
      }
      if (route === "admin/alertas/precio_alta" && method === "POST") {
        const b = await request.json();
        await db.prepare("UPDATE alertas SET precio_alta = ? WHERE id = ? AND precio_alta IS NULL").bind(Number(b.precio), Number(b.id)).run();
        return json({ ok: true });
      }
      if (route === "admin/alojamientos") {
        const { results } = await db.prepare("SELECT * FROM alojamientos ORDER BY creado DESC LIMIT 500").all();
        return json({ ok: true, alojamientos: results });
      }
      if (route === "admin/alojamientos/aprobar" && method === "POST") {
        const b = await request.json();
        await db.prepare("UPDATE alojamientos SET estado = ?, lat = COALESCE(?, lat), lon = COALESCE(?, lon), departamento = COALESCE(?, departamento), foto = COALESCE(?, foto) WHERE id = ?")
          .bind(b.accion === "aprobar" ? "aprobado" : "rechazado", b.lat ?? null, b.lon ?? null, b.departamento ?? null, b.foto ?? null, Number(b.id)).run();
        return json({ ok: true });
      }
      if (route === "admin/pendientes") {
        const { results } = await db.prepare("SELECT id, tema, padre, nombre, texto, creado FROM comentarios WHERE estado = 'pendiente' ORDER BY creado").all();
        const exp = (await db.prepare("SELECT id, modelo AS tema, 'experiencia' AS nombre, texto, creado FROM experiencias WHERE texto_estado = 'pendiente' ORDER BY creado").all()).results;
        return json({ ok: true, pendientes: results, experiencias: exp });
      }
      if (route === "admin/export") {
        const comentarios = (await db.prepare("SELECT tema, texto, creado FROM comentarios WHERE estado = 'aprobado' AND creado > datetime('now','-12 months')").all()).results;
        const experiencias = (await db.prepare("SELECT modelo, kwh100, uso, estacion, km, departamento, nota, problemas, CASE WHEN texto_estado = 'aprobado' THEN texto END AS texto, creado FROM experiencias WHERE creado > datetime('now','-24 months')").all()).results;
        const votos = (await db.prepare("SELECT tema, opcion, COUNT(*) AS n FROM votos GROUP BY tema, opcion").all()).results;
        return json({ ok: true, comentarios, experiencias, votos });
      }
      if (route === "admin/moderar" && method === "POST") {
        const b = await request.json();
        const estado = b.accion === "aprobar" ? "aprobado" : "rechazado";
        if (b.tipo === "experiencia") await db.prepare("UPDATE experiencias SET texto_estado = ? WHERE id = ?").bind(estado, +b.id).run();
        else {
          await db.prepare("UPDATE comentarios SET estado = ? WHERE id = ?").bind(estado, +b.id).run();
          if (estado === "aprobado") await avisarRespuesta(db, env, baseUrl, +b.id);
        }
        return json({ ok: true });
      }
    }
    return json({ ok: false, error: "Ruta no encontrada" }, 404);
  } catch (err) {
    return json({ ok: false, error: "Error interno" }, 500);
  }
}
