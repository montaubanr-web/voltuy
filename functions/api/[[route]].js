// API de VoltUY para Cloudflare Pages Functions + base de datos D1 (plan gratuito).
// Rutas:
//   GET  /api/comentarios?tema=ID      -> comentarios aprobados
//   POST /api/comentarios               -> {tema, nombre, texto} queda "pendiente"
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
    body: JSON.stringify({ sender: { name: "VoltUY", email: env.CONTACTO_EMAIL }, to: [{ email: to }], subject, htmlContent: html }) });
  return r.ok;
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
        const res = await fetch("https://back-app.eve-move.com/eve/miem", { headers: { "user-agent": "VoltUY/1.0" } });
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
    if (route === "comentarios" && method === "GET") {
      const tema = clean(url.searchParams.get("tema"), 60);
      const { results } = await db
        .prepare("SELECT nombre, texto, strftime('%d/%m/%Y', creado) AS fecha FROM comentarios WHERE tema = ? AND estado = 'aprobado' ORDER BY creado ASC LIMIT 500")
        .bind(tema).all();
      return json({ ok: true, comentarios: results });
    }

    if (route === "comentarios" && method === "POST") {
      const b = await request.json();
      const tema = clean(b.tema, 60), nombre = clean(b.nombre, 40), texto = clean(b.texto, 1500);
      if (!tema || !nombre || texto.length < 5) return json({ ok: false, error: "Datos incompletos" }, 400);
      const ip = await hashIp(request.headers.get("cf-connecting-ip") || "");
      // Límite simple: 5 comentarios por hora por IP
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM comentarios WHERE ip = ? AND creado > datetime('now','-1 hour')").bind(ip).first();
      if (n >= 5) return json({ ok: false, error: "Demasiados comentarios, probá más tarde" }, 429);
      await db.prepare("INSERT INTO comentarios (tema, nombre, texto, ip) VALUES (?, ?, ?, ?)").bind(tema, nombre, texto, ip).run();
      return json({ ok: true, estado: "pendiente" });
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
          body: JSON.stringify({ sender: { name: "Web VoltUY", email: env.CONTACTO_EMAIL }, to: [{ email: env.CONTACTO_EMAIL }],
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
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${olon},${olat};${dlon},${dlat}?overview=full&geometries=geojson`, { headers: { "User-Agent": "VoltUY/1.0" } });
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
      if (!row.confirmado) await correo(env, email, "Confirmá tu alerta de precio en VoltUY",
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
          body: JSON.stringify({ items: [{ title: `VoltUY · ${PLANES[plan].nombre} · ${nombre}`, quantity: 1, unit_price: precio, currency_id: "UYU" }],
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
        const { results } = await db.prepare("SELECT id, tema, nombre, texto, creado FROM comentarios WHERE estado = 'pendiente' ORDER BY creado").all();
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
        else await db.prepare("UPDATE comentarios SET estado = ? WHERE id = ?").bind(estado, +b.id).run();
        return json({ ok: true });
      }
    }
    return json({ ok: false, error: "Ruta no encontrada" }, 404);
  } catch (err) {
    return json({ ok: false, error: "Error interno" }, 500);
  }
}
