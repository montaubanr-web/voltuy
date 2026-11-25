/* AutosEléctricosUY · lógica del sitio (sin dependencias) */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const usd = (n) => (n ? "US$ " + n.toLocaleString("es-UY") : "Consultar");
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
  const fecha = (f) => { if (!f) return ""; const [y, m, d] = f.split("-"); return (d ? +d + " " : "") + MESES[+m - 1] + " " + y; };

  const state = { modelos: [], noticias: { uruguay: [], internacional: [] }, normativa: {}, debates: [], cmp: [], newsTab: "uruguay", newsCat: "",
    combustible: {}, tarifas: {}, localidades: [], tests: { uruguay: [], internacional: [] }, testTab: "uruguay", testTipo: "", cargadores: [], uyGeo: null };
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  async function load(name) {
    if (window.__DATA__ && window.__DATA__[name]) return window.__DATA__[name];
    const r = await fetch(name === "uruguay" ? "data/uruguay.geojson" : `data/${name}.json`, { cache: "no-cache" });
    return r.json();
  }

  // API con respaldo local (para la vista previa sin servidor)
  async function api(path, opts) {
    if (window.__DATA__) return null; // vista previa de un solo archivo: no hay servidor
    try {
      const r = await fetch(path, opts);
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch {
      return null;
    }
  }

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2600); }

  // Color por marca para la tarjeta
  const BRAND = { Maxus: ["#0F766E", "#5EEAD4"], Foton: ["#1E40AF", "#93C5FD"], Victory: ["#9A3412", "#FDBA74"], BAW: ["#475569", "#CBD5E1"], Volvo: ["#1F2937", "#9CA3AF"], BMW: ["#1D4ED8", "#93C5FD"], "Mercedes-Benz": ["#111827", "#6B7280"], Volkswagen: ["#1E3A8A", "#60A5FA"], Kia: ["#0F172A", "#94A3B8"], Hyundai: ["#0C4A6E", "#7DD3FC"], GWM: ["#BE123C", "#FDA4AF"], Smart: ["#334155", "#A3E635"], Zeekr: ["#18181B", "#A1A1AA"], Mini: ["#14532D", "#86EFAC"], JAC: ["#B91C1C", "#FCA5A5"], Geely: ["#155E75", "#67E8F9"], BYD: ["#0EA5E9", "#22D3EE"], Tesla: ["#111827", "#4B5563"], Chevrolet: ["#B45309", "#FBBF24"], Wuling: ["#EC4899", "#F9A8D4"], Dongfeng: ["#1D4ED8", "#60A5FA"], Omoda: ["#7C3AED", "#C4B5FD"], Leapmotor: ["#059669", "#6EE7B7"], Zeekr: ["#0F172A", "#334155"], Xpeng: ["#65A30D", "#BEF264"], GAC: ["#DC2626", "#FCA5A5"], Hyundai: ["#1E3A8A", "#3B82F6"], Geely: ["#0369A1", "#7DD3FC"], MG: ["#B91C1C", "#F87171"], Jaecoo: ["#155E75", "#67E8F9"], Peugeot: ["#1E293B", "#64748B"], Fiat: ["#9F1239", "#FDA4AF"], Kia: ["#18181B", "#A1A1AA"] };
  const art = (m) => { const [a, b] = BRAND[m.marca] || ["#334155", "#64748B"]; return `background:linear-gradient(135deg,${a},${b})`; };

  function card(m) {
    const inCmp = state.cmp.includes(m.id);
    return `<article class="card">
      <div class="art" style="${art(m)}"><span>${esc(m.marca)}</span>
        <em class="tag ${m.tipo === "PHEV" ? "phev" : ""}">${m.tipo === "PHEV" ? "Enchufable" : "100% eléctrico"}</em>
        ${m.destacado ? '<em class="tag dest">Destacado</em>' : ""}</div>
      <div class="body">
        <h3><a class="ficha" href="/modelos/${esc(m.id)}/" title="Ficha completa del ${esc(m.marca + " " + m.modelo)}">${esc(m.modelo)}</a></h3><div class="ver">${esc([...new Set([m.version, m.segmento].filter(Boolean))].join(" · "))}</div>
        <div class="price">${usd(m.precio_usd)} ${m.fecha_precio ? `<small>(${esc(fecha(m.fecha_precio))})</small>` : ""}</div>
        <div class="specs">
          <span>🔋 <b>${m.bateria_kwh ?? "—"}</b> kWh</span>
          <span>🛣️ <b>${m.autonomia_km ?? "—"}</b> km${m.ciclo ? " " + esc(m.ciclo) : ""}</span>
          ${urseaOk(m) ? `<span title="Rendimiento homologado URSEA: ${m.ursea.rendimiento_km_kwh} km/kWh">⚡ <b>${String(m.ursea.consumo_kwh_100km).replace(".", ",")}</b> kWh/100 km</span>` : ""}
          ${ventasModelo(m) ? `<span>🏆 <b>${ventasModelo(m).toLocaleString("es-UY")}</b> vendidos en ${state.ventas.anio || 2026} (modelo)</span>` : ""}
        </div>
        <div class="src-row"><a class="src" href="${esc(m.fuente)}" target="_blank" rel="noopener">Fuente ↗</a>${m.precio_usd ? `<button class="btn-alerta" data-alerta="${m.id}" title="Historial y alerta de precio">🔔 Avisame si baja</button>` : ""}</div>
        ${(() => { const n = testsDe(m.id).length; return n ? `<button class="btn-tests" data-tests="${m.id}">🧪 ${n} test${n > 1 ? "s" : ""}</button>` : ""; })()}
        <div class="actions">
          <button class="btn btn-sm btn-cmp ${inCmp ? "on" : ""}" data-cmp="${m.id}">${inCmp ? "✓ Comparando" : "Comparar"}</button>
          <button class="btn btn-sm btn-lead" data-lead="${m.id}">Cotizar</button>
        </div>
      </div></article>`;
  }

  function newsCard(n) {
    return `<a class="news" href="${esc(n.url)}" target="_blank" rel="noopener">
      <div class="meta"><span class="cat ${esc(n.categoria)}">${esc(n.categoria)}</span><span>${esc(n.fuente)} · ${esc(fecha(n.fecha))}</span></div>
      <h3>${esc(n.titulo)}</h3>${n.resumen ? `<p>${esc(n.resumen)}</p>` : ""}</a>`;
  }

  // ---------- Ventas 2026 (ACAU, mes a mes) ----------
  const MESES_V = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const nomMes = (k) => MESES_V[+k.slice(5, 7) - 1];
  const periodoVentas = () => { const ms = (state.ventas.meses || []); return ms.length ? `${nomMes(ms[0].mes).slice(0, 3)}–${nomMes(ms[ms.length - 1].mes).slice(0, 3)}` : ""; };
  const nv = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9/()]+/g, " ").trim();
  const variantes = (s) => nv(s).replace(/[()]/g, "/").split("/").map((x) => x.trim()).filter(Boolean);
  function acumuladoVentas(meses) {
    const acc = {};
    meses.forEach((mm) => mm.modelos.forEach((x) => { const k = x.marca + "|" + x.modelo; (acc[k] = acc[k] || { ...x, unidades: 0 }).unidades += x.unidades; if (x.nota) acc[k].nota = x.nota; }));
    return Object.values(acc).sort((a, b) => b.unidades - a.unidades);
  }
  let _ventasCache = null;
  function ventasModelo(m) {
    if (!state.ventas || !state.ventas.meses) return 0;
    if (!_ventasCache) _ventasCache = acumuladoVentas(state.ventas.meses);
    const vm = variantes(m.modelo);
    const e = _ventasCache.find((x) => nv(x.marca) === nv(m.marca) && variantes(x.modelo).some((v) => vm.includes(v)));
    return e ? e.unidades : 0;
  }
  function renderVentas() {
    const ms = state.ventas.meses || [];
    if (!ms.length) { $("#homeVentas").innerHTML = '<p class="muted">Sin datos de ventas todavía.</p>'; return; }
    const sel = $("#vMes");
    if (!sel.options.length) {
      sel.innerHTML = `<option value="acum">Acumulado ${periodoVentas()} 2026</option>` + [...ms].reverse().map((mm) => `<option value="${mm.mes}">${nomMes(mm.mes)[0].toUpperCase() + nomMes(mm.mes).slice(1)} 2026</option>`).join("");
      sel.onchange = renderVentas;
    }
    const per = sel.value || "acum";
    const lista = per === "acum" ? acumuladoVentas(ms) : ms.find((x) => x.mes === per).modelos;
    const top = lista.slice(0, 10), max = top[0].unidades;
    const totales = ms.map((mm) => ({ mes: mm.mes, v: mm.total_electricos || mm.modelos.reduce((s, x) => s + x.unidades, 0), aprox: !mm.total_electricos }));
    const tmax = Math.max(...totales.map((t) => t.v));
    const fuente = per === "acum" ? "" : ms.find((x) => x.mes === per).fuente;
    $("#homeVentas").innerHTML = `<div class="v-rank">
        ${top.map((x, i) => `<div class="v-row"><span class="v-pos">${i + 1}</span><span class="v-name">${esc(x.marca)} ${esc(x.modelo)}${x.nota ? ' <i title="' + esc(x.nota) + '">*</i>' : ""}<em>${esc(x.categoria)}</em></span>
          <span class="v-bar"><span style="width:${(x.unidades / max) * 100}%"></span></span><b>${x.unidades.toLocaleString("es-UY")}</b></div>`).join("")}
        <p class="muted small">Unidades 0 km de modelos 100% eléctricos registradas por ACAU${fuente ? ` · <a href="${esc(fuente)}" target="_blank" rel="noopener">fuente del mes</a>` : " (suma de los meses publicados)"}. ${top.some((x) => x.nota) ? "* ACAU agrupa en esa línea versiones eléctricas y enchufables." : ""}</p>
      </div>
      <div class="v-mes"><h4>Eléctricos vendidos por mes</h4><div class="v-cols">
        ${totales.map((t) => `<button class="v-col ${t.mes === per ? "on" : ""}" data-vmes="${t.mes}" title="${nomMes(t.mes)}: ${t.aprox ? "≈" : ""}${t.v.toLocaleString("es-UY")}"><span style="height:${(t.v / tmax) * 100}%"></span><em>${nomMes(t.mes).slice(0, 3)}</em><b>${t.aprox ? "≈" : ""}${(t.v / 1000).toLocaleString("es-UY", { maximumFractionDigits: 1 })}k</b></button>`).join("")}
      </div><p class="muted small">≈ = suma de los modelos eléctricos publicados por ACAU para ese mes (el total oficial no fue informado).</p></div>`;
    const ids = new Set(); const cards = [];
    acumuladoVentas(ms).forEach((x) => { if (cards.length >= 4) return; const m = state.modelos.find((mm) => !ids.has(mm.id) && nv(mm.marca) === nv(x.marca) && variantes(mm.modelo).some((v) => variantes(x.modelo).includes(v))); if (m) { ids.add(m.id); cards.push(m); } });
    $("#homeTop").innerHTML = cards.map(card).join("");
  }

  // ---------- Vistas ----------
  function renderHome() {
    $("#stats").innerHTML = (state.normativa.mercado || []).map((s) => `<a class="stat" href="${esc(s.url)}" target="_blank" rel="noopener"><div class="v">${esc(s.valor)}</div><div class="l">${esc(s.etiqueta)}</div><div class="d">${esc(s.detalle)}</div></a>`).join("");
    $("#homeNews").innerHTML = state.noticias.uruguay.slice(0, 6).map(newsCard).join("");
    renderVentas();
  }

  function fillFilters() {
    const marcas = [...new Set(state.modelos.map((m) => m.marca))].sort();
    $("#fMarca").innerHTML += marcas.map((m) => `<option>${esc(m)}</option>`).join("");
    const segs = [...new Set(state.modelos.map((m) => m.segmento))].sort();
    $("#fSeg").innerHTML += segs.map((s) => `<option>${esc(s)}</option>`).join("");
    $("#cmpSelect").innerHTML += state.modelos.map((m) => `<option value="${m.id}">${esc(m.marca)} ${esc(m.modelo)} ${esc(m.version || "")}</option>`).join("");
  }

  function renderModelos() {
    const q = $("#fQ").value.trim().toLowerCase(), marca = $("#fMarca").value, tipo = $("#fTipo").value, seg = $("#fSeg").value, max = +$("#fPrecio").value, orden = $("#fOrden").value, car = $("#fCar").value;
    $("#fPrecioLbl").textContent = max >= 100000 ? "sin tope" : usd(max);
    let list = state.modelos.filter((m) =>
      (!q || `${m.marca} ${m.modelo} ${m.version}`.toLowerCase().includes(q)) && (!marca || m.marca === marca) && (!tipo || m.tipo === tipo) && (!seg || m.segmento === seg) && (!car || m.carroceria === car) && (max >= 100000 || (m.precio_usd && m.precio_usd <= max)));
    const key = { precio: (m) => m.precio_usd ?? 1e9, "-precio": (m) => -(m.precio_usd ?? 0), "-autonomia": (m) => -(m.autonomia_km ?? 0), "-ventas": (m) => -ventasModelo(m) }[orden];
    list.sort((a, b) => (b.destacado - a.destacado) || key(a) - key(b));
    $("#fCount").textContent = `${list.length} de ${state.modelos.length} versiones`;
    $("#modelGrid").innerHTML = list.map(card).join("") || '<div class="empty">No hay modelos con esos filtros.</div>';
  }

  function renderCmp() {
    $("#cmpCount").textContent = state.cmp.length;
    $("#cmpCount").classList.toggle("hidden", !state.cmp.length);
    const ms = state.cmp.map((id) => state.modelos.find((m) => m.id === id)).filter(Boolean);
    if (!ms.length) { $("#cmpTable").innerHTML = '<div class="empty">Todavía no elegiste modelos. Agregalos desde el catálogo con «Comparar».</div>'; return; }
    const best = (k, dir) => { const v = ms.map((m) => m[k]).filter((x) => x != null); return v.length > 1 ? (dir > 0 ? Math.max(...v) : Math.min(...v)) : null; };
    const bPrecio = best("precio_usd", -1), bAut = best("autonomia_km", 1), bBat = best("bateria_kwh", 1);
    const row = (label, f) => `<tr><th>${label}</th>${ms.map((m) => `<td>${f(m)}</td>`).join("")}</tr>`;
    $("#cmpTable").innerHTML = `<table class="cmp">
      ${row("", (m) => `<div class="head">${esc(m.marca)} ${esc(m.modelo)}</div><div class="muted small">${esc(m.version || "")}</div><button class="rm" data-rm="${m.id}">✕ Quitar</button>`)}
      ${row("Precio", (m) => `<span class="${m.precio_usd === bPrecio ? "best" : ""}">${usd(m.precio_usd)}</span>`)}
      ${row("Tipo", (m) => (m.tipo === "PHEV" ? "Híbrido enchufable" : "100% eléctrico"))}
      ${row("Tipo de vehículo", (m) => esc(m.carroceria || "—"))}
      ${row("Segmento", (m) => esc(m.segmento))}
      ${row("Batería", (m) => `<span class="${m.bateria_kwh === bBat ? "best" : ""}">${m.bateria_kwh ? m.bateria_kwh + " kWh" : "—"}</span>`)}
      ${row("Autonomía", (m) => `<span class="${m.autonomia_km === bAut ? "best" : ""}">${m.autonomia_km ? m.autonomia_km + " km" : "—"}</span> ${m.ciclo ? `<span class="muted small">(${esc(m.ciclo)})</span>` : ""}`)}
      ${row("Consumo homologado (URSEA)", (m) => (urseaOk(m) ? `${String(m.ursea.consumo_kwh_100km).replace(".", ",")} kWh/100 km <span class="muted small">(${m.ursea.rendimiento_km_kwh} km/kWh)</span>` : "—"))}
      ${row("Costo cada 100 km en casa", (m) => (urseaOk(m) && state.tarifas.residencial ? pesos(m.ursea.consumo_kwh_100km * precioCasa("triple:valle")) + ' <span class="muted small">(Triple valle)</span>' : "—"))}
      ${row("US$ por km de autonomía", (m) => (m.precio_usd && m.autonomia_km ? "US$ " + Math.round(m.precio_usd / m.autonomia_km) : "—"))}
      ${row("Vendidos en 2026 (" + periodoVentas() + ")", (m) => (ventasModelo(m) ? ventasModelo(m).toLocaleString("es-UY") : "—"))}
      ${row("Importador", (m) => esc(m.importador || "—"))}
      ${row("", (m) => `<button class="btn btn-sm btn-lead" data-lead="${m.id}">Pedir cotización</button>`)}
    </table><p class="muted small">En verde, el mejor valor de cada fila. La autonomía CLTC no es comparable directamente con la WLTP.</p>`;
  }

  function toggleCmp(id) {
    const i = state.cmp.indexOf(id);
    if (i >= 0) state.cmp.splice(i, 1);
    else { if (state.cmp.length >= 4) return toast("Podés comparar hasta 4 modelos"); state.cmp.push(id); toast("Agregado al comparador"); }
    store.set("cmp", state.cmp);
    renderCmp(); renderModelos(); renderHome();
  }

  function renderNews() {
    const list = state.noticias[state.newsTab] || [];
    const cats = [...new Set(list.map((n) => n.categoria))];
    $("#newsCats").innerHTML = [`<button data-c="" class="${!state.newsCat ? "on" : ""}">Todas</button>`, ...cats.map((c) => `<button data-c="${esc(c)}" class="${state.newsCat === c ? "on" : ""}">${esc(c)}</button>`)].join("");
    const f = list.filter((n) => !state.newsCat || n.categoria === state.newsCat);
    $("#newsList").innerHTML = f.map((n) => newsCard(n).replace('<div class="meta">', `<div class="date">${esc(fecha(n.fecha))}</div><div><div class="meta">`).replace("</a>", "</div></a>")).join("");
    $$("#newsTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === state.newsTab));
  }

  function renderNormativa() {
    $("#rules").innerHTML = (state.normativa.reglas || []).map((r) => `<div class="rule"><span class="estado ${/estudio|ajuste|cambia/i.test(r.estado) ? "warn" : ""}">${esc(r.estado)}</span><h3>${esc(r.titulo)}</h3><p>${esc(r.texto)}</p>${r.interno ? `<a class="btn btn-sm btn-primary" href="${esc(r.interno)}">Ver la guía y si calificás</a> ` : ""}<a class="small" href="${esc(r.url)}" target="_blank" rel="noopener">Fuente ↗</a></div>`).join("");
  }

  // ---------- Costos de energía ----------
  const CONSUMO_SEG = { "Urbano": 13, "Hatchback": 14.5, "Sedán": 15, "SUV compacto": 16, "SUV compacto premium": 17.5, "SUV mediano": 18, "SUV mediano premium": 19 };
  const urseaOk = (m) => m && m.ursea && m.ursea.certeza !== "baja" && m.ursea.consumo_kwh_100km;
  const consumoDe = (m) => (urseaOk(m) ? m.ursea.consumo_kwh_100km : (m && CONSUMO_SEG[m.segmento]) || 16);
  const notaConsumo = (m) => !m ? "" : urseaOk(m)
    ? `Homologado por URSEA: ${m.ursea.rendimiento_km_kwh} km/kWh (registro ${m.ursea.registro}). En uso real suele ser algo mayor.`
    : "Estimado según el tipo de auto (URSEA no tiene un dato confiable para esta versión). Si conocés el consumo real, cambialo.";
  const pesos = (n) => "$ " + Math.round(n).toLocaleString("es-UY");
  const pesos2 = (n) => "$ " + n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function precioCasa(id) {
    const t = state.tarifas, [tar, fr] = id.split(":");
    const f = (t.residencial.find((r) => r.id === tar) || {}).franjas?.find((x) => x.id === fr);
    return f ? f.sin_iva * (1 + t.iva) : 0;
  }
  const precioPublica = (p) => p.kwh + p.cargo_base / p.kwh_por_sesion;
  function initCostos() {
    const bev = state.modelos.filter((m) => m.tipo === "BEV");
    const opts = bev.map((m) => `<option value="${m.id}">${esc(nombreModelo(m.id))}</option>`).join("");
    $("#kModelo").innerHTML = '<option value="">Otro / ingreso manual</option>' + opts;
    $("#vModelo").innerHTML = '<option value="">Otro / ingreso manual</option>' + bev.filter((m) => m.bateria_kwh).map((m) => `<option value="${m.id}">${esc(nombreModelo(m.id))}</option>`).join("");
    const t = state.tarifas;
    $("#kTarifa").innerHTML = t.residencial.flatMap((r) => r.franjas.map((f) => `<option value="${r.id}:${f.id}">${esc(r.nombre.replace("Residencial ", ""))} · ${esc(f.nombre.split(" (")[0])} (${pesos2(f.sin_iva * (1 + t.iva))}/kWh)</option>`)).join("");
    $("#kComb").innerHTML = (state.combustible.productos || []).map((p) => `<option value="${p.clave}">${esc(p.producto)} (${pesos2(p.precio_uyu)}/l)</option>`).join("");
    const yp = bev.find((m) => m.id === "byd-yuan-pro-gs"); if (yp) $("#kModelo").value = yp.id;
    $("#kCons").value = consumoDe(yp);
    $("#kModelo").addEventListener("input", () => { $("#kCons").value = consumoDe(state.modelos.find((m) => m.id === $("#kModelo").value)); renderCostos(); });
    ["#kCons", "#kKm", "#kTarifa", "#kCasa", "#kDc", "#kComb", "#kLitros"].forEach((x) => $(x).addEventListener("input", renderCostos));
    renderTarifas();
  }
  function renderCostos() {
    const t = state.tarifas; if (!t.residencial) return;
    const cons = +$("#kCons").value || 16, km = +$("#kKm").value, casa = +$("#kCasa").value / 100, dc = +$("#kDc").value / 100;
    $("#kKmLbl").textContent = km + " km"; $("#kCasaLbl").textContent = Math.round(casa * 100) + "%"; $("#kDcLbl").textContent = Math.round(dc * 100) + "%";
    $("#kConsNota").textContent = notaConsumo(state.modelos.find((m) => m.id === $("#kModelo").value));
    const ac = t.publica.find((p) => p.id === "ute_ac"), dcp = t.publica.find((p) => p.id === "ute_dc");
    const pCasa = precioCasa($("#kTarifa").value), pAc = precioPublica(ac), pDc = precioPublica(dcp);
    const pMix = casa * pCasa + (1 - casa) * ((1 - dc) * pAc + dc * pDc);
    const comb = (state.combustible.productos || []).find((p) => p.clave === $("#kComb").value) || { precio_uyu: 0, producto: "" };
    const litros = +$("#kLitros").value || 0;
    const kmAnio = km * 365, porKmE = cons / 100 * pMix, porKmC = litros / 100 * comb.precio_uyu;
    $("#kKpis").innerHTML = `<div class="kpi"><div class="l">Eléctrico, por km</div><div class="v">${pesos2(porKmE)}</div></div>
      <div class="kpi"><div class="l">${esc(comb.producto)}, por km</div><div class="v">${pesos2(porKmC)}</div></div>
      <div class="kpi"><div class="l">Eléctrico por mes</div><div class="v">${pesos(porKmE * km * 30)}</div></div>
      <div class="kpi"><div class="l">Combustión por mes</div><div class="v">${pesos(porKmC * km * 30)}</div></div>
      <div class="kpi big"><div class="l">Ahorro estimado por año</div><div class="v">${pesos((porKmC - porKmE) * kmAnio)}</div></div>`;
    const filas = [
      ["Casa · " + $("#kTarifa").selectedOptions[0].text.split(" (")[0], cons / 100 * pCasa * kmAnio, "#16A34A"],
      ["Tu combinación", porKmE * kmAnio, "linear-gradient(90deg,#16A34A,#F59E0B)"],
      ["Pública UTE lenta (AC)", cons / 100 * pAc * kmAnio, "#84CC16"],
      ["Pública UTE rápida (DC)", cons / 100 * pDc * kmAnio, "#38BDF8"],
      [comb.producto, porKmC * kmAnio, "#F87171"],
    ];
    const max = Math.max(...filas.map((f) => f[1]), 1);
    $("#kBars").innerHTML = filas.map(([l, v, c]) => `<div class="bar"><span>${esc(l)}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%;background:${c}"></div></div><span class="amt">${pesos(v)}</span></div>`).join("");
    $("#kNota").textContent = `Solo energía, con IVA: no incluye cargo fijo ni potencia, patente, seguro ni mantenimiento. Carga pública: incluye el cargo base prorrateado en una carga típica de ${ac.kwh_por_sesion} kWh (AC) o ${dcp.kwh_por_sesion} kWh (DC).`;
  }
  function renderTarifas() {
    const t = state.tarifas, c = state.combustible;
    $("#tarUpd").textContent = "Combustibles verificados el " + fecha(c.verificado || "");
    const res = t.residencial.map((r) => `<div class="rule"><span class="estado">Vigente desde ${esc(fecha(r.vigencia))}</span><h3>${esc(r.nombre)}</h3>
      <table class="tar-table">${r.franjas.map((f) => `<tr><td>${esc(f.nombre)}</td><td>${pesos2(f.sin_iva)} + IVA = ${pesos2(f.sin_iva * (1 + t.iva))}/kWh</td></tr>`).join("")}</table>
      <a class="small" href="${esc(r.url)}" target="_blank" rel="noopener">Fuente ↗</a></div>`).join("");
    const pub = `<div class="rule"><span class="estado warn">Puede cambiar</span><h3>Red pública de UTE</h3><table class="tar-table">${t.publica.map((p) => `<tr><td>${esc(p.nombre)}</td><td>${pesos2(p.cargo_base)}/carga + ${pesos2(p.kwh)}/kWh</td></tr><tr><td class="muted">Minuto conectado sin cargar</td><td>${pesos2(p.min_inactivo)}</td></tr>`).join("")}</table>
      <p class="small muted">${esc(t.publica_nota)}</p><a class="small" href="${esc(t.publica_url)}" target="_blank" rel="noopener">Fuente ↗</a></div>`;
    const comb = `<div class="rule"><span class="estado">Actualizado a diario</span><h3>Combustibles ANCAP</h3><table class="tar-table">${(c.productos || []).map((p) => `<tr><td><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.producto)}</a></td><td>${pesos2(p.precio_uyu)}/l</td></tr>`).join("")}</table>
      <p class="small muted">${esc(c.detalle || "")}.</p></div>`;
    $("#tarifas").innerHTML = comb + res + pub;
  }

  // ---------- Planificador de viaje ----------
  let vMap = null, vCapa = null;
  const rad = (x) => (x * Math.PI) / 180;
  const distKm = (a, b) => { const R = 6371, dp = rad(b[0] - a[0]), dl = rad(b[1] - a[1]); const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const consVel = (c90, v, clima) => c90 * (0.55 + 0.45 * (v / 90) ** 2) * (clima ? 1.08 : 1);
  async function geocodificar(texto) {
    const loc = state.localidades.find((l) => l.nombre.toLowerCase() === texto.trim().toLowerCase());
    if (loc) return [loc.lat, loc.lon, loc.nombre];
    if (window.__DATA__) return null;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=uy&limit=1&q=${encodeURIComponent(texto)}`);
      const j = await r.json(); return j[0] ? [+j[0].lat, +j[0].lon, j[0].display_name.split(",")[0]] : null;
    } catch { return null; }
  }
  async function trazar(a, b) {
    const pre = window.__DATA__ && window.__DATA__.rutas;  // vista previa: rutas precalculadas entre localidades
    if (pre) {
      const k1 = `${a[2]}|${b[2]}`, k2 = `${b[2]}|${a[2]}`, r = pre[k1] || pre[k2];
      if (r) return { coords: pre[k1] ? r.c : [...r.c].reverse(), km: r.km, min: r.min, real: true };
    }
    if (!window.__DATA__) {
      const p = await api(`/api/ruta?o=${a[0]},${a[1]}&d=${b[0]},${b[1]}`);
      if (p && p.ok) return { coords: p.coords, km: p.km, min: p.min, real: true };
      try {
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`);
        const j = await r.json();
        if (j.routes && j.routes[0]) return { coords: j.routes[0].geometry.coordinates.map(([lo, la]) => [la, lo]), km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60, real: true };
      } catch {}
    }
    const n = 60, coords = Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    return { coords, km: distKm(a, b) * 1.25, real: false };
  }
  function enRuta(coords, kmTotal, corredor = 3, minKw = 40) {
    // distancia de cada cargador al tramo más cercano de la ruta (no solo a los vértices)
    const acum = [0]; for (let i = 1; i < coords.length; i++) acum.push(acum[i - 1] + distKm(coords[i - 1], coords[i]));
    const escala = kmTotal / (acum[acum.length - 1] || 1), kx = 111.32 * Math.cos(rad(-33)), ky = 110.57;
    return state.cargadores.filter((c) => (minKw >= 40 ? dcKw(c) : (c.max_kw || 0)) >= minKw).map((c) => {
      let best = 1e9, kmEn = 0;
      for (let i = 1; i < coords.length; i++) {
        const ax = coords[i - 1][1] * kx, ay = coords[i - 1][0] * ky, bx = coords[i][1] * kx, by = coords[i][0] * ky, px = c.lon * kx, py = c.lat * ky;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d < best) { best = d; kmEn = acum[i - 1] + t * (acum[i] - acum[i - 1]); }
      }
      return { c, desvio: best, km: kmEn * escala };
    }).filter((x) => x.desvio <= corredor).sort((x, y) => x.km - y.km);
  }
  function simular({ kmTotal, bat, c90, soc, res, vel, clima, candidatos }) {
    const util = bat * 0.92, kwhKm = consVel(c90, vel, clima) / 100, maxCarga = Math.min(170, Math.max(40, bat * 1.6));
    let pos = 0, e = util * soc, paradas = [], sinCobertura = false;
    const reserva = util * res;
    while (pos + (e - reserva) / kwhKm < kmTotal) {
      const alcance = pos + (e - reserva) / kwhKm;
      const opciones = candidatos.filter((x) => x.km > pos + 5 && x.km <= alcance);
      if (!opciones.length) { sinCobertura = true; break; }
      const s = opciones[opciones.length - 1];
      e -= (s.km - pos) * kwhKm; pos = s.km;
      const falta = (kmTotal - pos) * kwhKm + reserva, objetivo = Math.min(util * 0.8, Math.max(falta, util * 0.5));
      const kwh = Math.max(0, objetivo - e), esDC = dcKw(s.c) > 0, potencia = (esDC ? Math.min(dcKw(s.c) || 50, maxCarga) * 0.7 : Math.min(s.c.max_kw || 7, 11));
      paradas.push({ ...s, dc: esDC, kwh, min: (kwh / potencia) * 60 + 5, soc: e / util, socFin: (e + kwh) / util });
      e += kwh;
      if (paradas.length > 8) break;
    }
    const llegada = sinCobertura ? null : (e - (kmTotal - pos) * kwhKm) / util;
    return { paradas, llegada, sinCobertura, energia: kmTotal * kwhKm, kwhKm };
  }
  function costoParada(p) {
    const t = state.tarifas, tar = t.publica.find((x) => x.id === (p.dc ? "ute_dc" : "ute_ac"));
    return /UTE/i.test(p.c.operador) ? tar.cargo_base + p.kwh * tar.kwh : p.kwh * tar.kwh; // otros operadores: referencia UTE
  }
  function initViaje() {
    $("#vLocs").innerHTML = state.localidades.map((l) => `<option value="${esc(l.nombre)}">`).join("");
    const elegir = () => { const m = state.modelos.find((x) => x.id === $("#vModelo").value); if (m) { $("#vBat").value = m.bateria_kwh; $("#vCons").value = urseaOk(m) ? +(m.ursea.consumo_kwh_100km * 1.15).toFixed(1) : consumoDe(m); } };
    const def = state.modelos.find((m) => m.id === "byd-yuan-pro-gs"); if (def) { $("#vModelo").value = def.id; elegir(); }
    $("#vModelo").addEventListener("input", elegir);
    const lbl = () => { $("#vSocLbl").textContent = $("#vSoc").value + "%"; $("#vResLbl").textContent = $("#vRes").value + "%"; };
    ["#vSoc", "#vRes"].forEach((x) => $(x).addEventListener("input", lbl)); lbl();
    $("#vForm").addEventListener("submit", (e) => { e.preventDefault(); calcularViaje(); });
  }
  async function calcularViaje() {
    const out = $("#vRes1"); out.innerHTML = '<p class="muted">Calculando…</p>';
    const a = await geocodificar($("#vOrigen").value), b = await geocodificar($("#vDestino").value);
    if (!a || !b) { out.innerHTML = `<div class="warn">No encontré ${!a ? "el origen" : "el destino"}. ${window.__DATA__ ? "En esta vista previa elegí una localidad de la lista." : "Probá con el nombre de la ciudad."}</div>`; return; }
    const ruta = await trazar(a, b);
    $("#vAviso").textContent = ruta.real ? "Ruta por calle (OSRM / © OpenStreetMap)." : "Vista previa: distancia estimada (línea recta × 1,25) y cargadores hasta 20 km de esa línea. En la web publicada se usa la ruta real por calle y cargadores a menos de 3 km.";
    const bat = +$("#vBat").value, c90 = +$("#vCons").value, soc = +$("#vSoc").value / 100, res = +$("#vRes").value / 100, clima = $("#vClima").checked;
    if (!bat || !c90) { out.innerHTML = '<div class="warn">Completá batería y consumo.</div>'; return; }
    let candidatos = enRuta(ruta.coords, ruta.km, ruta.real ? 3 : 20), semi = false;
    const vel = +$("#vVel").value;
    let r = simular({ kmTotal: ruta.km, bat, c90, soc, res, vel, clima, candidatos });
    if (r.sinCobertura) {  // sin cargadores rápidos suficientes: probamos sumando semirrápidos (11 kW o más)
      const c2 = enRuta(ruta.coords, ruta.km, ruta.real ? 3 : 20, 11), r2 = simular({ kmTotal: ruta.km, bat, c90, soc, res, vel, clima, candidatos: c2 });
      if (!r2.sinCobertura || r2.paradas.length > r.paradas.length) { candidatos = c2; r = r2; semi = true; }
    }
    const horas = ruta.min ? (ruta.min / 60) * (100 / vel) ** 0.5 : ruta.km / (vel * 0.85), cargaMin = r.paradas.reduce((x, p) => x + p.min, 0);
    const [hh, mm] = ($("#vHora").value || "09:00").split(":").map(Number);
    const nafta = (state.combustible.productos || []).find((p) => p.clave === "super95");
    const costoNafta = nafta ? ruta.km * 0.07 * nafta.precio_uyu : 0;
    const casaKwh = Math.max(0, r.energia - r.paradas.reduce((x, p) => x + p.kwh, 0));
    const costoE = casaKwh * precioCasa("triple:valle") + r.paradas.reduce((x, p) => x + costoParada(p), 0);
    const escen = [90, 100, 110].map((v) => { const s = simular({ kmTotal: ruta.km, bat, c90, soc, res, vel: v, clima, candidatos }); return `<tr><td>${v} km/h</td><td>${s.energia.toFixed(1)} kWh</td><td>${s.paradas.length}${s.sinCobertura ? " (sin cobertura)" : ""}</td><td>${s.llegada == null ? "—" : Math.round(s.llegada * 100) + "%"}</td></tr>`; }).join("");
    let reloj = hh + mm / 60;
    const paradasHtml = r.paradas.map((p, i) => {
      const llegaH = reloj + (p.km - (i ? r.paradas[i - 1].km : 0)) / (vel * 0.85); reloj = llegaH + p.min / 60;
      const [cls, txt] = estimarEspera(p.c, Math.floor(llegaH) % 24);
      return `<div class="stop"><h4>Parada ${i + 1}: ${esc(p.c.nombre)}</h4><div class="small muted">Km ${Math.round(p.km)} · ${esc([p.c.ciudad, p.c.departamento].filter(Boolean).join(", "))} · ${esc(p.c.operador)} · ${p.dc ? "DC hasta " + dcKw(p.c) : "AC " + p.c.max_kw} kW${p.desvio > 0.5 && ruta.real ? ` · ${p.desvio.toFixed(1)} km de la ruta` : ""}</div>
        <div class="small" style="margin-top:4px">Llegás con <b>${Math.round(p.soc * 100)}%</b>, cargás ${p.kwh.toFixed(1)} kWh hasta <b>${Math.round(p.socFin * 100)}%</b> · unos <b>${Math.round(p.min)} min</b> · ${pesos(costoParada(p))}${/UTE/i.test(p.c.operador) ? "" : " (referencia UTE)"} <span class="espera ${cls}">Espera ${txt.toLowerCase()}</span></div></div>`;
    }).join("");
    out.innerHTML = `<div class="trip-sum">
      <div><div class="l">Distancia</div><div class="v">${Math.round(ruta.km)} km</div></div>
      <div><div class="l">Manejo + carga</div><div class="v">${Math.floor(horas + cargaMin / 60)} h ${Math.round(((horas + cargaMin / 60) % 1) * 60)} min</div></div>
      <div><div class="l">Llegás con</div><div class="v">${r.llegada == null ? "—" : Math.round(r.llegada * 100) + "%"}</div></div>
      <div><div class="l">Costo eléctrico / nafta</div><div class="v">${pesos(costoE)} <span class="muted small">/ ${pesos(costoNafta)}</span></div></div></div>
      ${r.sinCobertura ? '<div class="warn">No encontramos cargadores rápidos cerca de la ruta dentro de tu autonomía. Salí con más batería, bajá la velocidad o buscá carga lenta en el mapa de cargadores.</div>' : ""}
      ${semi ? '<div class="warn">Con cargadores rápidos solamente no alcanza: el plan incluye carga semirrápida (AC), que tarda más.</div>' : ""}
      <div class="stops">${paradasHtml || (r.sinCobertura ? "" : '<div class="stop"><h4>Llegás sin parar a cargar 🎉</h4></div>')}</div>
      <table class="scen"><tr><th>Velocidad</th><th>Energía</th><th>Paradas</th><th>Llegás con</th></tr>${escen}</table>
      <p class="muted small">Costo eléctrico: energía de casa en Triple Horario valle + cargas en ruta con tarifa UTE DC. Nafta: auto de 7 l/100 km con Súper 95 de ANCAP.</p>`;
    if (!window.L) return;
    if (!vMap) { vMap = L.map("vMap"); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© colaboradores de OpenStreetMap" }).addTo(vMap); if (state.uyGeo) L.geoJSON(state.uyGeo, { style: { color: "#0B1020", weight: 1.5, fillColor: "#F5F7FB", fillOpacity: 0.55 } }).addTo(vMap); }
    if (vCapa) vCapa.remove();
    vCapa = L.layerGroup().addTo(vMap);
    const linea = L.polyline(ruta.coords, { color: "#2563EB", weight: 5, opacity: 0.8, dashArray: ruta.real ? null : "8 8" }).addTo(vCapa);
    candidatos.forEach((x) => L.circleMarker([x.c.lat, x.c.lon], { radius: 4, color: "#0B1020", weight: 1, fillColor: "#94A3B8", fillOpacity: 0.9 }).bindPopup(esc(x.c.nombre)).addTo(vCapa));
    r.paradas.forEach((p, i) => L.circleMarker([p.c.lat, p.c.lon], { radius: 10, color: "#0B1020", weight: 2, fillColor: "#A3E635", fillOpacity: 1 }).bindPopup(`Parada ${i + 1}: ${esc(p.c.nombre)}`).addTo(vCapa));
    [[a, "Salida", "#2563EB"], [b, "Llegada", "#DC2626"]].forEach(([pt, t, col]) => L.marker([pt[0], pt[1]], { icon: L.divIcon({ className: "pin", html: `<span style="background:${col}"></span>`, iconSize: [16, 16] }) }).bindTooltip(`${t}: ${esc(pt[2])}`, { permanent: true, direction: "top", offset: [0, -8] }).addTo(vCapa));
    setTimeout(() => { vMap.invalidateSize(); vMap.fitBounds(linea.getBounds(), { padding: [30, 30] }); }, 50);
  }

  // ---------- Tests ----------
  const testsDe = (id) => [...(state.tests.uruguay || []), ...(state.tests.internacional || [])].filter((t) => t.modelo_id === id);
  const nombreModelo = (id) => { const m = state.modelos.find((x) => x.id === id); return m ? `${m.marca} ${m.modelo} ${m.version || ""}`.trim() : ""; };
  function renderTests() {
    const modelo = $("#testModelo").value, q = $("#testQ").value.trim().toLowerCase();
    let list = modelo ? testsDe(modelo) : state.tests[state.testTab] || [];
    const tipos = [...new Set(list.map((t) => t.tipo))];
    $("#testTipos").innerHTML = [`<button data-tipo="" class="${!state.testTipo ? "on" : ""}">Todos</button>`, ...tipos.map((t) => `<button data-tipo="${esc(t)}" class="${state.testTipo === t ? "on" : ""}">${esc(t)}</button>`)].join("");
    list = list.filter((t) => (!state.testTipo || t.tipo === state.testTipo) && (!q || t.titulo.toLowerCase().includes(q)));
    $$("#testTabs button").forEach((b) => b.classList.toggle("on", !modelo && b.dataset.tt === state.testTab));
    $("#testList").innerHTML = list.map((t) => `<a class="news" href="${esc(t.url)}" target="_blank" rel="noopener">
      <div class="meta"><span class="cat Test">${esc(t.tipo)}</span><span>${esc(t.medio)} · ${esc(fecha(t.fecha))}${t.pais ? " · " + esc(t.pais) : ""}</span></div>
      <h3>${esc(t.titulo)}</h3>${t.modelo_id ? `<span class="test-model">En el catálogo: ${esc(nombreModelo(t.modelo_id))}</span>` : ""}</a>`).join("") || '<div class="empty">No hay tests con esos filtros.</div>';
  }

  // ---------- Cargadores ----------
  let map = null, capa = null, marcadores = {}, vivoTimer = null;
  // ---- Estado en vivo (mapa interoperable de operadores: UTE, eOne, DMC, Evergo, Eve…) ----
  const VIVO_URL = "https://back-app.eve-move.com/eve/miem";
  state.vivo = {}; state.vivoHora = null;
  async function cargarVivo() {
    let d = await api("/api/cargadores/estado");
    if (!d || !d.ok) {  // sin servidor (vista previa): consulta directa
      try {
        const t = await (await fetch(VIVO_URL)).text(), fin = t.indexOf("\n[");
        const S = { Available: "L", Charging: "C", Unavailable: "F" };
        d = { ok: true, hora: new Date().toISOString(), estaciones: JSON.parse(fin > 0 ? t.slice(0, fin) : t).filter((e) => e.latitude != null)
          .map((e) => ({ lat: +e.latitude, lon: +e.longitude, c: (e.cnns || []).map((k) => S[k.status] || "F").join("") })) };
      } catch { d = null; }
    }
    if (!d || !d.ok) { $("#cgVivo").textContent = ""; return; }
    const vivo = {}, kx = 111320 * Math.cos(-33 * Math.PI / 180);
    d.estaciones.forEach((e) => {
      let mejor = null, dm = 70;
      state.cargadores.forEach((c) => { const m = Math.hypot((c.lat - e.lat) * 110570, (c.lon - e.lon) * kx); if (m < dm) { dm = m; mejor = c; } });
      if (!mejor) return;
      const v = vivo[mejor.id] || { L: 0, C: 0, F: 0 };
      [...e.c].forEach((x) => v[x]++);
      vivo[mejor.id] = v;
    });
    state.vivo = vivo; state.vivoHora = new Date(d.hora);
    const n = Object.keys(vivo).length;
    $("#cgVivo").innerHTML = `<i class="dot-vivo"></i> Estado en vivo de ${n} ubicaciones · ${state.vivoHora.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}`;
    if (location.hash.slice(1).split("/")[0] === "cargadores") renderCargadores();
  }
  function vivoDe(c) {
    const v = state.vivo[c.id]; if (!v) return null;
    const total = v.L + v.C + v.F;
    if (v.L) return { cls: "libre", txt: `${v.L} de ${total} libre${v.L > 1 ? "s" : ""}` };
    if (v.C) return { cls: "uso", txt: `Todos en uso (${v.C})` };
    return { cls: "fuera", txt: "Fuera de servicio" };
  }
  const COLOR_VIVO = { libre: "#16A34A", uso: "#F59E0B", fuera: "#DC2626" };
  const DC = ["CCS2", "CHAdeMO", "GB/T DC"];
  const dcKw = (c) => Math.max(0, ...(c.conectores || []).filter((k) => DC.includes(k.tipo)).map((k) => k.kw || 0));
  const potRef = (c) => dcKw(c) || Math.min(c.max_kw || 0, 22);  // en AC el auto carga a 7-22 kW aunque el cargador diga 43
  const colorKw = (kw) => (kw >= 100 ? "#16A34A" : kw >= 40 ? "#84CC16" : kw >= 11 ? "#22D3EE" : "#94A3B8");
  const VERANO_COSTA = { Maldonado: 2.2, Rocha: 2.2, Canelones: 1.4 };
  function estimarEspera(c, hora) {
    const ahora = new Date(), mes = ahora.getMonth(), finde = [0, 6].includes(ahora.getDay());
    const rapida = dcKw(c) >= 40;
    const curva = rapida ? [.1,.1,.1,.1,.1,.15,.3,.5,.6,.7,.8,.85,.9,.8,.7,.7,.8,.95,1,1,.85,.6,.4,.2] : [.2,.2,.2,.2,.2,.25,.4,.6,.7,.7,.7,.7,.7,.7,.7,.7,.7,.75,.8,.8,.7,.5,.35,.25];
    let s = curva[hora] * (finde ? 1.1 : 1);
    if ([11, 0, 1, 2].includes(mes)) s *= VERANO_COSTA[c.departamento] || 1;
    if (c.departamento === "Montevideo") s *= 1.3;
    if (rapida) s *= 1.4;
    const conectores = Math.max(1, (c.conectores || []).reduce((a, k) => a + (k.cantidad || 1), 0));
    s /= Math.sqrt(conectores);
    return s < 0.45 ? ["baja", "Baja"] : s < 0.9 ? ["media", "Media"] : ["alta", "Alta"];
  }
  async function reportes(id) {
    const r = await api(`/api/reportes?id=${encodeURIComponent(id)}`);
    if (r && r.ok) return r;
    const local = store.get("rep_" + id, []);
    if (!local.length) return null;
    const esperas = local.map((x) => x.espera).sort((a, b) => a - b);
    return { n: local.length, mediana: esperas[Math.floor(esperas.length / 2)], fallas: local.filter((x) => !x.funciona).length };
  }
  function cgFiltrados() {
    const q = $("#cgQ").value.trim().toLowerCase(), con = $("#cgConector").value, pot = +$("#cgPot").value, dep = $("#cgDepto").value, op = $("#cgOp").value;
    return state.cargadores.filter((c) => (!q || `${c.nombre} ${c.direccion} ${c.ciudad} ${c.departamento} ${c.operador}`.toLowerCase().includes(q))
      && (!con || c.conectores.some((k) => k.tipo === con)) && (!pot || dcKw(c) >= pot) && (!dep || c.departamento === dep) && (!op || c.operador === op)
      && (!$("#cgLibre").checked || (state.vivo[c.id] && state.vivo[c.id].L > 0)));
  }
  function plugs(c) { return `<div class="plugs">${c.conectores.map((k) => `<span class="plug ${["CCS2", "CHAdeMO", "GB/T DC"].includes(k.tipo) ? "dc" : ""}">${k.cantidad}× ${esc(k.tipo)}${k.kw ? " " + k.kw + " kW" : ""}</span>`).join("")}</div>`; }
  function popupHtml(c) {
    const [cls, txt] = estimarEspera(c, +$("#cgHora").value), v = vivoDe(c);
    return `<h4>${esc(c.nombre)}</h4>${v ? `<div class="vivo ${v.cls}">● Ahora: ${esc(v.txt)}</div>` : ""}
      ${c.no_visto_dias ? `<div class="warn small">Hace ${c.no_visto_dias} días que no aparece en su fuente: puede haber sido retirado.</div>` : ""}<div class="small muted">${esc([c.direccion, c.ciudad, c.departamento].filter(Boolean).join(", "))}</div>
      ${plugs(c)}<div class="small">Operador: <b>${esc(c.operador)}</b>${c.horario ? ` · ${esc(c.horario)}` : ""}${c.costo ? `<br>Costo: ${esc(c.costo)}` : ""}</div>
      ${v ? "" : `<div style="margin-top:6px"><span class="espera ${cls}">Espera ${txt.toLowerCase()} (estimada)</span></div>`}
      <div class="small muted" data-rep="${c.id}"></div>
      <div class="pop-actions"><a href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}" target="_blank" rel="noopener">Cómo llegar ↗</a><button data-reportar="${c.id}">Reportar</button></div>
      <div class="small muted" style="margin-top:6px">Fuente: <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.fuente)}</a>${c.visto ? ` · confirmado en su fuente ${esc(fecha(c.visto))}` : c.verificado ? ` · verificado ${esc(fecha(c.verificado))}` : ""}</div>`;
  }
  function initMap() {
    if (map || !window.L) return;
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([-32.8, -56], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© colaboradores de OpenStreetMap" }).addTo(map);
    if (state.uyGeo) L.geoJSON(state.uyGeo, { style: { color: "#0B1020", weight: 1.5, fillColor: "#F5F7FB", fillOpacity: 0.55 } }).addTo(map);
    map.attributionControl.addAttribution("Cargadores: UTE, operadores, Open Charge Map, OpenStreetMap");
    map.on("popupopen", async (e) => {
      const el = e.popup.getElement().querySelector("[data-rep]"); if (!el) return;
      const r = await reportes(el.dataset.rep);
      el.textContent = r ? `Reportes de usuarios: ${r.n} · espera mediana ${r.mediana} min${r.fallas ? ` · ${r.fallas} con fallas` : ""}` : "Todavía sin reportes de usuarios.";
    });
  }
  function renderCargadores() {
    const list = cgFiltrados(), hora = +$("#cgHora").value;
    $("#cgCount").textContent = `${list.length} de ${state.cargadores.length} ubicaciones`;
    $("#cgList").innerHTML = list.slice(0, 200).map((c) => { const [cls, txt] = estimarEspera(c, hora), v = vivoDe(c); return `<div class="cg" data-cg="${c.id}">
      <h4>${esc(c.nombre)}</h4><div class="meta">${esc([c.ciudad, c.departamento].filter(Boolean).join(", "))} · ${esc(c.operador)}${dcKw(c) ? ` · DC hasta ${dcKw(c)} kW` : c.max_kw ? ` · AC ${c.max_kw} kW` : ""}</div>
      ${plugs(c)}${v ? `<span class="vivo ${v.cls}">● ${esc(v.txt)}</span>` : `<span class="espera ${cls}">Espera ${txt.toLowerCase()}</span>`}</div>`; }).join("") || '<div class="empty">Ningún cargador coincide.</div>';
    if (!map) return;
    if (capa) capa.remove();
    capa = L.layerGroup(); marcadores = {};
    list.forEach((c) => {
      const v = vivoDe(c);
      const mk = L.circleMarker([c.lat, c.lon], { radius: dcKw(c) >= 40 ? 8 : 6, color: v ? COLOR_VIVO[v.cls] : "#0B1020", weight: v ? 3 : 1, fillColor: colorKw(potRef(c)), fillOpacity: c.no_visto_dias ? 0.4 : 0.95 })
        .bindPopup(() => popupHtml(c));
      mk.addTo(capa); marcadores[c.id] = mk;
    });
    capa.addTo(map);
  }

  // ---------- Debates ----------
  async function getComments(tema) {
    const r = await api(`/api/comentarios?tema=${encodeURIComponent(tema)}`);
    if (r && Array.isArray(r.comentarios)) return r.comentarios;
    return store.get("c_" + tema, []);
  }
  async function renderDebates() {
    $("#debateThread").classList.add("hidden");
    $("#debateList").classList.remove("hidden");
    const items = await Promise.all(state.debates.map(async (d) => ({ d, n: (await getComments(d.id)).length })));
    $("#debateList").innerHTML = items.map(({ d, n }) => `<div class="debate" data-tema="${d.id}"><div><span class="cat">${esc(d.etiqueta)}</span><h3>${esc(d.titulo)}</h3><p class="muted small" style="margin:0">${esc(d.descripcion)}</p></div><span class="count">💬 ${n}</span></div>`).join("");
  }
  async function openThread(id) {
    const d = state.debates.find((x) => x.id === id); if (!d) return;
    const cs = await getComments(id);
    $("#debateList").classList.add("hidden");
    const t = $("#debateThread"); t.classList.remove("hidden");
    t.innerHTML = `<button class="rm" id="backDeb">← Volver a los debates</button>
      <h2>${esc(d.titulo)}</h2><p class="muted">${esc(d.descripcion)}</p>
      ${encuesta(d)}${(state.comunidad.debates || {})[d.id] ? `<div class="panel ai"><b>Resumen del debate</b><p>${esc(state.comunidad.debates[d.id].resumen)}</p><p class="muted small">Generado por nuestro agente a partir de los comentarios aprobados.</p></div>` : ""}
      ${cs.map((c) => `<div class="comment"><span class="who">${esc(c.nombre)}</span><span class="when">${esc(c.fecha || "")}</span><p style="margin:6px 0 0">${esc(c.texto)}</p></div>`).join("") || '<p class="muted">Todavía no hay comentarios. ¡Abrí el debate!</p>'}
      <form class="cform" id="cForm"><input name="nombre" required maxlength="40" placeholder="Tu nombre o apodo"><textarea name="texto" required maxlength="1500" placeholder="Contá tu experiencia u opinión…"></textarea>
      <input name="web" class="hidden" tabindex="-1" autocomplete="off"><button class="btn btn-primary">Publicar comentario</button>
      <p class="muted small">Se publica después de revisar que respete las normas de convivencia.</p></form>`;
    $("#backDeb").onclick = renderDebates;
    $("#cForm").onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      if (fd.web) return; // trampa para bots
      const r = await api("/api/comentarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tema: id, nombre: fd.nombre, texto: fd.texto }) });
      if (r && r.ok) { toast("¡Gracias! Tu comentario queda pendiente de moderación"); e.target.reset(); }
      else { // modo vista previa: guarda local
        const list = store.get("c_" + id, []); list.push({ nombre: fd.nombre, texto: fd.texto, fecha: new Date().toLocaleDateString("es-UY") }); store.set("c_" + id, list);
        toast("Vista previa: comentario guardado solo en este navegador"); openThread(id);
      }
    };
  }

  // ---------- Comunidad: experiencias estructuradas, consumo real, problemas, debates ----------
  const PROBLEMAS = {
    carga_publica: "Cargadores públicos fuera de servicio", espera_carga: "Esperas para cargar", posventa: "Posventa / service",
    repuestos: "Demora de repuestos", software: "App, software o conectividad", bateria: "Autonomía menor a la esperada",
    cargador_casa: "Instalación del cargador en casa", terminaciones: "Ruidos o terminaciones", entrega: "Demora en la entrega",
  };
  const USOS = { ciudad: "Ciudad", mixto: "Mixto", ruta: "Ruta" };
  const ESTACIONES = { verano: "Verano", otono: "Otoño", invierno: "Invierno", primavera: "Primavera" };
  const PREVIEW = () => !!window.__DATA__;
  const MIN_N = () => (PREVIEW() ? 1 : 3); // en producción nunca se muestra un promedio con menos de 3 dueños
  const mediana = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const cuartil = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
  const n1 = (x) => (x == null ? "—" : (Math.round(x * 10) / 10).toLocaleString("es-UY"));
  let comTab = "resumen", comDatos = null;

  async function datosComunidad() {
    const r = await api("/api/comunidad");
    const base = r && r.ok ? r : { experiencias: state.comunidad.experiencias_raw || [], votos: state.comunidad.votos || {} };
    const loc = store.get("exp_local", []), vloc = store.get("votos_local", {});
    const votos = JSON.parse(JSON.stringify(base.votos || {}));
    Object.entries(vloc).forEach(([t, op]) => { votos[t] = votos[t] || {}; votos[t][op] = (votos[t][op] || 0) + 1; });
    return { experiencias: [...(base.experiencias || []), ...loc], votos, local: loc.length };
  }

  function agregar(exps) {
    const ok = exps.filter((e) => e.kwh100 >= 6 && e.kwh100 <= 40);
    const porModelo = {};
    ok.forEach((e) => { (porModelo[e.modelo] = porModelo[e.modelo] || []).push(e); });
    const consumo = Object.entries(porModelo).map(([id, l]) => {
      const v = l.map((e) => e.kwh100), m = state.modelos.find((x) => x.id === id);
      const porUso = {}; Object.keys(USOS).forEach((u) => { const vv = l.filter((e) => e.uso === u).map((e) => e.kwh100); if (vv.length >= MIN_N()) porUso[u] = mediana(vv); });
      return { id, nombre: m ? nombreModelo(id) : id, n: l.length, mediana: mediana(v), p25: cuartil(v, 0.25), p75: cuartil(v, 0.75), porUso,
        ursea: m && urseaOk(m) ? m.ursea.consumo_kwh_100km : null, nota: mediana(l.map((e) => e.nota).filter(Boolean)) };
    }).filter((c) => c.n >= MIN_N()).sort((a, b) => b.n - a.n);
    const prob = {}; exps.forEach((e) => (e.problemas || []).forEach((p) => { if (PROBLEMAS[p]) prob[p] = (prob[p] || 0) + 1; }));
    const notas = exps.map((e) => e.nota).filter(Boolean);
    return { consumo, prob, total: exps.length, sinProblemas: exps.filter((e) => !(e.problemas || []).length).length, nps: notas.length ? notas.filter((x) => x >= 4).length / notas.length : null, nNotas: notas.length };
  }

  async function renderComunidad() {
    comDatos = await datosComunidad();
    const a = agregar(comDatos.experiencias);
    const nVotos = Object.values(comDatos.votos).reduce((s, o) => s + Object.values(o).reduce((x, y) => x + y, 0), 0);
    $("#comKpis").innerHTML = [
      [a.total, "experiencias de dueños"], [a.consumo.length, "modelos con consumo real"], [nVotos, "votos en debates"],
      [a.nps == null ? "—" : Math.round(a.nps * 100) + "%", "lo recomendaría"],
    ].map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");
    $$("#comTabs button").forEach((b) => b.classList.toggle("on", b.dataset.ct === comTab));
    $("#comDeb").classList.toggle("hidden", comTab !== "debates");
    $("#comBody").classList.toggle("hidden", comTab === "debates");
    const aviso = comDatos.local ? `<p class="note">Vista previa: incluye ${comDatos.local} experiencia(s) guardada(s) solo en este navegador. Publicado, el mínimo para mostrar un modelo es de 3 dueños.</p>` : "";
    if (comTab === "debates") return renderDebates();
    if (comTab === "resumen") $("#comBody").innerHTML = aviso + renderResumen(a);
    if (comTab === "consumo") $("#comBody").innerHTML = aviso + renderConsumo(a);
    if (comTab === "problemas") $("#comBody").innerHTML = aviso + renderProblemas(a);
  }

  // Infografías en SVG (se pueden descargar como imagen para compartir en redes)
  const SVG_W = 640;
  function svgCard(titulo, sub, filas, pie, alto) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${alto}" class="info-svg" role="img" aria-label="${esc(titulo)}">
      <rect width="${SVG_W}" height="${alto}" rx="18" fill="#123D2A"/>
      <text x="28" y="44" fill="#FFFFFF" font-family="Space Grotesk,Inter,sans-serif" font-size="22" font-weight="700">${esc(titulo)}</text>
      <text x="28" y="68" fill="#B7CDBE" font-family="Inter,sans-serif" font-size="13">${esc(sub)}</text>
      ${filas}
      <text x="28" y="${alto - 18}" fill="#8FAE99" font-family="Inter,sans-serif" font-size="11">${esc(pie)}</text>
      <text x="${SVG_W - 28}" y="${alto - 18}" fill="#FCD34D" font-family="Space Grotesk,sans-serif" font-size="13" font-weight="700" text-anchor="end">⚡ AutosEléctricosUY</text></svg>`;
  }
  function barras(items, max, fmt, y0) { // items: [{label, a, b?}] a = barra principal, b = referencia
    return items.map((it, i) => { const y = y0 + i * 40, w = 300, ax = 300;
      return `<text x="28" y="${y + 14}" fill="#E6EAF2" font-family="Inter,sans-serif" font-size="13">${esc(it.label.slice(0, 38))}</text>
        <rect x="${ax}" y="${y}" width="${w}" height="10" rx="5" fill="#1E5A3F"/>
        <rect x="${ax}" y="${y}" width="${Math.max(4, (it.a / max) * w)}" height="10" rx="5" fill="${it.color || "#4ADE80"}"/>
        ${it.b != null ? `<rect x="${ax}" y="${y + 13}" width="${Math.max(4, (it.b / max) * w)}" height="5" rx="2.5" fill="#FBBF24"/>` : ""}
        <text x="${ax + w}" y="${y + 32}" fill="#B7CDBE" font-family="Inter,sans-serif" font-size="11" text-anchor="end">${esc(fmt(it))}</text>`; }).join("");
  }
  const descargable = (svg, nombre) => `<figure class="info">${svg}<button class="btn btn-sm btn-ghost-dark" data-png="${nombre}">⬇ Descargar imagen</button></figure>`;

  function infoConsumo(a) {
    let items = a.consumo.filter((c) => c.mediana).slice(0, 8).map((c) => ({ label: c.nombre, a: c.mediana, b: c.ursea, n: c.n }));
    let sub = "Mediana reportada por dueños (barra verde) vs homologado URSEA (amarilla), kWh/100 km";
    if (!items.length) { // sin datos reales todavía: ranking homologado, explicitado como tal
      items = state.modelos.filter(urseaOk).sort((x, y) => x.ursea.consumo_kwh_100km - y.ursea.consumo_kwh_100km).slice(0, 8)
        .map((m) => ({ label: nombreModelo(m.id), a: m.ursea.consumo_kwh_100km, color: "#FBBF24" }));
      sub = "Todavía sin datos de dueños: ranking homologado URSEA (kWh/100 km, menos es mejor)";
    }
    const max = Math.max(...items.map((i) => Math.max(i.a, i.b || 0))) * 1.1;
    return svgCard("¿Cuánto gastan de verdad?", sub, barras(items, max, (i) => `${n1(i.a)}${i.b ? ` · URSEA ${n1(i.b)}` : ""}${i.n ? ` · ${i.n} dueño${i.n > 1 ? "s" : ""}` : ""}`, 96), "Fuente: comunidad AutosEléctricosUY y Registro de Etiquetado Vehicular (URSEA)", 96 + items.length * 40 + 40);
  }
  function infoProblemas(a) {
    const it = Object.entries(a.prob).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => ({ label: PROBLEMAS[k], a: n / a.total * 100, n, color: "#F97316" }));
    if (!it.length) return "";
    return svgCard("Problemas más reportados", `Porcentaje de dueños que lo mencionan · ${a.total} experiencias`, barras(it, 100, (i) => `${Math.round(i.a)}% · ${i.n}`, 96), `${a.sinProblemas} dueños no reportaron ningún problema`, 96 + it.length * 40 + 40);
  }
  function infoDebates() {
    const filas = state.debates.filter((d) => d.opciones).map((d) => {
      const v = comDatos.votos[d.id] || {}, tot = d.opciones.reduce((s, o) => s + (v[o] || 0), 0);
      return { d, v, tot };
    }).filter((x) => x.tot).slice(0, 4);
    if (!filas.length) return "";
    const COL = ["#4ADE80", "#FBBF24", "#F97316", "#A7F3D0"];
    const body = filas.map(({ d, v, tot }, i) => { const y = 100 + i * 70; let x = 28;
      const segs = d.opciones.map((o, j) => { const w = (v[o] || 0) / tot * 584; const r = `<rect x="${x}" y="${y + 12}" width="${w}" height="14" fill="${COL[j]}"/>`; x += w; return r; }).join("");
      const ley = d.opciones.map((o, j) => `${o} ${Math.round((v[o] || 0) / tot * 100)}%`).join("   ·   ");
      return `<text x="28" y="${y + 4}" fill="#E6EAF2" font-family="Inter,sans-serif" font-size="13" font-weight="600">${esc(d.titulo.slice(0, 70))}</text>${segs}
        <text x="28" y="${y + 44}" fill="#B7CDBE" font-family="Inter,sans-serif" font-size="11">${esc(ley.slice(0, 110))} · ${tot} votos</text>`; }).join("");
    return svgCard("Pulso de los debates", "Qué opina la comunidad esta semana", body, "Votos de usuarios de AutosEléctricosUY (uno por persona y debate)", 100 + filas.length * 70 + 30);
  }

  function videoCard(v) {
    const res = v.resumen_editorial || v.resumen;
    return `<a class="video" href="${esc(v.url)}" target="_blank" rel="noopener">
      <span class="v-thumb">${v.miniatura ? `<img src="${esc(v.miniatura)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<i>▶</i></span>
      <span class="v-info"><b>${esc(v.titulo)}</b><em>${esc(v.canal)} · ${esc(fecha(v.fecha))}${v.vistas ? ` · ${v.vistas.toLocaleString("es-UY")} vistas` : ""}</em>
      ${res ? `<span>${esc(res)}${v.resumen_editorial ? "" : ' <small class="muted">(descripción del canal)</small>'}</span>` : ""}</span></a>`;
  }
  function bloqueVideos(n) {
    const V = state.videos || {}, uy = (V.uruguay || []).slice(0, n), int = (V.internacional || []).slice(0, n);
    if (!uy.length && !int.length) return `<div class="panel"><h3>🎬 Lo que se habla esta semana en video</h3><p class="muted">Los lunes y jueves nuestro agente busca en YouTube los videos nuevos sobre eléctricos, de Uruguay y del mundo, y los resume en una línea. Se completa cuando el sitio esté publicado.</p></div>`;
    return `<div class="panel"><h3>🎬 Lo que se habla esta semana en video</h3><div class="videos-grid">
      <div><h4>🇺🇾 Uruguay</h4>${uy.map(videoCard).join("") || '<p class="muted small">Sin videos nuevos esta semana.</p>'}</div>
      <div><h4>🌎 Internacional</h4>${int.map(videoCard).join("") || '<p class="muted small">Sin videos nuevos esta semana.</p>'}</div>
      </div><p class="muted small">Videos de YouTube; los derechos son de cada canal. Actualizado ${esc(fecha(V.actualizado))}.</p></div>`;
  }

  function renderResumen(a) {
    const r = state.comunidad.resumen;
    const destacados = r && r.puntos && r.puntos.length ? `<div class="panel"><h3>${esc(r.titular || "Lo que dejó la semana")}</h3><ul>${r.puntos.map((p) => `<li>${esc(p)}</li>`).join("")}</ul><p class="muted small">Resumen generado por nuestro agente a partir de las experiencias y comentarios aprobados (${esc(fecha(state.comunidad.actualizado))}).</p></div>` :
      `<div class="panel"><h3>Cómo funciona</h3><p class="muted">Cada semana un agente lee las experiencias y los comentarios aprobados, extrae consumos (kWh/100 km, km/kWh, autonomía) y clasifica los problemas. Con eso arma estas infografías y un resumen. Los promedios solo aparecen con 3 o más dueños por modelo, y nunca se publican nombres.</p></div>`;
    return bloqueVideos(4) + `<div class="info-grid">${descargable(infoConsumo(a), "consumo-real")}${infoProblemas(a) ? descargable(infoProblemas(a), "problemas") : ""}${infoDebates() ? descargable(infoDebates(), "debates") : ""}</div>${destacados}`;
  }

  function renderConsumo(a) {
    if (!a.consumo.length) return `<div class="empty">Todavía no hay suficientes dueños por modelo. <button class="btn btn-sm btn-primary" data-exp="1">Sé el primero en contar tu consumo</button><br><span class="small muted">Mientras tanto, el consumo homologado de cada modelo está en Modelos y en el comparador.</span></div>`;
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Modelo</th><th>Dueños</th><th>Real (mediana)</th><th>Rango típico</th><th>Ciudad</th><th>Ruta</th><th>Homologado URSEA</th><th>Diferencia</th></tr></thead><tbody>
      ${a.consumo.map((c) => `<tr><td>${esc(c.nombre)}</td><td>${c.n}</td><td><b>${n1(c.mediana)}</b></td><td>${n1(c.p25)}–${n1(c.p75)}</td><td>${n1(c.porUso.ciudad)}</td><td>${n1(c.porUso.ruta)}</td><td>${n1(c.ursea)}</td>
        <td>${c.ursea ? `<span class="${c.mediana > c.ursea ? "neg" : "pos"}">${c.mediana > c.ursea ? "+" : ""}${Math.round((c.mediana / c.ursea - 1) * 100)}%</span>` : "—"}</td></tr>`).join("")}
      </tbody></table></div><p class="muted small">Valores en kWh/100 km, como los muestra la computadora del auto (no incluyen pérdidas de carga). Se descartan valores fuera de 6–40 kWh/100 km.</p>`;
  }

  function renderProblemas(a) {
    if (!a.total) return `<div class="empty">Sin experiencias todavía. <button class="btn btn-sm btn-primary" data-exp="1">Contá la tuya</button></div>`;
    const porModelo = {};
    comDatos.experiencias.forEach((e) => { const p = porModelo[e.modelo] = porModelo[e.modelo] || { n: 0, prob: {}, notas: [] }; p.n++; if (e.nota) p.notas.push(e.nota); (e.problemas || []).forEach((k) => (p.prob[k] = (p.prob[k] || 0) + 1)); });
    const filas = Object.entries(porModelo).filter(([, p]) => p.n >= MIN_N()).sort((x, y) => y[1].n - x[1].n).map(([id, p]) => {
      const top = Object.entries(p.prob).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, n]) => `${PROBLEMAS[k]} (${Math.round(n / p.n * 100)}%)`).join(", ") || "Ninguno reportado";
      const nota = p.notas.length ? (p.notas.reduce((s, x) => s + x, 0) / p.notas.length) : null;
      return `<tr><td>${esc(nombreModelo(id))}</td><td>${p.n}</td><td>${nota ? "★ " + n1(nota) : "—"}</td><td>${esc(top)}</td></tr>`; }).join("");
    return `${infoProblemas(a) ? descargable(infoProblemas(a), "problemas") : ""}<div class="table-wrap"><table class="tbl"><thead><tr><th>Modelo</th><th>Dueños</th><th>Recomendación</th><th>Problemas más citados</th></tr></thead><tbody>${filas || '<tr><td colspan="4" class="muted">Ningún modelo llega todavía al mínimo de dueños.</td></tr>'}</tbody></table></div>`;
  }

  async function descargarPng(nombre, btn) {
    const svg = btn.closest("figure").querySelector("svg"), vb = svg.viewBox.baseVal;
    const img = new Image(), url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
    img.onload = () => { const c = document.createElement("canvas"); c.width = vb.width * 2; c.height = vb.height * 2; const ctx = c.getContext("2d"); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url); const a = document.createElement("a"); a.download = `voltuy-${nombre}.png`; a.href = c.toDataURL("image/png"); a.click(); };
    img.src = url;
  }

  function initExperiencia() {
    $("#expModelo").innerHTML = '<option value="">Elegí tu modelo…</option>' + state.modelos.map((m) => `<option value="${m.id}">${esc(nombreModelo(m.id))}</option>`).join("");
    const deptos = [...new Set(state.cargadores.map((c) => c.departamento).filter(Boolean))].sort();
    $("#expDepto").innerHTML += deptos.map((d) => `<option>${esc(d)}</option>`).join("");
    $("#expProb").innerHTML = Object.entries(PROBLEMAS).map(([k, l]) => `<label><input type="checkbox" name="p_${k}"> ${esc(l)}</label>`).join("");
    $("#expStars").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}">★</button>`).join("");
    $("#expStars").onclick = (e) => { const b = e.target.closest("[data-star]"); if (!b) return; const n = +b.dataset.star; $("#expForm").nota.value = n; $$("#expStars button").forEach((x) => x.classList.toggle("on", +x.dataset.star <= n)); };
    const mes = new Date().getMonth(); $("#expForm").estacion.value = [11, 0, 1].includes(mes) ? "verano" : mes < 5 ? "otono" : mes < 8 ? "invierno" : "primavera";
    $("#btnExp").onclick = () => $("#expDlg").showModal();
    $("#expForm").addEventListener("submit", async (e) => {
      if (e.submitter && e.submitter.value === "cancel") return;
      const f = e.target, fd = Object.fromEntries(new FormData(f));
      if (fd.web || !fd.modelo) return;
      const v = +String(fd.consumo).replace(",", ".");
      const exp = { modelo: fd.modelo, kwh100: Math.round((fd.unidad === "kmkwh" ? 100 / v : v) * 10) / 10, uso: fd.uso, estacion: fd.estacion,
        km: fd.km ? +fd.km : null, departamento: fd.departamento || null, nota: fd.nota ? +fd.nota : null,
        problemas: Object.keys(PROBLEMAS).filter((k) => fd["p_" + k]), texto: fd.texto || "" };
      const r = await api("/api/experiencias", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exp) });
      if (!(r && r.ok)) { const l = store.get("exp_local", []); l.push(exp); store.set("exp_local", l); }
      toast(r && r.ok ? "¡Gracias! Tu experiencia ya suma a los promedios" : "Vista previa: guardada solo en este navegador");
      f.reset(); $$("#expStars button").forEach((x) => x.classList.remove("on"));
      if (location.hash === "#debates") renderComunidad();
    });
  }

  function encuesta(d) {
    if (!d.opciones) return "";
    const v = (comDatos && comDatos.votos[d.id]) || {}, tot = d.opciones.reduce((s, o) => s + (v[o] || 0), 0), mio = store.get("votos_local", {})[d.id] || store.get("voto_" + d.id, null);
    return `<div class="poll"><b>¿Vos qué pensás?</b>${d.opciones.map((o) => { const p = tot ? Math.round((v[o] || 0) / tot * 100) : 0;
      return `<button class="poll-op ${mio === o ? "on" : ""}" data-voto="${esc(d.id)}" data-op="${esc(o)}" ${mio ? "disabled" : ""}><span style="width:${mio ? p : 0}%"></span><em>${esc(o)}</em>${mio ? `<i>${p}%</i>` : ""}</button>`; }).join("")}
      <p class="muted small">${tot} voto${tot === 1 ? "" : "s"}${mio ? "" : " · votá para ver los resultados"}</p></div>`;
  }
  async function votar(tema, op) {
    const r = await api("/api/votos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tema, opcion: op }) });
    if (r && r.ok) store.set("voto_" + tema, op);
    else { const v = store.get("votos_local", {}); v[tema] = op; store.set("votos_local", v); }
    await renderComunidad(); openThread(tema);
  }

  // ======================= Devolución del MIEM =======================
  const diasHasta = (iso) => Math.ceil((new Date(iso + "T23:59:59-03:00") - new Date()) / 864e5);
  function initMiem() {
    const M = state.miem; if (!M || !M.cierre) return;
    const d = diasHasta(M.cierre);
    const txt = d >= 0 ? `Cierra el ${fecha(M.cierre)}: quedan ${d} días.` : `La convocatoria ${M.cierre.slice(0, 4)} cerró el ${fecha(M.cierre)}.`;
    $("#miemCierre").textContent = txt; $("#miemDias").textContent = d >= 0 ? `Quedan ${d} días.` : "";
    if (d < 0) $("#promoMiem").classList.add("hidden");
    $("#miemPasos").innerHTML = M.pasos.map((p) => `<li><b>${esc(p.t)}</b><span>${esc(p.d)}</span>${p.url ? `<a class="small" href="${esc(p.url)}" target="_blank" rel="noopener">Abrir ↗</a>` : ""}</li>`).join("")
      + `<li><b>Material de apoyo</b><span><a href="${esc(M.enlaces.tabla_ilustrativa)}" target="_blank" rel="noopener">Tabla de montos según km por día</a> · <a href="${esc(M.enlaces.preguntas_frecuentes)}" target="_blank" rel="noopener">Preguntas frecuentes</a> · <a href="${esc(M.enlaces.instructivo)}" target="_blank" rel="noopener">Instructivo del trámite</a></span></li>`;
    $("#miemForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target)), malo = [];
      if (f.tipo !== "bev") malo.push("Solo aplica a vehículos 100% eléctricos (no híbridos ni enchufables).");
      if (f.ruedas === "pesado") malo.push("Esta convocatoria es para vehículos livianos; camiones y ómnibus van por otra vía (medidas no estandarizadas).");
      if (f.nuevo !== "si") malo.push("El vehículo tiene que haberse comprado nuevo y sin uso: no se aceptan usados ni unidades de test drive.");
      if (f.padron !== "si") malo.push("Tiene que estar empadronado.");
      if (f.cuenta !== "si") malo.push("Necesitás una cuenta bancaria a tu nombre (o de la empresa): no se aceptan cuentas de terceros.");
      const ini = f.inicio ? new Date(f.inicio + "T12:00:00") : null, desde = new Date(M.inicio_operacion_desde + "T00:00:00");
      let cuando = "";
      if (ini && ini < desde) malo.push(`Tiene que estar en uso desde el ${fecha(M.inicio_operacion_desde)} o después.`);
      if (ini && ini >= desde) {
        const habil = new Date(ini.getTime() + M.antiguedad_minima_dias * 864e5), cierre = new Date(M.cierre + "T23:59:59");
        if (habil > cierre) malo.push(`Recién cumple un año de uso el ${habil.toLocaleDateString("es-UY")}, después del cierre de esta convocatoria. Probablemente puedas postularte en la de ${habil.getFullYear()}.`);
        else cuando = habil <= new Date() ? "Ya cumple el año de uso: podés postularte hoy." : `Podés postularte desde el ${habil.toLocaleDateString("es-UY")}.`;
      }
      $("#miemRes").innerHTML = malo.length
        ? `<div class="kpi"><div class="l">Resultado</div><div class="v" style="font-size:1.4rem">Por ahora no calificás</div></div><ul>${malo.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
        : `<div class="kpi big"><div class="l">Resultado</div><div class="v">¡Calificás! Hasta ${pesos(M.tope_uyu)}</div></div><p>${esc(cuando)}</p>
           <p>El monto exacto depende de cuántos km hacés por día (ver la tabla del MIEM). Seguí el paso a paso de abajo; es gratis y no necesitás intermediarios.</p>
           <p class="small">Tip: guardá la factura, la libreta de propiedad y los datos completos de tu cuenta bancaria antes de empezar.</p>`;
    });
  }

  // ======================= Alertas de precio e historial =======================
  function historial(id) {
    const h = ((state.precios_historial || {}).historial || {})[id] || [];
    const m = state.modelos.find((x) => x.id === id);
    const pts = [...h]; if (m && m.precio_usd && (!pts.length || pts[pts.length - 1][1] !== m.precio_usd)) pts.push([(m.fecha_precio || "").slice(0, 10) || "hoy", m.precio_usd]);
    return pts;
  }
  function sparkHist(pts) {
    if (pts.length < 2) return `<p class="muted small">Precio actual: <b>US$ ${pts.length ? pts[0][1].toLocaleString("es-UY") : "—"}</b>. Empezamos a registrar cada cambio de precio desde noviembre de 2026; acá vas a ver la evolución.</p>`;
    const W = 320, H = 70, vs = pts.map((p) => p[1]), mn = Math.min(...vs), mx = Math.max(...vs), r = mx - mn || 1;
    const xy = pts.map((p, i) => [10 + (i * (W - 20)) / (pts.length - 1), H - 12 - ((p[1] - mn) / r) * (H - 24)]);
    return `<svg viewBox="0 0 ${W} ${H}" class="spark"><polyline fill="none" stroke="#16A34A" stroke-width="2.5" points="${xy.map((p) => p.join(",")).join(" ")}"/>${xy.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#16A34A"><title>${pts[i][0]}: US$ ${pts[i][1].toLocaleString("es-UY")}</title></circle>`).join("")}</svg>
      <p class="muted small">${pts.map((p) => `${esc(p[0])}: US$ ${p[1].toLocaleString("es-UY")}`).join(" → ")}</p>`;
  }
  function abrirAlerta(id) {
    const m = state.modelos.find((x) => x.id === id); if (!m) return;
    const f = $("#alertaForm"); f.modelo_id.value = id; f.objetivo.value = "";
    $("#alertaTit").textContent = `Precio de ${nombreModelo(id)}`;
    $("#alertaHist").innerHTML = sparkHist(historial(id));
    $("#alertaDlg").showModal();
  }
  function initAlertas() {
    $("#alertaForm").addEventListener("submit", async (e) => {
      if (e.submitter && e.submitter.value === "cancel") return;
      const fd = Object.fromEntries(new FormData(e.target)); if (fd.web) return;
      const r = await api("/api/alertas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: fd.email, modelo_id: fd.modelo_id, objetivo: fd.objetivo ? +fd.objetivo : null }) });
      toast(r && r.ok ? "Listo: revisá tu correo para confirmar la alerta" : "Vista previa: las alertas se activan con el sitio publicado");
      e.target.reset();
    });
  }

  // ======================= Recomendador =======================
  const autonomiaDe = (m) => (urseaOk(m) && m.ursea.autonomia_km) || (m.autonomia_km ? (m.ciclo && /CLTC|NEDC/i.test(m.ciclo) ? m.autonomia_km * 0.8 : m.autonomia_km) : (m.bateria_kwh ? (m.bateria_kwh * 0.92 / consumoDe(m)) * 100 : 0));
  const GRANDES = /mediano|grande|Sedán|Monovolumen/;
  function renderElegir() {
    const pres = +$("#ePres").value, car = $("#eCar").value, km = +$("#eKm").value, viaje = +$("#eViaje").value, casa = +$("#eCasa").value, prio = $("#ePrio").value;
    $("#ePresLbl").textContent = pres >= 100000 ? "sin tope" : "US$ " + pres.toLocaleString("es-UY"); $("#eKmLbl").textContent = km + " km";
    const necesaria = Math.max(km * (casa ? 1.6 : 3), viaje === 2 ? 350 : viaje === 1 ? 250 : 0);
    const cand = state.modelos.filter((m) => m.tipo === "BEV" && m.precio_usd && (pres >= 100000 || m.precio_usd <= pres) && (!car || m.carroceria === car));
    if (!cand.length) { $("#eRes").innerHTML = '<p>No hay modelos con esas condiciones. Probá subir el presupuesto o cambiar el tipo de vehículo.</p>'; return; }
    const maxP = Math.max(...cand.map((m) => m.precio_usd)), minP = Math.min(...cand.map((m) => m.precio_usd));
    const maxA = Math.max(...cand.map(autonomiaDe), 1), maxV = Math.max(...cand.map(ventasModelo), 1);
    const peso = { precio: [0.45, 0.2, 0.1, 0.1], autonomia: [0.2, 0.45, 0.1, 0.1], espacio: [0.2, 0.2, 0.35, 0.1], respaldo: [0.2, 0.2, 0.1, 0.4] }[prio];
    const res = cand.map((m) => {
      const a = autonomiaDe(m), sp = maxP === minP ? 1 : 1 - (m.precio_usd - minP) / (maxP - minP), sa = a / maxA;
      const se = GRANDES.test(m.segmento) || m.carroceria === "Utilitario" ? 1 : /compacto|Hatch/.test(m.segmento) ? 0.6 : 0.3;
      const sv = Math.log1p(ventasModelo(m)) / Math.log1p(maxV);
      let s = peso[0] * sp + peso[1] * sa + peso[2] * se + peso[3] * sv + 0.05 * (urseaOk(m) ? 1 : 0);
      const pen = a && a < necesaria ? Math.min(0.5, (necesaria - a) / necesaria) : 0; s -= pen;
      const por = [];
      if (sp > 0.7) por.push("de los más baratos de tu búsqueda");
      if (a) por.push(`${Math.round(a)} km de autonomía estimada${urseaOk(m) ? " (URSEA)" : ""}${a >= necesaria ? ", alcanza para tu uso" : ", justa para tu uso"}`);
      if (urseaOk(m)) por.push(`consume ${n1(m.ursea.consumo_kwh_100km)} kWh/100 km: unos ${pesos(m.ursea.consumo_kwh_100km / 100 * km * 30 * 3.0)} por mes cargando en casa`);
      if (ventasModelo(m) > 300) por.push(`${ventasModelo(m).toLocaleString("es-UY")} vendidos en 2026: buena red de servicio y repuestos`);
      if (!casa && m.bateria_kwh && m.bateria_kwh < 40) por.push("ojo: batería chica si dependés de la red pública");
      return { m, s, por };
    }).sort((a, b) => b.s - a.s).slice(0, 5);
    $("#eRes").innerHTML = `<h3 style="margin:0 0 8px">Tus 5 mejores opciones</h3>` + res.map(({ m, por }, i) => `<div class="e-item"><span class="v-pos">${i + 1}</span><div><b>${esc(nombreModelo(m.id))}</b> · US$ ${m.precio_usd.toLocaleString("es-UY")}<ul>${por.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      <button class="btn btn-sm btn-ghost-dark" data-cmp="${m.id}">Comparar</button> <button class="btn btn-sm btn-primary" data-lead="${m.id}">Cotizar</button> <button class="btn btn-sm btn-ghost-dark" data-alerta="${m.id}">🔔 Avisame si baja</button></div></div>`).join("")
      + `<p class="small" style="color:#B7CDBE">Autonomía necesaria estimada para tu uso: ${Math.round(necesaria)} km. Orden calculado con precio, autonomía (URSEA cuando hay dato confiable), tamaño y ventas 2026, según tu prioridad.</p>`;
  }
  function initElegir() { ["#ePres", "#eCar", "#eKm", "#eViaje", "#eCasa", "#ePrio"].forEach((x) => $(x).addEventListener("input", renderElegir)); renderElegir(); }

  // ======================= Costo total de tenencia =======================
  function renderTco() {
    const m = state.modelos.find((x) => x.id === $("#kModelo").value);
    if (document.activeElement !== $("#tPrecioE") && m && m.precio_usd && $("#tPrecioE").dataset.mid !== m.id) { $("#tPrecioE").value = m.precio_usd; $("#tPrecioE").dataset.mid = m.id; }
    const n = +$("#tAnios").value, tc = +$("#tTC").value || 39, pe = +$("#tPrecioE").value || 0, pc = +$("#tPrecioC").value || 0;
    $("#tAniosLbl").textContent = n + (n === 1 ? " año" : " años");
    const t = state.tarifas, km = +$("#kKm").value, cons = +$("#kCons").value || 16, casa = +$("#kCasa").value / 100, dcs = +$("#kDc").value / 100;
    const ac = t.publica.find((p) => p.id === "ute_ac"), dcp = t.publica.find((p) => p.id === "ute_dc");
    const pMix = casa * precioCasa($("#kTarifa").value) + (1 - casa) * ((1 - dcs) * precioPublica(ac) + dcs * precioPublica(dcp));
    const comb = (state.combustible.productos || []).find((p) => p.clave === $("#kComb").value) || { precio_uyu: 0 };
    const energiaE = cons / 100 * pMix * km * 365 * n / tc, energiaC = (+$("#kLitros").value || 0) / 100 * comb.precio_uyu * km * 365 * n / tc;
    const desc = $("#tAnual").checked ? 0.8 : 1, dep = (i) => Math.pow(0.88, i); // valor de mercado cae ~12% por año
    let patE = 0, patC = 0, segE = 0, segC = 0;
    for (let i = 0; i < n; i++) {
      patE += pe / 1.22 * (i === 0 ? 0.03 : 0.0225) * dep(i) * desc; patC += pc / 1.22 * (+$("#tPatC").value / 100) * dep(i) * desc;
      segE += pe * dep(i) * (+$("#tSeg").value / 100) * 0.85; segC += pc * dep(i) * (+$("#tSeg").value / 100);
    }
    const mantE = +$("#tMantE").value * n, mantC = +$("#tMantC").value * n, miem = $("#tMiem").checked ? state.miem.tope_uyu / tc : 0;
    const E = { Compra: pe, Energía: energiaE, Patente: patE, Seguro: segE, Mantenimiento: mantE, "Devolución MIEM": -miem };
    const C = { Compra: pc, Energía: energiaC, Patente: patC, Seguro: segC, Mantenimiento: mantC };
    const tE = Object.values(E).reduce((a, b) => a + b, 0), tC = Object.values(C).reduce((a, b) => a + b, 0);
    const usd = (v) => "US$ " + Math.round(v).toLocaleString("es-UY");
    $("#tKpis").innerHTML = `<div class="kpi"><div class="l">Eléctrico en ${n} años</div><div class="v">${usd(tE)}</div></div><div class="kpi"><div class="l">Nafta en ${n} años</div><div class="v">${usd(tC)}</div></div>
      <div class="kpi big"><div class="l">${tE <= tC ? "Ahorrás con el eléctrico" : "El eléctrico cuesta más"}</div><div class="v">${usd(Math.abs(tC - tE))}</div></div>`;
    const cats = ["Compra", "Energía", "Patente", "Seguro", "Mantenimiento"], col = ["#94A3B8", "#16A34A", "#F59E0B", "#38BDF8", "#A78BFA"];
    const mx = Math.max(tE + miem, tC);
    const barra = (O, lab) => `<div class="bar"><span>${lab}</span><div class="track stack">${cats.map((c, i) => `<div class="fill" title="${c}: ${usd(O[c])}" style="width:${(O[c] / mx) * 100}%;background:${col[i]}"></div>`).join("")}</div><span>${usd(cats.reduce((a, c) => a + O[c], 0))}</span></div>`;
    $("#tBars").innerHTML = barra(E, "Eléctrico") + barra(C, "Nafta") + `<p class="small leyenda">${cats.map((c, i) => `<i style="background:${col[i]}"></i>${c}`).join(" ")}${miem ? ` · al eléctrico se le resta la devolución del MIEM (${usd(miem)})` : ""}</p>`;
    $("#tNota").textContent = "Estimación: patente eléctrica 3% del valor sin IVA el primer año y 2,25% después; seguro con 15% de descuento del BSE para eléctricos; el valor del auto baja ~12% por año. Energía según lo que elegiste arriba. No incluye valor de reventa ni financiación. Ajustá los supuestos a tu caso.";
  }
  function initTco() { ["#tAnios", "#tPrecioE", "#tPrecioC", "#tTC", "#tSeg", "#tPatC", "#tMantE", "#tMantC", "#tMiem", "#tAnual", "#kModelo", "#kCons", "#kKm", "#kTarifa", "#kCasa", "#kDc", "#kComb", "#kLitros"].forEach((x) => $(x).addEventListener("input", renderTco)); renderTco(); }

  // ======================= Usados =======================
  const CHECK_USADOS = [
    ["Estado de la batería (SOH)", "Pedí el porcentaje de salud de la batería con un escáner o un informe del servicio oficial. Por debajo de 85-90% en un auto de pocos años, negociá el precio."],
    ["Garantía de batería", "Muchas marcas dan 8 años de garantía de batería. Confirmá que siga vigente y que se transfiera al nuevo dueño."],
    ["Historial de servicio", "Pedí las revisiones en el servicio oficial y las actualizaciones de software hechas."],
    ["Uso de carga rápida", "Usar mucha carga rápida acelera el desgaste. Preguntá cómo cargaba el dueño anterior."],
    ["Prueba de carga", "Probá cargarlo en un cargador público (AC y DC) para comprobar que acepta carga sin errores."],
    ["Cable y cargador", "Verificá que incluya el cable de carga y, si lo tenía, el cargador portátil o wallbox."],
    ["Neumáticos y frenos", "Los eléctricos son pesados y gastan más neumáticos: revisalos. Los frenos suelen durar más por la frenada regenerativa."],
    ["Devolución del MIEM", "Los usados no califican para la devolución del MIEM: no lo sumes al cálculo."],
  ];
  function initUsados() {
    const U = state.usados || {}, ids = Object.keys(U.modelos || {});
    $("#uCheck").innerHTML = CHECK_USADOS.map(([t, d]) => `<div class="rule"><h3>✔ ${esc(t)}</h3><p>${esc(d)}</p></div>`).join("");
    if (!ids.length) {
      const mods = [...new Map(state.modelos.filter((m) => m.tipo === "BEV").map((m) => [m.marca + " " + m.modelo, m])).keys()].sort();
      $("#uModelo").innerHTML = mods.map((n) => `<option>${esc(n)}</option>`).join("");
      const pinta0 = () => { const q = $("#uModelo").value, slug = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
        $("#uRes").innerHTML = `<div class="empty">Estamos sumando precios de referencia de usados por año y kilómetros.<br>Mientras tanto, mirá los avisos de <b>${esc(q)}</b> usados:<br><br>
          <a class="btn btn-primary" href="https://autos.mercadolibre.com.uy/${slug}-usado" target="_blank" rel="noopener">Ver avisos en MercadoLibre ↗</a>
          <br><span class="small muted">Antes de comprar, repasá el checklist de abajo.</span></div>`; };
      $("#uModelo").addEventListener("input", pinta0); pinta0(); return;
    }
    $("#uUpd").textContent = "Actualizado " + fecha(U.actualizado);
    $("#uModelo").innerHTML = ids.sort((a, b) => U.modelos[b].n - U.modelos[a].n).map((id) => `<option value="${id}">${esc(U.modelos[id].nombre)} (${U.modelos[id].n} avisos)</option>`).join("");
    const pinta = () => { const d = U.modelos[$("#uModelo").value];
      $("#uRes").innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Año</th><th>Avisos</th><th>Precio típico</th><th>Rango</th><th>Km típicos</th></tr></thead><tbody>${d.por_anio.map((a) => `<tr><td>${a.anio}</td><td>${a.n}</td><td><b>US$ ${a.mediana.toLocaleString("es-UY")}</b></td><td>US$ ${a.p25.toLocaleString("es-UY")}–${a.p75.toLocaleString("es-UY")}</td><td>${a.km ? a.km.toLocaleString("es-UY") + " km" : "—"}</td></tr>`).join("")}</tbody></table></div>
        <div class="u-avisos">${d.avisos.map((x) => `<a class="u-aviso" href="${esc(x.url)}" target="_blank" rel="noopener"><b>US$ ${x.precio.toLocaleString("es-UY")}</b><span>${x.anio} · ${x.km ? x.km.toLocaleString("es-UY") + " km" : "km s/d"} · ${esc(x.lugar || "")}</span><em>${esc(x.titulo)}</em></a>`).join("")}</div>
        <p class="muted small">Avisos de MercadoLibre. AutosEléctricosUY no vende ni intermedia: verificá siempre el vehículo antes de comprar.</p>`; };
    $("#uModelo").addEventListener("input", pinta); pinta();
  }

  // ======================= Alojamientos =======================
  let alojDest = [];
  async function initAlojamientos() {
    const A = state.alojamientos || { alojamientos: [], planes: [] };
    const r = await api("/api/alojamientos"); alojDest = (r && r.ok && r.alojamientos) || [];
    const todos = () => { const ids = new Set(alojDest.map((x) => x.id)); return [...alojDest, ...A.alojamientos.filter((x) => !ids.has(x.id))]; };
    const deps = [...new Set(todos().map((x) => x.departamento).filter(Boolean))].sort(), tipos = [...new Set(todos().map((x) => x.tipo))].sort();
    $("#aDepto").innerHTML = '<option value="">Todo el país</option>' + deps.map((d) => `<option>${esc(d)}</option>`).join("");
    $("#aTipo").innerHTML = '<option value="">Todos los tipos</option>' + tipos.map((d) => `<option>${esc(d)}</option>`).join("");
    const pinta = () => {
      const dp = $("#aDepto").value, tp = $("#aTipo").value;
      const L = todos().filter((x) => (!dp || x.departamento === dp) && (!tp || x.tipo === tp)).sort((a, b) => (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0) || a.nombre.localeCompare(b.nombre));
      $("#aList").innerHTML = L.map((x) => `<div class="aloj ${x.destacado ? "dest" : ""}">${x.destacado ? '<span class="badge-dest">★ Destacado</span>' : ""}
        ${x.foto ? `<img src="${esc(x.foto)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
        <h3>${esc(x.nombre)}</h3><p class="muted small">${esc(x.tipo)} · ${esc(x.localidad)}${x.departamento && x.departamento !== x.localidad ? ", " + esc(x.departamento) : ""}</p>
        <p class="small">🔌 ${esc(x.cargador)}<br>👤 ${esc(x.acceso)}${x.distancia_m ? ` · cargador a ${x.distancia_m} m` : ""}</p>
        <div class="row">${x.url ? `<a class="btn btn-sm btn-primary" href="${esc(x.url)}" target="_blank" rel="noopener sponsored">Reservar / ver</a>` : ""}<a class="btn btn-sm btn-ghost-dark" href="https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=16/${x.lat}/${x.lon}" target="_blank" rel="noopener">Mapa</a></div></div>`).join("")
        || '<div class="empty">Todavía no hay alojamientos en esta zona. ¿Tenés uno con cargador? Sumalo gratis.</div>';
    };
    ["#aDepto", "#aTipo"].forEach((s) => $(s).addEventListener("input", pinta)); pinta();
    $("#aPlanes").innerHTML = `<h2>¿Tenés un alojamiento con cargador?</h2><div class="planes-grid">${A.planes.map((p) => `<div class="plan ${p.id !== "basico" ? "dest" : ""}"><h3>${esc(p.nombre)}</h3><div class="precio">${esc(p.precio)}</div><ul>${p.detalle.map((d) => `<li>${esc(d)}</li>`).join("")}</ul><button class="btn btn-sm ${p.id === "basico" ? "btn-ghost-dark" : "btn-primary"}" data-plan="${p.id}">${p.id === "basico" ? "Sumarme gratis" : "Quiero destacarme"}</button></div>`).join("")}</div>`;
    const txtPlan = () => { const p = A.planes.find((x) => x.id === $("#alojPlan").value); $("#alojPlanTxt").textContent = p ? `${p.precio}. ${p.id === "basico" ? "Revisamos los datos y lo publicamos." : "Después de verificar los datos te mandamos el enlace de pago (Mercado Pago). Se activa al acreditarse."}` : ""; };
    $("#alojPlan").addEventListener("input", txtPlan);
    $("#btnAloj").onclick = () => { txtPlan(); $("#alojDlg").showModal(); };
    $("#alojForm").addEventListener("submit", async (e) => {
      if (e.submitter && e.submitter.value === "cancel") return;
      const fd = Object.fromEntries(new FormData(e.target)); if (fd.web) return;
      const r2 = await api("/api/alojamientos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fd) });
      toast(r2 && r2.ok ? (r2.pago ? "¡Gracias! Te llevamos al pago" : "¡Gracias! Lo revisamos y te avisamos por correo") : "Vista previa: el alta se activa con el sitio publicado");
      if (r2 && r2.pago) location.href = r2.pago;
      e.target.reset();
    });
  }

  // ======================= Empresas y flotas =======================
  function renderFlota() {
    const t = state.tarifas, n = +$("#fN").value || 1, km = +$("#fKm").value || 0, dias = +$("#fDias").value || 0;
    const comb = (state.combustible.productos || []).find((p) => p.clave === $("#fComb").value) || { precio_uyu: 0, producto: "" };
    const tar = $("#fTar").value, tri = t.residencial.find((r) => /triple/i.test(r.id + r.nombre)) || t.residencial[0];
    const fr = (id) => (tri.franjas.find((f) => f.id.includes(id)) || tri.franjas[0]).sin_iva * (1 + t.iva);
    const pk = tar === "dc" ? precioPublica(t.publica.find((p) => p.id === "ute_dc")) : fr(tar);
    const kmAnio = n * km * dias, cE = (+$("#fCons").value || 0) / 100 * pk * kmAnio, cC = (+$("#fLitros").value || 0) / 100 * comb.precio_uyu * kmAnio;
    const cee = n * state.miem.tope_uyu;
    $("#fKpis").innerHTML = `<div class="kpi"><div class="l">Combustible por año</div><div class="v">${pesos(cC)}</div></div><div class="kpi"><div class="l">Electricidad por año</div><div class="v">${pesos(cE)}</div></div>
      <div class="kpi big"><div class="l">Ahorro de energía por año</div><div class="v">${pesos(cC - cE)}</div></div><div class="kpi"><div class="l">Certificados del MIEM (tope)</div><div class="v">hasta ${pesos(cee)}</div></div>`;
    $("#fNota").textContent = `${kmAnio.toLocaleString("es-UY")} km por año en total. Solo energía, con IVA (las empresas suelen descontarlo). No incluye potencia contratada, mantenimiento ni la inversión en cargadores. Las tarifas comerciales de UTE pueden diferir de las residenciales usadas acá.`;
  }
  function initEmpresas() {
    const P = state.combustible.productos || [];
    $("#fComb").innerHTML = P.map((p) => `<option value="${p.clave}">${esc(p.producto)} (${pesos2(p.precio_uyu)}/l)</option>`).join("");
    const g = P.find((p) => /gasoil 50/i.test(p.producto)) || P[0]; if (g) $("#fComb").value = g.clave;
    ["#fN", "#fKm", "#fDias", "#fComb", "#fLitros", "#fCons", "#fTar"].forEach((x) => $(x).addEventListener("input", renderFlota)); renderFlota();
    const M = state.miem;
    $("#fBenef").innerHTML = [
      ["Certificados de Eficiencia Energética", `${M.flotas} Hasta ${pesos(M.tope_uyu)} por vehículo liviano eléctrico.`, "#miem"],
      ["Sin aranceles de importación", "Vehículos eléctricos, baterías y cargadores están exonerados de aranceles.", "#normativa"],
      ["Seguro", "El BSE aplica 15% de descuento a utilitarios y camiones eléctricos (20% en ómnibus).", "#normativa"],
      ["Patente reducida", "Los eléctricos pagan una patente menor que los de combustión (ver Normativa por los cambios de 2027).", "#normativa"],
    ].map(([t, d, h]) => `<div class="rule"><h3>${esc(t)}</h3><p>${esc(d)}</p><a class="small" href="${h}">Ver más →</a></div>`).join("");
    const U = state.modelos.filter((m) => m.carroceria === "Utilitario" || m.carroceria === "Pick-up").sort((a, b) => (a.precio_usd || 9e9) - (b.precio_usd || 9e9));
    $("#fTabla").innerHTML = `<thead><tr><th>Modelo</th><th>Tipo</th><th>Precio</th><th>Batería</th><th>Autonomía</th><th>Vendidos 2026</th><th></th></tr></thead><tbody>${U.map((m) => `<tr><td>${esc(nombreModelo(m.id))}</td><td>${esc(m.carroceria)}</td><td>${m.precio_usd ? "US$ " + m.precio_usd.toLocaleString("es-UY") : "—"}</td><td>${m.bateria_kwh ? n1(m.bateria_kwh) + " kWh" : "—"}</td><td>${autonomiaDe(m) ? Math.round(autonomiaDe(m)) + " km" : "—"}</td><td>${ventasModelo(m) || "—"}</td><td><button class="btn btn-sm btn-primary" data-lead="${m.id}">Cotizar</button></td></tr>`).join("")}</tbody>`;
  }

  // ---------- Leads y newsletter (monetización) ----------
  function openLead(id) {
    const m = state.modelos.find((x) => x.id === id); if (!m) return;
    $("#leadModel").textContent = `${m.marca} ${m.modelo} ${m.version || ""} · ${usd(m.precio_usd)}`;
    $("#leadForm").dataset.model = id;
    $("#leadDlg").showModal();
  }
  $("#leadForm").addEventListener("submit", async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    const fd = Object.fromEntries(new FormData(e.target));
    const r = await api("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fd, modelo: e.target.dataset.model }) });
    toast(r && r.ok ? "¡Listo! Un concesionario te va a contactar" : "Vista previa: el formulario se activa al publicar el sitio");
    e.target.reset();
  });
  $("#nlForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = e.target.querySelector("input").value;
    const r = await api("/api/newsletter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    toast(r && r.ok ? (r.confirmar ? "Te mandamos un correo: confirmá tu suscripción" : "¡Listo, ya estás suscripto!") : "Vista previa: la suscripción se activa al publicar el sitio");
    e.target.reset();
  });

  $("#repForm").addEventListener("submit", async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    const fd = Object.fromEntries(new FormData(e.target)), id = e.target.dataset.id;
    const body = { cargador: id, espera: +fd.espera, funciona: fd.funciona === "1" };
    const r = await api("/api/reportes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!(r && r.ok)) { const l = store.get("rep_" + id, []); l.push(body); store.set("rep_" + id, l); }
    toast(r && r.ok ? "¡Gracias! Tu reporte ayuda a estimar mejor las esperas" : "Vista previa: reporte guardado solo en este navegador");
    e.target.reset();
  });

  $("#btnContacto").addEventListener("click", () => $("#contDlg").showModal());
  $("#contForm").addEventListener("submit", async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    const fd = Object.fromEntries(new FormData(e.target));
    const r = await api("/api/contacto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fd) });
    toast(r && r.ok ? "¡Gracias! Te respondemos a la brevedad" : "Vista previa: el formulario se activa al publicar el sitio");
    e.target.reset();
  });

  // ---------- Navegación ----------
  const VIEWS = ["inicio", "modelos", "comparar", "cargadores", "viaje", "tests", "noticias", "normativa", "calculadora", "debates", "miem", "elegir", "usados", "alojamientos", "empresas"];
  function route() {
    const h = (location.hash || "#inicio").slice(1);
    const v = VIEWS.includes(h) ? h : "inicio";
    $$(".view").forEach((s) => s.classList.toggle("active", s.id === v));
    $$("#nav a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + v));
    $("#nav").classList.remove("open");
    if (v === "debates") renderComunidad();
    if (v === "cargadores") { initMap(); renderCargadores(); setTimeout(() => map && map.invalidateSize(), 50);
      if (!vivoTimer) { cargarVivo(); vivoTimer = setInterval(() => { if (location.hash.slice(1).split("/")[0] === "cargadores" && !document.hidden) cargarVivo(); }, 180000); } }
    if (v === "tests") renderTests();
    if (v === "viaje" && !vMap) calcularViaje();
    window.scrollTo(0, 0);
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-alerta],[data-plan],[data-flota],[data-vmes],[data-car],[data-ct],[data-exp],[data-png],[data-voto],[data-cmp],[data-lead],[data-rm],[data-tema],[data-tests],[data-cg],[data-cgop],[data-reportar],[data-tt],[data-tipo],#newsTabs button,#newsCats button");
    if (!t) return;
    if (t.dataset.alerta) { abrirAlerta(t.dataset.alerta); return; }
    if (t.dataset.plan) { $("#alojPlan").value = t.dataset.plan; $("#btnAloj").click(); return; }
    if (t.dataset.flota) { const f = $("#contDlg form") || document.querySelector("#contDlg form"); if (f && f.motivo) f.motivo.value = "Flotas y empresas"; $("#contDlg").showModal(); return; }
    if (t.dataset.vmes) { $("#vMes").value = t.dataset.vmes; renderVentas(); return; }
    if (t.dataset.car) { $("#fCar").value = t.dataset.car; renderModelos(); return; }
    if (t.dataset.ct) { comTab = t.dataset.ct; renderComunidad(); return; }
    if (t.dataset.exp) { $("#expDlg").showModal(); return; }
    if (t.dataset.png) { descargarPng(t.dataset.png, t); return; }
    if (t.dataset.voto) { votar(t.dataset.voto, t.dataset.op); return; }
    if (t.dataset.tests) { $("#testModelo").value = t.dataset.tests; state.testTipo = ""; location.hash = "#tests"; renderTests(); return; }
    if (t.dataset.tt) { state.testTab = t.dataset.tt; state.testTipo = ""; $("#testModelo").value = ""; renderTests(); return; }
    if (t.dataset.tipo !== undefined) { state.testTipo = t.dataset.tipo; renderTests(); return; }
    if (t.dataset.cgop != null) { $("#cgOp").value = t.dataset.cgop; renderCargadores(); $("#map").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (t.dataset.cg) { const c = state.cargadores.find((x) => x.id === t.dataset.cg); $$(".cg").forEach((x) => x.classList.toggle("on", x === t)); if (map && c) { map.setView([c.lat, c.lon], 14); marcadores[c.id] && marcadores[c.id].openPopup(); } return; }
    if (t.dataset.reportar) { const c = state.cargadores.find((x) => x.id === t.dataset.reportar); $("#repNombre").textContent = c ? c.nombre : ""; $("#repForm").dataset.id = t.dataset.reportar; $("#repDlg").showModal(); return; }
    if (t.dataset.cmp) toggleCmp(t.dataset.cmp);
    else if (t.dataset.lead) openLead(t.dataset.lead);
    else if (t.dataset.rm) toggleCmp(t.dataset.rm);
    else if (t.dataset.tema) openThread(t.dataset.tema);
    else if (t.dataset.t) { state.newsTab = t.dataset.t; state.newsCat = ""; renderNews(); }
    else if (t.dataset.c !== undefined) { state.newsCat = t.dataset.c; renderNews(); }
  });

  async function init() {
    const [mod, not, nor, deb, comb, tst, cg, geo, tar, locs, com, ven, vid, mie, alo, usa, phi] = await Promise.all(["modelos", "noticias", "normativa", "debates", "combustible", "tests", "cargadores", "uruguay", "tarifas", "localidades", "comunidad", "ventas", "videos", "miem", "alojamientos", "usados", "precios_historial"].map(load));
    state.comunidad = com || {}; state.ventas = ven || {}; state.videos = vid || {}; state.miem = mie || {}; state.alojamientos = alo || {}; state.usados = usa || {}; state.precios_historial = phi || {};
    state.tarifas = tar; state.localidades = locs;
    state.modelos = mod.modelos; state.noticias = not; state.normativa = nor; state.debates = deb.temas;
    state.combustible = comb; state.tests = tst; state.cargadores = cg.cargadores || []; state.uyGeo = geo;
    $("#cgNota").innerHTML = `${cg.total} ubicaciones${cg.puntos ? ` y ${cg.puntos} conectores` : ""} · actualizado ${esc(fecha(cg.actualizado))}.`;
    const po = cg.por_operador || {};
    $("#cgCobertura").innerHTML = `<h3>Cobertura del mapa</h3>
      <p class="small muted">${esc(cg.nota || "")} Cada día se compara con el anterior: si una fuente falla o baja la cantidad de cargadores, recibimos un aviso y se mantienen los datos del día previo. Un cargador que deja de aparecer queda marcado y se quita a los 14 días.</p>
      <div class="chips">${Object.entries(po).map(([k, n]) => `<button class="chip" data-cgop="${esc(k)}">${esc(k)} <b>${n}</b></button>`).join("")}</div>
      <p class="small">¿Conocés un cargador que no está, o un dato mal? <button class="btn btn-sm btn-ghost-dark" id="cgFalta" type="button">Avisanos</button></p>
      <p class="small muted">Fuentes: ${(cg.fuentes || []).map(esc).join(" · ")}.</p>`;
    $("#cgFalta").onclick = () => $("#faltaDlg").showModal();
    $("#faltaDlg").addEventListener("close", async () => {
      if ($("#faltaDlg").returnValue !== "ok") return;
      const f = Object.fromEntries(new FormData($("#faltaForm")));
      const r = await api("/api/contacto", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: f.nombre, email: f.email, web: f.web, motivo: "cargador", mensaje: `Cargador: ${f.lugar}\n${f.detalle}` }) });
      toast(r && r.ok ? "¡Gracias! Lo revisamos." : "No se pudo enviar ahora; probá más tarde.");
      if (r && r.ok) $("#faltaForm").reset();
    });
    const deptos = [...new Set(state.cargadores.map((c) => c.departamento).filter(Boolean))].sort();
    $("#cgDepto").innerHTML += deptos.map((d) => `<option>${esc(d)}</option>`).join("");
    const ops = [...new Set(state.cargadores.map((c) => c.operador))].sort();
    $("#cgOp").innerHTML = '<option value="">Todos los operadores</option>' + ops.map((o) => `<option>${esc(o)}</option>`).join("");
    const h0 = new Date().getHours();
    $("#cgHora").innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === h0 ? "selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("");
    ["#cgQ", "#cgConector", "#cgPot", "#cgDepto", "#cgOp", "#cgHora", "#cgLibre"].forEach((x) => $(x).addEventListener("input", renderCargadores));
    $("#cgCerca").onclick = () => { try { navigator.geolocation.getCurrentPosition((p) => { initMap(); map && map.setView([p.coords.latitude, p.coords.longitude], 12); }, () => toast("No pudimos acceder a tu ubicación")); } catch { toast("Tu navegador no permite ubicar"); } };
    $("#testModelo").innerHTML += state.modelos.filter((m) => testsDe(m.id).length).map((m) => `<option value="${m.id}">${esc(nombreModelo(m.id))}</option>`).join("");
    $("#testQ").addEventListener("input", renderTests);
    $("#testModelo").addEventListener("input", () => { state.testTipo = ""; renderTests(); });
    state.cmp = store.get("cmp", []).filter((id) => state.modelos.some((m) => m.id === id));
    state.noticias.uruguay.sort((a, b) => b.fecha.localeCompare(a.fecha));
    state.noticias.internacional.sort((a, b) => b.fecha.localeCompare(a.fecha));
    $("#modelosNota").textContent = mod.nota;
    $("#newsUpd").textContent = "Actualizado: " + fecha(not.actualizado);
    $("#footUpd").textContent = "Datos actualizados el " + fecha(mod.actualizado);
    fillFilters();
    ["#fQ", "#fMarca", "#fCar", "#fTipo", "#fSeg", "#fPrecio", "#fOrden"].forEach((s) => $(s).addEventListener("input", renderModelos));
    $("#cmpSelect").addEventListener("change", (e) => { if (e.target.value && !state.cmp.includes(e.target.value)) toggleCmp(e.target.value); e.target.value = ""; });
    $("#heroSearch").addEventListener("submit", (e) => { e.preventDefault(); $("#fQ").value = $("#heroQ").value; location.hash = "#modelos"; renderModelos(); });
    $("#menuBtn").onclick = () => $("#nav").classList.toggle("open");
    renderHome(); renderModelos(); renderCmp(); renderNews(); renderNormativa(); initCostos(); renderCostos(); initViaje(); initExperiencia(); initMiem(); initAlertas(); initElegir(); initTco(); initUsados(); initAlojamientos(); initEmpresas();
    window.addEventListener("hashchange", route); route();
  }
  init();
})();
