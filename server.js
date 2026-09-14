const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123";
const databaseUrl = process.env.MYSQL_URL
  || process.env.MYSQL_PRIVATE_URL
  || process.env.DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const DB_NAME = process.env.DB_NAME
  || process.env.MYSQLDATABASE
  || parsedDatabaseUrl?.pathname.replace(/^\//, "")
  || "sya";
const allowedOrigins = (process.env.FRONTEND_URL || "https://santanderyasociados.netlify.app")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET no está definido en backend/.env");
}

const dbConfig = {
  host: process.env.MYSQLHOST || parsedDatabaseUrl?.hostname || process.env.DB_HOST || "localhost",
  port: Number(process.env.MYSQLPORT || parsedDatabaseUrl?.port || process.env.DB_PORT || 3306),
  user: process.env.MYSQLUSER || parsedDatabaseUrl?.username || process.env.DB_USER || "root",
  password: process.env.MYSQLPASSWORD || parsedDatabaseUrl?.password || process.env.DB_PASSWORD || "",
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
};

const pool = mysql.createPool(dbConfig);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origen no permitido por CORS"));
    },
  })
);
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function inicializarBaseDeDatos() {
  const usaMySQLLocal = !databaseUrl && !process.env.MYSQLHOST && dbConfig.host === "localhost";
  if (usaMySQLLocal) {
    const adminPool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
    });

    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await adminPool.end();
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      username VARCHAR(80) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(30) NOT NULL DEFAULT 'admin',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY admin_users_username_unique (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id BIGINT UNSIGNED NOT NULL,
      nombre VARCHAR(120) NOT NULL,
      email VARCHAR(255) NOT NULL,
      telefono VARCHAR(40) NOT NULL DEFAULT '',
      asunto VARCHAR(180) NOT NULL DEFAULT '',
      mensaje TEXT NOT NULL,
      fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      leido BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (id),
      KEY mensajes_fecha_index (fecha)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contenido (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tipo VARCHAR(30) NOT NULL,
      titulo VARCHAR(220) NOT NULL DEFAULT '',
      subtitulo VARCHAR(220) NOT NULL DEFAULT '',
      categoria VARCHAR(120) NOT NULL DEFAULT '',
      ubicacion VARCHAR(180) NOT NULL DEFAULT '',
      resumen TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      imagen LONGTEXT NOT NULL,
      slug VARCHAR(220) NOT NULL DEFAULT '',
      autor VARCHAR(120) NOT NULL DEFAULT '',
      fecha_publicacion DATE NULL,
      estado VARCHAR(30) NOT NULL DEFAULT 'Borrador',
      orden INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY contenido_tipo_estado_index (tipo, estado),
      UNIQUE KEY contenido_tipo_slug_unique (tipo, slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query("ALTER TABLE contenido MODIFY COLUMN imagen LONGTEXT NOT NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracion (
      clave VARCHAR(80) NOT NULL,
      valor LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (clave)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const configuracionPorDefecto = {
    slider: {
      carrusel: true,
    },
    sitio: {
      empresa: "S&A Santander y Asociados",
      emailNotificaciones: "felipemoralesherrera888@gmail.com",
      notificacionesActivas: true,
    },
    analytics: {
      measurementId: "",
      enabled: false,
      anonymize: true,
    },
    seo: {
      title: "S&A Santander y Asociados | Ingeniería y consultoría",
      description: "Soluciones de ingeniería, diseño estructural, consultoría e interventoría para proyectos de infraestructura y edificación.",
      canonical: "https://sya.com.co/",
      image: "/Logo/logo.png",
      indexable: true,
    },
  };

  for (const [clave, valor] of Object.entries(configuracionPorDefecto)) {
    await pool.query(
      "INSERT IGNORE INTO configuracion (clave, valor) VALUES (?, ?)",
      [clave, JSON.stringify(valor)]
    );
  }

  const seedPath = path.join(__dirname, "data", "content-seed.json");
  const contenidoInicial = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  for (const item of contenidoInicial) {
    await pool.query(
      `INSERT IGNORE INTO contenido
       (tipo, titulo, subtitulo, categoria, ubicacion, resumen, descripcion,
        imagen, slug, autor, fecha_publicacion, estado, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.tipo,
        item.titulo || "",
        item.subtitulo || "",
        item.categoria || "",
        item.ubicacion || "",
        item.resumen || item.descripcion || "",
        item.descripcion || item.resumen || "",
        item.imagen || "",
        item.slug,
        item.autor || "Equipo S&A",
        item.fecha || null,
        item.estado || "Publicado",
        Number(item.orden || 0),
      ]
    );
  }

  // Migración inicial de la sección Nosotros. Solo se ejecuta si no existen registros
  // de estos tipos; después, los cambios hechos desde Admin quedan únicamente en MySQL.
  const equipoInicial = [
    ["Jorge Alfredo Santander Moya", "Gerente General", "/equipo/jorge.jpg"],
    ["Jose Nelson Diaz Cardenas", "Director de Proyectos", "/equipo/jose.jpg"],
    ["Luis Fernando Santander Moya", "Director de Proyectos", "/equipo/luis.jpg"],
    ["Lizeth Andrea Bautista", "Directora Administrativa", "/equipo/lizeth.jpg"],
    ["Braham Nicolas Mirque Rodriguez", "Coordinador BIM", "/equipo/braham.jpg"],
    ["Paulo Cesar Rebolledo Palacios", "Ingeniero de Diseño", "/equipo/paulo.jpg"],
    ["Luisa Maria Chala Madrigal", "Secretaria", "/equipo/luisa.jpg"],
    ["Jenny Esperanza Ortiz", "Asesor Externo SST", "/equipo/jenny.jpg"],
    ["Lina Maria Parga Hernandez", "Ingeniera de Diseño", "/equipo/lina.jpg"],
    ["Jhon Anderson Lesmes", "Dibujante", "/equipo/jhon.jpg"],
    ["Jarrison Favian Vaquen Lozano", "Dibujante", "/equipo/jarrison.jpg"],
    ["Edgar Nicolas Fuentes Alfonso", "Ingeniero de Diseño", "/equipo/edgar.jpg"],
    ["Edwin Leonardo Gonzalez Rojas", "Dibujante", "/equipo/edwin.jpg"],
    ["Dayana Patricia Molina Tilano", "Ingeniera de Diseño", "/equipo/dayana.jpg"],
    ["Dolly Lizeth Fonseca Peña", "Auxiliar Varios", "/equipo/dolly.jpg"],
    ["Daniel Alejandro Molano Huertas", "Ingeniero de Diseño", "/equipo/daniel.jpg"],
    ["Brandon Felipe Morales Herrera", "Aprendiz SENA", "/equipo/brandon.jpg"],
  ];

  const clientesIniciales = [
    "/images/LOGOS CLIENTES/ARQUIURBANA.png",
    "/images/LOGOS CLIENTES/calymayor.png",
    "/images/LOGOS CLIENTES/cass.jpg",
    "/images/LOGOS CLIENTES/COLPATRIA.png",
    "/images/LOGOS CLIENTES/concay.png",
    "/images/LOGOS CLIENTES/conconcreto.jpg",
    "/images/LOGOS CLIENTES/ENTORNO.jpg",
    "/images/LOGOS CLIENTES/gisaico.png",
    "/images/LOGOS CLIENTES/gradeco.png",
    "/images/LOGOS CLIENTES/hace ingenieros.png",
    "/images/LOGOS CLIENTES/KMA.png",
    "/images/LOGOS CLIENTES/latinco.jpg",
    "/images/LOGOS CLIENTES/NORDESTE.png",
    "/images/LOGOS CLIENTES/oxy.png",
    "/images/LOGOS CLIENTES/planificadas.png",
    "/images/LOGOS CLIENTES/PACIFICO 3.png",
    "/images/LOGOS CLIENTES/prourbanos.jpg",
    "/images/LOGOS CLIENTES/ruta40.jpg",
    "/images/LOGOS CLIENTES/sesac.png",
    "/images/LOGOS CLIENTES/SISGA.jpg",
    "/images/LOGOS CLIENTES/sonacol.jpg",
    "/images/LOGOS CLIENTES/tecnoconsulta.jpg",
    "/images/LOGOS CLIENTES/URBANSA.jpg",
  ];

  const [[equipoCount]] = await pool.query(
    "SELECT COUNT(*) AS total FROM contenido WHERE tipo = 'equipo'"
  );
  if (Number(equipoCount.total) === 0) {
    for (let i = 0; i < equipoInicial.length; i += 1) {
      const [nombre, cargo, imagen] = equipoInicial[i];
      await pool.query(
        `INSERT INTO contenido
         (tipo, titulo, subtitulo, categoria, ubicacion, resumen, descripcion, imagen, slug, autor, estado, orden)
         VALUES ('equipo', ?, ?, ?, '', ?, ?, ?, ?, 'S&A', 'Publicado', ?)`,
        [nombre, cargo, cargo, cargo, cargo, imagen, `equipo-${i + 1}-${Date.now()}-${i}`, i]
      );
    }
  }

  const [[clientesCount]] = await pool.query(
    "SELECT COUNT(*) AS total FROM contenido WHERE tipo = 'clientes'"
  );
  if (Number(clientesCount.total) === 0) {
    for (let i = 0; i < clientesIniciales.length; i += 1) {
      const imagen = clientesIniciales[i];
      const nombre = `Cliente ${i + 1}`;
      await pool.query(
        `INSERT INTO contenido
         (tipo, titulo, subtitulo, categoria, ubicacion, resumen, descripcion, imagen, slug, autor, estado, orden)
         VALUES ('clientes', ?, '', '', '', '', '', ?, ?, 'S&A', 'Publicado', ?)`,
        [nombre, imagen, `cliente-${i + 1}-${Date.now()}-${i}`, i]
      );
    }
  }

  const [users] = await pool.query(
    "SELECT id FROM admin_users WHERE username = ? LIMIT 1",
    [ADMIN_USER]
  );

  if (users.length === 0) {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query(
      "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
      [ADMIN_USER, passwordHash]
    );
  }
}

function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ message: "Token no proporcionado" });
  }

  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}

const TIPOS_CONTENIDO = new Set([
  "proyectos",
  "servicios",
  "noticias",
  "clientes",
  "experiencia",
  "slider",
  "equipo",
]);

function validarTipoContenido(req, res, next) {
  if (!TIPOS_CONTENIDO.has(req.params.tipo)) {
    return res.status(400).json({ message: "Tipo de contenido no válido" });
  }
  next();
}

function normalizarContenido(body = {}) {
  const titulo = String(body.titulo || body.nombre || "").trim();
  const slugBase = String(body.slug || titulo)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return {
    titulo,
    subtitulo: String(body.subtitulo || "").trim(),
    categoria: String(body.categoria || "").trim(),
    ubicacion: String(body.ubicacion || "").trim(),
    resumen: String(body.resumen || body.categoria || "").trim(),
    descripcion: String(body.descripcion || "").trim(),
    imagen: String(body.imagen || "").trim(),
    slug: slugBase || `contenido-${Date.now()}`,
    autor: String(body.autor || "").trim(),
    fecha_publicacion: body.fecha || body.fecha_publicacion || null,
    estado: String(body.estado || "Borrador").trim(),
    orden: Number(body.orden || 0),
  };
}

function slugUnicoParaSlider(slug) {
  return `${slug || "diapositiva"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

app.get("/", (req, res) => {
  res.json({
    message: "API S&A Santander y Asociados funcionando correctamente",
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/contenido/:tipo", validarTipoContenido, async (req, res) => {
  try {
    const [items] = await pool.query(
      `SELECT id, tipo, titulo, subtitulo, categoria, ubicacion, resumen,
              descripcion, imagen, slug, autor, fecha_publicacion AS fecha,
              estado, orden, created_at, updated_at
       FROM contenido
       WHERE tipo = ? AND estado = 'Publicado'
       ORDER BY orden ASC, created_at DESC`,
      [req.params.tipo]
    );
    res.json(items);
  } catch (error) {
    console.error("Error cargando contenido público:", error.message);
    res.status(500).json({ message: "No se pudo cargar el contenido" });
  }
});

const PERMISOS_POR_ROL = {
  admin: ["contenido:leer", "contenido:crear", "contenido:editar", "contenido:publicar", "contenido:eliminar", "mensajes:leer", "mensajes:gestionar", "usuarios:gestionar"],
  Administrador: ["contenido:leer", "contenido:crear", "contenido:editar", "contenido:publicar", "contenido:eliminar", "mensajes:leer", "mensajes:gestionar", "usuarios:gestionar"],
  Editor: ["contenido:leer", "contenido:crear", "contenido:editar", "contenido:publicar", "contenido:eliminar", "mensajes:leer", "mensajes:gestionar"],
  Autor: ["contenido:leer", "contenido:crear", "contenido:editar", "mensajes:leer"],
  Colaborador: ["contenido:leer", "contenido:crear", "mensajes:leer"],
  Suscriptor: ["contenido:leer"],
};

function tienePermiso(req, permiso) {
  return (PERMISOS_POR_ROL[req.admin?.role] || []).includes(permiso);
}

function exigirPermiso(permiso) {
  return (req, res, next) => {
    if (!tienePermiso(req, permiso)) {
      return res.status(403).json({ message: "Tu rol no tiene permiso para esta acción" });
    }
    next();
  };
}

app.get("/api/admin/contenido/:tipo", verificarToken, exigirPermiso("contenido:leer"), validarTipoContenido, async (req, res) => {
  try {
    const [items] = await pool.query(
      `SELECT id, tipo, titulo, subtitulo, categoria, ubicacion, resumen,
              descripcion, imagen, slug, autor, fecha_publicacion AS fecha,
              estado, orden, created_at, updated_at
       FROM contenido WHERE tipo = ? ORDER BY orden ASC, created_at DESC`,
      [req.params.tipo]
    );
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: "No se pudo cargar el contenido" });
  }
});

app.post("/api/admin/contenido/:tipo", verificarToken, exigirPermiso("contenido:crear"), validarTipoContenido, async (req, res) => {
  const contenido = normalizarContenido(req.body);
  if (req.params.tipo === "slider") contenido.slug = slugUnicoParaSlider(contenido.slug);
  if (!tienePermiso(req, "contenido:publicar")) contenido.estado = "Borrador";
  if (!contenido.titulo || !contenido.descripcion) {
    return res.status(400).json({ message: "Título y descripción son obligatorios" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO contenido
       (tipo, titulo, subtitulo, categoria, ubicacion, resumen, descripcion,
        imagen, slug, autor, fecha_publicacion, estado, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.tipo, ...Object.values(contenido)]
    );
    const [rows] = await pool.query("SELECT * FROM contenido WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error("Error creando contenido:", error.message);
    res.status(500).json({ message: "No se pudo crear el contenido" });
  }
});

app.patch("/api/admin/contenido/:tipo/:id", verificarToken, exigirPermiso("contenido:editar"), validarTipoContenido, async (req, res) => {
  const contentId = Number(req.params.id);
  if (!Number.isSafeInteger(contentId) || contentId <= 0) {
    return res.status(400).json({ message: "El ID del contenido no es válido" });
  }
  const contenido = normalizarContenido(req.body);
  if (req.params.tipo === "slider") contenido.slug = slugUnicoParaSlider(contenido.slug);
  if (!tienePermiso(req, "contenido:publicar")) contenido.estado = "Borrador";
  try {
    const [result] = await pool.query(
      `UPDATE contenido SET titulo = ?, subtitulo = ?, categoria = ?, ubicacion = ?,
       resumen = ?, descripcion = ?, imagen = ?, slug = ?, autor = ?,
       fecha_publicacion = ?, estado = ?, orden = ? WHERE tipo = ? AND id = ?`,
      [...Object.values(contenido), req.params.tipo, contentId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Contenido no encontrado" });
    const [rows] = await pool.query("SELECT * FROM contenido WHERE id = ?", [contentId]);
    res.json(rows[0]);
  } catch (error) {
    console.error("Error actualizando contenido:", error.message);
    res.status(500).json({ message: "No se pudo actualizar el contenido" });
  }
});

app.delete("/api/admin/contenido/:tipo/:id", verificarToken, exigirPermiso("contenido:eliminar"), validarTipoContenido, async (req, res) => {
  const contentId = Number(req.params.id);
  if (!Number.isSafeInteger(contentId) || contentId <= 0) {
    return res.status(400).json({ message: "El ID del contenido no es válido" });
  }
  try {
    const [result] = await pool.query(
      "DELETE FROM contenido WHERE tipo = ? AND id = ?",
      [req.params.tipo, contentId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Contenido no encontrado" });
    res.json({ message: "Contenido eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo eliminar el contenido" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ message: "Usuario y contraseña son obligatorios" });
  }

  try {
    const [users] = await pool.query(
      "SELECT id, username, password_hash, role FROM admin_users WHERE username = ? LIMIT 1",
      [username.trim()]
    );
    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      message: "Inicio de sesión correcto",
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (error) {
    console.error("Error en login:", error.message);
    res.status(500).json({ message: "No se pudo procesar el inicio de sesión" });
  }
});

const ROLES_ADMIN = new Set([
  "Administrador",
  "Editor",
  "Autor",
  "Colaborador",
  "Suscriptor",
]);

function exigirAdministrador(req, res, next) {
  if (req.admin?.role !== "admin" && req.admin?.role !== "Administrador") {
    return res.status(403).json({ message: "Solo un administrador puede gestionar usuarios" });
  }
  next();
}

app.get("/api/admin/usuarios", verificarToken, exigirAdministrador, async (req, res) => {
  try {
    const [users] = await pool.query(
      "SELECT id, username, role, created_at FROM admin_users ORDER BY created_at DESC"
    );
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "No se pudieron cargar los usuarios" });
  }
});

app.post("/api/admin/usuarios", verificarToken, exigirAdministrador, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "Suscriptor").trim();

  if (username.length < 3 || password.length < 6 || !ROLES_ADMIN.has(role)) {
    return res.status(400).json({ message: "Usuario, contraseña y rol no son válidos" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      "INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)",
      [username, passwordHash, role]
    );
    res.status(201).json({ id: result.insertId, username, role });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Ese usuario ya existe" });
    }
    res.status(500).json({ message: "No se pudo crear el usuario" });
  }
});

app.patch("/api/admin/usuarios/:id", verificarToken, exigirAdministrador, async (req, res) => {
  const role = String(req.body.role || "").trim();
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || !ROLES_ADMIN.has(role)) {
    return res.status(400).json({ message: "Usuario o rol no válido" });
  }

  try {
    const [result] = await pool.query(
      "UPDATE admin_users SET role = ? WHERE id = ?",
      [role, userId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Usuario no encontrado" });
    res.json({ message: "Rol actualizado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el rol" });
  }
});

app.delete("/api/admin/usuarios/:id", verificarToken, exigirAdministrador, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isSafeInteger(userId) || userId === Number(req.admin.sub)) {
    return res.status(400).json({ message: "No puedes eliminar tu propio usuario" });
  }

  try {
    const [result] = await pool.query("DELETE FROM admin_users WHERE id = ?", [userId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Usuario no encontrado" });
    res.json({ message: "Usuario eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo eliminar el usuario" });
  }
});

app.get("/api/configuracion", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT clave, valor FROM configuracion");
    const config = {};
    for (const row of rows) {
      try {
        config[row.clave] = JSON.parse(row.valor);
      } catch {
        config[row.clave] = row.valor;
      }
    }
    res.json(config);
  } catch (error) {
    console.error("Error obteniendo configuración pública:", error.message);
    res.status(500).json({ message: "No se pudo cargar la configuración" });
  }
});

app.get("/api/admin/configuracion", verificarToken, exigirAdministrador, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT clave, valor FROM configuracion");
    const config = {};
    for (const row of rows) {
      try {
        config[row.clave] = JSON.parse(row.valor);
      } catch {
        config[row.clave] = row.valor;
      }
    }
    res.json(config);
  } catch (error) {
    console.error("Error obteniendo configuración admin:", error.message);
    res.status(500).json({ message: "No se pudo cargar la configuración" });
  }
});

app.put("/api/admin/configuracion", verificarToken, exigirAdministrador, async (req, res) => {
  const { slider, sitio, analytics, seo } = req.body || {};
  const clavesValidas = { slider, sitio, analytics, seo };

  try {
    for (const [clave, valor] of Object.entries(clavesValidas)) {
      if (valor !== undefined) {
        await pool.query(
          `INSERT INTO configuracion (clave, valor)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
          [clave, JSON.stringify(valor)]
        );
      }
    }

    const [rows] = await pool.query("SELECT clave, valor FROM configuracion");
    const config = {};
    for (const row of rows) {
      try {
        config[row.clave] = JSON.parse(row.valor);
      } catch {
        config[row.clave] = row.valor;
      }
    }

    res.json({
      message: "Configuración guardada correctamente en el servidor",
      configuracion: config,
    });
  } catch (error) {
    console.error("Error guardando configuración admin:", error.message);
    res.status(500).json({ message: "No se pudo guardar la configuración en la base de datos" });
  }
});

app.post("/api/mensajes", async (req, res) => {
  const { nombre, email, telefono, asunto, mensaje } = req.body;

  if (!nombre || !email || !mensaje) {
    return res.status(400).json({
      message: "Nombre, correo y mensaje son obligatorios",
    });
  }

  try {
    const nuevoMensaje = {
      id: Date.now(),
      nombre: String(nombre).trim(),
      email: String(email).trim(),
      telefono: String(telefono || "").trim(),
      asunto: String(asunto || "").trim(),
      mensaje: String(mensaje).trim(),
    };

    await pool.query(
      `INSERT INTO mensajes
       (id, nombre, email, telefono, asunto, mensaje)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nuevoMensaje.id,
        nuevoMensaje.nombre,
        nuevoMensaje.email,
        nuevoMensaje.telefono,
        nuevoMensaje.asunto,
        nuevoMensaje.mensaje,
      ]
    );

    res.status(201).json({
      message: "Mensaje guardado correctamente",
      mensaje: { ...nuevoMensaje, leido: false },
    });
  } catch (error) {
    console.error("Error guardando mensaje:", error.message);
    res.status(500).json({ message: "No se pudo guardar el mensaje" });
  }
});

app.get("/api/mensajes", verificarToken, exigirPermiso("mensajes:leer"), async (req, res) => {
  try {
    const [mensajes] = await pool.query(
      "SELECT id, nombre, email, telefono, asunto, mensaje, fecha, leido FROM mensajes ORDER BY fecha DESC"
    );
    res.json(mensajes);
  } catch (error) {
    res.status(500).json({ message: "No se pudieron cargar los mensajes" });
  }
});

app.patch("/api/mensajes/:id", verificarToken, exigirPermiso("mensajes:gestionar"), async (req, res) => {
  try {
    const [result] = await pool.query(
      "UPDATE mensajes SET leido = TRUE WHERE id = ?",
      [Number(req.params.id)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Mensaje no encontrado" });
    }

    res.json({ message: "Mensaje marcado como leído" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el mensaje" });
  }
});

app.delete("/api/mensajes/:id", verificarToken, exigirPermiso("mensajes:gestionar"), async (req, res) => {
  try {
    const [result] = await pool.query(
      "DELETE FROM mensajes WHERE id = ?",
      [Number(req.params.id)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Mensaje no encontrado" });
    }

    res.json({ message: "Mensaje eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo eliminar el mensaje" });
  }
});

inicializarBaseDeDatos()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor S&A ejecutándose en http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("No se pudo iniciar la base de datos:", {
      code: error.code,
      message: error.message,
      sqlMessage: error.sqlMessage,
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
    });
    process.exit(1);
  });
