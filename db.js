import mysql from "mysql2/promise";
import "dotenv/config";

// ✅ MySQL baglanyşyk (Pool)
export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "localhost",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "sanly_tebip_db", 
  port: process.env.MYSQL_PORT || 3306,
  charset: 'utf8mb4', 
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

export async function findPlantInLibrary(prompt) {
  if (!prompt) return null;

  try {
    // ⚠️ NORMALIZASIÝA (Düzedildi: \b diňe ASCII goldaýandygy üçin RegExp dynamic filtere geçirildi)
    let cleanPrompt = prompt
      .toLowerCase()
      .replace(/[.,?!]/g, "")
      .replace(/ä/g, "a")
      .replace(/ş/g, "s")
      .replace(/ç/g, "c")
      .replace(/ň/g, "n")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .replace(/ý/g, "y");

    // Durnukly söz arassalamak logikasy
    cleanPrompt = cleanPrompt
      .replace(/(?:^|\s)(?:barada|maglumat|ber|atly|osumlik)(?=\s|$)/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // ⚠️ GATY GYSGA SÖZLERI GEÇIRME
    if (cleanPrompt.length < 2) return null;

    // 1. TAKYK DEŇEŞDIRME
    const [exactRows] = await pool.query(
      `
      SELECT * FROM plants_library
      WHERE
        LOWER(
          CONVERT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ady_tm,
          'ä','a'),'ş','s'),'ç','c'),'ň','n'),'ö','o'),'ü','u'),'ý','y') USING utf8mb4)
        ) = ?
      LIMIT 1
      `,
      [cleanPrompt]
    );

    if (exactRows.length > 0) {
      return exactRows[0];
    }

    // ⚠️ DIŇE DOLY SÖZ BOÝUNÇA GÖZLEG
    const [rows] = await pool.query(
      `
      SELECT * FROM plants_library
      WHERE
        LOWER(
          CONVERT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ady_tm,
          'ä','a'),'ş','s'),'ç','c'),'ň','n'),'ö','o'),'ü','u'),'ý','y') USING utf8mb4)
        ) REGEXP ?
      ORDER BY LENGTH(ady_tm) ASC
      LIMIT 1
      `,
      [`(^|[[:space:]])${cleanPrompt}([[:space:]]|$)`]
    );

    return rows.length > 0 ? rows[0] : null;

  } catch (error) {
    console.error("⚠️ Kitaphanada gözleg hatasy:", error.message);
    return null;
  }
}

/**
 * 2. Cache barlamak
 */
export async function findCachedResponse(prompt) {
  try {
    const [rows] = await pool.query(
      "SELECT response, image_file FROM cache WHERE LOWER(prompt) = ? LIMIT 1", 
      [prompt.toLowerCase().trim()]
    );

    if (rows.length > 0) {
      const responseData = typeof rows[0].response === 'string' 
        ? JSON.parse(rows[0].response) 
        : rows[0].response;

      return {
        text: responseData.text,
        plants: responseData.plants || [],
        surat_fayl: rows[0].image_file, 
        source: "Sanly Tebip (Cache)"
      };
    }
    return null;
  } catch (error) {
    console.error("❌ Cache okalanda ýalňyşlygy:", error.message);
    return null;
  }
}

/**
 * 3. Jogaby Cache ýazmak
 */
export async function saveNewResponse(prompt, responseObj, imageFile) {
  try {
    if (!prompt || !responseObj) return;

    const responseString = JSON.stringify(responseObj);
    const trimmed = prompt.toLowerCase().trim();
    
    const query = `
      INSERT INTO cache (prompt, response, image_file) 
      VALUES (?, ?, ?) 
      ON DUPLICATE KEY UPDATE 
        response = VALUES(response), 
        image_file = VALUES(image_file)
    `;

    await pool.query(query, [trimmed, responseString, imageFile]);
  } catch (error) {
    console.error("⚠️ Cache ýazylanda ýalňyşlyk:", error.message);
  }
}

/**
 * 4. TÄZE ÖSÜMLIGI BAZA GOŞMAK
 */
export async function addNewPlantToLibrary(data) {
  try {
    const { ady_tm, ady_lat, ady_ru, bejeriş_häsiýeti, surat_fayl, tom_belgisi, sahypa_belgisi } = data;
    
    const query = `
      INSERT INTO plants_library 
      (ady_tm, ady_lat, ady_ru, bejeriş_häsiýeti, surat_fayl, tom_belgisi, sahypa_belgisi) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await pool.query(query, [ady_tm, ady_lat, ady_ru, bejeriş_häsiýeti, surat_fayl, tom_belgisi, sahypa_belgisi]);
    console.log(`✅ ${ady_tm} bazanyň kitaphana bölümine goşuldy.`);
  } catch (error) {
    console.error("❌ Täze ösümlik ýazylanda ýalňyşlygy:", error.message);
  }
}

/**
 * 5. Baglanyşygy barla
 */
export async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log("✅ MySQL: Baglanyşyk şowly gurnaldy! [sanly_tebip_db]");
    return true;
  } catch (error) {
    console.error("❌ MySQL Baglanyşyk ýalňyşlygy!", error.message);
    return false;
  } finally {
    if (connection) connection.release();
  }
}