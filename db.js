import mysql from "mysql2/promise";
import "dotenv/config";
import crypto from "crypto";

// =====================================================
// 1. MYSQL BAGLANYŞYK (POOL)
// =====================================================

export const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "sanly_tebip_db",
    port: process.env.MYSQL_PORT || 3306,

    charset: "utf8mb4",

    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,

    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});


// =====================================================
// 2. TEKSTI NORMALIZASIÝA ETMEK
// =====================================================

function normalizePlantText(text) {
    if (!text) return "";

    return String(text)
        .toLowerCase()
        .replace(/[.,?!:;'"“”«»()_\-]/g, " ")

        // Türkmen harplary
        .replace(/ä/g, "a")
        .replace(/ş/g, "s")
        .replace(/ç/g, "c")
        .replace(/ň/g, "n")
        .replace(/ö/g, "o")
        .replace(/ü/g, "u")
        .replace(/ý/g, "y")

        .replace(/\s+/g, " ")
        .trim();
}


// =====================================================
// 3. ÖSÜMLIGI KITAPHANADAN GÖZLEMEK
// =====================================================

export async function findPlantInLibrary(prompt) {
  if (!prompt) return null;

  try {
      const normalize = (text) => {
          return String(text || "")
              .toLowerCase()
              .replace(/[.,?!:;'"“”«»()_\-]/g, " ")
              .replace(/ä/g, "a")
              .replace(/ş/g, "s")
              .replace(/ç/g, "c")
              .replace(/ň/g, "n")
              .replace(/ö/g, "o")
              .replace(/ü/g, "u")
              .replace(/ý/g, "y")
              .replace(/\s+/g, " ")
              .trim();
      };

      const cleanPrompt = normalize(prompt);

      console.log("🔎 DB gözleg:", cleanPrompt);

      const [rows] = await pool.query(`
          SELECT *
          FROM plants_library
      `);

      console.log("🌿 plants_library:", rows.length);

      // Uzyn atlary ilki barla
      rows.sort((a, b) =>
          normalize(b.ady_tm).length -
          normalize(a.ady_tm).length
      );

      for (const plant of rows) {

          const plantName = normalize(plant.ady_tm);

          if (!plantName || plantName.length < 3) {
              continue;
          }

          // Tutuş prompt-yň içinde ösümlik adyny gözle
          if (` ${cleanPrompt} `.includes(` ${plantName} `)) {

              console.log(
                  `✅ DB-DEN TAPYLDY: ${plant.ady_tm}`
              );

              console.log(
                  `📚 Latyn: ${plant.ady_lat}`
              );

              console.log(
                  `📚 Rusça: ${plant.ady_ru}`
              );

              console.log(
                  `📖 Tom: ${plant.tom_belgisi}, Sahypa: ${plant.sahypa_belgisi}`
              );

              console.log(
                  `🖼️ Surat: ${plant.surat_fayl}`
              );

              return plant;
          }
      }

      console.log(
          `❌ DB-DEN TAPYLMADY: ${cleanPrompt}`
      );

      return null;

  } catch (error) {
      console.error(
          "❌ Kitaphanada gözleg ýalňyşlygy:",
          error.message
      );

      return null;
  }
}

// =====================================================
// 4. CACHE-DEN JOGAP OKAMAK
// =====================================================

export async function findCachedResponse(prompt) {

    try {

        if (!prompt) {
            return null;
        }

        const normalizedPrompt = String(prompt)
            .toLowerCase()
            .trim();

        // SHA-256 hash
        const promptHash = crypto
            .createHash("sha256")
            .update(normalizedPrompt, "utf8")
            .digest("hex");


        const [rows] = await pool.query(
            `
            SELECT response, image_file
            FROM cache
            WHERE prompt_hash = ?
            LIMIT 1
            `,
            [promptHash]
        );


        if (rows.length === 0) {

            console.log(
                "🔍 Cache: jogap tapylmady."
            );

            return null;
        }


        let responseData = rows[0].response;


        // MySQL Buffer görnüşinde getirip biler
        if (Buffer.isBuffer(responseData)) {

            responseData = responseData.toString("utf8");
        }


        // JSON string bolsa parse et
        if (typeof responseData === "string") {

            responseData = JSON.parse(responseData);
        }


        console.log(
            "✅ Cache: jogap bazadan tapyldy."
        );


        return {

            text: responseData.text || "",

            plants: Array.isArray(responseData.plants)
                ? responseData.plants
                : [],

            surat_fayl:
                rows[0].image_file || "default.png",

            source:
                "Sanly Tebip (Cache)"
        };


    } catch (error) {

        console.error(
            "❌ Cache okalanda ýalňyşlyk:",
            error.message
        );

        return null;
    }
}


// =====================================================
// 5. JOGABY CACHE-E ÝAZMAK
// =====================================================

export async function saveNewResponse(
    prompt,
    responseObj,
    imageFile
) {

    try {

        if (!prompt || !responseObj) {

            console.warn(
                "⚠️ Cache ýazmak üçin maglumat ýetmezçilik edýär."
            );

            return false;
        }


        const normalizedPrompt = String(prompt)
            .toLowerCase()
            .trim();


        // Prompt hash
        const promptHash = crypto
            .createHash("sha256")
            .update(normalizedPrompt, "utf8")
            .digest("hex");


        const responseString =
            JSON.stringify(responseObj);


        await pool.query(
            `
            INSERT INTO cache
                (
                    prompt,
                    prompt_hash,
                    response,
                    image_file
                )
            VALUES
                (?, ?, ?, ?)

            ON DUPLICATE KEY UPDATE

                response = VALUES(response),
                image_file = VALUES(image_file)
            `,
            [
                normalizedPrompt,
                promptHash,
                responseString,
                imageFile || "default.png"
            ]
        );


        console.log(
            `✅ Cache: jogap baza ýazyldy -> ${normalizedPrompt}`
        );

        return true;


    } catch (error) {

        console.error(
            "❌ Cache ýazlanda ýalňyşlyk:",
            error.message
        );

        return false;
    }
}


// =====================================================
// 6. TÄZE ÖSÜMLIGI BAZA GOŞMAK
// =====================================================

export async function addNewPlantToLibrary(data) {

    try {

        const {
            ady_tm,
            ady_lat,
            ady_ru,
            bejeriş_häsiýeti,
            surat_fayl,
            tom_belgisi,
            sahypa_belgisi
        } = data;


        const query = `
            INSERT INTO plants_library
            (
                ady_tm,
                ady_lat,
                ady_ru,
                bejeriş_häsiýeti,
                surat_fayl,
                tom_belgisi,
                sahypa_belgisi
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;


        await pool.query(
            query,
            [
                ady_tm,
                ady_lat,
                ady_ru,
                bejeriş_häsiýeti,
                surat_fayl,
                tom_belgisi,
                sahypa_belgisi
            ]
        );


        console.log(
            `✅ ${ady_tm} bazanyň kitaphana bölümine goşuldy.`
        );


        return true;


    } catch (error) {

        console.error(
            "❌ Täze ösümlik ýazylanda ýalňyşlyk:",
            error.message
        );

        return false;
    }
}


// =====================================================
// 7. MYSQL BAGLANYŞYGY BARLAMAK
// =====================================================

export async function testConnection() {

    let connection;

    try {

        connection = await pool.getConnection();

        console.log(
            "✅ MySQL: Baglanyşyk şowly gurnaldy! [sanly_tebip_db]"
        );

        return true;


    } catch (error) {

        console.error(
            "❌ MySQL Baglanyşyk ýalňyşlygy!",
            error.message
        );

        return false;


    } finally {

        if (connection) {
            connection.release();
        }
    }
}