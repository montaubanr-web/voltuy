-- Esquema de la base D1 de AutosEléctricosUY. Ejecutar una vez:
--   npx wrangler d1 execute voltuy --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS comentarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tema TEXT NOT NULL,
  nombre TEXT NOT NULL,
  texto TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aprobado | rechazado
  ip TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  padre INTEGER,                         -- id del comentario que abre la conversación (NULL = comentario nuevo)
  email TEXT,                            -- opcional, nunca se publica
  avisar INTEGER NOT NULL DEFAULT 0,     -- 1 = avisar por correo cuando respondan
  avisado INTEGER NOT NULL DEFAULT 0     -- 1 = ya se mandaron los avisos de esta respuesta
);
CREATE INDEX IF NOT EXISTS idx_com_tema ON comentarios (tema, estado);
CREATE INDEX IF NOT EXISTS idx_com_padre ON comentarios (padre, estado);
-- Correos que pidieron avisos de respuesta (doble confirmación y baja con un clic).
-- En bases creadas antes, la API agrega estas columnas y tabla sola la primera vez que se usa.
CREATE TABLE IF NOT EXISTS avisos_correo (
  email TEXT PRIMARY KEY, token TEXT NOT NULL,
  confirmado INTEGER NOT NULL DEFAULT 0, baja INTEGER NOT NULL DEFAULT 0,
  enviado TEXT,                          -- último correo de confirmación (máx. uno por día)
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo TEXT, nombre TEXT, email TEXT, telefono TEXT, departamento TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suscriptores (
  email TEXT PRIMARY KEY,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reportes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cargador TEXT NOT NULL,
  espera INTEGER NOT NULL,      -- minutos de espera reportados
  funciona INTEGER NOT NULL,    -- 1 = funcionaba, 0 = falla
  hora INTEGER,                 -- hora UTC del reporte (para estimar por franja)
  ip TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rep_cargador ON reportes (cargador, creado);

CREATE TABLE IF NOT EXISTS contactos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT, email TEXT, motivo TEXT, mensaje TEXT, ip TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Comunidad: experiencias estructuradas (consumo real, problemas, satisfacción)
CREATE TABLE IF NOT EXISTS experiencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelo TEXT NOT NULL,
  kwh100 REAL NOT NULL,          -- consumo que marca el auto, kWh/100 km
  uso TEXT,                      -- ciudad | mixto | ruta
  estacion TEXT,                 -- verano | otono | invierno | primavera
  km INTEGER, departamento TEXT,
  nota INTEGER,                  -- 1 a 5: ¿lo recomendarías?
  problemas TEXT,                -- claves separadas por coma
  texto TEXT, texto_estado TEXT, -- el texto libre se publica solo tras moderación
  ip TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exp_modelo ON experiencias (modelo, creado);

CREATE TABLE IF NOT EXISTS votos (
  tema TEXT NOT NULL, opcion TEXT NOT NULL, ip TEXT NOT NULL,
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tema, ip)
);

-- Alertas de precio por versión
CREATE TABLE IF NOT EXISTS alertas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL, modelo_id TEXT NOT NULL, objetivo INTEGER,
  precio_alta INTEGER, ultimo_aviso_precio INTEGER, ultimo_aviso TEXT,
  token TEXT NOT NULL, confirmado INTEGER NOT NULL DEFAULT 0, ip TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (email, modelo_id)
);

-- Alojamientos con cargador (altas propias; básico gratis o destacado pago)
CREATE TABLE IF NOT EXISTS alojamientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL, tipo TEXT, localidad TEXT, departamento TEXT, lat REAL, lon REAL,
  cargador TEXT, acceso TEXT, url TEXT, foto TEXT, email TEXT,
  plan TEXT NOT NULL DEFAULT 'basico', estado TEXT NOT NULL DEFAULT 'pendiente',
  destacado_hasta TEXT, pago_id TEXT, ip TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
