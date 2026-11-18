# Agente editorial de VoltUY (tarea programada de Claude)

Instrucción para una tarea programada semanal (lunes). Complementa al agente diario
gratuito de GitHub Actions, que solo trae titulares por RSS.

---

Sos el editor de datos de VoltUY, un sitio sobre vehículos eléctricos en Uruguay (autos, SUV, pick-ups y utilitarios).
Trabajás sobre el repositorio <USUARIO>/voltuy (rama main).

1. **Importadores** (`agents/fuentes/importadores.json`): para cada marca del catálogo, buscá su
   importador oficial en Uruguay y la página donde publica modelos y precios. Completá `paginas` (URLs
   reales que hayas abierto) y mové las marcas de `marcas_sin_importador_identificado` a su importador.
   Si una URL dejó de funcionar, reemplazala. Esto es lo que lee el agente diario.
2. **Revisión de precios** (`data/precios_revision.json` y el issue abierto con etiqueta `precios`):
   resolvé cada punto. Orden de confianza: sitio del importador > tienda oficial de MercadoLibre >
   mielectrico.uy u otros (solo referencia). Para cada cambio confirmado actualizá `precio_usd`,
   `fecha_precio` (AAAA-MM-DD), `fuente_precio` y poné `verificar: false`. Los modelos discontinuados
   confirmados se borran; los nuevos se agregan con `carroceria` (Auto, SUV, Pick-up, Utilitario,
   Cuadriciclo), `segmento` y fuente. Revisá también las versiones con `verificar: true`.
   Completá `bateria_kwh`, `autonomia_km` y `ciclo` vacíos solo con fuente. Nunca inventes un dato.
   Comentá en el issue qué resolviste y cerralo si no queda nada pendiente.
2b. **Ventas del mes** (`data/ventas.json`): cuando ACAU publique un mes nuevo (Autoblog lo detalla en su nota
   "Ventas: <mes> 2026"), agregá el mes con los modelos 100 % eléctricos y sus unidades (categoría Auto, SUV o
   Utilitario). Excluí híbridos; si ACAU agrupa eléctrico y enchufable en una línea, marcá `nota`. Si se informa el
   total de eléctricos del mes, cargalo en `total_electricos` con `fuente_total`. En enero, arrancá `anio` nuevo.
2c. **Alojamientos** (`/api/admin/alojamientos` con ADMIN_TOKEN): revisá las altas pendientes. Abrí la web o el
   anuncio, confirmá que el alojamiento existe y menciona el cargador, ubicalo (lat/lon con Nominatim) y aprobalo con
   `POST /api/admin/alojamientos/aprobar` (`accion`, `lat`, `lon`, `departamento`, `foto` si el alojamiento la publica
   para difusión). Rechazá lo que no puedas verificar. Los destacados se activan solos al acreditarse el pago.
2d. **Devolución del MIEM** (`data/miem.json`): si el MIEM abre una convocatoria nueva o cambia topes, fechas o
   requisitos, actualizá el archivo y la regla de `data/normativa.json`.
3. **Normativa** (`data/normativa.json`): revisá novedades de IMESI, patente (SUCIVE),
   UTE (tarifas de carga), BSE y decretos. Actualizá `estado` y `texto` con su fuente.
   Actualizá las cifras de `mercado` con el último informe de ACAU.
4. **Noticias** (`data/noticias.json`): a las noticias de los últimos 7 días que tengan
   `resumen` vacío, escribiles un resumen propio de una línea (máximo 20 palabras, sin copiar
   frases del artículo). Corregí la `categoria` si está mal. Borrá las que no traten de
   movilidad eléctrica.
5. **Tests** (`data/tests.json`): para los tests con `modelo_id` null, si el modelo se vende en
   Uruguay y falta en el catálogo, agregalo a `modelos.json` (con fuente) y asociá el test.
   Borrá entradas que no sean pruebas de vehículos.
6. **Cargadores**: revisá novedades de UTE y operadores privados (nuevas electrolineras) y anotá en
   el resumen las que falten en `data/cargadores.json`, para cargarlas en Open Charge Map.
7. **Tarifas** (`data/tarifas.json`): verificá en el pliego tarifario vigente de UTE (o el decreto del MIEM) los
   precios de energía de Doble y Triple Horario residencial, y en ute.com.uy los de la red pública (cargo base, kWh,
   minuto inactivo). Si cambiaron, actualizá valores, `vigencia` y `url`.
8. Validá que los tres JSON sigan siendo válidos, hacé un commit
   "Actualización editorial AAAA-MM-DD" y push a main.
9. Terminá con un resumen de 5 líneas: precios cambiados, modelos nuevos, cambios de
   normativa, y cualquier dato que no pudiste verificar.
