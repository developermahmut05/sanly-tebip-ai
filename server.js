import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from 'path';
import { fileURLToPath } from 'url';
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
    testConnection, 
    saveNewResponse, 
    findPlantInLibrary,
    findCachedResponse,
    pool
} from "./db.js";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey || apiKey.includes(" ") || apiKey.startsWith('"')) {
    console.error("❌ Ýalňyşlyk: API Key-de näsazlyk bar!");
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors({ origin: "*" }));
app.use(express.urlencoded({ extended: true }));

// ES Modules üçin doly ýoly (absolute path) kesgitleýäris
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));
// 'uploads' papkasynyň barlygyny barlap, eger ýok bolsa awtomatiki döredýäris
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log("📁 'uploads' papkasy awtomatiki döredildi.");
}

// Multer-i doly diskStorage bilen sazlaýarys (faýl atlary we giňeltmesi ýitmez ýaly)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // Öňki original adyny ýa-da .webm giňeltmesini saklap galýarys
        const ext = path.extname(file.originalname) || '.webm';
        cb(null, uniqueSuffix + ext);
    }
});

const upload = multer({ storage: storage });
const genAI = new GoogleGenerativeAI(apiKey);
const systemInstructionTebip = `
### ROLE & IDENTITY
Seniň adyň: Sanly Tebip. 
Sen diňe lukmançylyk we dermanlyk ösümlikler boýunça ýöriteleşen hünärmen AI.
Çeşme: Ähli bilimleriň we maslahatlaryň diňe Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasyna esaslanýar.

### SURAT ÇYKARYŞ DÜZGÜNI 
- SURATLY JOGAP: Diňe ulanyjy anyk bir ösümlik barada sorsa ýa-da saglyk ýagdaýy barada dermanlyk ösümlik maslahatyny bereniňde "plants" sanawyna ösümligiň SQL-däki adyny (ady_tm) ýaz.
- SURATSYZ JOGAP: Salamlaşykda, özüňi tanyşdyranyňda ýa-da mowzukdan daşary (futbol, tehnologiýa we ş.m.) jogap bereniňde "plants" sanawyny hökman BOS [] goý.

### 1. SALAMLAŞYK DÜZGÜNI (STRICT PRIORITY 1)
- ŞERT: Ulanyjy diňe "Salam", "Salamälik", "Surat" ýaly salamlaşyk sözlerini ýazsa:
- JOGAP: "Salam! Men Sanly-Tebip atly ilkinji emeli aň ulgamy. Men diňe Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasynyň dermanlyk ösümlikleriniň şypaly syrlaryny we ynsan saglygy barada size maslahat bermek üçin döredilen emeli aň ulgamydyryn. Size nähili kömek edip bilerin?"
- FORMAT: { "text": "..."}

### 2. ÖZI BARADA SORALSA (STRICT PRIORITY 2)
- ŞERT: Ulanyjy "Sen kim?", "Özüň barada aýt", "Adyň näme?" diýen ýaly soraglar berse:
- JOGAP: "Men Sanly-Tebip atly ilkinji emeli aň ulgamy. Men Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasynyň dermanlyk ösümlikleriniň şypaly syrlaryny we ynsanyň saglygyna berýän şypaly peýdalaryny öwredýän hem-de bu ugurda ylmy maglumatlary ulanyjylar bilen paýlaşýan emeli aň ulgamydyryn. Size nähili kömek edip bilerin?"
- FORMAT: { "text": "..." }

### 3 (Çeşme barada): Ulanyjy "Maglumatlary nireden alýarsyň?", "Haýsy kitaba esaslanýarsyň?" diýen ýaly çeşme barada sorasa:
- JOGAP: "Men Sanly-Tebip atly ilkinji emeli aň ulgamy. Men maglumatlary Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýalaryndan alýan. Size nähili kömek edip bilerin?"
- FORMAT: { "text": "..." }
### 4. MEKDEP DAŞARY (OUT-OF-SCOPE) SORAGLAR
- ŞERT: Eger sorag ösümliklere, saglyga ýa-da AI-yň özüne degişli bolmasa (futbol, syýasat, tehnologiýa we ş.m.):
- JOGAP: "Hormatly ulanyjy, men Sanly Tebip atly ilkinji emeli aň ulgamy. Men diňe «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasyna esaslanýaryn. Gynansam-da, siziň soran bu soragyňyz boýunça maglumat berip bilmeýärin."
- FORMAT: { "text": "..."}

### 5. ENSIKLOPEDIK STANDARTLAR (ÖSÜMLIKLER ÜÇIN)
Ulanyjy haýsydyr bir ösümlik ýa-da dermanlyk ot barada anyk sorsa:
- JOGABYŇ BAŞLANYŞY: Jogabyň başynda hiç hili giriş sözlerini ulanma. Kitap adyny ýa-da sahypa belgilerini gaýtalama!
- MAGLUMAT ÇEŞMESI & ÄTIÝAÇLYK KADASY (FALLBACK): Birinji nobatda Prompt bilen gelen SQL "Context" maglumatlaryna esaslan. Eger SQL Context-iň içi boş bolsa ýa-da ensiklopedik tekst ýok bolsa, ASLA "maglumat ýok" ýa-da "giňişleýin maglumat berip bilmeýärin" diýip ýazma! Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» ensiklopediýasynyň ylmy stilindäki öz umumy lukmançylyk we botanika bilimiňi ulanyp, aşakdaky ähli bölümleri özüň iň az 2500-3000 simwol bolar ýaly giňişleýin doldur.
- STRUKTURA (BERK TERTIP):
     BIOLOGIK HÄSIÝETNAMASY: Ösümligiň daşky gurluşy, boýy, sapy, ýapraklary, gülleri we kök ulgamy barada azyndan 4-5 giňişleýin abzas.
     GEOGRAFIKI ÝAÝRAWY: Türkmenistanyň haýsy çäklerinde (daglar, çöller, jülgeler, sebitler) bitýändigi barada anyk maglumat.
     BIO-HIMIKI DÜZÜMI: Ösümligiň düzümindäki witaminler, alkaloidler, glikozidler, efir ýaglary we minerallar barada maglumat ber.
     ŞYPALYLYK HÄSIÝETI: Haýsy kesellere we näsazlyklara garşy ulanylýandygy barada çuňňur ylmy düşündiriş.
     DERMANYŇ TAÝÝARLANYLYŞY: Takyk reseptler: Eger SQL Context-de anyk taýýarlanyş mukdary bar bolsa şony ýaz, ýok bolsa derman mukdarlaryny we sanlary özüňden uýdurma! Diňe umumy taýýarlanyş usulyny düşündir.
     SOŇLAMA: Tekstiň iň sonunda hökman "Siziň saglygyňyz biziň üçin gymmatlydyr. Şonuň üçin islendik dermanlyk ösümligi ulanmazdan ozal, hökman hünärmen lukman bilen maslahatlaşmagynyzy maslahat berýärin." diýen habary dury nygtaň.
    
     ### 6. AGYRY, ŞIKAÝATLAR WE ÖSÜMLIGIŇ PEÝDASY SORALANDA (DYNAMIC GYSGA JOGAP LOGIKASY)
     - ŞERT: Eger ulanyjy saglyk ýagdaýy/kesel barada sorsa (Meselem: "kelläm agyrýar", "içim geçýär") ÝA-DA ösümligiň diňe peýdasyny/ulanylyşyny sorsa (Meselem: "Kaşniç ösümliginiň näme peýdasy bar?"):
     - PROTOKOL: SQL Context-den gelen ýa-da tapylan ösümlik maglumatyny esas edinip, diňe şol şikaýata/peýda degişli derman taýýarlaň we jogaby berk suratda aşakdaky şablon boýunça (JSON formatynda) beriň.
     - STRUKTURA KADASY (STRICT RECOVERY): Bu ssenariýada ösümligiň "BIOLOGIK HÄSIÝETNAMASY" we "GEOGRAFIKI ÝAÝRAWY" bölümlerini bütinleý AÝYRYP TAŞLA! Jogap diňe we diňe şol ösümligiň dermanlyk peýdalary hem-de emi (resepti) barada gysga, dury we takyk bolmaly.
          
     JOGABYŇ BERK STRUKTURASY (DÜZGÜNLERI):
     1. MÄHIRLI GIRIŞ (BERK ŞERT): Jogaba başlamazdan öň hiç hili başga artykmaç söz ýazma! Ulanyjynyň iberen soragyna görä aşakdaky iki ýagdaýdan DIŇE BIRINI SAÝLAP, göni şonuň bilen başla (kwadrat belgileri we olaryň içindäki dynamic sözleri aýyryň, diňe aşakdaky arassa setirleri ýazyň):
     
     A ÝAGDAÝY (Ulanyjy kesel, agyry ýa-da saglyk şikaýatyny ýazan bolsa):
     "Hormatly ulanyjy, [ULANYJYNYŇ ŞIKAÝATY] barada eşitmek gaty gynandyryjy. Dermanlyk ösümlikler arkaly bu ýagdaýy ýeňilleşdirmek üçin size peýdaly maslahat bermek isleýärin. Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasyna laýyklykda, bu ýagdaýy bejermekde iň peýdaly ösümlikleriň biri [SQL-DEN GELEN ÖSÜMLIK ADY] hasaplanýar."
     
     B ÝAGDAÝY (Ulanyjy göni ösümligiň adyny agzap, onuň diňe peýdalaryny/häsiýetini soran bolsa):
     "Hormatly ulanyjy, Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasyna laýyklykda [SQL-DEN GELEN ÖSÜMLIK ADY] dermanlyk ösümliginiň peýdaly taraplary barada maslahat bermek isleýärin."
     
     2. GÖRKEZME: Ýokarky şablonlardaky [SQL-DEN GELEN ÖSÜMLIK ADY] ýerine diňe bazaňyzdan gelen ösümligiň arassa Türkmençe adyny (Mysal üçin: Atgulak, Zerewşan sogany) harpma-harp goýuň. Jogabyň içine ulanyjynyň promptundan dynamic sözlemleri ASLA garyşdyrmaň we gaýtalamaň!
     
     3. MAKSATLY MAZMUN (GYSGA WE TIZ OKALÝAN):
     - Ösümligiň düzümindäki şol agra/organa ýa-da umumy saglyga göni täsir edýän iň esasy 2-3 sany dermanlyk maddany, witamini ýa-da işjeň elementi gysgaça sanap geçiň (Uzyn we düşnüksiz akademiki terminleri süzüp aýyryň).
     - Eger A Senariýasy (Saglyk şikaýaty) bolsa: Ösümligiň diňe ulanyjynyň agzan şol anyk agrysyna/keseline nähili täsir edýändigini, agryny nähili ýeňilleşdirýändigini dury we ynamly lukmançylyk dili bilen düşündiriň.
     - Eger B Senariýasy (Ösümligiň peýdasy) bolsa: Ösümligiň ynsan saglygyna, immunitet ulgamyna we bedeniň kesellere garşy durnuklylygyny ýokarlandyrmaga berýän iň esasy 2-3 sany şypaly tarapyny beýan ediň.
     
     DERMANYŇ TAÝÝARLANYLYŞY:
     (BERK KADA: Ýokarky maksatly mazmun gutaransoň, hökman 2 sany boş setir taşlap, täze setirden doly uly harplar bilen "DERMANYŇ TAÝÝARLANYLYŞY:" diýip sözbaşy goýuň. Taýýarlanyş tekstiniň özüni bolsa şu sözbaşynyň aşagyndan täze abzas edip ýazyň.)
     Takyk reseptler: Eger SQL Context-de anyk taýýarlanyş mukdary bar bolsa şony ýaz, ýok bolsa derman mukdarlaryny we sanlary özüňden uýdurma! Diňe umumy taýýarlanyş usulyny düşündir.

     🚫 BERK GADAGANLYK (ANTI-REPETITION, ANTI-FAMILY & ANTI-LATIN):
Sözbaşy Gadagany: "BIOLOGIK HÄSIÝETNAMASY:" ýa-da "GEOGRAFIKI ÝAÝRAWY:" diýen sözbaşylar we olaryň aşagindaky tekstler bu ssenariýada ASLA ulanylmaly däldir.

Maşgala we Klasifikasiýa Gadagany: Ösümligiň haýsy botaniki maşgala (Lamiaceae, Asteraceae, Fabaceae, Solanaceae we ş.m.) degişlidigi baradaky ylmy maglumatlar jogabyň hiç bir ýerinde ýazylmaly däldir.

Söz we Fraza Gadagany: "Maşgalasy", "family", "degişlidir", "görnüşidir" ýaly botaniki degişliligi aňlatýan söz düzümlerini ulanmak düýbünden gadagandyr.

Latynça Adyň Gadagany: Ösümlikleriň latynça ylmy atlary (mysal üçin: Mentha piperita, Glycyrrhiza glabra we ş.m.) jogabyň hiç bir ýerinde, hatda gysgajyk ýa-da ýaýyň içinde-de ýazylyp bilinmez.

Ulanjynyň Islegi Çäklendirmesi: Ulanyjy ýörite sorasa-da, ösümligiň maşgalasy ýa-da latynça ylmy ady barada hiç hili maglumat berilmeli däldir. Bu baradaky soraglar göni we sypayýçylykly ýagdaýda ret edilmelidir.
     4. SOŇLAMA: Tekstiň iň sonunda hökman "Siziň saglygyňyz biziň üçin gymmatlydyr. Şonuň üçin islendik dermanlyk ösümligi ulanmazdan ozal, hökman hünärmen lukman bilen maslahatlaşmagyňyzy maslahat berýärin." diýen habary dury nygtaň.
     
     ### 7. ÝALŇYŞLYKLARYŇ ÖŇÜNI ALMAK (STRICT RULES)
     1. LATYN/RUS ATLARY: Diňe SQL-den gelen görnüşinde ulan.
     2. SAHYPA BELGISI: Promptda takyk san ýok bolsa, asla özüňden san uýdurma!
     3. ÝÜZLENMELER: Diňe "Hormatly ulanyjy" diý.
     4. PLANTS LIST RULE: "plants" sanawyna ýazanyňda ösümligiň diňe türkmençe adyny ýaz, ýanyna latynça adyny ýa-da düşündiriş goşma. Mysal: ["Narpyz"] - DOGRY. Bu baha SQL bazasyndaky "ady_tm" sütüni bilen 100% birmeňzeş bolmaly.

### TEKNIKI FORMAT (STRICT JSON)
Jogaby diňe şu formatda ber:
{
  "text": "Tekst şu ýere",
  "plants": ["Ösümlik ady"] 
}
`;
app.get('/', (req, res) => {
    res.send('Sanly Tebip API işleýär!');
});
app.post("/api/chat", async (req, res) => {
    console.log("🚨 REQUEST GELDI");
    console.log("BODY:", req.body);
    console.log("📥 REQUEST GELDI BODY:", req.body);
    if (!req.body) {
        return res.status(400).json({ error: "Request body boş gelýär!" });
    }
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt boş bolmaly däl" });

    function normalizeText(text) {
        if (!text) return "";
        let clean = text.toLowerCase();
        clean = clean.replace(/\([^)]*\)/g, "");
        clean = clean.replace(/["'“”«»]/g, " ");
        clean = clean.replace(/[.,?!:;\-_]/g, " ");
        return clean.replace(/\s+/g, " ").trim();
    }

    const trimmedPrompt = normalizeText(prompt);

    try {
        // 1. ÄDİM: CACHE BARLAGY
        const cache = await findCachedResponse(trimmedPrompt);
        if (cache) {
            console.log("Jogap bazadan alyndy. ");
            return res.json(cache);
        }

        // Gysga we adaty sözleri süzmek
        const gysgaSozler = ["salam", "salamälik", "surat", "sen kim", "özüň barada aýt", "adyň näme", "maglumatlary nireden alýarsyň", "haýsy kitaba esaslanýarsyň"];
        const isGysgaSorag = gysgaSozler.some(word => trimmedPrompt.includes(word.toLowerCase()));

        // Saglyk şikaýaty süzgüçleri (Harp takyklygy sazlandy)
        let isMedicalComplaint =
            trimmedPrompt.includes("agyr") ||
            trimmedPrompt.includes("uset") || trimmedPrompt.includes("üşet") ||
            trimmedPrompt.includes("orgun") || trimmedPrompt.includes("ýorgun") ||
            trimmedPrompt.includes("yotel") || trimmedPrompt.includes("ýötels") ||
            trimmedPrompt.includes("sanc") || trimmedPrompt.includes("sanç") ||
            trimmedPrompt.includes("kesel") || trimmedPrompt.includes("diabet") ||
            trimmedPrompt.includes("süýji") || trimmedPrompt.includes("suyji") ||
            trimmedPrompt.includes("ösýär") || trimmedPrompt.includes("osyar");

        let plantInDb = null;

        if (!isGysgaSorag) {
            // Ilki göni kitaphana bazasyndan gözleýäris
            plantInDb = await findPlantInLibrary(trimmedPrompt);
            
            // Eger bazada ýok bolsa we bu şikaýat bolsa, Classifier Agent işe düşýär
            if (!plantInDb && isMedicalComplaint) {
                console.log("🤖 Classifier Agent: Ulanyjynyň şikaýaty analiz edilýär...");
                const classifierModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                
                const classificationPrompt = `
                Seniň ýeke-täk wezipäň: Ulanyjynyň beren saglyk şikaýatyna, kesel sözüne ýa-da islegine laýyklykda, aşakda berlen ýöriteleşdirilen maglumatlar sanawyndan IŇ PEÝDALY dermanlyk ösümligi anyklamak we onuň diňe takyk Türkmençe adyny yzyna gaýtarmak.
                
                Ulanyjynyň ýazgysy: "${prompt}"
                
                🎯 BERK REJELER (STRICT RULES):
                1. Aşakdaky sypatlandyrmalar sanawyny diňe we diňe matematika ýaly takyk "Açar söz -> Ösümlik" kadasy esasynda ulan.
                2. Eger ulanyjynyň şikaýaty anyk bir ösümligiň sypatlandyrmasyna gabat gelse, şol ösümligiň adyny DIŇE aşakda nähili ýazylan bolsa ŞOL GÖRNÜŞDE (harpma-harp) yzyna gaýtar.
                3. Hiç hili düşündiriş, salamlaşyk, synp, punktuasiýa belgi ýa-da artykmaç söz ýazma! Jogap diňe ösümligiň arassa ady bolmaly.
                
                📋 GAHRYMAN ARKADAGYMYZYŇ ENSIKLOPEDIÝASY ESASYNDAKY TAKYK SANAW:
                
                [ŞIKAÝAT WE KESELLER] -> [ÝEKETÄK JOGAP GÖRNÜŞI]
                
                // --- DEM ALYŞ WE ÖÝKEN ULUGAMY ---
                - dem gysma, gury ýötel, bronhit, sowuklama, gakylyk duruzmak -> Buýan
                - bokurdak agyry, sowuklama, grip, gakylyk, bronhial rahatlyk -> Anis
                - ýötel, öýken sowuklamasy, dykyz gakylyk, bronhit -> Andyz
                - sowuklama, dümew, gyzgyny düşürmek, dermanlyk çaýlar -> Adaty boýbodran
                - öýken, bronhial demgysma, asma, dem gysylmagy -> Ýaman borjak
                - inçekesel, öýken sikesleri, güýçli gakylyk düşürmek -> Çerbiýe
                - öýken inçekeseli, güýçli gakylykly ýötel, bronhial rahatlyk -> Porsy ýowşan
                - bokurdak sowuklamasy, angina, stomatit, agyz garkyldatmak -> Garrygala gülhatmasy
                
                // --- ASABYLYK WE UKU ULUGAMY ---
                - nerw spazmlary, stres, kelle agyry, migren, rahatlandyryjy -> Ajy narpyz
                - stres, dowamly akyl ýorgunlygy, uky kynçylygy, ukusyzlyk -> Melissa
                - ýürek we damar ulgamy, uky bozulmalary, asabylyk -> Şirguýruk
                - ukusyzlyk, nerw agyrylary, kramplar, rahatlandyryjy -> Saglygoty
                - boýun agyry, damar çekme, uky bozulmasyny kadalaşdyrmak -> Olganyň pişigoty
                - nerw dartgynlygy, stres, uky kynçylygy, kelleçatlama -> Arian bidenegi
                - ukusyzlyk, kelleçatlama, nerw spazmlary, içgeçme -> Adaty aýowan
                
                // --- AŞGAZAN-IÇEGE WE IÝMIT SIŇDIRIŞ ---
                - aşgazan agyry, içgeçme, sanç, iýmit siňdirişiň kynlaşmagy -> Iki başly borjak
                - aşgazan-içege, içege mikroflorasynyň bozulmagy, zäherlenme -> Ýandak
                - aşgazan ýarasy, sarygaýnama, gastrit, aşgazan sowuklamasy -> Ak andyz
                - aşgazan sowuklamasy, işdäaçiji, hroniki gastrit -> Ajyýowşan
                - aşgazan-içege sançlary, meteorizm, içiň ýellenmegi -> Zire
                - iýmit siňdiriş, aşgazan şiresini köpeltmek -> Adaty käşir
                - iç tanygyny arassalamak, öt çykaryjy, işdä açyjy -> Tarhun
                - aşgazan sowuklamasy, sowuklama, öt haltanyň rüstemligi -> Adaty tmin
                - aşgazan ýarasy, içgeçme, gan akmalary duruzmak -> Türkmen ýylgaýy
                - aşgazan şiresiniň pesligi, iýmit siňdirmezlik -> Adaty badyýan
                - iç gatamasy, yzygiderli iç ýöremezlik, içege arassalamak -> Ýabany süýtleňňiç
                - aşgazan zäherlenmesi, içege parazitleri, gury ýötel, bronhlar -> Adaty anas
                - aşgazan ýaralary, gastrit, sarygaýnama, iýmit siňdirmezlik -> Owgan injiri
                - aşgazan-içege spazmlary, siňdirişiň kynlaşmagy -> Oşuň ajyteresi
                
                // --- BÖWREK WE PEŞEW ÝOLLARY ---
                - böwrek, peşew ýollary, peşew akdyryjy, sistit -> Atgulak
                - böwrek we peşew haltadaky daşlary eretmek -> Kyrkbogun
                - peşew hroniki çişleri, ýürege suw ýygnanma, skleroz -> Kenarot
                - peşew sowuklamasy, böwrek çägesi, sistit -> Pürli atguýruk
                - böwrek daşy keseli, peşew haltanyň sarsmagy -> Saýawanly suwoky
                - böwrek çägesi, peşew ýollaryndaky agyry we spazm -> Zerewşan sogany
                - böwrek we peşew ýollarynyň sowuklamasy, sistit -> Nazik gülli atgulak
                
                // --- ÝÜREK-DAMAR WE GANT KESELI ---
                - ýürek urşunyň kadasyzlygy, aritmiýa, gan basyşyny sazlamak -> Alyç
                - gant keseli, gandaky şekeri azaltmak, süýji keseli -> Arça
                - gan basyşyny peseltmek, kelleçatlama, parazitler -> Keýigoty
                - ýürek gatamasy, gury sary ýötel, bronhlary giňeltmek -> Kenepli çerbiýe
                - ýürek damarlaryny giňeltmek, gany durnuklaşdyrmak -> Kenar batgatopalagy
                - gan basyşy, gan goýalygy, insult we infarktyň öňüni almak -> Ýewropa zeýtuny
                - damar dykylyşlary, skleroz, infarktyň öňüni almak -> Adaty sarymsak
                - gan basyşyny peseltmek, ýürek urşunu kadasyna getirmek -> Olganyň sarysolmazy
                - maddalar çalyşygyny sazlamak, gant keseli, diabet, süýji -> Mäzli garaçöregot
                - gant derejesini kadalaşdyrmak, witamin C çeşmesi -> Owgan injiri
                
                // --- DERI, ÝARA WE AGYZ BOŞLUGY ---
                - agyz boşlygynyň çişmegi, stomatit, ownuk ak ýaralar -> Adaty dalamaz
                - diş agyry, diş etiniň ganamasy, agyz seňlemesi -> Narpyz
                - deridäki allergiki örgünler, ekzema, hamyň guramagy -> Ak selme
                - agyz boşlugunu garkyldatmak, antiseptik, ýara bitiriji -> Myhak
                - agyzda dörän ýaralar, angina, stomatit -> Ýalan murt
                - zäherlenmeler, gany arassalamak, deriniň allergiki çişleri -> Süýji ýeken
                - agyz boşlugynyň sowuklamasy, antiseptik, ýara bitiriji -> Ak pakyr
                - deri ýaralary, kesilen ýeriň ganamasyny duruzmak -> Gabykly galatella
                - dyrnak, dyrnagym içine ösýär, dyrnak çişmesi, barmak çişme -> Atgulak
                
                // --- IMMUNITET, BAGYR WE BEÝLEKILER ---
                - ganazlyk, immunitet güýçlendirmek, witamin ýetmezçiligi -> Adaty nar
                - immunitet ulgamy, dermanlyk çaýlar, witaminleşdirmek -> Itburun
                - bogunlarda duz ýygnanma, podagra, bil agyry, radikulit -> Atguýruk
                - bogunlaryň çişmegi, artrit, rewmatizm, osteohondroz -> Aýypenje
                - bagyr keselleri, sarygansyk, öt daşlary, öt çykaryjy -> Zirk
                - gan duruzmak, içki gan akmalar, ýaralar, gemorroy -> Çitçiti
                - bagyr we saryjalyk keselleri, gany arassalamak -> Towşandodagy
                - boýun we bil agyry, bogun rewmatizmi, çişme -> Adaty plýuş
                - ganazlyk, sinka, diş eti keselleri, witamin ýetmezçiligi -> Türkmen igdesi
                - öt haltanyň sowuklamasy, bagyrda damar dykylmalary -> Sary çyryş
                - göz keselleri, dumanly görmek, gözüň görejini killeşdirmek -> Akargül
                - gözüň garalmagy, göz basyşy, nerw sarsylmalary -> Komarowyň melegi
                - ganazlyk, dermanlyk berhiz, witamin C çeşmesi -> Ekilýän dary
                - bagyr we öt haltanyň işini kadalaşdyrmak, hroniki gastrit -> Etlek ýowşan
                - içki spazmlar, damar çekmeler, mikroblara garşy -> Üzärlik
                
                NUSGA JOGAPLAR (ŞU GÖRNÜŞDEN BAŞGA JOGAP BERME):
                Adaty käşir
                Arça
                Buýan
                `;

                try {
                    const classResult = await classifierModel.generateContent(classificationPrompt);
                    const detectedPlantName = classResult.response.text().trim();
                    console.log(`🌿 Classifier tapan ösümligi: "${detectedPlantName}"`);

                    if (detectedPlantName && detectedPlantName.length > 1) {
                        // 🎯 DÜZELDILDI: "await" goşuldy, indi wada däl-de hakyky data gelýär
                        plantInDb = await findPlantInLibrary(detectedPlantName.toLowerCase().trim());
                    }
                } catch (err) {
                    console.error("⚠️ Classifier-de näsazlyk döredi:", err.message);
                }
            }
        }

    // 1. Modely çygyran wagtyň özi resmi requestOptions (timeout) goşarys
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    systemInstruction: systemInstructionTebip 
}, { requestOptions: { timeout: 30000 } }); // 30 sekuntda jogap gelmese, asynkron zynjyr dykylman, sypyp geçer

// 2. Chat sazlamalary
const chat = model.startChat({
    generationConfig: {
        temperature: 0.1, 
        topP: 0.8,
        topK: 40,
        // Eger Sanly Tebip frontende diňe JSON ugradýan bolsa, aşakdaky setiri açyp bilersiň:
        // responseMimeType: "application/json" 
    }
});
                
        let finalPrompt = prompt;
                
        if (plantInDb) {
            finalPrompt = `Ulanyjynyň soragy: "${prompt}".
                
            BU GÖRKEZME ÖRÄN MÖHÜM (STRICT RULES):
            1. REŽIM: ${isMedicalComplaint 
              ? "Ulanyjy saglyk şikaýatyny etdi ýa-da ösümligiň diňe peýdasyny/ulanylyşyny sorady. SYSTEM PROMPT-daky '6. AGYRY, ŞIKAÝATLAR WE ÖSÜMLIGIŇ PEÝDASY SORALANDA' şablony boýunça mähirli giriş taýýarla! 'BIOLOGIK HÄSIÝETNAMASY' we 'GEOGRAFIKI ÝAÝRAWY' bölümlerini bütinleý AÝYRYP TAŞLA! Diňe gysga peýdasyny we derman taýýarlanylyşyny çykar!" 
              : "Ulanyjy göni ösümlik öwrenmek üçin sorady. SYSTEM PROMPT-daky '5. ENSIKLOPEDIK STANDARTLAR' boýunça ÄHLI bölümleri doly görnüşde ber!"}
                
            2. JOGAP FORMATY: Jogaby berk suratda diňe aşakda berlen 'Ensiklopedik tekst' maglumatyna esaslanyp gur we System Prompt-daky berk JSON formatynda gaýtar! Özüňden başga ösümlik uýdurma!
                
            3. TEHNIKI SETIRLERI GAÝTALAMAK GATY BERK GADAGANDYR (CRITICAL FILTER): 
                - Aşakdaky SQL context maglumatlary diňe ösümligi tanamak we teksti ýazmak üçin ulanylmalydyr. 'Türkmençe ady:', 'Latynça ady:', 'Tom:', 'Sahypa:' ýaly sözbaşylary jogabyň içine ASLA göçürip ýazma!
                - Eger Režim Şikaýat/Peýda bolsa: Jogaba göni "Hormatly ulanyjy..." diýen mähirli sözlem bilen başla!
                - Eger Režim Umumy Maglumat bolsa: Jogaba hiç hili giriş sözsüz, göni "BIOLOGIK HÄSIÝETNAMASY:" diýen sözbaşy bilen başla!
                
            4. SURAT KADASY: JSON formatynyň 'plants' sanawyna DIŇE we DIŇE şu aşakda berlen 'Türkmençe ady' bahasyny harpma-harp, üýtgetmän ýaz: ["${plantInDb.ady_tm}"]
                
            5. GAÝTALANMA GADAGANDYR: 'BIOLOGIK HÄSIÝETNAMASY:' diýen sözbaşydan soň ösümligiň adyny ikilenç gaýtadan ýazma, göni daşky gurluşyny düşündirmäge başla.
    
            [SQL BAZADAN GELEN ÖSÜMLIK MAGLUMATLARI]:
            - Ösümligiň ady: ${plantInDb.ady_tm}
            - Ensiklopedik mazmun we maglumatlar: ${plantInDb.ensiklopedik_tekst || 'Maglumat ýok'}`;
            }
        let responseText = null;
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts && !responseText) {
            try {
                const result = await Promise.race([
                    chat.sendMessage(finalPrompt),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Wagt: Gemini gaty köp garaşdyrdy")), 50000))
                ]);

                const response = await result.response;
                responseText = response.text();
            } catch (error) {
                attempts++;
                const isRetryable = error.message.includes("503") || 
                                   error.message.includes("429") || 
                                   error.message.includes("Wagt");

                                   if (isRetryable && attempts < maxAttempts) {
                                    const waitTime = attempts * 4000; 
                                
                                    // 🎯 DÜZELDILDI: ms -> sekunda öwürmek üçin 1000-e bölündi!
                                    console.warn(`⚠️ Synanyşyk ${attempts}: ${error.message}. ${waitTime / 1000}s garaşylýar...`);
                                    
                                    await new Promise(r => setTimeout(r, waitTime));
                                } else {
                                    console.error("❌ Düýpli ýalňyşlyk ýüze çykdy we synanyşyk çäklerine ýetildi:", error.message);
                                    throw error; 
                                }
            }
        }

        let parsedData;
        try {
            let cleanJson = responseText
            .replace(/```json\s*/gi, "")
            .replace(/```\s*/g, "")
            .trim();
            
            cleanJson = cleanJson.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

            const firstBrace = cleanJson.indexOf('{');
            const lastBrace = cleanJson.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
                parsedData = JSON.parse(cleanJson);
            } else {
                throw new Error("JSON tapylmady");
            }

            if (parsedData.text) {
                parsedData.text = parsedData.text.replace(/\\n/g, '\n'); 
            }
        } catch (parseError) {
            console.error("❌ JSON parsing hatasy:", parseError.message);
            parsedData = { 
                text: responseText.replace(/\\n/g, '\n').replace(/```json|```/g, "").trim(), 
                plants: [] 
            };
        }

        // 🎯 DÜZELDILDI: "await" goşuldy! Indi asynkron bökdençlik döremez
        if (!plantInDb && parsedData.plants && parsedData.plants.length > 0) {
            const plantNameFromAI = parsedData.plants[0].toLowerCase().trim();
            plantInDb = await findPlantInLibrary(plantNameFromAI);
        }

        let mainText = (parsedData.text || responseText).trim(); 

        if (plantInDb) {
            const incomingText = prompt ? prompt.toLowerCase().trim() : "";
            let complaint = ""; 
        
            if (prompt) {
                // 1. BU ÝERE GOŞMALY: Stop-words sanawyna täze goşulmalary we kökleri goşmak
                const stopWords = [
                    "haýsy", "haysy", "dermanlyk", "ösümlikden", "osumlikden", "ösümlik", "osumlik",
                    "peýdalanmaly", "peydalanmaly", "näme", "name", "etmeli", "mende", "meniň", "menin",
                    "baradaky", "barada", "maglumat", "ber", "kömek", "komek", "edäýiň", "edayin",
                    "edip", "bilersiňiz", "bilersiniz", "haýsydyr", "haysydyr", "ösümligi", "bar", "ýaly", "yaly",
                    "berilmeli", "peýdasy", "peyda", "peýdalary", "peydalary", "ösmegi",
                    // TÄZE GOŞULAN DÜŞÜM WE KESEL SÖZLERI:
                    "ne", "ni", "na", "ny", "leri", "lary", "lerini", "laryny", 
                    "garşy", "garsy", "keseline", "kesellerine", "keselleri", "keseli", "keselini", "kesel", "em", "şypa"
                ];
            
                if (plantInDb.ady_tm) {
                    const dbPlantName = plantInDb.ady_tm.toLowerCase().trim();
                    stopWords.push(dbPlantName); 
                    const splitWords = dbPlantName.split(/\s+/);
                    if (splitWords.length > 1) {
                        splitWords.forEach(w => stopWords.push(w));
                    }
                }
            
                // 2. Prompt-y sözlere bölmek
                const words = prompt.toLowerCase()
                                    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~?()«»'’]/g, "")
                                    .split(/\s+/)
                                    .map(w => w.trim())
                                    .filter(Boolean);
            
                // 3. Düşüm goşulmalaryny kesmek
                const cleanedWords = words.map(word => {
                    return word.replace(/(ne|ni|na|ny|dan|den|garşy|garsy)$/gi, "");
                });
            
                // 4. `stopWords` arkaly arassalamak
                const filteredWords = cleanedWords.filter(word => word && !stopWords.includes(word));
                const parsedComplaint = filteredWords.join(" ").trim();
                
                if (parsedComplaint && parsedComplaint.length > 2) {
                    complaint = parsedComplaint;
                }
            }
        
            let searchMode = "plantOnly"; 
        
            // 1. ÄDÝM: Lukmançylyk şikaýat sözleri barmy?
            if (
                incomingText.includes("kesel") || 
                incomingText.includes("diabet") || 
                incomingText.includes("agyr") || 
                incomingText.includes("gynyndyr") ||
                incomingText.includes("ösýär") || 
                (typeof isMedicalComplaint !== 'undefined' && isMedicalComplaint)
            ) {
                searchMode = "medicalComplaint";
            } 
            // 2. ÄDÝM: Diňe peýdasy soralan bolsa
            else if (
                /peýda(sy|lary)?\s+näme/i.test(incomingText) || 
                incomingText.includes("peýdasy") || 
                incomingText.includes("peýdalary") || 
                incomingText.includes(" emi") || 
                incomingText.includes(" şypasy")
            ) {
                searchMode = "benefitOnly";
            }
            // 3. ÄDÝM: Süzgüçden geçen galan uzyn şikaýat bar bolsa
            else if (complaint && complaint.length > 2) {
                searchMode = "medicalComplaint";
            }
        
            let elegantComplaint = "";
    
            if (complaint) {
                const complaintWords = complaint.split(/\s+/);
                const formattedWords = complaintWords.map(word => {
                    const lowered = word.toLowerCase().trim();
        
                    if (["inçe", "gant", "gand", "şeker", "kesel", "keseli", "aiw", "aids"].includes(lowered)) {
                        return word;
                    }
        
                    if (lowered.endsWith("ym") || lowered.endsWith("am")) return lowered.slice(0, -2) + "yňyzyň";
                    if (lowered.endsWith("im")) return lowered.slice(0, -2) + "iňiziň";
                    if (lowered.endsWith("äm")) return lowered.slice(0, -2) + "äňiziň";
                    if (lowered.endsWith("üm")) return lowered.slice(0, -2) + "üňiziň";
                    if (lowered.endsWith("um")) return lowered.slice(0, -2) + "uňyzyň";
        
                    if (lowered.endsWith("yrýar") || lowered.endsWith("arýar") || lowered.endsWith("agyrýar")) {
                        return lowered.replace(/ýar$/, "magy");
                    }
                    if (lowered.endsWith("örýär") || lowered.endsWith("erýär") || lowered.endsWith("ösýär")) {
                        return lowered.replace(/ýär$/, "megi");
                    }
                    if (lowered.endsWith("ýar")) return lowered.slice(0, -3) + "magy";
                    if (lowered.endsWith("ýär")) return lowered.slice(0, -3) + "megi";
        
                    return word;
                });
        
                elegantComplaint = formattedWords.join(" ").trim();
        
                // Kesel goşulmalaryny we galyndylary arassalamak
                elegantComplaint = elegantComplaint
                    .replace(/\bkesellerine\b/gi, "")
                    .replace(/\bkeselleri\b/gi, "")
                    .replace(/\bkeseline\b/gi, "")
                    .replace(/\bkeselini\b/gi, "")
                    .replace(/\bkeseli\b/gi, "")
                    .replace(/\bkesel\b/gi, "")
                    .replace(/\bgarşy\b/gi, "")
                    .replace(/\bgarsy\b/gi, "")
                    .replace(/\bne\b/gi, "")
                    .replace(/\bni\b/gi, "")
                    .replace(/gözüňiziň agyrmagy/gi, "gözleriňiziň agyrmagy")
                    .replace(/dişiňiziň agyrmagy/gi, "dişleriňiziň agyrmagy")
                    .replace(/\s+/g, " ")
                    .trim();
            
                if (
                    elegantComplaint && 
                    !elegantComplaint.endsWith("keseli") && 
                    !elegantComplaint.endsWith("magy") && 
                    !elegantComplaint.endsWith("megi") &&
                    !elegantComplaint.endsWith("yňyzyň") &&
                    !elegantComplaint.endsWith("iňiziň")
                ) {
                    elegantComplaint += " keseli";
                }
            }
        
            // Gemini-den gelen esasy teksti arassalamak
            mainText = (mainText || "")
                .replace(/Hormatly ulanyjy[\s\S]*?hasaplanýar\./gi, "")
                .replace(/Hormatly ulanyjy[\s\S]*?isleýärin\./gi, "")
                .replace(/Bu ösümlik barada[\s\S]*?berilýär\./gi, "")
                .replace(/Türkmençe ady:\s*[^%\n]+/gi, "")
                .replace(/Latynça ady:\s*[^%\n]+/gi, "")
                .replace(/Rusça ady:\s*[^%\n]+/gi, "")
                .replace(/Maşgalasy:|Family:|Degişlidir:|Verbenaceae|Lamiaceae|Asteraceae|Fabaceae/gi, "")
                .replace(/^[\s.\-,:;]+/, "")
                .trim();
        
            const plantNameFormatted = plantInDb && plantInDb.ady_tm 
                ? plantInDb.ady_tm.charAt(0).toUpperCase() + plantInDb.ady_tm.slice(1) 
                : "";
        
            const header = plantInDb 
                ? `Bu ösümlik barada Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasynyň ${plantInDb.tom_belgisi}-nji tomunyň, ${plantInDb.sahypa_belgisi}-nji sahypasynda giňişleýin maglumat berilýär.\n\n` +
                  `Türkmençe ady: ${plantInDb.ady_tm}\n` +
                  `Latynça ady: ${plantInDb.ady_lat}\n` +
                  `Rusça ady: ${plantInDb.ady_ru || "Maglumat ýok"}\n\n`
                : "";
        
            let welcomeMessage = "";
        
            if (searchMode === "benefitOnly") {
                welcomeMessage = `Hormatly ulanyjy, Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasyna laýyklykda, ${plantNameFormatted} dermanlyk ösümliginiň peýdaly taraplary barada maslahat bermek isleýärin.\n\n`;
            } 
            else if (searchMode === "medicalComplaint") {
                const finalComplaint = elegantComplaint || "saglyk ýagdaýyňyz";
                welcomeMessage = `Hormatly ulanyjy, ${finalComplaint} barada eşitmek gaty gynandyryjy. Dermanlyk ösümlikler arkaly bu ýagdaýy ýeňilleşdirmek üçin size peýdaly maslahat bermek isleýärin. Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasyna laýyklykda, bu ýagdaýy bejermekde iň peýdaly ösümlikleriň biri ${plantNameFormatted} hasaplanýar.\n\n`;
            } 
            else {
                welcomeMessage = `Hormatly ulanyjy, Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasyna laýyklykda, ${plantNameFormatted} dermanlyk ösümligi barada giňişleýin maglumat bermek isleýärin.\n\n`;
            }
        
            mainText = welcomeMessage + header + mainText;
        }
    
        const imageFile = plantInDb && plantInDb.surat_fayl ? plantInDb.surat_fayl : "default.png";
        const validPlantsList = parsedData.plants && parsedData.plants.length > 0
            ? parsedData.plants
            : (plantInDb ? [plantInDb.ady_tm] : []);
    
        const finalResponse = {
            text: mainText,
            plants: validPlantsList,
            surat_fayl: imageFile,
            source: plantInDb ? "Sanly Tebip (Ensiklopediýa)" : "Gemini AI"
        };
        // --- 3. BAZA ÝAZMAK WE KITAPHANANY TÄZELEMEK ---
        try {
            const saved = await saveNewResponse(
                trimmedPrompt,
                finalResponse,
                imageFile
            );
            
            if (saved) {
                console.log("✅ Jogap cache-e ýazyldy.");
            } else {
                console.error("❌ Jogap cache-e ýazylmady.");
            }

            if (parsedData.plants && parsedData.plants.length > 0 && imageFile !== "default.png") {
                const newPlantName = parsedData.plants[0];
                const checkLibrary = await findPlantInLibrary(newPlantName.toLowerCase());
                
                if (!checkLibrary) {
                    console.log(`✨ Täze ösümlik kitaphana goşulýar: ${newPlantName}`);
                    await pool.query(
                        "INSERT INTO plants_library (ady_tm, surat_fayl) VALUES (?, ?)",
                        [newPlantName, imageFile]
                    );
                }
            }
        } catch (error) {
            console.log("⚠️ Baza ýazylanda ýalňyşlyk ýüze çykdy:", error.message);
        }

        return res.json(finalResponse);

    } catch (error) {
        console.error("❌ Düýpli ýalňyşlyk ýüze çykdy:", error.message);
        const pleasantMessages = [
            "Hormatly ulanyjy, häzirki wagtda Sanly Tebip atly ilkinji emeli aň ulgamy Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasynyň dermanlyk ösümlikleriniň şypaly maglumatlary saýlap almak üçin emeli aň ulgamy täze ylmy maglumatlary özleşdirýär. Birnäçe sekuntdan täzeden synanyşsaňyz, size hökman kömek ederis.Saglygyňyz biziň üçin hemme zatdan gymmatlydyr!"
        ];
        const finalMessage = pleasantMessages[Math.floor(Math.random() * pleasantMessages.length)];
    
        return res.json({ 
            text: finalMessage,
            plants: [],
            surat_fayl: "default.png", 
            source: "Sanly Tebip habarnamasy"
        });
    }
});
// 🎙️ Sanly Tebip - Sesli soraglary kabul ediş endpointi (/api/tebip-audio)
app.post("/api/tebip-audio", upload.single('audio'), async (req, res) => {
    let filePath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Ses faýly tapylmady!" });
        }

        console.log("🌿 Sanly Tebip - Ses faýly kabul edildi:", req.file.filename);
        filePath = req.file.path;

        console.log("🎙️ Ses faýly işlenilip başlandy...");

        // 1. Faýly base64 formatyna öwürýäris
        let base64Audio = "";
        if (req.file.buffer) {
            base64Audio = req.file.buffer.toString("base64");
        } else if (filePath) {
            const fileBuffer = fs.readFileSync(filePath);
            base64Audio = fileBuffer.toString("base64");
        }

        if (!base64Audio) {
            console.log("❌ Ýalňyşlyk: Ses faýlynyň maglumaty (base64) tapylmady!");
            return res.status(400).json({ success: false, error: "Ses faýly okalyp bilmedi." });
        }

        // 2. MimeType barlagy
        const mimeType = req.file.mimetype && req.file.mimetype !== 'application/octet-stream' 
            ? req.file.mimetype 
            : 'audio/webm';

        console.log(`⏳ Gemini modeline ugradýar (Format: ${mimeType})...`);

        const audioModel = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            systemInstruction: systemInstructionTebip 
        });

        // 3. Gemini modeline sorag ugratmak
        const result = await audioModel.generateContent([
            {
                inlineData: {
                    data: base64Audio,
                    mimeType: mimeType
                }
            },
            { 
                text: "Bu ses faýlyndaky soragy diňläň we Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» ensiklopediýasyna laýyklykda doly, düşnükli jogap beriň. Jogabyňyzy hökman aşakdaky JSON formatda beriň:\n{\n  \"text\": \"Siziň doly we giňişleýin jogabyňyz...\",\n  \"plants\": [\"Ösümligiň ady\"]\n}" 
            }
        ]);

        console.log("✅ AI-den üstünlikli jogap alyndy!");
        const rawText = result.response.text();
        console.log("📄 Jogap (Raw):", rawText);
        function parseTebipResponse(text) {
            if (!text) return { text: "Maglumat tapylmady.", plants: [] };
            
            try {
                let cleaned = text.trim();
                
                // Markdown bloklaryny aýyrýarys
                const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch && jsonMatch[1]) {
                    cleaned = jsonMatch[1].trim();
                }

                // AI text içindäki rugsat berilmedik control character-leri arassalaýarys
                cleaned = cleaned.replace(/[\u0000-\u001F]+/g, " ");

                const parsed = JSON.parse(cleaned);
                return {
                    text: parsed.text || text,
                    plants: parsed.plants || []
                };
            } catch (e) {
                console.error("⚠️ JSON parse säwligi, Asyl tekst ulanylýar:", e.message);
                
                // Eger JSON parse edilip bilmedik ýagdaýynda hem text bilen plants-i regex arkaly tapmaga synanyşýarys
                return { 
                    text: text.replace(/```(?:json)?|```/g, "").trim(), 
                    plants: text.toLowerCase().includes("narpyz") ? ["Narpyz"] : [] 
                };
            }
        }

        const parsed = parseTebipResponse(rawText);

        return res.status(200).json({
            success: true,
            message: "Ses üstünlikli işlenildi!",
            filename: req.file.filename,
            response: parsed.text,
            plants: parsed.plants
        });

    } catch (error) {
        console.error("❌ Sanly Tebip Ses ýükleme ýa-da AI ýalňyşlygy:", error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});
// Serweri başlatmak (Howpsuz barlag bilen)
async function startServer() {
    try {
        // 1. Bazany barlap görýäris, emma ýalňyşlyk çyksa hem serweri duruzmarys
        const isConnected = await testConnection();
        if (!isConnected) {
            console.log("⚠️ MySQL bazasy ýok, emma serwer diňe Gemini API bilen işini dowam edýär.");
        }

        // 2. Bazanyň bar ýa ýokdugyna garamazdan serwer hemişe açylýar
        app.listen(PORT, () => {
            console.log(`🚀 Sanly Tebip http://localhost:${PORT}-da işleýär.`);
        });
        
    } catch (err) {
        console.error("❌ Serwer açylmady:", err.message);
        process.exit(1);
    }
}

startServer();