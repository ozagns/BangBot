// =========================================================
// BANGBOT — WhatsApp Multi-Function Bot (Sticker, Tools, Safe Mode)
// Versi SAFE MODE — Dengan Metadata "by BangBot"
// =========================================================

// --- KODE 24 JAM RENDER ---
const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.send('Halo! BangBot sedang aktif 🚀');
});

app.listen(port, () => {
  console.log(`Server kecil berjalan di port ${port}`);
});
// --------------------------
const {
    default: makeWASocket,
    useMultiFileAuthState,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const P = require('pino');
const qrcode = require('qrcode-terminal');
const https = require("https");
const fs = require('fs');
const os = require('os'); // Bisa taruh di atas file juga
const path = require('path');
const { youtube } = require('btch-downloader');

function listFilesRecursive(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(listFilesRecursive(full));
    else results.push(full);
  }
  return results;
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function getSofficeCmd() {
  const env = process.env.SOFFICE_PATH;
  if (env && env.trim()) return `"${env.trim()}"`;
  return "soffice"; // jika sudah di PATH
}

function pickExtFromFileName(fn) {
  const m = String(fn || "").toLowerCase().match(/\.(docx?|xlsx?|pptx?)$/);
  return m ? m[0] : "";
}

async function convertOfficeToPdf({ inPath, outDir }) {
  const soffice = process.env.SOFFICE_PATH || "soffice";

  // Penting: quote path
  const cmd =
    `"${soffice}" --headless --nologo --nolockcheck --nodefault --norestore ` +
    `--convert-to pdf --outdir "${outDir}" "${inPath}"`;

  // Jangan pakai exec() tanpa menangkap output; pastikan execPromise melempar error kalau exit code != 0
  await execPromise(cmd);
}

async function waitForFile(p, ms = 15000, step = 300) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(p)) return true;
    await new Promise(r => setTimeout(r, step));
  }
  return false;
}

function getAudioMixQueue(chatId) {
  if (!audioMixQueue.has(chatId)) audioMixQueue.set(chatId, []);
  return audioMixQueue.get(chatId);
}

const { exec } = require('child_process');
const xml2js = require("xml2js"); // npm i xml2js

// =========================================================
// HELPER: GENERIC RANDOM FILENAME (Anti-Tabrakan)
// =========================================================
const getRandom = (ext) => {
    return `${Math.floor(Math.random() * 10000)}${Date.now()}.${ext}`;
};

// =========================================================
// HELPER: execPromise (untuk yt-dlp, ffmpeg, dll)
// =========================================================
function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr });
    });
  });
}

// =========================================================
// AUDIO MIX QUEUE (per chat): simpan max 2 audio
// =========================================================
const audioMixQueue = new Map(); // key: chatId, value: [{ path, name, by, ts }]

// Fungsi ubah "MM:SS" jadi detik (integer)
function parseTime(text) {
    if (text.includes(':')) {
        const parts = text.split(':');
        const min = parseInt(parts[0]);
        const sec = parseInt(parts[1]);
        return (min * 60) + sec;
    }
    return parseInt(text); // Kalau cuma angka (misal "30"), anggap detik
}

// =========================================================
// helper office converter
// =========================================================
function sanitizeFileName(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")  // karakter ilegal Windows
    .replace(/\s+/g, " ")
    .trim();
}

async function handleOfficeToPdf(sock, from, msg, mediaMsg, fileNameHint) {
  const workDir = path.join(__dirname, "downloads", "office2pdf");
  ensureDir(workDir);
  const stamp = Date.now();

  // Bersihkan nama file agar aman bagi sistem operasi
  const cleanBaseName = sanitizeFileName(fileNameHint).replace(/\s+/g, "_");
  const inPath = path.join(workDir, `${stamp}_${cleanBaseName}`);

  const buf = await downloadMediaMessage(mediaMsg, "buffer");
  fs.writeFileSync(inPath, buf);

  await sock.sendMessage(from, { text: "⏳ Mengonversi Office → PDF (LibreOffice)..." }, { quoted: msg });

  try {
    await convertOfficeToPdf({ inPath, outDir: workDir });

    // Tentukan path output yang diharapkan oleh LibreOffice
    const expectedOutPath = inPath.replace(/\.[^.]+$/i, ".pdf");
    await waitForFile(expectedOutPath, 15000);

    let finalPath = expectedOutPath;
    
    // Fallback jika file tidak ditemukan dengan nama yang sama
    if (!fs.existsSync(finalPath)) {
      const pdfs = fs.readdirSync(workDir).filter(f => f.includes(String(stamp)) && f.endsWith(".pdf"));
      if (!pdfs.length) throw new Error("Output PDF tidak ditemukan.");
      finalPath = path.join(workDir, pdfs[0]);
    }

    // --- FORMULASI NAMA AKHIR ---
    // Mengambil judul asli dan menambahkan ekstensi .pdf
    const outputName = cleanBaseName.replace(/\.[^.]+$/i, "") + ".pdf";

    await sock.sendMessage(from, {
      document: fs.readFileSync(finalPath),
      mimetype: "application/pdf",
      fileName: outputName // Mengirim kembali dengan nama file yang benar
    }, { quoted: msg });

  } catch (err) {
    throw err;
  } finally {
    // Pembersihan file sementara
    try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch {}
    try { 
      const autoGeneratedPdf = inPath.replace(/\.[^.]+$/i, ".pdf");
      if (fs.existsSync(autoGeneratedPdf)) fs.unlinkSync(autoGeneratedPdf);
    } catch {}
  }
}

const axios = require('axios');
const cheerio = require('cheerio');
const { PDFDocument } = require("pdf-lib");
const JimpPkg = require("jimp");
const Jimp = JimpPkg.Jimp || JimpPkg; // kompatibel Jimp lama & baru
const QrCodeReader = require('qrcode-reader');

// --- MAP PENYIMPAN SESI BALASAN ---
const activeConfess = {};

// --- DATABASE PESAN SEMENTARA (ANTI-DELETE) ---
const msgLog = {}; // Tempat nyimpen riwayat chat
const NOMOR_OWNER = "628975800981@s.whatsapp.net"; // Ganti No WA Abang (pake @s.whatsapp.net)

// --- CONFIG GROQ AI (PENYELAMAT) ---
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const moment = require('moment-timezone');
const yts = require('yt-search');

// =========================================================
// PDF MERGE QUEUE (per chat)
// =========================================================
const pdfMergeQueue = new Map(); // key: chatId, value: [{path, name, by, ts}]

const { Boom } = require('@hapi/boom');
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); // EXIF STIKER
const QRCode = require('qrcode');                                   // QR GENERATOR
// Menyimpan pesan PDF terakhir per chat (untuk !pdf2img tanpa reply)
const lastPdfPerChat = new Map();   // key: JID chat, value: message object PDF
// Simpan PDF terakhir per chat (grup/privat)
const LAST_PDF = {};
const REMBG_CLI = "rembg";
// Simpan gambar terakhir per chat (untuk !qrauto)
const LAST_QR_IMAGE = {};

// Load .env sekali saja
require('dotenv').config();

process.on('unhandledRejection', (reason, p) => {
    console.error('UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

// Fungsi ambil daftar blacklist
const getBlacklist = () => {
    return JSON.parse(fs.readFileSync('./blacklist.json'));
};

// Fungsi tambah nomor ke blacklist
const addBlacklist = (target) => {
    const blacklist = getBlacklist();
    if (!blacklist.includes(target)) {
        blacklist.push(target);
        fs.writeFileSync('./blacklist.json', JSON.stringify(blacklist, null, 2));
    }
};

// Base URL backup TikTok (pihak ketiga apa pun)
// Contoh .env: TIKTOK_BACKUP_API=https://your-backup-api.com/tiktok?url=
const TIKTOK_BACKUP_API = process.env.TIKTOK_BACKUP_API || "";

/**
 * PINTEREST DOWNLOADER CONFIG
 *
 * Contoh isian di .env:
 *   PINTEREST_PRIMARY_API=https://klickpin-ENDPOINT-KAMU?url=
 *   PINTEREST_BACKUP_API=https://pindown-ENDPOINT-KAMU?url=
 */
const PINTEREST_PRIMARY_API = process.env.PINTEREST_PRIMARY_API || "";
const PINTEREST_BACKUP_API  = process.env.PINTEREST_BACKUP_API  || "";

// Font mirip iPhone (Inter Regular)
const IPHONE_FONT_PATH = "./fonts/Inter-Regular.otf";

// =================================================================
// KONFIGURASI & STATE
// =================================================================

// JID owner bot (otomatis terisi saat bot connect, tapi isi manual jika perlu)
let OWNER_JID = "";

// Anti-Spam Command (per user)
const COOLDOWN_MS = 4000;
const lastCommandTime = new Map();

// Anti-Flood (Safe Mode: hanya warning, tidak kick)
const FLOOD_WINDOW_MS = 8000;
const FLOOD_MAX_MSG = 7;
const floodMap = new Map();

// Admin Guardian
const PROTECTED_ADMINS = []; // Akan terisi owner otomatis

// Statistik & Limit Downloader
let totalCommands = 0;
const DOWNLOAD_LIMIT_PER_USER = 10;   // per user per hari
const DOWNLOAD_LIMIT_PER_GROUP = 50;  // per grup per hari
const downloadUserMap = new Map();    // key: sender, value: { date, count }
const downloadGroupMap = new Map();   // key: from,   value: { date, count }

// Auto Emoji Reaction (Smart Mode)
const AUTO_EMOJI_REACTION = true;   // smart reaction ke chat biasa
const AUTO_EMOJI_CHANCE   = 0.35;   // 0.35 = 35% peluang react

// Auto reaction untuk command (jam/progress)
const AUTO_COMMAND_REACTION = true;

// =================================================================
// KONFIG EKSTERNAL: ANIME & MOVIE
// =================================================================

// Jikan API (MyAnimeList proxy / JSON)
const JIKAN_BASE = "https://api.jikan.moe/v4";

// OMDb API (wajib punya API key: https://www.omdbapi.com/apikey.aspx)
const OMDB_API_KEY = process.env.OMDB_API_KEY || "dd2f9835"; 

// =================================================================
// CEK RESI
// =================================================================
const COURIERS = {
    jne: "jne",
    jnt: "jnt",
    sicepat: "sicepat",
    anteraja: "anteraja",
    ninja: "ninja",
    pos: "pos",
    wahana: "wahana",
    idexpress: "idexpress",
    ide: "idexpress",
    spx: "spx",
    spxid: "spx",
    spxmy: "spx",
    spxsg: "spx"
};

function detectCourier(text) {
    text = text.toLowerCase();
    for (let key in COURIERS) {
        if (text.includes(key)) return COURIERS[key];
    }
    // Deteksi prefix otomatis SPX
    if (/^spx[a-z]{2}/i.test(text)) return "spx";
    return null;
}

// --- DATABASE AFK ---
let afk = {};

// --- DATABASE GAME ---
let math = {};         // Sesi Game Matematika
let siapakahaku = {};  // Sesi Game Siapakah Aku

// --- DATABASE EKONOMI (SIMPLE JSON) ---
const dbFile = './database.json';
let userBalance = {};

// Fungsi Load Database (Jalan pas bot nyala)
if (fs.existsSync(dbFile)) {
    userBalance = JSON.parse(fs.readFileSync(dbFile));
} else {
    fs.writeFileSync(dbFile, JSON.stringify(userBalance));
}

// Fungsi Simpan Database (Dipanggil tiap ada transaksi)
const saveDb = () => {
    fs.writeFileSync(dbFile, JSON.stringify(userBalance, null, 2));
};

// Fungsi Helper Tambah/Kurang Uang
const addBalance = (id, amount) => {
    if (!userBalance[id]) userBalance[id] = 0; // Modal awal 0
    userBalance[id] += amount;
    saveDb();
};

const getBalance = (id) => {
    return userBalance[id] || 0;
};

// =================================================================
// GAME SESSIONS (per chat)
// =================================================================
const tebakkataSessions   = new Map(); // key: from (jid), value: { answer, hint, tries }
const tebakgambarSessions = new Map(); // key: from (jid), value: { answer, hint, tries }
const caklontongSessions  = new Map(); // key: from (jid), value: { answer, explain, tries }
const family100Sessions   = new Map(); // key: from (jid), value: { question, answers, tries }

const TEBAK_KATA_BANK = [
    // --- YANG SUDAH ADA (TETAP) ---
    {
        answer: "kopi",
        hint: "Minuman hitam, pahit, sering diminum pagi hari."
    },
    {
        answer: "bintang",
        hint: "Bersinar di langit malam."
    },
    
    // --- TAMBAHAN BARU (BANYAK) ---
    {
        answer: "gajah",
        hint: "Hewan sangat besar, punya belalai dan gading."
    },
    {
        answer: "kucing",
        hint: "Hewan peliharaan berbulu, bunyinya meong."
    },
    {
        answer: "matahari",
        hint: "Pusat tata surya, terbit di timur."
    },
    {
        answer: "bulan",
        hint: "Satelit alami bumi, muncul malam hari."
    },
    {
        answer: "komputer",
        hint: "Alat elektronik canggih untuk mengetik dan olah data."
    },
    {
        answer: "sepatu",
        hint: "Alas kaki yang dipakai saat sekolah atau kerja."
    },
    {
        answer: "nasi",
        hint: "Makanan pokok orang Indonesia, asalnya dari padi."
    },
    {
        answer: "sate",
        hint: "Daging dipotong kecil, ditusuk, lalu dibakar."
    },
    {
        answer: "rendang",
        hint: "Makanan khas Padang, daging sapi bumbu rempah."
    },
    {
        answer: "polisi",
        hint: "Profesi penegak hukum, seragamnya cokelat."
    },
    {
        answer: "guru",
        hint: "Pahlawan tanpa tanda jasa, mengajar di sekolah."
    },
    {
        answer: "dokter",
        hint: "Bekerja di rumah sakit, menyembuhkan orang sakit."
    },
    {
        answer: "pantai",
        hint: "Wisata alam berpasir di tepi laut."
    },
    {
        answer: "gunung",
        hint: "Dataran tinggi menjulang, kadang meletus."
    },
    {
        answer: "mobil",
        hint: "Kendaraan roda empat, butuh bensin."
    },
    {
        answer: "pesawat",
        hint: "Transportasi udara, punya sayap tapi bukan burung."
    },
    {
        answer: "jam",
        hint: "Alat penunjuk waktu."
    },
    {
        answer: "kunci",
        hint: "Pasangan gembok, buat buka pintu."
    },
    {
        answer: "buku",
        hint: "Jendela dunia, lembaran kertas dijilid."
    },
    {
        answer: "tas",
        hint: "Wadah untuk membawa barang di punggung atau bahu."
    },
    {
        answer: "air",
        hint: "Benda cair, jernih, vital buat kehidupan."
    },
    {
        answer: "api",
        hint: "Panas, menyala, jangan dimainin nanti ngompol."
    },
    {
        answer: "cermin",
        hint: "Benda yang bisa memantulkan bayangan kita."
    },
    {
        answer: "kasur",
        hint: "Tempat paling nyaman buat rebahan."
    },
    {
        answer: "bantal",
        hint: "Teman setia kepala saat tidur."
    },
    {
        answer: "sendok",
        hint: "Alat makan, pasangannya garpu."
    },
    {
        answer: "piring",
        hint: "Wadah tempat menaruh makanan saat makan."
    },
    {
        answer: "gelas",
        hint: "Wadah untuk minum."
    },
    {
        answer: "hujan",
        hint: "Air yang turun dari langit."
    },
    {
        answer: "pelangi",
        hint: "Lengkungan warna-warni indah setelah hujan."
    },
    {
        answer: "semut",
        hint: "Serangga kecil, suka gula, gotong royong."
    },
    {
        answer: "nyamuk",
        hint: "Serangga kecil penghisap darah, bikin bentol."
    },
    {
        answer: "kambing",
        hint: "Hewan kurban, bunyinya mbeee."
    },
    {
        answer: "ayam",
        hint: "Unggas berkokok di pagi hari."
    },
    {
        answer: "ular",
        hint: "Reptil panjang tidak berkaki, berbisa."
    },
    {
        answer: "ikan",
        hint: "Hewan hidup di air, bernapas pakai insang."
    },
    {
        answer: "internet",
        hint: "Jaringan dunia maya, butuh kuota."
    },
    {
        answer: "kulkas",
        hint: "Lemari pendingin penyimpan makanan."
    },
    {
        answer: "televisi",
        hint: "Kotak bergambar dan bersuara untuk hiburan."
    },
    {
        answer: "kipas",
        hint: "Baling-baling berputar bikin adem."
    },
    {
        answer: "topi",
        hint: "Aksesoris pelindung kepala dari panas."
    },
    {
        answer: "payung",
        hint: "Pelindung dari hujan, sedia sebelum hujan."
    },
    {
        answer: "roti",
        hint: "Makanan berbahan tepung, biasanya dioles selai."
    },
    {
        answer: "bakso",
        hint: "Bola daging berkuah panas."
    },
    {
        answer: "susu",
        hint: "Minuman sehat warna putih dari sapi."
    },
    {
        answer: "jeruk",
        hint: "Buah warna oranye, kaya vitamin C."
    },
    {
        answer: "pisang",
        hint: "Buah kuning melengkung kesukaan monyet."
    },
    {
        answer: "kelapa",
        hint: "Buah keras, airnya segar, isinya putih."
    },
    {
        answer: "indonesia",
        hint: "Negara kepulauan terbesar, tanah air kita."
    },
    {
        answer: "monas",
        hint: "Tugu berlapis emas di Jakarta."
    }
];

const TEBAK_GAMBAR_BANK = [
    // --- CONTOH YANG LAMA ---
    {
        question: "🍎📱",
        answer: "iphone",
        hint: "Buah + HP populer."
    },
    
    // --- TAMBAHAN BARU (BANYAK) ---
    {
        question: "🕷️👨",
        answer: "spiderman",
        hint: "Superhero laba-laba."
    },
    {
        question: "🦁👑",
        answer: "lion king",
        hint: "Film singa yang jadi raja hutan."
    },
    {
        question: "🦇👨",
        answer: "batman",
        hint: "Superhero manusia kelelawar."
    },
    {
        question: "🐜👨",
        answer: "antman",
        hint: "Superhero manusia semut."
    },
    {
        question: "👓📖",
        answer: "kutu buku",
        hint: "Sebutan untuk orang yang hobi baca."
    },
    {
        question: "🐍🪜",
        answer: "ular tangga",
        hint: "Permainan papan klasik."
    },
    {
        question: "🐮🥛",
        answer: "susu sapi",
        hint: "Minuman sehat dari hewan melenguh."
    },
    {
        question: "🐝🍯",
        answer: "madu",
        hint: "Cairan manis dari lebah."
    },
    {
        question: "🚢🧊",
        answer: "titanic",
        hint: "Kapal besar yang menabrak gunung es."
    },
    {
        question: "👻🏠",
        answer: "rumah hantu",
        hint: "Tempat seram ada setannya."
    },
    {
        question: "👮‍♂️💤",
        answer: "polisi tidur",
        hint: "Gundukan di jalan biar pelan."
    },
    {
        question: "📸👰",
        answer: "foto pengantin",
        hint: "Dokumentasi saat nikahan."
    },
    {
        question: "📅🔴",
        answer: "tanggal merah",
        hint: "Hari libur di kalender."
    },
    {
        question: "🥊🐔",
        answer: "adu ayam",
        hint: "Pertarungan dua unggas."
    },
    {
        question: "🚪🏃",
        answer: "kabur",
        hint: "Lari lewat pintu."
    },
    {
        question: "🛌💤",
        answer: "tidur siang",
        hint: "Istirahat di tengah hari."
    },
    {
        question: "🏫🎒",
        answer: "anak sekolah",
        hint: "Pergi belajar bawa tas."
    },
    {
        question: "💉👨‍⚕️",
        answer: "suntik",
        hint: "Alat dokter yang tajam."
    },
    {
        question: "💇‍♂️💈",
        answer: "potong rambut",
        hint: "Merapikan kepala di barbershop."
    },
    {
        question: "🌧️🌈",
        answer: "pelangi",
        hint: "Muncul indah setelah hujan."
    },
    {
        question: "🧛‍♂️🩸",
        answer: "drakula",
        hint: "Hantu penghisap darah."
    },
    {
        question: "🧜‍♀️🌊",
        answer: "putri duyung",
        hint: "Manusia setengah ikan."
    },
    {
        question: "🧞‍♂️💡",
        answer: "jin",
        hint: "Keluar dari lampu ajaib."
    },
    {
        question: "🧟🧠",
        answer: "zombie",
        hint: "Mayat hidup suka makan otak."
    },
    {
        question: "💍💎",
        answer: "berlian",
        hint: "Perhiasan sangat mahal dan keras."
    },
    {
        question: "🍿🎬",
        answer: "bioskop",
        hint: "Nonton film layar lebar sambil makan jagung."
    },
    {
        question: "🎤🎶",
        answer: "karaoke",
        hint: "Menyanyi pakai mic."
    },
    {
        question: "🎮🕹️",
        answer: "video game",
        hint: "Permainan elektronik."
    },
    {
        question: "⚽🥅",
        answer: "gol",
        hint: "Bola masuk gawang."
    },
    {
        question: "🏀🗑️",
        answer: "basket",
        hint: "Bola masuk keranjang."
    },
    {
        question: "🏸🐓",
        answer: "bulu tangkis",
        hint: "Olahraga tepok bulu angsa."
    },
    {
        question: "🎣🐟",
        answer: "mancing",
        hint: "Menangkap ikan dengan kail."
    },
    {
        question: "🏊‍♂️🌊",
        answer: "berenang",
        hint: "Olahraga di dalam air."
    },
    {
        question: "🎂🕯️",
        answer: "ulang tahun",
        hint: "Perayaan hari lahir tiup lilin."
    },
    {
        question: "💔😭",
        answer: "patah hati",
        hint: "Sedih karena putus cinta."
    },
    {
        question: "🤕🏥",
        answer: "kecelakaan",
        hint: "Terluka dan dibawa ke RS."
    },
    {
        question: "💰🏦",
        answer: "bank",
        hint: "Tempat menyimpan uang."
    },
    {
        question: "🎓📚",
        answer: "wisuda",
        hint: "Lulus kuliah pakai toga."
    },
    {
        question: "🏖️🌴",
        answer: "pantai",
        hint: "Liburan di laut ada pohonnya."
    },
    {
        question: "🌋💥",
        answer: "gunung meletus",
        hint: "Bencana alam lahar panas."
    },
    {
        question: "👽🛸",
        answer: "alien",
        hint: "Makhluk luar angkasa naik piring terbang."
    },
    {
        question: "🧱🇨🇳",
        answer: "tembok cina",
        hint: "Bangunan panjang bersejarah di Tiongkok."
    },
    {
        question: "🗼🇫🇷",
        answer: "menara eiffel",
        hint: "Ikon kota Paris."
    },
    {
        question: "🗽🇺🇸",
        answer: "patung liberty",
        hint: "Wanita bawa obor di New York."
    },
    {
        question: "🍫💝",
        answer: "valentine",
        hint: "Hari kasih sayang kasih coklat."
    },
    {
        question: "🎄🎅",
        answer: "natal",
        hint: "Hari raya ada sinterklas."
    },
    {
        question: "🕌🌙",
        answer: "lebaran",
        hint: "Hari raya umat muslim."
    },
    {
        question: "🧨🎆",
        answer: "tahun baru",
        hint: "Pergantian tahun ada petasan."
    },
    {
        question: "👀❤️",
        answer: "mata hati",
        hint: "Perasaan terdalam (kiasan)."
    },
    {
        question: "🦶⚽",
        answer: "sepak bola",
        hint: "Olahraga nendang bola."
    }
];

const CAK_LONTONG_BANK = [
    // --- YANG SUDAH ADA (TETAP) ---
    {
        question: "Binatang apa yang kalau kita pukul malah kita yang sakit?",
        answer: "palu",
        explain: "Karena yang dipukul itu palu, bukan binatang beneran. Cak Lontong style: membingungkan."
    },
    
    // --- TAMBAHAN BARU (BANYAK & NGESELIN) ---
    {
        question: "Matahari tenggelam di sebelah...",
        answer: "gawat",
        explain: "Gawat kalau matahari tenggelam di sebelah kita, bisa kebakar."
    },
    {
        question: "Galon apa yang berat?",
        answer: "galonmu",
        explain: "Ya kalau galon saya kan ringan, kalau galonmu ya berat bawa sendiri."
    },
    {
        question: "Apabila mengendarai mobil wajib bawa...",
        answer: "satu",
        explain: "Kalo bawa dua gimana mengendarainya?"
    },
    {
        question: "Mawar melati semuanya...",
        answer: "bunga",
        explain: "Ya emang bunga, masa makanan."
    },
    {
        question: "Jangan berteman dengan orang...",
        answer: "hilang",
        explain: "Gimana cara bertemannya kalau orangnya hilang?"
    },
    {
        question: "Hujan turun biasanya...",
        answer: "kebawah",
        explain: "Kalau ke atas namanya air mancur."
    },
    {
        question: "Ada guling ada...",
        answer: "benang",
        explain: "Guling tanpa benang jahitannya lepas semua."
    },
    {
        question: "Orang bingung mikir...",
        answer: "salah",
        explain: "Orang bingung kok disuruh mikir, ya jelas salah dong."
    },
    {
        question: "Kucing diatas pohon kalau turun apanya dulu?",
        answer: "niatnya",
        explain: "Kalau gak ada niat, dia gak bakal turun."
    },
    {
        question: "Lebak bulus, cililitan, adalah nama...",
        answer: "keduanya",
        explain: "Benar kan? Itu nama keduanya."
    },
    {
        question: "Tidak boleh masuk kelas...",
        answer: "lalat",
        explain: "Lalat mengganggu pelajaran."
    },
    {
        question: "Bendera NKRI warnanya...",
        answer: "cuma dua",
        explain: "Merah sama Putih, jadi cuma dua warna."
    },
    {
        question: "Candi borobudur adalah candi...",
        answer: "itu",
        explain: "Iya itu, masa candi ini."
    },
    {
        question: "Orang berjalan di atas air tidak pakai...",
        answer: "otak",
        explain: "Udah tau air kok diinjak, pake jembatan atau perahu dong."
    },
    {
        question: "Ikan bernafas di air dengan...",
        answer: "tenang",
        explain: "Kalau gelisah nanti ikannya stress."
    },
    {
        question: "Apa fungsi rem?",
        answer: "ngebut",
        explain: "Coba kalau gak ada rem, berani ngebut gak?"
    },
    {
        question: "Orang makan karena...",
        answer: "sadar",
        explain: "Kalau pingsan gak bisa makan."
    },
    {
        question: "Burung adalah hewan yang bisa...",
        answer: "temenan",
        explain: "Burung kakatua temenan sama burung dara."
    },
    {
        question: "Batik merupakan produk asli dari...",
        answer: "manusia",
        explain: "Masa hewan bisa bikin batik."
    },
    {
        question: "Hewan yang mempunyai 2 kelamin namanya...",
        answer: "jantan",
        explain: "Kela 'min' jantan, dan kela 'max' betina. (Maksa dikit)"
    },
    {
        question: "Dalam permainan bulutangkis, dilarang memegang...",
        answer: "tangan",
        explain: "Apalagi tangan lawan, nanti dikira modus."
    },
    {
        question: "Kecoa adalah hewan yang...",
        answer: "ada",
        explain: "Ya emang ada, sering lewat di dapur."
    },
    {
        question: "Mobil tidak bisa jalan karena...",
        answer: "parkir",
        explain: "Kalau jalan namanya bukan parkir."
    },
    {
        question: "Dimana tempat lahir I.R. Soepratman?",
        answer: "indonesia",
        explain: "W.R. Soepratman di Purworejo, kalau I.R. Soepratman mungkin tetangganya."
    },
    {
        question: "Waktu lulus sekolah, siswa mencoret-coret...",
        answer: "temannya",
        explain: "Baju temannya yang dicoret, bukan baju sendiri."
    },
    {
        question: "Yang menyebabkan haus saat romadhon...",
        answer: "cuaca",
        explain: "Kalau cuaca panas pasti haus."
    },
    {
        question: "Bisa dipanggil, tidak bisa menengok...",
        answer: "telinga",
        explain: "Coba panggil telinga kamu, bisa nengok gak?"
    },
    {
        question: "Banteng menyeruduk menggunakan...",
        answer: "tenaga",
        explain: "Kalau gak ada tenaga, mana bisa nyeruduk."
    },
    {
        question: "Sumur itu berbentuk...",
        answer: "lubang",
        explain: "Kalau kotak namanya peti mati."
    },
    {
        question: "Tanda kalau kucing marah ekornya...",
        answer: "satu",
        explain: "Kalau ekornya dua namanya siluman."
    },
    {
        question: "Alat musik gesek...",
        answer: "bunyi",
        explain: "Kalau digesek gak bunyi, rusak berarti."
    },
    {
        question: "Ibu menjahit dengan jarum dan...",
        answer: "serius",
        explain: "Kalau bercanda nanti ketusuk."
    },
    {
        question: "Pesawat mendarat di...",
        answer: "ban",
        explain: "Bannya dulu yang nyentuh landasan."
    },
    {
        question: "Kapan waktu yang tepat untuk membuka pintu?",
        answer: "tertutup",
        explain: "Kalau pintu terbuka ngapain dibuka lagi."
    },
    {
        question: "Anda datang terlambat maka anda...",
        answer: "selamat",
        explain: "Selamat, anda sampai tujuan walau telat."
    },
    {
        question: "Alat untuk memotong...",
        answer: "tajam",
        explain: "Kalau tumpul gak bisa buat motong."
    },
    {
        question: "Supaya bersih kita mandi dengan...",
        answer: "yakin",
        explain: "Yakinlah kalau sudah mandi pasti bersih."
    },
    {
        question: "Ibu kota Indonesia adalah...",
        answer: "bapaknya",
        explain: "Ibu kota pasangannya bapak kota."
    },
    {
        question: "Ayam apa yang paling besar?",
        answer: "ayam semesta",
        explain: "Induk ayam semesta."
    },
    {
        question: "Sandal apa yang paling enak?",
        answer: "sandal terasi",
        explain: "Sambal terasi maksudnya."
    },
    {
        question: "Ada api pasti ada...",
        answer: "anya",
        explain: "Api tanpa 'A' jadi pi. Anya Geraldine?"
    },
    {
        question: "Cicak biasanya makan...",
        answer: "nyamuk",
        explain: "Kali ini jawabannya bener, biar yang jawab salah kesel."
    },
    {
        question: "Hewan yang suka hinggap di makanan...",
        answer: "lapar",
        explain: "Kalau kenyang dia tidur."
    },
    {
        question: "Jauh di mata dekat di...",
        answer: "sini",
        explain: "Di sini, di hati."
    },
    {
        question: "Duduk sama rendah, berdiri sama...",
        answer: "kaki",
        explain: "Masa berdiri pakai tangan."
    },
    {
        question: "Satu ditambah satu sama dengan...",
        answer: "soal",
        explain: "Itu soal matematika anak SD."
    },
    {
        question: "Penyanyi luar negeri yang susah nelen...",
        answer: "ed sered",
        explain: "Ed Sheeran maksudnya (seret tenggorokan)."
    },
    {
        question: "Yang bisa menangkap penjahat di malam hari...",
        answer: "bangga",
        explain: "Bangga dong jadi polisi berprestasi."
    },
    {
        question: "Malam apa yang paling indah?",
        answer: "malamar",
        explain: "Melamar kamu."
    }
];

const FAMILY100_BANK = [
    // --- YANG SUDAH ADA (TETAP) ---
    {
        question: "Sebutkan benda yang biasa ada di kamar tidur.",
        answers: ["bantal", "guling", "kasur", "lemari", "selimut", "lampu", "cermin"]
    },
    
    // --- TAMBAHAN BARU (BANYAK) ---
    {
        question: "Apa yang biasa dilakukan orang saat bangun tidur?",
        answers: ["cek hp", "minum air", "ke kamar mandi", "doa", "mandi", "geliat", "matikan alarm"]
    },
    {
        question: "Sebutkan warna pelangi.",
        answers: ["merah", "kuning", "hijau", "biru", "jingga", "nila", "ungu"]
    },
    {
        question: "Jenis-jenis sambal di Indonesia.",
        answers: ["terasi", "bawang", "ijo", "matah", "korek", "tomat", "dabu-dabu", "bajak"]
    },
    {
        question: "Benda apa yang wajib dibawa saat sekolah?",
        answers: ["buku", "pulpen", "tas", "uang saku", "topi", "dasi", "bekal"]
    },
    {
        question: "Apa yang dilakukan orang saat mati lampu?",
        answers: ["cari lilin", "hidupkan senter", "tidur", "main hp", "ngipasin badan", "keluar rumah"]
    },
    {
        question: "Sebutkan nama-nama buah berwarna merah.",
        answers: ["apel", "stroberi", "semangka", "rambutan", "ceri", "tomat", "delima"]
    },
    {
        question: "Apa alasan orang datang terlambat?",
        answers: ["macet", "bangun kesiangan", "ban bocor", "hujan", "lupa jam", "sakit perut"]
    },
    {
        question: "Sebutkan hewan yang hidup di air.",
        answers: ["ikan", "udang", "kepiting", "cumi-cumi", "paus", "lumba-lumba", "ubur-ubur", "hiu"]
    },
    {
        question: "Apa yang biasa ada di dalam dompet?",
        answers: ["uang", "ktp", "sim", "kartu atm", "foto", "struk belanja", "stnk"]
    },
    {
        question: "Sebutkan merek mie instan populer di Indonesia.",
        answers: ["indomie", "mie sedaap", "supermi", "sarimi", "lemonilo", "pop mie"]
    },
    {
        question: "Apa yang orang lakukan di pantai?",
        answers: ["berenang", "main pasir", "foto", "berjemur", "makan", "lihat sunset", "selancar"]
    },
    {
        question: "Sebutkan nama-nama planet.",
        answers: ["bumi", "mars", "jupiter", "saturnus", "merkurius", "venus", "uranus", "neptunus"]
    },
    {
        question: "Sebutkan anggota tubuh yang berpasangan (kiri & kanan).",
        answers: ["mata", "telinga", "tangan", "kaki", "alis", "lubang hidung", "paru-paru", "ginjal"]
    },
    {
        question: "Apa yang biasa dibeli di minimarket?",
        answers: ["minuman", "roti", "rokok", "snack", "sabun", "shampo", "mie instan"]
    },
    {
        question: "Sebutkan profesi yang memakai seragam.",
        answers: ["polisi", "tentara", "dokter", "pilot", "satpam", "perawat", "guru", "siswa"]
    },
    {
        question: "Apa yang dilakukan orang kalau lagi galau?",
        answers: ["dengerin lagu", "nangis", "curhat", "tidur", "makan", "melamun", "jalan jalan"]
    },
    {
        question: "Sebutkan rasa es krim.",
        answers: ["coklat", "vanila", "stroberi", "durian", "mangga", "kopi", "mint"]
    },
    {
        question: "Apa yang membuat bayi menangis?",
        answers: ["lapar", "haus", "ngompol", "sakit", "digigit nyamuk", "gerah", "pengen digendong"]
    },
    {
        question: "Sebutkan alat transportasi umum.",
        answers: ["bus", "angkot", "kereta", "pesawat", "kapal", "taksi", "ojek"]
    },
    {
        question: "Apa yang biasa dilakukan saat tahun baru?",
        answers: ["bakar jagung", "main kembang api", "begadang", "tiup terompet", "kumpul keluarga", "doa"]
    },
    {
        question: "Sebutkan jenis olahraga bola besar.",
        answers: ["sepak bola", "basket", "voli", "futsal", "rugby", "bowling"]
    },
    {
        question: "Apa yang ada di dalam kulkas?",
        answers: ["air dingin", "telur", "sayur", "buah", "daging", "es batu", "susu", "sisa makanan"]
    },
    {
        question: "Sebutkan judul lagu kebangsaan/wajib nasional.",
        answers: ["indonesia raya", "maju tak gentar", "halo halo bandung", "garuda pancasila", "padamu negeri", "mengheningkan cipta"]
    },
    {
        question: "Apa yang biasa dilakukan saat jam istirahat sekolah?",
        answers: ["jajan", "makan", "main", "ngobrol", "ke toilet", "sholat", "baca buku"]
    },
    {
        question: "Sebutkan hewan yang bisa terbang.",
        answers: ["burung", "nyamuk", "lalat", "lebah", "kupu-kupu", "kelelawar", "capung"]
    },
    {
        question: "Benda apa yang sering hilang di rumah?",
        answers: ["remot tv", "kunci", "korek", "gunting kuku", "peniti", "kaos kaki", "karet gelang"]
    },
    {
        question: "Sebutkan menu sarapan orang Indonesia.",
        answers: ["nasi goreng", "bubur ayam", "lontong sayur", "nasi uduk", "roti", "susu", "gorengan"]
    },
    {
        question: "Apa yang dilakukan orang saat hujan turun?",
        answers: ["neduh", "pakai payung", "pakai jas hujan", "tidur", "angkat jemuran", "makan mie"]
    },
    {
        question: "Sebutkan nama-nama hari.",
        answers: ["senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu"]
    },
    {
        question: "Apa yang identik dengan hantu pocong?",
        answers: ["kain kafan", "lompat", "putih", "kuburan", "seram", "tali", "kapas"]
    },
    {
        question: "Sebutkan sosmed yang populer.",
        answers: ["instagram", "tiktok", "facebook", "twitter", "whatsapp", "youtube", "telegram"]
    },
    {
        question: "Apa yang menyebabkan sakit perut?",
        answers: ["makan pedas", "telat makan", "masuk angin", "makan asam", "keracunan", "haid"]
    },
    {
        question: "Benda apa yang ada di kamar mandi?",
        answers: ["gayung", "ember", "sabun", "sikat gigi", "odol", "shampo", "handuk", "kloset"]
    },
    {
        question: "Sebutkan hewan buas.",
        answers: ["singa", "macan", "buaya", "ular", "beruang", "serigala", "hiu"]
    },
    {
        question: "Apa yang dilakukan orang di bioskop?",
        answers: ["nonton", "makan popcorn", "minum", "pacaran", "duduk", "diam"]
    },
    {
        question: "Sebutkan mata uang asing.",
        answers: ["dollar", "euro", "yen", "won", "ringgit", "rupee", "peso", "poundsterling"]
    },
    {
        question: "Apa yang membuat orang tertawa?",
        answers: ["lawakan", "komedi", "gelitik", "kejadian lucu", "meme", "teman"]
    },
    {
        question: "Sebutkan bumbu dapur.",
        answers: ["garam", "gula", "merica", "ketumbar", "kunyit", "jahe", "bawang", "kecap"]
    },
    {
        question: "Apa yang ada di lapangan sepak bola?",
        answers: ["bola", "gawang", "wasit", "pemain", "rumput", "garis", "penonton"]
    },
    {
        question: "Sebutkan jenis-jenis bunga.",
        answers: ["mawar", "melati", "anggrek", "matahari", "tulip", "kamboja", "sepatu", "lili"]
    },
    {
        question: "Apa yang dilakukan suami istri saat malam pertama?",
        answers: ["tidur", "ngobrol", "hitung angpao", "mandi", "makan", "berdoa"]
    },
    {
        question: "Sebutkan merek HP.",
        answers: ["samsung", "iphone", "xiaomi", "oppo", "vivo", "realme", "infinix", "nokia"]
    },
    {
        question: "Apa yang biasa ada di pasar malam?",
        answers: ["bianglala", "kora-kora", "rumah hantu", "arum manis", "baju", "komedi putar", "penjual"]
    },
    {
        question: "Sebutkan nama nabi.",
        answers: ["muhammad", "isa", "musa", "ibrahim", "nuh", "adam", "yusuf", "sulaiman"]
    },
    {
        question: "Apa yang dilakukan orang saat kepedasan?",
        answers: ["minum", "kipas-kipas", "cari gula", "keringatan", "makan kerupuk", "teriak"]
    },
    {
        question: "Sebutkan superhero terkenal.",
        answers: ["superman", "batman", "spiderman", "iron man", "hulk", "captain america", "thor", "wonder woman"]
    },
    {
        question: "Benda tajam yang berbahaya.",
        answers: ["pisau", "gunting", "silet", "jarum", "pedang", "kaca pecah", "paku"]
    },
    {
        question: "Sebutkan topping martabak manis.",
        answers: ["coklat", "keju", "kacang", "wijen", "susu", "pisang", "kismis"]
    },
    {
        question: "Apa yang identik dengan vampir?",
        answers: ["darah", "gigi taring", "takut matahari", "peti mati", "bawang putih", "pucat", "jubah hitam"]
    }
];

// Sleep util (untuk delay human-like)
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper exec → Promise (bisa ambil output kalau perlu)
function execAsync(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) return reject(err);
            resolve(stdout ? stdout.toString() : "");
        });
    });
}

// --- FUNGSI TAMBAHAN DI PALING BAWAH FILE ---
async function uploadToCatbox(buffer) {
    const { FormData } = require("formdata-node");
    const { fileFromPath } = require("formdata-node/file-from-path");
    const { Blob } = require("buffer");
    
    // Kita pakai API Catbox.moe (Gratis & Stabil)
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", new Blob([buffer]), "image.jpg");

    const { data } = await axios.post("https://catbox.moe/user/api.php", form, {
        headers: { "Content-Type": "multipart/form-data" } // Biar axios otomatis atur boundary
    });
    
    return data.trim(); // Balikin URL gambar (contoh: https://files.catbox.moe/xyz.jpg)
}

// =================================================================
// vn2teks
// =================================================================
async function transcribeAudio(audioBuffer) {
    try {
        const response = await axios({
            method: 'POST',
            url: 'https://api.wit.ai/speech',
            headers: {
                'Authorization': `Bearer ${process.env.WIT_API_KEY}`,
                'Content-Type': 'audio/mpeg', // Pastikan mpeg jika mengirim mp3
            },
            data: audioBuffer,
        });
        // Wit.ai mengembalikan data dalam format teks mentah atau JSON
        return response.data.text || response.data._text || null;
    } catch (err) {
        console.error("Transcription Error:", err.response?.data || err.message);
        return null;
    }
}

// =================================================
// FUNGSI SCRAPER RESEP (RESEPKOKI.ID)
// =================================================
async function cariResep(query) {
    try {
        const searchUrl = `https://resepkoki.id/?s=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl);
        const $ = cheerio.load(data);

        // 1. Ambil link resep pertama dari hasil pencarian
        const link = $('.tlet-element-image a').first().attr('href');
        
        if (!link) return null; // Gak nemu

        // 2. Buka link resepnya
        const { data: resData } = await axios.get(link);
        const $$ = cheerio.load(resData);

        // 3. Ambil data detail
        const judul = $$('.entry-title').first().text().trim();
        const image = $$('.wp-post-image').first().attr('src'); // Gambar utama
        
        // Ambil Bahan
        let bahan = [];
        $$('.ingredient-list li').each((i, el) => {
            bahan.push("• " + $$(el).text().trim());
        });

        // Ambil Langkah
        let langkah = [];
        $$('.instruction-list li').each((i, el) => {
            langkah.push(`${i + 1}. ` + $$(el).text().trim());
        });

        // Ambil info tambahan (Porsi/Waktu)
        const porsi = $$('.sw-recipe-servings').text().trim() || "-";
        const waktu = $$('.sw-recipe-cook-time').text().trim() || "-";

        return {
            judul,
            image,
            porsi,
            waktu,
            bahan: bahan.join("\n"),
            langkah: langkah.join("\n\n"),
            sumber: link
        };

    } catch (e) {
        console.error("Scrape Resep Error:", e);
        return null;
    }
}

// =================================================
// FUNGSI SCRAPER ARTI NAMA (PRIMBON)
// =================================================
async function artiNama(nama) {
    try {
        // Website Primbon
        const url = `https://primbon.com/arti_nama.php?nama1=${nama}&proses=+Submit%21+`;
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        // Ambil isi konten dari ID #body
        let content = $('#body').text(); 
        
        // Parsing Teks (Karena website jadul, kita potong manual string-nya)
        // Pola: "ARTI NAMA: [NAMA] ... (isi) ... Nama:"
        
        // 1. Cari batas awal
        let splitAwal = content.split(`ARTI NAMA: ${nama}`);
        if (splitAwal.length < 2) {
            // Coba split generic kalau nama kapitalisasinya beda
            splitAwal = content.split(`ARTI NAMA:`);
        }
        
        if (splitAwal.length < 2) return null;

        let hasilKotor = splitAwal[1];

        // 2. Cari batas akhir (biasanya ada tulisan "Nama:" untuk input box bawahnya)
        let hasilBersih = hasilKotor.split("Nama:")[0];
        
        // 3. Bersihkan sampah lain (iklan/copyright)
        hasilBersih = hasilBersih.replace("Copyright", "").trim();

        return hasilBersih;

    } catch (e) {
        console.error("Scrape Arti Nama Error:", e);
        return null;
    }
}

// =================================================================
// HELPER: KIRIM STIKER DENGAN EXIF PACKNAME / AUTHOR
// =================================================================
async function sendStickerWithMeta(sock, jid, buffer, options = {}) {
    const sticker = new Sticker(buffer, {
        pack: options.packname || "BangBot",
        author: options.author || "BangBot",
        type: StickerTypes.FULL,
        quality: 70,
        categories: options.categories || ["😀"]
    });

    const stickerBuffer = await sticker.toBuffer();

    await sock.sendMessage(jid, { sticker: stickerBuffer });
}

// =================================================================
// UTIL FORMAT WAKTU & LIMIT
// =================================================================
function formatUptime(seconds) {
    seconds = Math.floor(seconds);
    const days = Math.floor(seconds / (24 * 3600));
    seconds %= 24 * 3600;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;

    const parts = [];
    if (days) parts.push(`${days} hari`);
    if (hours) parts.push(`${hours} jam`);
    if (minutes) parts.push(`${minutes} menit`);
    if (seconds || parts.length === 0) parts.push(`${seconds} detik`);
    return parts.join(" ");
}

function getToday() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function checkDownloadLimit(sender, from) {
    const today = getToday();
    const userKey = sender;
    const groupKey = from;

    let userData = downloadUserMap.get(userKey) || { date: today, count: 0 };
    let groupData = downloadGroupMap.get(groupKey) || { date: today, count: 0 };

    if (userData.date !== today) userData = { date: today, count: 0 };
    if (groupData.date !== today) groupData = { date: today, count: 0 };

    if (userData.count >= DOWNLOAD_LIMIT_PER_USER) {
        return {
            ok: false,
            msg: `Limit download harian kamu sudah habis (maks ${DOWNLOAD_LIMIT_PER_USER}x per hari, Bang).`
        };
    }

    if (groupData.count >= DOWNLOAD_LIMIT_PER_GROUP) {
        return {
            ok: false,
            msg: `Limit download harian di sini sudah penuh (maks ${DOWNLOAD_LIMIT_PER_GROUP}x per hari).`
        };
    }

    userData.count++;
    groupData.count++;
    userData.date = today;
    groupData.date = today;

    downloadUserMap.set(userKey, userData);
    downloadGroupMap.set(groupKey, groupData);

    return { ok: true };
}

// =================================================================
// HELPER: pdfsplit
// =================================================================
function parsePageSpec(spec, totalPages) {
    // spec: "1,3,5-7"
    // output: [0,2,4,5,6] (0-based)
    spec = String(spec || "").trim();
    if (!spec) return null;

    const out = [];
    const seen = new Set();

    const pushPage = (p1based) => {
        const p = Number(p1based);
        if (!Number.isFinite(p)) return;
        if (p < 1 || p > totalPages) return;
        const idx = p - 1;
        if (!seen.has(idx)) {
            seen.add(idx);
            out.push(idx);
        }
    };

    const parts = spec.split(",").map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
        // range "a-b"
        const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
            let a = parseInt(m[1], 10);
            let b = parseInt(m[2], 10);
            if (a > b) [a, b] = [b, a];
            for (let i = a; i <= b; i++) pushPage(i);
            continue;
        }

        // single "n"
        if (/^\d+$/.test(part)) {
            pushPage(part);
            continue;
        }
    }

    return out.length ? out : null;
}

// =================================================================
// HELPER: pdfmerge
// =================================================================
function getPdfQueue(chatId) {
  if (!pdfMergeQueue.has(chatId)) pdfMergeQueue.set(chatId, []);
  return pdfMergeQueue.get(chatId);
}

async function mergePdfsToBuffer(filePaths) {
  const merged = await PDFDocument.create();

  for (const fp of filePaths) {
    const bytes = fs.readFileSync(fp);
    const src = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach(p => merged.addPage(p));
  }

  const outBytes = await merged.save();
  return Buffer.from(outBytes);
}

// =================================================================
// HELPER: RINGKAS TEKS SEDERHANA (OFFLINE, TANPA API)
// =================================================================
function summarizeText(rawText, maxSentences = 3) {
    if (!rawText) return "";

    // Normalisasi
    let text = rawText.replace(/\s+/g, " ").trim();
    if (!text) return "";

    // Split ke kalimat (sederhana)
    const sentences = text
        .split(/(?<=[.!?…])/u) // pisah di titik/tanda tanya/tanda seru
        .map(s => s.trim())
        .filter(Boolean);

    if (sentences.length <= maxSentences) {
        return text; // sudah pendek
    }

    // Hitung frekuensi kata (ID + EN, buang stopword umum)
    const stopwords = new Set([
        "dan","yang","di","ke","dari","untuk","dengan","atau","pada","itu","ini",
        "the","a","an","of","to","in","on","for","and","or","is","are","was","were",
        "sebagai","dalam","karena","juga","sudah","telah","bahwa","ada","tidak","bukan",
        "akan","dapat","mungkin","jika","agar","bagi","oleh","dengan"
    ]);

    const wordFreq = {};
    const words = text
        .toLowerCase()
        .replace(/[^a-zA-Z0-9\u00C0-\u024f\u1E00-\u1EFF ]/g, " ")
        .split(/\s+/)
        .filter(w => w && !stopwords.has(w));

    for (const w of words) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
    }

    // Skor tiap kalimat = jumlah frekuensi kata penting di kalimat itu
    const sentenceScores = sentences.map((s, idx) => {
        const wList = s
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\u00C0-\u024f\u1E00-\u1EFF ]/g, " ")
            .split(/\s+/)
            .filter(Boolean);

        let score = 0;
        for (const w of wList) {
            if (wordFreq[w]) score += wordFreq[w];
        }
        return { idx, sentence: s, score };
    });

    // Urutkan berdasarkan skor, ambil top N, lalu kembalikan sesuai urutan awal
    sentenceScores.sort((a, b) => b.score - a.score);
    const selected = sentenceScores.slice(0, maxSentences).sort((a, b) => a.idx - b.idx);

    return selected.map(s => s.sentence).join(" ");
}

// =================================================================
// HELPER: PARAFRASE TEKS SEDERHANA (OFFLINE)
// =================================================================
function paraphraseText(rawText) {
    if (!rawText) return "";

    // Normalisasi spasi
    let text = rawText.replace(/\s+/g, " ").trim();
    if (!text) return "";

    // Beberapa pola frasa umum (ID & sedikit EN)
    const phraseReplacements = [
        { from: /\bmenurut saya\b/gi,        to: "dari sudut pandang saya" },
        { from: /\bmenurut kami\b/gi,        to: "dari sudut pandang kami" },
        { from: /\bmenurut\b/gi,             to: "berdasarkan pandangan" },
        { from: /\bkesimpulannya\b/gi,       to: "dapat disimpulkan bahwa" },
        { from: /\bdengan demikian\b/gi,     to: "oleh karena itu" },
        { from: /\bnamun\b/gi,               to: "meskipun demikian" },
        { from: /\bsehingga\b/gi,            to: "hingga pada akhirnya" },
        { from: /\bkarena\b/gi,              to: "sebab" },
        { from: /\bhal ini\b/gi,             to: "situasi ini" },
        { from: /\bcontohnya\b/gi,           to: "sebagai contoh" },
        { from: /\bmisalnya\b/gi,            to: "sebagai ilustrasi" },
        { from: /\bjadi\b/gi,                to: "dengan demikian" },
        { from: /\bpenting\b/gi,             to: "krusial" },
        { from: /\bmasalah\b/gi,             to: "permasalahan" },
        { from: /\bsolusi\b/gi,              to: "pemecahan masalah" },
        { from: /\btujuan\b/gi,              to: "sasaran" },
        { from: /\bmeningkatkan\b/gi,        to: "mengoptimalkan" },
        { from: /\bmenurunkan\b/gi,          to: "mengurangi" },
        { from: /\bdigunakan\b/gi,           to: "dipakai" },
        { from: /\bmenggunakan\b/gi,         to: "memanfaatkan" },
        { from: /\bsecara umum\b/gi,         to: "pada garis besarnya" },
        { from: /\bsecara khusus\b/gi,       to: "lebih spesifiknya" },

        // sedikit English
        { from: /\bin conclusion\b/gi,       to: "in summary" },
        { from: /\btherefore\b/gi,           to: "as a result" },
        { from: /\bbecause\b/gi,             to: "due to the fact that" },
    ];

    // Terapkan penggantian frasa
    for (const { from, to } of phraseReplacements) {
        text = text.replace(from, to);
    }

    // Pecah ke kalimat untuk sedikit variasi (acak ringan)
    const sentences = text
        .split(/(?<=[.!?…])\s+/u)
        .map(s => s.trim())
        .filter(Boolean);

    if (sentences.length <= 1) {
        return text;
    }

    // Acak urutan ringan tapi tetap relatif dekat aslinya
    // (bukan shuffle total supaya makna tidak terlalu acak)
    const reordered = [...sentences];

    if (reordered.length >= 3) {
        // tukar kalimat 2 dan 3 sebagai variasi
        const tmp = reordered[1];
        reordered[1] = reordered[2];
        reordered[2] = tmp;
    }

    return reordered.join(" ");
}

// =================================================================
// BRAT TEXT FORMATTER (ACAK BARIS & SPASI, TIDAK UBAH KAPITAL)
// =================================================================
function bratifyText(raw) {
    if (!raw) return "";

    const words = raw.trim().split(/\s+/);
    const lines = [];
    let i = 0;

    while (i < words.length) {
        const remain = words.length - i;
        const take = Math.min(remain, 2 + Math.floor(Math.random() * 3)); // 2–4 kata

        let slice = words.slice(i, i + take);

        for (let j = 0; j < slice.length - 1; j++) {
            if (Math.random() < 0.35) {
                slice[j] = slice[j] + "  ";
            }
        }

        lines.push(slice.join(" "));
        i += take;
    }

    return lines.join("\n");
}

// =================================================================
// TEXT TO SPEECH
// =================================================================
async function generateTTS(text, lang = "id") {
    const url =
        `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
            text
        )}&tl=${lang}&client=tw-ob`;

    const res = await axios.get(url, {
        responseType: "arraybuffer",
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
    });

    return Buffer.from(res.data);
}

// =================================================================
// AUTO EMOJI REACTION (SMART MODE)
// =================================================================
function getSmartEmojiReaction(text) {
    if (!text) return null;

    const lower = text.toLowerCase();

    // 1) Ketawa / bercanda
    if (
        lower.includes("wkwk") ||
        lower.includes("wk wk") ||
        lower.includes("haha") ||
        lower.includes("hahaha") ||
        lower.includes("🤣") ||
        lower.includes("😂")
    ) {
        return "😂";
    }

    // 2) Ucapan terima kasih
    if (
        lower.includes("makasih") ||
        lower.includes("terima kasih") ||
        lower.includes("thanks") ||
        lower.includes("thank you") ||
        lower.includes("tengkyu")
    ) {
        return "❤️";
    }

    // 3) Pujian / keren
    if (
        lower.includes("mantap") ||
        lower.includes("mantabs") ||
        lower.includes("gg") ||
        lower.includes("keren") ||
        lower.includes("hebat") ||
        lower.includes("nice") ||
        lower.includes("good job")
    ) {
        return "🔥";
    }

    // 4) Sedih / capek / curhat
    if (
        lower.includes("capek") ||
        lower.includes("cape") ||
        lower.includes("lelah") ||
        lower.includes("sedih") ||
        lower.includes("pusing") ||
        lower.includes("stress") ||
        lower.includes("stres") ||
        lower.includes("😭") ||
        lower.includes("😢")
    ) {
        return "😢";
    }

    // 5) Salam / sapaan
    if (
        lower.startsWith("assalamu") ||
        lower.startsWith("assala") ||
        lower.includes("assalamu'alaikum") ||
        lower.includes("assalamualaikum")
    ) {
        return "🤲";
    }
    if (
        lower.includes("pagi") ||
        lower.includes("good morning")
    ) {
        return "🌤️";
    }
    if (
        lower.includes("siang") ||
        lower.includes("good afternoon")
    ) {
        return "☀️";
    }
    if (
        lower.includes("malam") ||
        lower.includes("good night") ||
        lower.includes("gn")
    ) {
        return "🌙";
    }

    // 6) Tanya / bingung
    if (lower.includes("?")) {
        return "🤔";
    }

    // 7) Nyebut bot
    if (
        lower.includes("bangbot") ||
        lower.includes("bang bot") ||
        lower.includes("bot")
    ) {
        return "🤖";
    }

    // default: kadang kasih jempol
    if (lower.length > 0 && lower.length < 12) {
        // pesan pendek, cocok buat 👍
        return "👍";
    }

    return null;
}

// =================================================================
// QR DECODER
// =================================================================
async function decodeQrFromBuffer(buffer) {
  // Loader Jimp kompatibel
  const JimpPkg = require("jimp");
  const Jimp = JimpPkg.Jimp || JimpPkg;

  const img = await (Jimp.read ? Jimp.read(buffer) : JimpPkg.read(buffer));

  // Resize kompatibel (Jimp lama: resize(w,h), Jimp baru: resize({w,h}))
  try {
    if (typeof img.resize === "function") {
      if (img.resize.length >= 2) {
        // Jimp lama
        img.resize(800, Jimp.AUTO);
      } else {
        // Jimp baru (object)
        img.resize({ w: 800 });
      }
    }
  } catch (e) {
    // Kalau resize gagal, lanjut tanpa resize
  }

  // Preprocess biar QR lebih kebaca
  if (typeof img.greyscale === "function") img.greyscale();
  if (typeof img.contrast === "function") img.contrast(0.6);

  const { data, width, height } = img.bitmap;

  const qr = new QrCodeReader();
  const value = await new Promise((resolve, reject) => {
    qr.callback = (err, v) => (err ? reject(err) : resolve(v));
    qr.decode({ data, width, height });
  });

  const result = value?.result ? String(value.result).trim() : "";
  if (!result) throw new Error("QR_EMPTY");

  return result;
}

function safeErr(err) {
  try {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (err instanceof Error) return err.stack || err.message || String(err);
    // axios error
    if (err.response?.status) {
      return `HTTP ${err.response.status} ${err.response.statusText || ""} - ${JSON.stringify(err.response.data).slice(0, 300)}`;
    }
    return JSON.stringify(err, Object.getOwnPropertyNames(err)).slice(0, 500);
  } catch {
    return String(err);
  }
}

// =========================================================
// CRYPTO PRICE (CoinGecko) — realtime + cache
// Command: !crypto btc  |  !crypto eth  |  !crypto sol
// =========================================================
const CRYPTO_CACHE = new Map(); // key: coinId, value: { ts:number, data:any }
const CRYPTO_CACHE_TTL_MS = 10_000; // 10 detik (hindari rate limit)

const CRYPTO_MAP = {
    btc: "bitcoin",
    bitcoin: "bitcoin",
    eth: "ethereum",
    ethereum: "ethereum",
    sol: "solana",
    solana: "solana",
    bnb: "binancecoin",
    ada: "cardano",
    doge: "dogecoin",
    xrp: "ripple",
    link: "chainlink",
    dot: "polkadot",
    matic: "matic-network",
    arb: "arbitrum",
    op: "optimism"
};

function fmtNumber(n, locale = "id-ID", digits = 0) {
    try {
        return Number(n).toLocaleString(locale, { maximumFractionDigits: digits });
    } catch {
        return String(n);
    }
}

async function getCryptoPrice(coinId) {
    const now = Date.now();
    const cached = CRYPTO_CACHE.get(coinId);
    if (cached && (now - cached.ts) < CRYPTO_CACHE_TTL_MS) return cached.data;

    const url = "https://api.coingecko.com/api/v3/simple/price";
    const res = await axios.get(url, {
        params: {
            ids: coinId,
            vs_currencies: "usd,idr",
            include_24hr_change: "true"
        },
        timeout: 15000,
        headers: {
            "User-Agent": "BangBot/1.0"
        }
    });

    const data = res.data?.[coinId];
    if (!data) throw new Error("CRYPTO_DATA_EMPTY");

    CRYPTO_CACHE.set(coinId, { ts: now, data });
    return data;
}

// =================================================================
// YT-DLP Downloader
// =================================================================
function downloadWithYtDlp(url, outPath, opts = { audioOnly: false }) {
    return new Promise((resolve, reject) => {
        let cmd;
        if (opts.audioOnly) {
            cmd = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 -o "${outPath}" "${url}"`;
        } else {
            cmd = `yt-dlp -f "mp4" -o "${outPath}" "${url}"`;
        }

        exec(cmd, (err) => {
            if (err) return reject(err);
            resolve(outPath);
        });
    });
}

// =================================================================
// NEWS SCRAPER (CNN Indonesia) — ambil berita terbaru
// =================================================================
async function getLatestNews(limit = 5) {
    try {
        // Ambil halaman utama CNN Indonesia
        const url = "https://www.cnnindonesia.com/";
        const res = await axios.get(url);
        const html = res.data;

        // Cari blok-blok artikel sederhana dengan regex
        // Catatan: ini scraping sederhana, bisa saja berubah kalau struktur web CNN berubah.
        const articleRegex = /<article[\s\S]*?<\/article>/gi;
        const matches = html.match(articleRegex) || [];

        const results = [];
        for (const block of matches) {
            // Judul
            const titleMatch = block.match(/title="([^"]+)"/i) ||
                               block.match(/<h2[^>]*>(.*?)<\/h2>/i) ||
                               block.match(/<h3[^>]*>(.*?)<\/h3>/i);

            // Link
            const linkMatch = block.match(/href="([^"]+)"/i);

            if (!titleMatch || !linkMatch) continue;

            let title = titleMatch[1]
                .replace(/<[^>]+>/g, "")   // hapus tag HTML
                .replace(/\s+/g, " ")      // normalkan spasi
                .trim();

            let link = linkMatch[1].trim();
            if (link.startsWith("//")) {
                link = "https:" + link;
            } else if (link.startsWith("/")) {
                link = "https://www.cnnindonesia.com" + link;
            }

            results.push({ title, link });

            if (results.length >= limit) break;
        }

        return results;
    } catch (err) {
        console.error("getLatestNews error:", err);
        return [];
    }
}

// =================================================================
// SPAM CHECK (per user)
// =================================================================
function checkCooldown(key) {
    const now = Date.now();
    const last = lastCommandTime.get(key) || 0;
    if (now - last < COOLDOWN_MS) return false;
    lastCommandTime.set(key, now);
    return true;
}

// =================================================================
// HELPER: AMBIL MEDIA DARI REPLY (image / video / sticker / doc-image)
// =================================================================
async function getQuotedMediaBuffer(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (!quoted) return null;

    // Urutan prioritas: image, video, sticker, document-image
    if (quoted.imageMessage) {
        return await downloadMediaMessage(
            { message: { imageMessage: quoted.imageMessage } },
            "buffer"
        );
    }

    if (quoted.videoMessage) {
        return await downloadMediaMessage(
            { message: { videoMessage: quoted.videoMessage } },
            "buffer"
        );
    }

    if (quoted.stickerMessage) {
        return await downloadMediaMessage(
            { message: { stickerMessage: quoted.stickerMessage } },
            "buffer"
        );
    }

    if (quoted.documentMessage && quoted.documentMessage.mimetype?.includes("image")) {
        return await downloadMediaMessage(
            { message: { documentMessage: quoted.documentMessage } },
            "buffer"
        );
    }

    return null;
}

// =================================================================
// HELPER: AUDIO EFFECT DARI REPLY (VOICE NOTE / AUDIO)
// =================================================================
async function processQuotedAudioEffect(msg, sock, from, filter, opts = {}) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedAud = ctx?.quotedMessage?.audioMessage;

    if (!quotedAud) {
        await sock.sendMessage(from, {
            text: opts.help || "Reply ke *audio/voice note* yang mau diubah, Bang."
        });
        return;
    }

    const buf = await downloadMediaMessage(
        { message: ctx.quotedMessage },
        "buffer"
    );

    const inPath = `./aud_in_${Date.now()}.ogg`;
    const outPath = `./aud_out_${Date.now()}.mp3`;

    try {
        fs.writeFileSync(inPath, buf);

        let ffCmd;
        if (filter && filter.trim()) {
            // contoh filter: bass=g=10,volume=4dB  (TANPA spasi)
            ffCmd =
                `ffmpeg -y -i "${inPath}" -af ${filter} -vn ` +
                `-acodec libmp3lame -qscale:a 4 "${outPath}"`;
        } else {
            ffCmd =
                `ffmpeg -y -i "${inPath}" -vn ` +
                `-acodec libmp3lame -qscale:a 4 "${outPath}"`;
        }

        await execAsync(ffCmd);

        const audio = fs.readFileSync(outPath);

        await sock.sendMessage(from, {
            audio,
            mimetype: "audio/mpeg",
            ptt: !!opts.ptt,
            caption: opts.caption || ""
        });

    } catch (err) {
        console.error("Audio effect error:", err);
        await sock.sendMessage(from, {
            text: "Gagal memproses audio, Bang."
        });
    } finally {
        if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
}

// =================================================================
// HELPER: CEK ADMIN GRUP
// =================================================================
async function isGroupAdmin(sock, groupJid, userJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const participants = meta.participants || [];
        const p = participants.find((m) => m.id === userJid);
        if (!p) return false;
        return p.admin === "admin" || p.admin === "superadmin";
    } catch (err) {
        console.error("isGroupAdmin error:", err);
        return false;
    }
}

async function isBotAdmin(sock, groupJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const participants = meta.participants || [];
        const me = participants.find((m) => m.id === sock.user.id);
        if (!me) return false;
        return me.admin === "admin" || me.admin === "superadmin";
    } catch (err) {
        console.error("isBotAdmin error:", err);
        return false;
    }
}

// =====================================================================
// SHORT URL
// =====================================================================
async function shortenWithBitly(axios, longUrl) {
  const token = process.env.BITLY_TOKEN;
  if (!token) throw new Error("BITLY_TOKEN not set");

  const res = await axios.post(
    "https://api-ssl.bitly.com/v4/shorten",
    { long_url: longUrl },
    {
      timeout: 20000,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "BangBot/1.0"
      }
    }
  );

  if (!res.data || !res.data.link) {
    throw new Error("Bitly invalid response");
  }

  return res.data.link;
}

// =====================================================================
// HELPER SSWEB
// =====================================================================
async function fetchWebsiteScreenshot(axios, url) {
  // thum.io: format PATH, tapi harus aman untuk '?' dan '#'
  const urlForPath = url
    .replace(/%/g, "%25")
    .replace(/\?/g, "%3F")
    .replace(/#/g, "%23");

  const tries = [
    // Lebih tajam: width besar
    `https://image.thum.io/get/width/1920/${urlForPath}`,
    `https://image.thum.io/get/width/2560/${urlForPath}`,

    // Full (kadang tetap kompres)
    `https://image.thum.io/get/full/${urlForPath}`,

    // Query fallback
    `https://image.thum.io/get/width/1920/?url=${encodeURIComponent(url)}`,
  ];

  let lastErr;
  for (const apiUrl of tries) {
    try {
      const res = await axios.get(apiUrl, {
        timeout: 30000,
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
          "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
        },
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      const ct = String(res.headers?.["content-type"] || "");
      if (!ct.startsWith("image/")) {
        throw new Error(`NOT_IMAGE:${ct || "unknown"}`);
      }

      return Buffer.from(res.data);
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr || new Error("SSWEB_FAIL");
}

// =====================================================================
// HELPER Summarize
// =====================================================================
function summarizeTextStrict(text, maxRatio = 0.45) {
  if (!text || typeof text !== "string") return "";

  const clean = text.replace(/\s+/g, " ").trim();

  // Pecah kalimat
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [];
  if (sentences.length <= 2) return clean; // sudah pendek

  // Kata kunci akademik
  const keywords = [
    "didefinisikan", "merupakan", "adalah",
    "diklasifikasikan", "dibedakan",
    "fusion welding", "solid state",
    "pengelasan", "proses"
  ];

  // Skoring kalimat
  const scored = sentences.map(s => {
    let score = 0;
    for (const k of keywords) {
      if (s.toLowerCase().includes(k)) score++;
    }
    return { s: s.trim(), score };
  });

  // Ambil kalimat skor tertinggi
  scored.sort((a, b) => b.score - a.score);

  let result = "";
  for (const item of scored) {
    if ((result + " " + item.s).length / clean.length > maxRatio) break;
    result += (result ? " " : "") + item.s;
  }

  // SAFETY: kalau masih hampir sama → potong manual
  if (result.length / clean.length > 0.7) {
    result = sentences.slice(0, Math.ceil(sentences.length / 2)).join(" ");
  }

  return result.trim();
}

// =====================================================================
// GENERIC MULTI-DOWNLOADER HELPER (IG, TT, X/TWITTER, dll.)
// =====================================================================

// (opsional) helper kecil buat reaction biar tidak nulis berulang
async function reactEmoji(sock, msg, emoji) {
    try {
        await sock.sendMessage(msg.key.remoteJid, {
            react: { text: emoji, key: msg.key }
        });
    } catch (e) {
        console.error("Gagal kirim reaction:", e);
    }
}

// Ambil buffer dari URL
async function fetchBuffer(url) {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    return Buffer.from(res.data);
}

// Normalisasi struktur JSON downloader jadi array media { type, url }
function normalizeMedias(raw) {
    if (!raw) return [];

    // Kalau API langsung array
    if (Array.isArray(raw)) return normalizeMedias({ medias: raw });

    let list = [];

    // Banyak API pakai "medias" atau "media"
    if (Array.isArray(raw.medias)) {
        list = raw.medias;
    } else if (Array.isArray(raw.media)) {
        list = raw.media;
    } else {
        // Fallback single object
        const single = [];
        if (raw.video) single.push({ type: "video", url: raw.video });
        if (raw.image) single.push({ type: "image", url: raw.image });
        if (raw.photo) single.push({ type: "image", url: raw.photo });
        list = single;
    }

    const result = [];

    for (const m of list) {
        if (!m) continue;

        const link =
            m.url ||
            m.download_url ||
            m.image ||
            m.video ||
            m.photo ||
            m.src ||
            m.link ||
            "";

        if (!link || typeof link !== "string" || !link.startsWith("http")) continue;

        const t = (m.type || m.kind || m.media_type || "").toLowerCase();

        if (t.includes("vid") || t.includes("gif")) {
            result.push({ type: "video", url: link });
        } else if (t.includes("img") || t.includes("photo") || t.includes("image")) {
            result.push({ type: "image", url: link });
        } else {
            // default → asumsikan image
            result.push({ type: "image", url: link });
        }
    }

    return result;
}

// Kirim semua media (foto → album / video) ke chat
async function sendMediasAsAlbum(sock, from, medias, label, originalUrl) {
    const photos = medias.filter(m => m.type === "image");
    const videos = medias.filter(m => m.type === "video");

    if (!photos.length && !videos.length) {
        await sock.sendMessage(from, {
            text: "Tidak ada media valid yang bisa dikirim."
        });
        return;
    }

    // FOTO (album)
    if (photos.length) {
        let idx = 0;
        for (const item of photos) {
            try {
                const buf = await fetchBuffer(item.url);
                await sock.sendMessage(from, {
                    image: buf,
                    caption:
                        idx === 0
                            ? `${label}\n${originalUrl}\nTotal foto: ${photos.length}`
                            : undefined
                });
                idx++;
            } catch (e) {
                console.error("Gagal kirim foto:", e);
            }
        }
    }

    // VIDEO (ambil satu terbaik dulu)
    if (videos.length) {
        try {
            const v = videos[0];
            const buf = await fetchBuffer(v.url);
            await sock.sendMessage(from, {
                video: buf,
                caption: `${label} (video)\n${originalUrl}`
            });
        } catch (e) {
            console.error("Gagal kirim video:", e);
        }
    }
}

// Handler generic yang dipanggil dari command
async function handleGenericDownloader(sock, from, msg, {
    apiUrl,
    originalUrl,
    label
}) {
    await reactEmoji(sock, msg, "🕑");

    try {
        const res = await axios.get(apiUrl, { timeout: 30000 });
        const data = res.data;

        const medias = normalizeMedias(data);

        if (!medias.length) {
            await sock.sendMessage(from, {
                text: `Gagal mengambil media dari ${label}. Respon kosong / tidak terduga.`
            });
            await reactEmoji(sock, msg, "❌");
            return;
        }

        await sendMediasAsAlbum(sock, from, medias, label, originalUrl);
        await reactEmoji(sock, msg, "✅");

    } catch (err) {
        console.error(`Downloader error [${label}]:`, err);
        await sock.sendMessage(from, {
            text: `Gagal download dari ${label}. Coba lagi nanti atau cek URL.`
        });
        await reactEmoji(sock, msg, "❌");
    }
}

// =========================================================
// HELPER: X / Twitter via yt-dlp (video + photo + multi)
// =========================================================
async function handleXWithYtDlp(sock, from, msg, url) {

    const outDir = path.join(__dirname, "downloads");
    try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

    // sanitize (jaga-jaga kalau masih ada "!x " nyangkut)
    url = String(url || "").trim().replace(/^!x\s+/i, "").replace(/^!twitter\s+/i, "");

    const stamp = Date.now();
    // autonumber supaya jika ada banyak media (multi photo/video) semua tersimpan rapi
    const outputTpl = path.join(outDir, `x_${stamp}_%(autonumber)02d.%(ext)s`);

    const isImageExt = (ext) => ["jpg", "jpeg", "png", "webp"].includes(ext);
    const isVideoExt = (ext) => ["mp4", "mkv", "webm", "mov"].includes(ext);

    try {
        await sock.sendMessage(from, { text: "Proses Bang!" }, { quoted: msg });

        // Jangan pakai -f mp4, karena foto tidak akan ikut.
        // Biarkan yt-dlp ambil media terbaik (photo/video) yang tersedia.
        await execPromise(`yt-dlp --no-playlist -o "${outputTpl}" "${url}"`);

        // Ambil semua file hasil download untuk stamp ini
        const files = fs.readdirSync(outDir)
            .filter(f => f.startsWith(`x_${stamp}_`))
            // sortir supaya urutan 01,02,03...
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        if (!files.length) {
            throw new Error("Tidak ada file hasil download.");
        }

        // Kirim satu per satu (aman untuk berbagai tipe media)
        for (let i = 0; i < files.length; i++) {
            const fp = path.join(outDir, files[i]);
            const ext = (path.extname(fp).slice(1) || "").toLowerCase();
            const buf = fs.readFileSync(fp);

            if (isImageExt(ext)) {
                await sock.sendMessage(from, { image: buf, caption: i === 0 ? "Selesai Bang!" : undefined }, { quoted: msg });
            } else if (isVideoExt(ext)) {
                await sock.sendMessage(from, { video: buf, caption: i === 0 ? "Selesai Bang!" : undefined }, { quoted: msg });
            } else {
                // fallback: kirim sebagai dokumen jika ekstensi tidak dikenali
                await sock.sendMessage(from, { document: buf, fileName: files[i] }, { quoted: msg });
            }

            // jeda kecil agar tidak “spammy”
            await new Promise(r => setTimeout(r, 700));

            // hapus file setelah terkirim
            try { fs.unlinkSync(fp); } catch {}
        }
    } catch (err) {
        const msgErr = String(err?.message || err || "");
        console.error("[X Downloader Error]", msgErr);

        // Fallback: tweet foto / tidak ada video
        if (/No video could be found in this tweet/i.test(msgErr)) {
            return handleXWithGalleryDl(sock, from, msg, url);
        }

        await sock.sendMessage(from, {
            text: "❌ Gagal download dari X / Twitter.\nPastikan tweet publik & coba lagi."
        }, { quoted: msg });
    }
}

// =========================================================
// HELPER: X / Twitter via gallerydl
// =========================================================
async function handleXWithGalleryDl(sock, from, msg, url) {
  const stamp = Date.now();
  const outDir = path.join(__dirname, "downloads", `xg_${stamp}`);
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

  const isImageExt = (ext) => ["jpg","jpeg","png","webp"].includes(ext);
  const isVideoExt = (ext) => ["mp4","mkv","webm","mov"].includes(ext);

  try {
    // gallery-dl harus terinstall & ada di PATH
    await execPromise(`gallery-dl -D "${outDir}" "${url}"`);

    const files = listFilesRecursive(outDir)
      .filter(fp => fs.existsSync(fp) && fs.statSync(fp).isFile())
      .sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));

    if (!files.length) throw new Error("Tidak ada file hasil gallery-dl.");

    for (let i = 0; i < files.length; i++) {
      const fp = files[i];
      const ext = (path.extname(fp).slice(1) || "").toLowerCase();
      const buf = fs.readFileSync(fp);

      if (isImageExt(ext)) {
        await sock.sendMessage(from, { image: buf, caption: i === 0 ? "Selesai Bang!" : undefined }, { quoted: msg });
      } else if (isVideoExt(ext)) {
        await sock.sendMessage(from, { video: buf, caption: i === 0 ? "Selesai Bang!" : undefined }, { quoted: msg });
      } else {
        await sock.sendMessage(from, { document: buf, fileName: path.basename(fp) }, { quoted: msg });
      }

      await new Promise(r => setTimeout(r, 700));
      try { fs.unlinkSync(fp); } catch {}
    }

    // bersihkan folder kosong (opsional, aman)
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  } catch (err) {
    console.error("[X GalleryDL Error]", err?.message || err);
    await sock.sendMessage(from, { text: "❌ Gagal ambil media via gallery-dl. Pastikan gallery-dl terinstall & tweet publik." }, { quoted: msg });
  }
}

// =========================================================
// HELPER: TIKTOK VIA TIKMATE (NO WATERMARK)
// return: { ok: boolean, id: string | null }
// =========================================================
async function handleTikTokViaTikMate(sock, from, msg, ttUrl) {
    try {
        const lookupUrl = `https://api.tikmate.app/api/lookup?url=${encodeURIComponent(ttUrl)}`;
        const { data } = await axios.get(lookupUrl, { timeout: 20000 });

        if (!data || !data.token || !data.id) {
            console.error("TikMate lookup invalid:", data);
            await sock.sendMessage(from, {
                text: "Gagal mengambil data TikTok dari TikMate (token / id kosong)."
            }, { quoted: msg });
            return { ok: false, id: null };
        }

        const token = data.token;
        const vidID = data.id;

        const videoUrl = `https://tikmate.app/download/${token}/${vidID}.mp4?h=1`;

        await sock.sendMessage(from, {
            video: { url: videoUrl },
            caption: `Selesai Bang!\nSumber: ${ttUrl}`
        }, { quoted: msg });

        return { ok: true, id: vidID };
    } catch (e) {
        console.error("TikMate Error:", e?.response?.data || e?.message || e);
        // Tidak kirim pesan gagal di sini, biar bisa lanjut ke backup
        return { ok: false, id: null };
    }
}

// =========================================================
// HELPER: TIKTOK VIA TIKCDN (BACKUP SERVER)
// =========================================================
async function handleTikTokViaTikcdn(sock, from, msg, ttUrl, vidIDFromTikMate) {
    try {
        // 1) Tentukan video_id
        let videoId = vidIDFromTikMate || null;

        if (!videoId) {
            // Coba ambil dari URL TikTok: .../video/7579162142369139988
            const m = ttUrl.match(/video\/(\d+)/);
            if (m && m[1]) {
                videoId = m[1];
            }
        }

        if (!videoId) {
            await sock.sendMessage(from, {
                text: "Backup server gagal: tidak bisa membaca video_id dari URL."
            }, { quoted: msg });
            return false;
        }

        // 2) Bangun URL TikCDN
        const backupUrl = `https://tikcdn.io/ssstik/${videoId}`;

        console.log("TikTok TikCDN backup:", backupUrl);

        // 3) Request video ke TikCDN
        const resp = await axios.get(backupUrl, {
            responseType: "arraybuffer",
            timeout: 20000,
            headers: {
                // TikCDN biasanya butuh User-Agent browser biasa :contentReference[oaicite:2]{index=2}
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "video/mp4,video/*;q=0.9,*/*;q=0.8"
            }
        });

        const contentType = (resp.headers["content-type"] || "").toLowerCase();
        const buffer = Buffer.from(resp.data);
        const caption = `Selesai Bang!\nSumber: ${ttUrl}`;

        if (contentType.startsWith("video")) {
            await sock.sendMessage(from, {
                video: buffer,
                caption
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, {
                document: buffer,
                mimetype: contentType || "application/octet-stream",
                fileName: `${videoId}.bin`,
                caption
            }, { quoted: msg });
        }

        return true;
    } catch (e) {
        console.error("TikCDN backup error:", e?.response?.data || e?.message || e);
        return false;
    }
}

// =========================================================
// HELPER: GENERIC PINTEREST DOWNLOADER VIA API BINARY
// apiBase = base URL API pihak ketiga, misalnya:
//   https://klickpin.com/api?url=
//   https://pindown.net/download?url=
// =========================================================
async function handlePinterestViaApi(sock, from, msg, pinUrl, apiBase, label) {
    if (!apiBase) return false; // belum diset di .env

    const apiUrl = `${apiBase}${encodeURIComponent(pinUrl)}`;
    console.log(`[Pinterest] Hit API: ${apiUrl}`);

    try {
        const resp = await axios.get(apiUrl, {
            responseType: "arraybuffer",
            timeout: 20000,
            headers: {
                // beberapa downloader minta UA browser
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*"
            }
        });

        const contentType = (resp.headers["content-type"] || "").toLowerCase();
        const buffer = Buffer.from(resp.data);
        const caption = `${label}\nSumber: ${pinUrl}`;

        if (contentType.startsWith("video")) {
            await sock.sendMessage(from, {
                video: buffer,
                caption
            }, { quoted: msg });
        } else if (contentType.startsWith("image")) {
            await sock.sendMessage(from, {
                image: buffer,
                caption
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, {
                document: buffer,
                mimetype: contentType || "application/octet-stream",
                fileName: `${label.replace(/\s+/g, "_").toLowerCase()}.bin`,
                caption
            }, { quoted: msg });
        }

        return true;
    } catch (e) {
        console.error(`[Pinterest] Error call ${apiUrl}:`, e?.message || e);
        return false;
    }
}

// =========================================================
// HELPER: PINTEREST PRIMARY + BACKUP (KlickPin / PinDown)
// =========================================================
/**
 * Pinterest via gallery-dl (CLI)
 * - Download ke folder sementara, kirim media (foto/video) ke WhatsApp
 * - Caption: best-effort metadata dari `gallery-dl -j`
 */
async function handlePinterestViaGalleryDl(sock, from, msg, pinUrl) {
    const outputFolder = path.join(__dirname, `pin_${Date.now()}`);
    try { fs.mkdirSync(outputFolder, { recursive: true }); } catch (_) {}

    const collectFilesRecursive = (dir) => {
        let out = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) out = out.concat(collectFilesRecursive(full));
            else out.push(full);
        }
        return out;
    };

    const parseGalleryDlJsonLines = (raw) => {
        const lines = String(raw || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const objs = [];
        for (const line of lines) {
            if (!line.startsWith("{")) continue;
            try { objs.push(JSON.parse(line)); } catch (_) {}
        }
        return objs;
    };

    const buildPinCaption = (meta, url) => {
        const parts = [];

        const author =
            meta?.uploader ||
            meta?.pinner?.username ||
            meta?.user?.username ||
            meta?.account?.username ||
            meta?.author?.name ||
            meta?.author ||
            meta?.username;

        const title =
            meta?.title ||
            meta?.pin_title ||
            meta?.name;

        const desc =
            meta?.description ||
            meta?.desc ||
            meta?.caption ||
            meta?.text;

        if (author) parts.push(`👤 ${author}`);
        if (title) parts.push(`📝 ${title}`);

        if (desc) {
            const clean = String(desc).replace(/\s+/g, " ").trim();
            parts.push(clean.length > 700 ? (clean.slice(0, 700) + "…") : clean);
        }

        parts.push("");
        parts.push(url);

        return parts.join("\n").trim();
    };

    // meta (opsional)
    let metaCaption = `📌 Pinterest\n${pinUrl}`;
    try {
        const cmdMeta = `gallery-dl -j "${pinUrl}"`;
        const metaStdout = await new Promise((resolve) => {
            exec(cmdMeta, { windowsHide: true, maxBuffer: 25 * 1024 * 1024 }, (err, stdout, stderr) => {
                resolve(stdout || "");
            });
        });

        const metas = parseGalleryDlJsonLines(metaStdout);
        const pick = metas.find(o => o && (o.title || o.description || o.pinner || o.uploader || o.user || o.account)) || metas[0];
        if (pick) metaCaption = buildPinCaption(pick, pinUrl);
    } catch (e) {
        console.log("[PIN] Meta skip:", e?.message || e);
    }

    // download
    const cmdDownload = `gallery-dl -d "${outputFolder}" "${pinUrl}"`;
    console.log("[PIN] Run gallery-dl:", cmdDownload);

    await new Promise((resolve, reject) => {
        exec(cmdDownload, { windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) return reject(err);
            resolve(true);
        });
    });

    const allFiles = collectFilesRecursive(outputFolder)
        .filter(p => {
            const l = p.toLowerCase();
            return l.endsWith(".jpg") || l.endsWith(".jpeg") || l.endsWith(".png") || l.endsWith(".webp")
                || l.endsWith(".mp4") || l.endsWith(".mov") || l.endsWith(".m4v");
        });

    if (!allFiles.length) {
        try { if (fs.existsSync(outputFolder)) fs.rmSync(outputFolder, { recursive: true, force: true }); } catch (_) {}
        return false;
    }

    let sent = 0;
    for (const filePath of allFiles) {
        const buffer = fs.readFileSync(filePath);
        const lower = filePath.toLowerCase();
        const isVideo = lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".m4v");
        const content = isVideo ? { video: buffer } : { image: buffer };
        if (sent === 0 && metaCaption) content.caption = metaCaption;
        await sock.sendMessage(from, content, { quoted: msg });
        sent++;
    }

    // cleanup
    try { if (fs.existsSync(outputFolder)) fs.rmSync(outputFolder, { recursive: true, force: true }); } catch (_) {}
    return true;
}

async function handlePinterestWithFallback(sock, from, msg, pinUrl) {
    // 0) Prioritas: gallery-dl (lebih stabil, tidak tergantung web downloader pihak ketiga)
    try {
        const okCli = await handlePinterestViaGalleryDl(sock, from, msg, pinUrl);
        if (okCli) return true;
    } catch (e) {
        console.error("[PIN] gallery-dl fail:", e?.message || e);
    }

    // 1) Fallback: API primary (kalau diset di .env)
    if (PINTEREST_PRIMARY_API) {
        let ok = await handlePinterestViaApi(
            sock,
            from,
            msg,
            pinUrl,
            PINTEREST_PRIMARY_API,
            "Pinterest (primary)"
        );
        if (ok) return true;
    }

    // 2) Fallback: API backup (kalau diset di .env)
    if (PINTEREST_BACKUP_API) {
        const ok = await handlePinterestViaApi(
            sock,
            from,
            msg,
            pinUrl,
            PINTEREST_BACKUP_API,
            "Pinterest (backup)"
        );
        if (ok) return true;
    }

    return false;
}

// =========================================================
// HELPER: INSTAGRAM VIA GALLERY-DL (FOTO & VIDEO)
// =========================================================

// Download semua media IG ke folder sementara pakai gallery-dl
async function downloadInstagramWithGalleryDl(igUrl) {
    return new Promise((resolve, reject) => {
        const outDir = path.join(__dirname, `ig_${Date.now()}`);
        fs.mkdirSync(outDir, { recursive: true });

        // Kalau gallery-dl tidak ada di PATH, bisa ganti:
        // const cmd = `python -m gallery_dl -d "${outDir}" "${igUrl}"`;
        const cmd = `gallery-dl -d "${outDir}" "${igUrl}"`;

        console.log("[IG] Run gallery-dl:", cmd);

        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.error("[IG] gallery-dl error:", err);
                console.error("[IG] stdout:", stdout);
                console.error("[IG] stderr:", stderr);
                return reject(err);
            }

            try {
                const files = fs
                    .readdirSync(outDir)
                    .map((name) => path.join(outDir, name))
                    .filter((p) => fs.statSync(p).isFile());

                resolve({ outDir, files });
            } catch (e) {
                reject(e);
            }
        });
    });
}

// Versi baru, tapi tetap pakai nama lama agar pemanggil tidak perlu diubah
async function handleInstagramViaIgDownloader(sock, from, msg, igUrl) {
    await reactEmoji(sock, msg, "🕑");

    let tempDir = null;

    try {
        const { outDir, files } = await downloadInstagramWithGalleryDl(igUrl);
        tempDir = outDir;

        if (!files || files.length === 0) {
            await sock.sendMessage(from, {
                text: "Gagal mengunduh media Instagram (file kosong). Coba cek URL atau akun private."
            }, { quoted: msg });
            await reactEmoji(sock, msg, "❌");
            return;
        }

        let sentCount = 0;

        // Urutkan biar konsisten (nama file ascending)
        files.sort();

        for (const filePath of files) {
            const lower = filePath.toLowerCase();

            // Baca file
            const buf = fs.readFileSync(filePath);

            // Deteksi jenis: video atau gambar
            if (
                lower.endsWith(".mp4") ||
                lower.endsWith(".mov") ||
                lower.endsWith(".mkv") ||
                lower.endsWith(".webm")
            ) {
                await sock.sendMessage(from, {
                    video: buf,
                    caption:
                        sentCount === 0
                            ? `Instagram media (video)\n${igUrl}`
                            : undefined
                }, { quoted: msg });

                sentCount++;
            } else if (
                lower.endsWith(".jpg") ||
                lower.endsWith(".jpeg") ||
                lower.endsWith(".png") ||
                lower.endsWith(".webp")
            ) {
                await sock.sendMessage(from, {
                    image: buf,
                    caption:
                        sentCount === 0
                            ? `Instagram media (foto)\n${igUrl}\nTotal file: ${files.length}`
                            : undefined
                }, { quoted: msg });

                sentCount++;
            } else {
                // Tipe file lain di-skip saja
                console.log("[IG] Skip non media file:", filePath);
            }
        }

        if (sentCount === 0) {
            await sock.sendMessage(from, {
                text: "File berhasil diunduh tapi tidak ada foto/video yang bisa dikirim (format tidak dikenal)."
            }, { quoted: msg });
            await reactEmoji(sock, msg, "❌");
            return;
        }

        await reactEmoji(sock, msg, "✅");

    } catch (err) {
        console.error("[IG] Error:", err);
        await sock.sendMessage(from, {
            text: "Gagal mengunduh dari Instagram. Coba beberapa menit lagi, atau cek log terminal untuk detail error."
        }, { quoted: msg });
        await reactEmoji(sock, msg, "❌");
    } finally {
        // Bersihkan folder sementara
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                for (const name of fs.readdirSync(tempDir)) {
                    const p = path.join(tempDir, name);
                    if (fs.existsSync(p)) fs.unlinkSync(p);
                }
                fs.rmdirSync(tempDir);
            } catch (e) {
                console.error("[IG] Cleanup error:", e);
            }
        }
    }
}

// ================================
// KURS BI (RETRY + CACHE)
// ================================
async function fetchGempaTerkini() {
    const url = "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.xml";
    const res = await axios.get(url);
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(res.data);
    return result.Infogempa.gempa;
}

// ================================
// KURS BI (RETRY + CACHE)
// ================================

const BI_KURS_BASE = "https://www.bi.go.id/biwebservice/wskursbi.asmx";
const BI_KURS_ENDPOINT = `${BI_KURS_BASE}/getSubKursLokal2`; // Kurs Transaksi (jual/beli) by date
const KURS_CACHE_FILE = path.join(__dirname, "cache_kurs_bi.json");

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  timeout: 20000,
});

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isRetryableNetErr(err) {
  const code = err?.code || err?.cause?.code;
  return ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNABORTED"].includes(code);
}

async function axiosGetWithRetry(http, url, options = {}, retries = 4) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await http.get(url, options);
    } catch (e) {
      lastErr = e;
      if (!isRetryableNetErr(e) || i === retries - 1) break;
      // backoff: 0.8s, 1.6s, 3.2s, 6.4s ...
      await sleep(800 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

function saveKursCache(payload) {
  try {
    fs.writeFileSync(KURS_CACHE_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch {}
}

function loadKursCache() {
  try {
    if (!fs.existsSync(KURS_CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(KURS_CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function fetchKursBI(http) {
    // BI wsKursBI ASMX returns XML DataSet. Sometimes only schema is returned for a date (weekend/holiday),
    // or the field names differ (e.g., kurs_beli / kurs_jual). We:
    // 1) try multiple date formats,
    // 2) fallback up to 14 days back,
    // 3) infer field names from the returned schema if needed.

    const dateCandidates = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");

        dateCandidates.push(`${yyyy}-${mm}-${dd}`);
        dateCandidates.push(`${dd}-${mm}-${yyyy}`);
        dateCandidates.push(`${dd}/${mm}/${yyyy}`);
        dateCandidates.push(`${mm}/${dd}/${yyyy}`);
    }

    const parseXml = async (xmlText) => {
        return await xml2js.parseStringPromise(xmlText, {
            explicitArray: false,
            ignoreAttrs: true,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });
    };

    const asXmlString = (v) => {
        if (typeof v !== "string") return null;
        const t = v.trim();
        if (!t) return null;
        if (t.startsWith("<") && t.includes(">")) return t;
        return null;
    };

    const peelInnerXml = async (node) => {
        if (!node) return null;

        if (typeof node === "string") {
            const x = asXmlString(node);
            return x ? await parseXml(x) : null;
        }

        if (typeof node === "object") {
            if (typeof node._ === "string") {
                const x = asXmlString(node._);
                if (x) return await parseXml(x);
            }
            return node;
        }

        return null;
    };

    const inferFieldNamesFromSchema = (rawXml) => {
    // Extract xs:element name="..."
    const names = [];
    const reEl = /<xs:element\s+name="([^"]+)"/gi;
    let mm;
    while ((mm = reEl.exec(rawXml)) !== null) {
        names.push(mm[1]);
    }

    const pick = (predicates) => {
        for (const p of predicates) {
            const hit = names.find(n => p(n));
            if (hit) return hit;
        }
        return null;
    };

    // In this endpoint, columns often look like:
    // mts_subkurslokal, beli_subkurslokal, jual_subkurslokal, tgl_subkurslokal, ...
    const currencyKey = pick([
        n => /^mts(_|$)/i.test(n),                 // mts / mts_subkurslokal
        n => /_mts/i.test(n),
        n => /kode.*mata/i.test(n),
        n => /mata_?uang/i.test(n),
        n => /matauang/i.test(n),
        n => /currency/i.test(n),
        n => /symbol/i.test(n),
    ]);

    const buyKey = pick([
        n => /^beli(_|$)/i.test(n),                // beli / beli_subkurslokal
        n => /beli_/i.test(n),
        n => /kurs.*beli/i.test(n),
        n => /nilai.*beli/i.test(n),
        n => /nil.*beli/i.test(n),
        n => /buy/i.test(n),
    ]);

    const sellKey = pick([
        n => /^jual(_|$)/i.test(n),                // jual / jual_subkurslokal
        n => /jual_/i.test(n),
        n => /kurs.*jual/i.test(n),
        n => /nilai.*jual/i.test(n),
        n => /nil.*jual/i.test(n),
        n => /sell/i.test(n),
    ]);

    const midKey = pick([
        n => /tengah/i.test(n),
        n => /mid/i.test(n),
    ]);

    return { currencyKey, buyKey, sellKey, midKey, schemaNames: names.slice(0, 80) };
};


    const extractRows = (root, keysHint) => {
        const rows = [];

        const hasKey = (obj, key) => obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);

        const walk = (obj) => {
            if (!obj || typeof obj !== "object") return;

            const keys = Object.keys(obj);

            // Use hinted keys if available; otherwise use generic patterns.
            const cKey = keysHint?.currencyKey
                ? (hasKey(obj, keysHint.currencyKey) ? keysHint.currencyKey : null)
                : keys.find(k => /^(mts|kode|kode_mata_uang|matauang|mata_?uang|currency|symbol)(_|$)/i.test(k));

            const bKey = keysHint?.buyKey
                ? (hasKey(obj, keysHint.buyKey) ? keysHint.buyKey : null)
                : keys.find(k => /(beli|buy|kurs.*beli|nilai.*beli|nil.*beli)/i.test(k));

            const sKey = keysHint?.sellKey
                ? (hasKey(obj, keysHint.sellKey) ? keysHint.sellKey : null)
                : keys.find(k => /(jual|sell|kurs.*jual|nilai.*jual|nil.*jual)/i.test(k));

            if (cKey && bKey && sKey) rows.push(obj);

            for (const k of keys) walk(obj[k]);
        };

        walk(root);
        return rows;
    };

    let lastErr;

    for (const tgl of dateCandidates) {
        try {
            const res = await axiosGetWithRetry(
                http,
                BI_KURS_ENDPOINT,
                {
                    timeout: 20000,
                    httpsAgent,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
                        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
                        "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
                        "Referer": "https://www.bi.go.id/",
                    },
                    responseType: "text",
                    maxRedirects: 5,
                    params: { tgl }
                },
                4
            );

            const raw = String(res.data || "");
            const keysHint = inferFieldNamesFromSchema(raw);

            // 1) Parse envelope/dataset
            let parsed = await parseXml(raw);

            // 2) If SOAP: try find *Result node anywhere
            const findResultNode = (obj) => {
                if (!obj || typeof obj !== "object") return null;
                const keys = Object.keys(obj);
                for (const k of keys) if (/Result$/i.test(k)) return obj[k];
                for (const k of keys) {
                    const found = findResultNode(obj[k]);
                    if (found != null) return found;
                }
                return null;
            };

            let node = findResultNode(parsed) || parsed;

            // 3) Peel inner XML if present (_ or string)
            node = await peelInnerXml(node) || node;

            // 4) Extract rows using schema-inferred keys
            const rows = extractRows(node, keysHint);

            const normalize = (r) => {
    const getExact = (k) =>
        k && Object.prototype.hasOwnProperty.call(r, k) ? r[k] : null;

    return {
        currency: asText(getExact(keysHint.currencyKey)),
        buy: asText(getExact(keysHint.buyKey)),
        sell: asText(getExact(keysHint.sellKey)),
        date: asText(getExact(keysHint.dateKey)),
    };
};

const data = rows
.map(normalize).filter(x => x.currency && x.buy != null && x.sell != null);

            if (!data.length) {
                // If we only got schema with no data, try earlier dates.
                const hasDiffgram = /diffgram/i.test(raw);
                console.log("KURS BI PARSE_EMPTY", {
                    tgl,
                    hasDiffgram,
                    inferred: { currencyKey: keysHint.currencyKey, buyKey: keysHint.buyKey, sellKey: keysHint.sellKey },
                    schemaNamesSample: keysHint.schemaNames,
                    sample: raw.slice(0, 900)
                });
                throw new Error("PARSE_EMPTY");
            }

            const payload = {
                fetchedAt: new Date().toISOString(),
                source: "BI-wsKursBI",
                tglRequested: tgl,
                inferredKeys: { currencyKey: keysHint.currencyKey, buyKey: keysHint.buyKey, sellKey: keysHint.sellKey },
                data
            };

            saveKursCache(payload);
            return payload;
        } catch (e) {
            lastErr = e;
            continue;
        }
    }

    throw lastErr || new Error("KURS_BI_FETCH_FAIL");
}

// Contoh pemakaian di command !kurs
// (tempel di handler messages.upsert kamu)
function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    if (typeof v._ === "string") return v._.trim();
    if (typeof v["#text"] === "string") return v["#text"].trim();
  }
  return String(v).trim();
}

function toNumberLoose(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // Indonesia style: 15.678,90 -> 15678.90
  const idLike = s.includes(",") && s.includes(".");
  const normalized = idLike
    ? s.replace(/\./g, "").replace(",", ".")
    : s.replace(/,/g, "");

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function fmtIDRNumber(n) {
  if (n == null) return "-";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);
}

async function handleKursBI(sock, from, msg, axios) {
  await sock.sendMessage(from, { text: "Proses Bang!" }, { quoted: msg });

  try {
    const payload = await fetchKursBI(axios);

    // format ringkas: tampilkan beberapa mata uang umum dulu, sisanya opsional
    const pick = ["USD", "EUR", "SGD", "JPY", "AUD", "GBP"];
    const map = new Map(payload.data.map(r => [asText(r.currency).toUpperCase(), r]));
    const lines = [];

    lines.push(`✅ *Kurs Referensi BI*`);
    lines.push(`Update: ${payload.fetchedAt}`);
    lines.push("");

    for (const c of pick) {
      const r = map.get(c);
      if (!r) continue;
      lines.push(`• *${c}* | Beli: ${fmtIDRNumber(toNumberLoose(r.buy))} | Jual: ${fmtIDRNumber(toNumberLoose(r.sell))}${r.middle ? ` | Tengah: ${fmtIDRNumber(toNumberLoose(r.middle))}` : ""}`);
    }

// Fallback: kalau tidak ada yang match di pick list, tampilkan beberapa mata uang pertama agar tidak kosong
const shown = lines.filter(l => l.startsWith("•")).length;
if (shown === 0) {
    const top = payload.data
        .slice()
        .sort((a, b) => asText(a.currency).localeCompare(asText(b.currency)))
        .slice(0, 8);

    for (const r of top) {
        const c = asText(r.currency).toUpperCase();
        lines.push(
            `• *${c}* | Beli: ${fmtIDRNumber(toNumberLoose(r.buy))} | Jual: ${fmtIDRNumber(toNumberLoose(r.sell))}`
        );
    }
}


    await sock.sendMessage(from, { text: lines.join("\n") }, { quoted: msg });
  } catch (err) {
    console.error("KURS BI ERROR:", err);

    // fallback: cache
    const cached = loadKursCache();
    if (cached?.data?.length) {
      await sock.sendMessage(
        from,
        {
          text:
            `⚠️ BI sedang tidak stabil (network reset). Ini *data terakhir tersimpan*:\n` +
            `Update cache: ${cached.fetchedAt}\n` +
            `Coba ulang beberapa menit lagi.`,
        },
        { quoted: msg }
      );
      return;
    }

    await sock.sendMessage(from, { text: "Gagal mengambil kurs BI. Coba ulangi nanti Bang." }, { quoted: msg });
  }
}

// =================================================================
// BOT START
// =================================================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        auth: state,
        browser: ["BangBot", "Chrome", "1.0.0"],
        // opsi lain tetap
    });

    sock.ev.on("creds.update", saveCreds);

    // =================================================================
    // CONNECTION STATUS
    // =================================================================
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        // === TAMPILKAN QR DI TERMINAL ===
        if (qr) {
            console.clear();
            console.log("Scan QR berikut untuk menghubungkan WhatsApp:");
            qrcode.generate(qr, { small: true });   // tampilkan QR kecil di terminal
        }

        console.log(
            "connection update:",
            connection,
            lastDisconnect?.error?.output?.statusCode
        );

        if (connection === "open") {
            console.log("✅ Tersambung ke WhatsApp");

            if (!OWNER_JID && sock.user?.id) {
                OWNER_JID = sock.user.id;
                if (!PROTECTED_ADMINS.includes(OWNER_JID)) {
                    PROTECTED_ADMINS.push(OWNER_JID);
                }
            }
        }

        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log("connection closed with status", statusCode);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 440) {
                console.log(
                    "Sesi dianggap tidak valid / diganti (status",
                    statusCode,
                    ")."
                );
                console.log(
                    "Hapus folder 'auth' lalu jalankan ulang dan scan QR lagi."
                );
                return;
            }

            console.log("Koneksi terputus, mencoba reconnect...");
            startBot();
        }
    });

// =========================================================
    // 🔥 FITUR WELCOME & GOODBYE (VERSI GIF / ANIMASI)
    // =========================================================
    sock.ev.on('group-participants.update', async (anu) => {
        console.log("👋 DETEKSI MEMBER:", anu);
        try {
            const { id, participants, action } = anu;
            const metadata = await sock.groupMetadata(id);
            
            // --- SETTING LINK GIF DI SINI ---
            // Cari link GIF yang berakhiran .mp4 atau .gif (harus direct link)
            const welcomeGif = 'https://media1.tenor.com/m/z8-F355sqFYAAAAC/welcome.gif'; // Contoh: Spongebob Welcome
            const goodbyeGif = 'https://media1.tenor.com/m/1r_IXDiKERkAAAAC/good-bye-spongebob.gif'; // Contoh: Spongebob Bye
            // --------------------------------

            for (const item of participants) {
                // Deteksi nomor (handle format object/string baru)
                const num = (typeof item === 'object') ? (item.phoneNumber || item.id) : item;
                if (!num || typeof num !== 'string') continue;

                const username = num.split('@')[0];

                if (action === 'add') {
                    const weltext = `Halo @${username} 👋\nSelamat datang di *${metadata.subject}*!\n\n*!menu* untuk lihat fitur bot.`;
                    
                    await sock.sendMessage(id, { 
                        video: { url: welcomeGif }, // Wajib 'video'
                        gifPlayback: true,          // Biar gerak looping kayak GIF
                        caption: weltext, 
                        mentions: [num] 
                    });
                } 
                else if (action === 'remove') {
                    const byetext = `Selamat tinggal @${username} 👋\nSemoga tenang di alam sana.`;
                    
                    await sock.sendMessage(id, { 
                        video: { url: goodbyeGif }, 
                        gifPlayback: true, 
                        caption: byetext, 
                        mentions: [num] 
                    });
                }
            }
        } catch (err) {
            console.log("❌ Error Welcome GIF:", err);
        }
    });

    // =================================================================
    // MESSAGE HANDLER
    // =================================================================
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        // JANGAN PROSES PESAN DARI BOT SENDIRI
        if (msg.key.fromMe) return;

        // --- 1. SIMPAN PESAN MASUK KE MEMORI ---
        // Kita simpan ID pesan dan isinya, biar kalau dihapus kita punya backup.
        const msgId = msg.key.id;
        
        // Cek: Kalau BUKAN pesan tipe hapus/protocol, simpan ke log
        if (!msg.message.protocolMessage) {
            msgLog[msgId] = msg;
            
            // Opsional: Batasi memori biar server gak berat (Hapus pesan lama banget)
            // setTimeout(() => { delete msgLog[msgId] }, 600000); // Hapus stlh 10 menit (opsional)
        }

        // --- 2. DETEKSI PESAN DIHAPUS (REVOKE) ---
        if (msg.message.protocolMessage && msg.message.protocolMessage.type === 0) {
            const keyToDelete = msg.message.protocolMessage.key.id;
            const chatYangDihapus = msgLog[keyToDelete]; // Cari di memori

            if (chatYangDihapus) {
                try {
                    // Ambil info siapa pelakunya
                    const participant = chatYangDihapus.key.participant || chatYangDihapus.key.remoteJid;
                    const namaGrup = chatYangDihapus.key.remoteJid.endsWith('@g.us') ? 'di Grup' : 'di PC';

                    // Laporan ke Owner
                    const laporan = 
`🚨 *ANTI-DELETE DETECTED* 🚨
--------------------------------
👤 *Pelaku:* @${participant.split('@')[0]}
📍 *Lokasi:* ${namaGrup}
🕒 *Waktu:* Sekarang
--------------------------------
_Berikut pesan/media yang dihapus:_`;

                    // 1. Kirim Teks Laporan dulu
                    await sock.sendMessage(NOMOR_OWNER, { 
                        text: laporan, 
                        mentions: [participant] 
                    });

                    // 2. Teruskan Pesan Aslinya (Gambar/Video/Stiker/Teks) ke Owner
                    // Kita pakai fitur 'forward' bawaan Baileys, jadi isinya persis sama
                    await sock.sendMessage(NOMOR_OWNER, { 
                        forward: chatYangDihapus, 
                        force: true 
                    });

                } catch (e) {
                    console.log("Gagal kirim anti-delete:", e);
                }
            }
        }

        // ... (LANJUT KE KODINGAN UTAMA ABANG: const from = ... body = ... dll) ...

        const from = msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        // Simpan gambar terakhir di chat ini (untuk !qrauto)
        if (
            type === "imageMessage" ||
            msg.message?.stickerMessage ||
            (type === "documentMessage" && msg.message.documentMessage?.mimetype?.includes("image"))
        ) {
            LAST_QR_IMAGE[from] = msg;
        }

        // Simpan pesan PDF terakhir di chat ini
        if (type === "documentMessage" && msg.message.documentMessage?.mimetype?.includes("pdf")) {
            lastPdfPerChat.set(from, msg);
        }
        const sender = msg.key.participant || msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");

        let teks =
            msg.message.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            msg.message?.documentMessage?.caption ||
            "";

        // =====================================================
        // 🔥 FITUR MULTI-PREFIX (HACK) 🔥
        // =====================================================
        // Daftar simbol yang mau dibaca sebagai command
        const availablePrefixes = ['.', '#', '/', 'cp', '!', '?'];
        
        // Cek apakah pesan diawali salah satu simbol itu
        const usedPrefix = availablePrefixes.find(p => teks.startsWith(p));
        
        if (usedPrefix) {
            // Kita tipu bot-nya: Ganti simbol depan jadi "!" biar script di bawah jalan
            teks = "!" + teks.slice(usedPrefix.length);
        }
        // =====================================================

        const lower = teks.toLowerCase().trim();
        const args = lower.split(" ");
        const cmd = args[0];

        // =====================================================
        // AUTO EMOJI REACTION (SMART MODE)
        // =====================================================
        if (AUTO_EMOJI_REACTION) {
            // JANGAN react untuk command / pesan kosong
            if (!lower.startsWith("!") && teks && teks.trim().length > 0) {

                // random agar tidak semua pesan di-react → anti spam
                if (Math.random() < AUTO_EMOJI_CHANCE) {
                    const emoji = getSmartEmojiReaction(teks);

                    if (emoji) {
                        try {
                            await sock.sendMessage(from, {
                                react: {
                                    text: emoji,
                                    key: msg.key
                                }
                            });
                        } catch (err) {
                            console.error("Auto emoji reaction error:", err);
                        }
                    }
                }
            }
        }

        // =====================================================
        // ANTI-FLOOD (SAFE MODE: HANYA WARNING, TIDAK KICK)
        // =====================================================
        if (isGroup) {
            const key = `${from}|${sender}`;
            const now = Date.now();
            const data = floodMap.get(key) || { count: 0, first: now };

            if (now - data.first > FLOOD_WINDOW_MS) {
                data.count = 1;
                data.first = now;
            } else {
                data.count++;
            }

            floodMap.set(key, data);

            if (data.count > FLOOD_MAX_MSG) {
                await sock.sendMessage(from, {
                    text: `Bang @${sender.split("@")[0]}, jangan spam ya.`,
                    mentions: [sender]
                });
                floodMap.set(key, { count: 0, first: now });
                return;
            }
        }

        // =====================================================
        // ANTI-LINK & ANTI-VIRTEX (SAFE MODE: TANPA KICK)
        // =====================================================
        if (isGroup && teks) {
            if (teks.includes("chat.whatsapp.com/")) {
                await sock.sendMessage(from, {
                    text: `Peringatan: Link undangan grup tidak diperbolehkan di sini, Bang.`,
                });
                return;
            }

            if (teks.length > 10000 || /[\u200B-\u200F]/.test(teks)) {
                await sock.sendMessage(from, {
                    text: "Pesan terdeteksi berpotensi virtex. Mohon dihapus ya, Bang."
                });
                return;
            }
        }

        // =====================================================
        // AUTO RESPON MENTION
        // =====================================================
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.includes(sock.user.id) && !lower.startsWith("!")) {
            await sock.sendMessage(from, {
                text: "Iya Bang? Ada yang bisa BangBot bantu?",
                mentions: [sender]
            });
        }

        // =====================================================
        // SIMPAN PDF TERAKHIR DI CHAT
        // =====================================================
        if (msg.message?.documentMessage && msg.message.documentMessage.mimetype.includes("pdf")) {
            LAST_PDF[from] = msg; // simpan seluruh pesan sebagai sumber PDF
        }

        // =====================================================
        // COMMAND HANDLING
        // =====================================================
        if (lower.startsWith("!")) {

            // ============================
            // AUTO REACTION JAM UNTUK COMMAND
            // ============================
            if (AUTO_COMMAND_REACTION) {
                try {
                    await sock.sendMessage(from, {
                        react: {
                            text: "🕑",   // emoji jam / lagi proses
                            key: msg.key
                        }
                    });
                } catch (err) {
                    console.error("Command reaction error:", err);
                }
            }

            await sleep(500 + Math.random() * 700);

            if (!checkCooldown(sender)) return;

            totalCommands += 1;

            // ... lanjut semua handler !menu, !s, !yt, dst ...

            // --- LOGIC AFK (INTERCEPTOR) ---
            if (afk[sender]) {
                const info = afk[sender];
                const duration = (Date.now() - info.waktu) / 1000;
                const min = Math.floor(duration / 60);
                const sec = Math.floor(duration % 60);
                
                delete afk[sender];
                await sock.sendMessage(from, { text: `👋 Selamat kembali @${sender.split('@')[0]}!\nKamu sudah AFK selama *${min} menit ${sec} detik*.` }, { quoted: msg });
            }

            // Cek Kalo Ada yg Ngetag Orang AFK
            const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            mentions.forEach(target => {
                if (afk[target]) {
                    const info = afk[target];
                    const duration = (Date.now() - info.waktu) / 1000;
                    const min = Math.floor(duration / 60);
                    sock.sendMessage(from, { text: `🤫 Sstt... Orangnya lagi AFK Bang!\n\n👤 *${target.split('@')[0]}*\n💤 Alasan: ${info.alasan}\n⏳ Sejak: ${min} menit yang lalu` }, { quoted: msg });
                }
            });

            // 3. LOGIKA GAME (MATH & SIAPAKAH AKU) JUGA TARUH SINI
            if (math[from] && !msg.key.fromMe) {
                const session = math[from];
                const answer = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim().toLowerCase();
                if (answer == session.jawaban) {
                    const reward = 2000; 
                    addBalance(sender, reward);
                    await sock.sendMessage(from, { text: `✅ *BENAR!* 🎉\nJawabannya: ${session.jawaban}\nHadiah: Rp ${reward}` }, { quoted: msg });
                    clearTimeout(math[from].timer);
                    delete math[from];
                }
            }

            if (siapakahaku[from] && !msg.key.fromMe) {
                const session = siapakahaku[from];
                const answer = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim().toLowerCase();
                if (session.jawaban.toLowerCase() === answer) {
                    const reward = 3500;
                    addBalance(sender, reward);
                    await sock.sendMessage(from, { text: `✅ *BENAR!* 🎉\nJawabannya: ${session.jawaban}\nHadiah: Rp ${reward}` }, { quoted: msg });
                    clearTimeout(siapakahaku[from].timer);
                    delete siapakahaku[from];
                }
            }

// =================================================
            // MENU SYSTEM (KATEGORI & ALL MENU)
            // =================================================
            
            // 1. MENU UTAMA (Daftar Kategori)
            if (cmd === "!menu" || cmd === "!help") {
                const menuMsg = 
`*_Halo, pilih menu di bawah ini:_*
• !menuutama
• !menustiker
• !menuconvert
• !menuimage
• !menuaudio
• !menuvideo
• !menufun
• !menudownload
• !menuoffice
• !menutools
• !menuinfo
• !menuai
• !menuedukasi
• !menureligi
• !menuemergency
• !menufinance
• !menudonate
• !allmenu`;

                await sock.sendMessage(from, { text: menuMsg }, { quoted: msg });
            }

            if (cmd === "!menuutama") {
                const utamaMsg =
`*MENU UTAMA*
• !s → stiker foto
• !brat teks → stiker brat
• !bratvid teks → stiker brat animasi
• !tostick → video ke stiker animasi
• !toimg → Stiker ke gambar
• !tovid → Stiker GIF ke video
• !emojimix → Gabung emoji
• !togif → video → GIF
• !confess 08123** | Pesan | Pengirim
• !hd → foto burikmu jadi hd
• !removebg → hapus background foto
• !edit → edit foto
• !curhat [Ceritamu]
• !play [Judul Lagu]`;
                
                await sock.sendMessage(from, { text: utamaMsg }, { quoted: msg });
            }

            // 2. MENU STIKER
            if (cmd === "!menustiker") {
                const stikerMsg =
`*STIKER*
• !s → stiker foto
• !brat teks → stiker brat
• !bratvid teks → stiker brat animasi
• !tostick → video ke stiker animasi
• !toimg → Stiker ke gambar
• !tovid → Stiker GIF ke video
• !sblur → stiker blur (sensor)
• !sgray → stiker hitam putih
• !emojimix → Gabung emoji
• !ssearch kueri → Cari stiker di Google
• !gets → Stiker meme random`;
                
                await sock.sendMessage(from, { text: stikerMsg }, { quoted: msg });
            }

            // 3. MENU CONVERT
            if (cmd === "!menuconvert") {
                const convertMsg =
`*CONVERT*
• !togif → video → GIF
• !tomp3 → Video/VN ke MP3
• !tovn → Audio ke Voice Note
• !voice2text (Reply VN) → Mengubah vn menjadi teks
• !tomp3
• !towav
• !toogg
• !tourl → Upload media ke Link
• !togif → Video ke GIF
• !heic2jpg → Ubah file HEIC (iPhone) jadi JPG
• !webp2jpg → Ubah stiker/webp jadi JPG
• !webp2png → Ubah stiker/webp jadi PNG
• !rgb2cmyk → Ubah warna untuk Printing (Kirim Dokumen)
• !cmyk2rgb → Perbaiki warna gambar hasil scan/print`;

                await sock.sendMessage(from, { text: convertMsg }, { quoted: msg });
            }

            // 4. MENU image
            if (cmd === "!menuimage") {
                const imageMsg =
`*IMAGE TOOLS*
• !removebg → hapus background foto
• !compress → kompres foto/video
• !cartoon → efek kartun offline
• !restoreface → perbaiki wajah blur
• !resize 1000 → ubah lebar gambar (px)
• !hd → perbesar resolusi gambar 2x
• !sschat teks / reply → fake screenshot chat
• !iqc → (iPhone Quote Chat)
• !meme atas|bawah (reply foto) → meme generator
• !scan → Ubah foto jadi seperti hasil scanner`;

                await sock.sendMessage(from, { text: imageMsg }, { quoted: msg });
            }

            // 5. MENU TOOLS & LAINNYA
            if (cmd === "!menuaudio") {
                const audioMsg =
`*AUDIO*
• !bass → bass boost
• !nightcore → tempo cepat & pitch tinggi
• !slow → perlambat tempo
• !vchip → suara cempreng
• !vn → kirim sebagai voice note
• !vocalremove → hilangkan vokal (karaoke)
• !audiomix → gabungkan 2 audio
• !voice2text (Reply VN) → Mengubah vn menjadi teks
• !tts [id/en] → Text to Speech
• !trim [start] [end]
• !fadein durasi
• !fadeout durasi
• !audioconvert [mp3/wav/ogg] → Ubah format file audio/VN
• !tomp3
• !towav
• !toogg`;

                await sock.sendMessage(from, { text: audioMsg }, { quoted: msg });
            }

            // 6. ALL MENU (TAMPIL SEMUA)
            if (cmd === "!menuvideo") {
                const vidMsg =
`*VIDEO*
• !thumbnail → Ambil gambar cover dari video
• !compress → kompres foto/video
• !vidcompress [size] → Kecilkan ukuran video
• !short [detik] → Ambil potongan tengah video
• !short random → Ambil potongan acak
• !cut [mm:ss] [mm:ss] → Potong video (Contoh: !cut 1:00 1:30)`;

                await sock.sendMessage(from, { text: vidMsg }, { quoted: msg });
            }

            if (cmd === "!menuoffice") {
                const officeMsg =
`*OFFICE*
• !office2pdf → DOCX/XLSX/PPTX ke PDF
• !pdf2img → PDF ke gambar
• !compresspdf → kompres PDF
• !pdfmerge → gabung beberapa PDF
• !pdfsplit halaman → potong halaman PDF
• !rename nama baru → Ganti nama file/dokumen
• !pagenum [posisi] → Beri nomor halaman PDF (bottom/top-right)
• !cleaname → Rapikan nama file otomatis
• !pdfmeta → Cek info detail/metadata PDF
• !lockpdf [pass] → Kunci PDF dengan password
• !unlockpdf [pass] → Hapus password dari PDF
• !pdfrotate [90/180/kiri] → Putar posisi halaman PDF
• !pdfextract [hal] → Ambil halaman (misal: 1,5,9 atau 1-5)
• !pdfdelete [hal] → Hapus halaman tertentu (misal: 2, 4-5)
• !img2pdf → Ubah foto jadi file PDF
• !summarize (reply teks) → ringkas teks
• !paraphrase (reply teks) → ubah susunan kalimat
• !pdffonts → Cek daftar jenis font dalam PDF`;

                await sock.sendMessage(from, { text: officeMsg }, { quoted: msg });
            }

            if (cmd === "!menudownload") {
                const downMsg =
`*DOWNLOADER*
• !play [Judul Lagu]
• !yt url → YouTube video
• !yta url → YouTube audio
• !fb url → Facebook
• !ig url → Instagram
• !tt url → TikTok
• !th url → Threads
• !x url → X/Twitter
• !pin url → Pinterest`;

                await sock.sendMessage(from, { text: downMsg }, { quoted: msg });
            }

            if (cmd === "!menufun") {
                const funMsg =
`*FUN*
• !afk [alasan] → Mode Jangan Ganggu
• !khodam nama → cek khodam
• !artinama [Nama]
• !motivasi
• !faktaunik
• !slot → mesin slot
• !dadu [jumlah] → lempar dadu
• !tebakkata / !tebakgambar
• !caklontong / !family100
• !quote, !joke, !pantun
• !8ball, !coin, !suit
• !siapa teks → pilih member random
• !pilih opsi1 | opsi2
• !jodoh nama & nama → Cek kecocokan cinta
• !dompet → Cek saldo uang
• !kerja → Kerja buat cari duit
• !daily → Klaim uang harian
• !transfer @tag [jml] → Kirim uang
• !top → Cek 10 orang paling kaya
• !slot [jml] → Judi slot (Awas bangkrut!)
• !math → Kuis Matematika
• !siapakahaku → Tebak-tebakan logika
• !reverse teks
• !story, !katabijak
• !puji, !roast, !cinta`;

                await sock.sendMessage(from, { text: funMsg }, { quoted: msg });
            }

            if (cmd === "!menuai") {
                const aiMsg =
`*AI*
• !ai pertanyaan → Tanya jawab cerdas (ChatGPT)
• !img teks → Buat gambar dari teks (AI)
• !edit → edit foto
• !toanime → foto jadi anime
• !curhat [Ceritamu]`;

                await sock.sendMessage(from, { text: aiMsg }, { quoted: msg });
            }

            if (cmd === "!menuedukasi") {
                const eduMsg =
`*EDUKASI*
• !kbbi [kata] → Kamus Besar B. Indonesia
• !tr [kode] [teks] → Google Translate (id/en/ja)
• !wiki [topik] → Cari artikel Wikipedia
• !hitung [angka] → Kalkulator (misal: 105-2)
• !nulis [teks] → Ubah ketikan jadi tulisan tangan
• !convert [nilai] to [satuan] → Konversi satuan teknik lengkap
• !ide [topik] → Cari ide liar/kreatif
• !swot [topik] → Analisis Kekuatan & Kelemahan
• !why [masalah] → Cari akar masalah (5 Whys)`;

                await sock.sendMessage(from, { text: eduMsg }, { quoted: msg });
            }

            if (cmd === "!menutools") {
                const toolMsg =
`*TOOLS*
• !confess 08123** | Pesan | Pengirim
• !alarm jam zona waktu keterangan
• !resep → cari resep masakan
• !lirik [judul] → Cari lirik lagu + cover album
• !bill [total] [orang/@tag] → Hitung patungan otomatis
• !qr teks → QR code
• !qrwifi ssid|pass|Tipe → QR WiFi
• !barcode kode → barcode
• !qrvcard nama|telp|email → QR vCard
• !qrdecode → baca QR dari gambar
• !qrauto → scan QR terakhir tanpa reply
• !qrfullscan → scan banyak QR sekaligus
• !ocr → Ambil teks dari gambar
• !cekresi <resi> → lacak paket (otomatis)
• !ssweb url → screenshot website
• !shortlink / !unshortlink → link tool
• !stalkig username → info profil IG`;

                await sock.sendMessage(from, { text: toolMsg }, { quoted: msg });
            }

            if (cmd === "!menureligi") {
                const religMsg =
`*RELIGI*
• !sholat [kota] → Jadwal sholat hari ini
• !quran [No.Surah] [Ayat] → Baca ayat Al-Quran
• !kisahnabi [nama] → Cerita Nabi
• !doaharian → Kumpulan doa harian
• !asmaulhusna
• !alkitab [Ayat]`;

                await sock.sendMessage(from, { text: religMsg }, { quoted: msg });
            }

            if (cmd === "!menuemergency") {
                const emerMsg =
`*EMERGENCY*
• !nomor → Daftar telepon darurat RI
• !p3k [topik] → Panduan Pertololan Pertama
• !carirs → Cari RS terdekat (Reply Lokasi)`;

                await sock.sendMessage(from, { text: emerMsg }, { quoted: msg });
            }

            if (cmd === "!menuinfo") {
                const infoMsg =
`*INFO*
• !speedtest → speedtest server bot
• !sysinfo
• !status / !about
• !groupinfo, !owner
• !owner → kontak owner
• !ping host → cek ping
• !ipinfo ip / domain → info IP
• !cuaca nama_kota → info cuaca
• !gempa → Info gempa terkini dari BMKG
• !trending → Cek apa yang lagi viral (Google Trends)
• !berita → Baca headline berita terbaru
• !news → berita terbaru CNN Indonesia
• !anime judul → info anime
• !movie judul → info film`;

                await sock.sendMessage(from, { text: infoMsg }, { quoted: msg });
            }

            if (cmd === "!menudonate") {
                const donateMsg =
`**DONATE
• !saweria → traktir BangBot ([https://saweria.co/ozagns](https://saweria.co/ozagns))`;

                await sock.sendMessage(from, { text: donateMsg }, { quoted: msg });
            }

            if (cmd === "!menufinance") {
                const financeMsg =
`*FINANCE*
• !kurs → kurs BI (IDR)
• !crypto btc → harga crypto realtime`;

                await sock.sendMessage(from, { text: financeMsg }, { quoted: msg });
            }

            if (cmd === "!allmenu") {
                const allMsg =
`*BANGBOT MENU*


*MENU STIKER*
• !s → Buat stiker dari foto
• !brat [teks] → Buat stiker gaya 'brat'
• !bratvid [teks] → Buat stiker 'brat' animasi
• !tostick → Ubah video menjadi stiker animasi
• !sblur → Buat stiker efek blur/sensor
• !sgray → Buat stiker hitam putih
• !emojimix → Gabungkan dua emoji menjadi satu
• !ssearch [kueri] → Cari stiker melalui Google
• !gets → Ambil stiker meme secara acak

*MEDIA & EDITING*
• !hd → foto burikmu jadi hd
• !removebg → Hapus latar belakang foto
• !cartoon → Berikan efek kartun pada foto
• !restoreface → Perbaiki wajah yang blur pada foto
• !resize [lebar] → Ubah ukuran lebar gambar (pixel)
• !scan → Ubah foto menjadi efek dokumen hasil scan
• !sschat [teks] → Buat screenshot chat palsu (WA)
• !iqc → Buat screenshot chat gaya iPhone (Quote Chat)
• !meme [atas|bawah] → Buat meme dari foto yang direply

*KONVERSI FILE*
• !toimg → Ubah stiker menjadi gambar biasa
• !tovid → Ubah stiker animasi/GIF menjadi video
• !togif → Ubah video menjadi GIF
• !tomp3 → Ubah video atau VN menjadi file audio MP3
• !tovn → Ubah file audio menjadi Voice Note (VN)
• !tourl → Upload file media ke link publik
• !heic2jpg → Konversi foto iPhone (HEIC) ke JPG
• !webp2jpg / !webp2png → Konversi stiker ke JPG/PNG
• !rgb2cmyk / !cmyk2rgb → Penyesuaian warna untuk kebutuhan cetak
• !compress → Kompres ukuran foto atau video
• !vidcompress [size] → Kecilkan ukuran file video secara spesifik

*AUDIO & MUSIK*
• !vocalremove → Hilangkan suara vokal (buat karaoke)
• !audiomix → Gabungkan dua file audio
• !bass → Tambahkan efek Bass Boost
• !nightcore → Ubah audio menjadi tempo cepat & pitch tinggi
• !slow → Perlambat tempo audio
• !vchip → Ubah suara menjadi cempreng
• !voice2text → Ubah suara dari VN menjadi teks (Transkrip)
• !tts [id/en] → Mengubah teks menjadi suara (Text to Speech)
• !lirik [judul] → Cari lirik lagu beserta cover albumnya
• !audioconvert [mp3/wav/ogg] → Ubah format file audio

*OFFICE & PDF*
• !office2pdf → Ubah DOCX/XLSX/PPTX menjadi PDF
• !img2pdf → Ubah kumpulan foto menjadi satu file PDF
• !pdf2img → Ubah halaman PDF menjadi gambar
• !compresspdf → Kecilkan ukuran file PDF
• !pdfmerge → Gabungkan beberapa file PDF
• !pdfsplit [hal] → Potong halaman tertentu pada PDF
• !pdfextract / !pdfdelete → Ambil atau hapus halaman spesifik
• !pdfrotate → Putar posisi halaman PDF
• !lockpdf / !unlockpdf → Pasang atau hapus password PDF
• !pagenum → Beri nomor halaman pada PDF
• !pdfmeta → Cek metadata/detail file PDF

*DOWNLOADER*
• !play [Judul Lagu]
• !yt / !yta [url] → YouTube
• !tt [url] → TikTok
• !ig [url] → Instagram
• !fb [url] → Facebook
• !th [url] → Threads
• !x [url] → X/Twitter
• !pin [url] → Pinterest

*AI & EDUKASI*
• !ai [pertanyaan] → Tanya jawab cerdas dengan ChatGPT
• !img [teks] → Generate gambar dari teks (AI)
• !edit → edit foto
• !toanime → foto jadi anime
• !curhat [Ceritamu]
• !summarize → Ringkas teks yang panjang
• !paraphrase → Ubah susunan kalimat (anti-plagiasi)
• !kbbi [kata] → Cari arti kata resmi di Kamus Besar Bahasa Indonesia
• !tr [kode] [teks] → Terjemahan bahasa (Contoh: !tr en halo)
• !wiki [topik] → Cari informasi di Wikipedia
• !hitung [angka] → Kalkulator otomatis
• !nulis [teks] → Ubah ketikan menjadi tulisan tangan di kertas
• !convert [nilai] → Konversi berbagai satuan teknik

*HIBURAN & GAME*
• !khodam [nama] → Cek khodam pelindungmu
• !slot / !kerja / !daily → Game ekonomi (Cari uang & judi virtual)
• !dompet / !transfer → Cek saldo & kirim uang virtual
• !tebakkata / !tebakgambar → Kuis tebak-tebakan
• !caklontong / !family100 → Game kuis populer
• !math → Kuis matematika cepat
• !jodoh [nama1|nama2] → Cek kecocokan cinta
• !afk [alasan] → Aktifkan mode sedang tidak di tempat
• !siapa [teks] → Pilih member grup secara acak
• !artinama [Nama]
• !motivasi
• !faktaunik

*TOOLS & INFORMASI*
• !alarm jam zona waktu keterangan
• !resep → cari resep masakan
• !cuaca [kota] → Info cuaca terkini
• !gempa → Info gempa bumi terbaru dari BMKG
• !trending / !news → Berita viral dan headline terbaru
• !cekresi [resi] → Lacak posisi paket secara otomatis
• !qr / !qrdecode → Buat atau baca kode QR
• !ocr → Ambil teks dari sebuah gambar
• !ssweb [url] → Screenshot tampilan website
• !shortlink [url] / !unshortlink [url]
• !ipinfo [ip] → Cek informasi alamat IP/Domain

*RELIGI*
• !sholat [kota] → Jadwal sholat hari ini
• !quran [No.Surah] [Ayat] → Baca ayat Al-Quran
• !kisahnabi [nama] → Cerita Nabi
• !doaharian → Kumpulan doa harian
• !asmaulhusna
• !alkitab [Ayat]

*SUPPORT*
• !saweria → Dukung pengembangan BangBot (https://saweria.co/ozagns)
• !owner → Kontak langsung pemilik bot

Gunakan fitur seperlunya ya Bang, jangan buat spam.`;

                await sock.sendMessage(from, { text: allMsg }, { quoted: msg });
            }

            // =================================================
            // SAWERIA / SUPPORT
            // =================================================
            if (["!saweria", "!traktir", "!donate"].includes(cmd)) {
                await sock.sendMessage(from, {
                    text:
`𝙼𝚊𝚞 𝚝𝚛𝚊𝚔𝚝𝚒𝚛 𝚔𝚘𝚙𝚒 𝚋𝚞𝚊𝚝 𝙱𝚊𝚗𝚐𝙱𝚘𝚝?

𝚂𝚊𝚠𝚎𝚛𝚒𝚊:
https://saweria.co/ozagns

𝚃𝚎𝚛𝚒𝚖𝚊 𝚔𝚊𝚜𝚒𝚑 𝚋𝚊𝚗𝚢𝚊𝚔 𝙱𝚊𝚗𝚐, 𝚍𝚞𝚔𝚞𝚗𝚐𝚊𝚗𝚗𝚢𝚊 𝚋𝚒𝚔𝚒𝚗 𝚜𝚎𝚖𝚊𝚗𝚐𝚊𝚝 𝚝𝚎𝚛𝚞𝚜 𝚗𝚐𝚎𝚖𝚋𝚊𝚗𝚐𝚒𝚗 𝚋𝚘𝚝 𝚒𝚗𝚒.`
                });
            }

            // =================================================
            // STATUS / ABOUT
            // =================================================
            if (cmd === "!status" || cmd === "!about") {
                const uptimeText = formatUptime(process.uptime());
                await sock.sendMessage(from, {
                    text:
`*BangBot Status*

Uptime     : ${uptimeText}
Command    : ${totalCommands}x dijalankan sejak bot start

Traktir kopi BangBot?
https://saweria.co/ozagns`
                });
            }

            // =================================================
            // GROUPINFO
            // =================================================
            if (cmd === "!groupinfo") {
                if (!isGroup) {
                    await sock.sendMessage(from, {
                        text: "Command *!groupinfo* hanya bisa dipakai di dalam grup, Bang."
                    });
                } else {
                    try {
                        const meta = await sock.groupMetadata(from);
                        const name = meta.subject || "-";
                        const participants = meta.participants || [];
                        const desc = meta.desc?.body || meta.desc || "(tidak ada deskripsi)";
                        const ownerJid = meta.owner || OWNER_JID || "";
                        const ownerNumber = ownerJid
                            ? ownerJid.split("@")[0].split(":")[0]
                            : "-";

                        await sock.sendMessage(from, {
                            text:
`*Info Grup*

Nama      : ${name}
Member    : ${participants.length}
Owner     : ${ownerNumber !== "-" ? "wa.me/" + ownerNumber : "-"}

Deskripsi :
${desc}`
                        });
                    } catch (err) {
                        console.error("groupinfo error:", err);
                        await sock.sendMessage(from, {
                            text: "Tidak bisa mengambil info grup saat ini, Bang."
                        });
                    }
                }
            }

            // =================================================
            // OWNER
            // =================================================
            if (cmd === "!owner") {
                if (!OWNER_JID) {
                    await sock.sendMessage(from, {
                        text: "Owner belum terdeteksi. Coba beberapa saat setelah bot terkoneksi penuh, Bang."
                    });
                } else {
                    const num = OWNER_JID.split("@")[0].split(":")[0];
                    await sock.sendMessage(from, {
                        text:
`*Owner BangBot*

WhatsApp : https://wa.me/628975800981
Saweria  : https://saweria.co/ozagns

Silakan hubungi owner untuk kerja sama, kritik/saran, atau report bug.`
                    });
                }
            }

            // =================================================
            // ADMIN MENU (hanya admin grup)
            // =================================================
            if (cmd === "!adminmenu") {
                if (!isGroup) {
                    await sock.sendMessage(from, {
                        text: "Command *!adminmenu* hanya bisa dipakai di dalam grup, Bang."
                    });
                } else {
                    const isAdminSender = await isGroupAdmin(sock, from, sender);
                    if (!isAdminSender) {
                        await sock.sendMessage(from, {
                            text: "Command ini khusus admin grup, Bang."
                        });
                        return;
                    }

                    await sock.sendMessage(from, {
                        text:
            `
• !kick
• !promote
• !demote
• !tagall
• !hidetag
• !group open/close
• !setname
• !setdesc
• !link
• !revoke
• !del`
                    });
                }
            }

            // =================================================
            // TAGALL / EVERYONE (hanya admin, Safe Mode)
            // =================================================
            if (cmd === "!tagall" || cmd === "!everyone") {
                if (!isGroup) {
                    await sock.sendMessage(from, {
                        text: "Command ini hanya untuk di grup, Bang."
                    });
                    return;
                }

                const isAdminSender = await isGroupAdmin(sock, from, sender);
                if (!isAdminSender) {
                    await sock.sendMessage(from, {
                        text: "Command *!tagall* hanya boleh dipakai admin grup, Bang."
                    });
                    return;
                }

                try {
                    const meta = await sock.groupMetadata(from);
                    const members = meta.participants || [];

                    if (!members.length) {
                        await sock.sendMessage(from, { text: "Tidak ada member terdeteksi di grup ini." });
                        return;
                    }

                    // batasi jika grup super besar (misal > 256, hanya sebut maksimum 256)
                    const limitedMembers = members.slice(0, 256);
                    const mentions = limitedMembers.map(m => m.id);
                    const lines = limitedMembers
                        .map((m, i) => `${i + 1}. @${m.id.split("@")[0]}`)
                        .join("\n");

                    const extraText = teks.replace(/!tagall/i, "").replace(/!everyone/i, "").trim();
                    const header = extraText ? extraText : "Tagall oleh admin:";

                    await sock.sendMessage(from, {
                        text: `${header}\n\n${lines}`,
                        mentions
                    });

                } catch (err) {
                    console.error("tagall error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal melakukan tagall, Bang."
                    });
                }
            }

// =================================================
            // 👮‍♂️ FITUR KHUSUS GROUP ADMIN
            // =================================================

            // 1. HIDETAG (Tag All Invisible)
            if (cmd === "!hidetag") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup Bang." }, { quoted: msg });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin, jangan macem-macem." }, { quoted: msg });

                const textHidetag = teks.replace("!hidetag", "").trim();
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants.map(p => p.id);

                // Kirim pesan dengan me-mention semua orang (tapi teks mention-nya kosong)
                await sock.sendMessage(from, { 
                    text: textHidetag || "📢 *PENGUMUMAN DARI ADMIN*", 
                    mentions: participants 
                });
            }

            if (cmd === "!kick") {
                if (!isGroup) return;
                if (!isBotAdmin) return reply("Bot harus jadi admin!");
                
                let users = msg.message.extendedTextMessage?.contextInfo?.mentionedJid[0] || 
                            msg.message.extendedTextMessage?.contextInfo?.participant;
                
                if (!users) return reply("Tag orangnya dulu, Bang!");

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });
                
                // 1. Tambahkan ke database blacklist
                addBlacklist(users);
                
                // 2. Tendang dari grup
                await sock.groupParticipantsUpdate(from, [users], "remove");
                reply(`Selesai! Nomor @${users.split('@')[0]} sudah di-blacklist permanen.`);
            }

            // 3. GROUP OPEN / CLOSE
            if (cmd === "!group") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup Bang." }, { quoted: msg });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin." }, { quoted: msg });
                if (!isBotAdmin) return sock.sendMessage(from, { text: "❌ Jadiin Bot admin dulu Bang." }, { quoted: msg });

                const args = teks.split(" ")[1]; // Ambil kata setelah !group

                if (args === "close" || args === "tutup") {
                    await sock.groupSettingUpdate(from, 'announcement');
                    await sock.sendMessage(from, { text: "🔒 Grup DITUTUP oleh Admin. Hanya Admin yang bisa kirim pesan." });
                } else if (args === "open" || args === "buka") {
                    await sock.groupSettingUpdate(from, 'not_announcement');
                    await sock.sendMessage(from, { text: "🔓 Grup DIBUKA kembali. Silakan meramaikan." });
                } else {
                    await sock.sendMessage(from, { text: "⚠️ Format salah.\nPilih: *!group open* atau *!group close*" }, { quoted: msg });
                }
            }

// =================================================
            // 👮‍♂️ ADMIN TOOLS EXTRA (POWERFUL)
            // =================================================

            // 4. PROMOTE (Naik Jabatan)
            if (cmd === "!promote" || cmd === "!admin") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup." });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin." });
                if (!isBotAdmin) return sock.sendMessage(from, { text: "❌ Bot harus jadi Admin dulu." });

                let target = msg.message.extendedTextMessage?.contextInfo?.participant || 
                             msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

                if (!target) return sock.sendMessage(from, { text: "⚠️ Reply pesan atau Tag orangnya." });

                try {
                    await sock.groupParticipantsUpdate(from, [target], "promote");
                    await sock.sendMessage(from, { text: `✅ Sukses! @${target.split('@')[0]} sekarang jadi Admin.`, mentions: [target] });
                } catch (e) {
                    await sock.sendMessage(from, { text: "Gagal promote." });
                }
            }

            // 5. DEMOTE (Turun Jabatan)
            if (cmd === "!demote" || cmd === "!unadmin") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup." });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin." });
                if (!isBotAdmin) return sock.sendMessage(from, { text: "❌ Bot harus jadi Admin dulu." });

                let target = msg.message.extendedTextMessage?.contextInfo?.participant || 
                             msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

                if (!target) return sock.sendMessage(from, { text: "⚠️ Reply pesan atau Tag orangnya." });

                try {
                    await sock.groupParticipantsUpdate(from, [target], "demote");
                    await sock.sendMessage(from, { text: `✅ Sukses! @${target.split('@')[0]} diturunkan jadi member biasa.`, mentions: [target] });
                } catch (e) {
                    await sock.sendMessage(from, { text: "Gagal demote." });
                }
            }

            // 6. DELETE MESSAGE (Tarik Pesan Bot/Member)
            if (cmd === "!del" || cmd === "!delete") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup." });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin." });
                if (!isBotAdmin) return sock.sendMessage(from, { text: "❌ Bot harus jadi Admin biar bisa hapus chat orang." });

                if (!msg.message.extendedTextMessage?.contextInfo?.stanzaId) {
                    return sock.sendMessage(from, { text: "⚠️ Reply pesan yang mau dihapus." });
                }

                const key = {
                    remoteJid: from,
                    fromMe: false,
                    id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                    participant: msg.message.extendedTextMessage.contextInfo.participant
                };

                await sock.sendMessage(from, { delete: key });
            }

            // 7. GET LINK GROUP
            if (cmd === "!link" || cmd === "!invitelink") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup." });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin." });
                if (!isBotAdmin) return sock.sendMessage(from, { text: "❌ Bot harus jadi Admin." });

                try {
                    const code = await sock.groupInviteCode(from);
                    await sock.sendMessage(from, { text: `🔗 *Link Grup:*\nhttps://chat.whatsapp.com/${code}` });
                } catch (e) {
                    await sock.sendMessage(from, { text: "Gagal mengambil link." });
                }
            }

            // 8. REVOKE LINK (Reset Link)
            if (cmd === "!revoke" || cmd === "!resetlink") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup." });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin." });
                if (!isBotAdmin) return sock.sendMessage(from, { text: "❌ Bot harus jadi Admin." });

                try {
                    await sock.groupRevokeInvite(from);
                    await sock.sendMessage(from, { text: "✅ Link grup berhasil di-reset. Link lama hangus." });
                } catch (e) {
                    await sock.sendMessage(from, { text: "Gagal reset link." });
                }
            }

            // 9. SET GROUP NAME & DESC
            if (cmd === "!setname") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup." });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin." });
                if (!isBotAdmin) return sock.sendMessage(from, { text: "❌ Bot harus jadi Admin." });

                const newName = teks.replace("!setname", "").trim();
                if (!newName) return sock.sendMessage(from, { text: "Namanya apa Bang?" });

                await sock.groupUpdateSubject(from, newName);
                await sock.sendMessage(from, { text: "✅ Nama grup diganti." });
            }

            if (cmd === "!setdesc") {
                if (!isGroup) return sock.sendMessage(from, { text: "Khusus Grup." });
                if (!isAdmin) return sock.sendMessage(from, { text: "❌ Lu bukan Admin." });
                if (!isBotAdmin) return sock.sendMessage(from, { text: "❌ Bot harus jadi Admin." });

                const newDesc = teks.replace("!setdesc", "").trim();
                if (!newDesc) return sock.sendMessage(from, { text: "Deskripsinya apa Bang?" });

                await sock.groupUpdateDescription(from, newDesc);
                await sock.sendMessage(from, { text: "✅ Deskripsi grup diganti." });
            }

            // =================================================
            // !s — IMAGE TO STICKER (Caption ATAU Reply)
            // =================================================
            if (cmd === "!s" || cmd === "!stiker" || cmd === "!sticker" || cmd === "!stik" || cmd === "!stick") {
                let imgBuffer = null;

                // 1) Jika user reply ke foto
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quotedImg = ctx?.quotedMessage?.imageMessage;

                if (quotedImg) {
                    imgBuffer = await downloadMediaMessage(
                        { message: ctx.quotedMessage },
                        "buffer"
                    );
                }

                // 2) Jika caption !s di foto itu sendiri
                else if (msg.message?.imageMessage) {
                    imgBuffer = await downloadMediaMessage(msg, "buffer");
                }

                // 3) Jika tidak ada foto sama sekali
                if (!imgBuffer) {
                    await sock.sendMessage(from, {
                        text: "Kirim foto + caption *!s* atau reply foto lalu ketik *!s*, Bang."
                    });
                    return;
                }

                try {
// Panggil rumus getRandom tadi
                    const input = `./${getRandom('jpg')}`;   // Hasilnya misal: ./8291_17458291.jpg
                    const output = `./${getRandom('webp')}`; // Hasilnya misal: ./1928_17458291.webp

                    fs.writeFileSync(input, imgBuffer);

                    const cmdMagick =
                        `magick "${input}" ` +
                        `-resize 512x512 ` +
                        `-background none -gravity center -extent 512x512 "${output}"`;

                    await execAsync(cmdMagick);

                    const stickerBuf = fs.readFileSync(output);

                    await sendStickerWithMeta(sock, from, stickerBuf, {
                        packname: "BangBot",
                        author: "BangBot"
                    });

                try {
                    if (fs.existsSync(input)) fs.unlinkSync(input);
                } catch (e) { /* Biarin aja kalau gagal hapus */ }

                try {
                    if (fs.existsSync(output)) fs.unlinkSync(output);
                } catch (e) { /* Biarin aja */ }

                } catch (err) {
                    console.error("!s error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal membuat stiker, Bang."
                    });
                }

                return;
            }

// =================================================
            // FITUR CONFESS (VERSI MANUAL !BALAS)
            // =================================================
            if (cmd === "!confess" || cmd === "!menfess" || cmd === "!surat") {
                const raw = teks.replace(cmd, "").trim();
                const parts = raw.split("|");

                if (parts.length < 2) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Format salah Bang.\n\nContoh:\n*${cmd} 0812xxx | Isi Pesan | Nama Pengirim (Opsional)*` 
                    }, { quoted: msg });
                }

                let targetNum = parts[0].trim().replace(/[^0-9]/g, '');
                const pesan = parts[1].trim();
                let pengirim = parts[2] ? parts[2].trim() : "Rahasia";

                // Format nomor ke 628xxx
                if (targetNum.startsWith('08')) {
                    targetNum = '62' + targetNum.slice(1);
                }
                const targetJid = targetNum + '@s.whatsapp.net';

                if (targetJid === from) return sock.sendMessage(from, { text: "Gak bisa kirim ke diri sendiri Bang." }, { quoted: msg });

                try {
                    const [result] = await sock.onWhatsApp(targetJid);
                    if (!result || !result.exists) {
                        return sock.sendMessage(from, { text: "❌ Nomor tidak terdaftar di WhatsApp." }, { quoted: msg });
                    }

                    // 🔥 SIMPAN SESI: Biar target bisa balas ke pengirim ini
                    activeConfess[targetJid] = from; 

                    // Pesan untuk Target
                    const confessMsg = 
`*PESAN ANONIM*
Dari: *${pengirim}*

"${pesan}"

_Ingin membalas pesan ini?_
_Ketik: *!balas* pesanmu_
_(Identitas pengirim tetap aman)_`;

                    // Kirim ke Target
                    await sock.sendMessage(targetJid, { text: confessMsg });

                    // Lapor ke Pengirim
                    await sock.sendMessage(from, { 
                        text: `✅ Berhasil terkirim ke *${targetNum}*.\nKalau dia membalas pakai command *!balas*, chatnya akan masuk ke sini.` 
                    }, { quoted: msg });

                } catch (err) {
                    console.error("Confess Error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengirim pesan." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR BALAS CONFESS
            // =================================================
            if (cmd === "!balas") {
                // Cek apakah ada yang pernah confess ke dia?
                const targetReplyJid = activeConfess[from]; // 'from' disini adalah si penerima confess tadi

                if (!targetReplyJid) {
                    return sock.sendMessage(from, { text: "❌ Tidak ada pesan Confess yang aktif untuk dibalas." }, { quoted: msg });
                }

                const isiBalasan = teks.replace("!balas", "").trim();
                if (!isiBalasan) {
                    return sock.sendMessage(from, { text: "Pesannya mana? Ketik: *!balas isi pesan*" }, { quoted: msg });
                }

                try {
                    // Kirim balasan ke Pengirim Awal
                    const replyMsg = 
`*BALASAN*

"${isiBalasan}"

_Ini adalah balasan dari target Confess kamu._
_Untuk membalas balik, gunakan command *!confess* lagi._`;

                    await sock.sendMessage(targetReplyJid, { text: replyMsg });

                    // Konfirmasi ke Penjawab
                    await sock.sendMessage(from, { text: "✅ Balasan terkirim ke pengirim rahasia." }, { quoted: msg });

                } catch (e) {
                    console.log("Gagal balas:", e);
                    await sock.sendMessage(from, { text: "Gagal mengirim balasan." }, { quoted: msg });
                }
            }

// =================================================
            // BRAT (MULTI-SERVER) — CARI YANG RAPI 🎨
            // =================================================
            if (cmd === "!brat") {
                const text = teks.replace(/!brat/i, "").trim();

                if (!text) {
                    await sock.sendMessage(from, { text: "Teksnya mana Bang?" }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                // DAFTAR SERVER (Urutan Prioritas: Siputzx -> Caliph -> Ryzendesu)
                // Siputzx biasanya emojinya lebih rapi (kecil)
                const apis = [
                    `https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(text)}`,
                    `https://brat.caliph.dev/api/brat?text=${encodeURIComponent(text)}`,
                    `https://api.ryzendesu.vip/api/maker/brat?text=${encodeURIComponent(text)}`
                ];

                for (const url of apis) {
                    try {
                        const { data } = await axios.get(url, { 
                            responseType: 'arraybuffer',
                            timeout: 5000 // Maksimal nunggu 5 detik per server
                        });

                        // Cek header untuk memastikan itu gambar, bukan error text
                        // (Kadang API error tapi balikin status 200)
                        if (data.length < 1000) continue; // Skip kalau file kekecilan (biasanya error json)

                        await sendStickerWithMeta(sock, from, data, {
                            packname: "BangBot",
                            author: "Brat Generator"
                        });
                        return; // Kalau sukses, stop loop (jangan coba server lain)

                    } catch (e) {
                        console.log("Server Brat skip:", e.message);
                        continue; // Coba server berikutnya
                    }
                }

                await sock.sendMessage(from, { text: "⚠️ Semua server Brat lagi down/limit. Coba lagi nanti." }, { quoted: msg });
            }

// =================================================
            // BRATVID — SUPER SLOW & READABLE (DELAY 0.8s) 🐢
            // =================================================
            if (cmd === "!bratvid") {
                const text = teks.replace(/!bratvid/i, "").trim();

                if (!text) {
                    await sock.sendMessage(from, { text: "Teksnya mana Bang?" }, { quoted: msg });
                    return;
                }
                
                const words = text.split(/\s+/);
                if (words.length > 30) {
                    await sock.sendMessage(from, { text: "Maksimal 30 kata aja Bang biar server gak nangis." }, { quoted: msg });
                    return;
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    const id = Date.now();
                    const framePaths = [];
                    
                    // --- DAFTAR API (Prioritas: Siputzx -> Caliph -> Ryzendesu) ---
                    const apiProviders = [
                        (t) => `https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(t)}`,
                        (t) => `https://brat.caliph.dev/api/brat?text=${encodeURIComponent(t)}`,
                        (t) => `https://api.ryzendesu.vip/api/maker/brat?text=${encodeURIComponent(t)}`
                    ];

                    const downloadFrame = async (txt) => {
                        for (const getUrl of apiProviders) {
                            try {
                                const url = getUrl(txt);
                                const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
                                const contentType = res.headers['content-type'] || '';
                                if (contentType.includes('image')) return res.data;
                            } catch (e) { continue; }
                        }
                        throw new Error("Semua API Down");
                    };

                    // --- DOWNLOAD FRAME ---
                    for (let i = 0; i < words.length; i++) {
                        const currentText = words.slice(0, i + 1).join(" ");
                        try {
                            const imgBuffer = await downloadFrame(currentText);
                            const frameFile = `./bratframe_${id}_${i}.png`;
                            fs.writeFileSync(frameFile, imgBuffer);
                            framePaths.push(frameFile);
                        } catch (err) {
                            console.log(`❌ Frame ${i} skip: ${err.message}`);
                        }
                        await new Promise(r => setTimeout(r, 200)); 
                    }

                    if (framePaths.length === 0) {
                        await sock.sendMessage(from, { text: "Gagal total Bang. API lagi pada tidur." }, { quoted: msg });
                        return;
                    }

                    // --- RENDER ANIMASI (SUPER SLOW) ---
                    const output = `./bratvid_${id}.webp`;
                    
                    // Tahan frame terakhir LEBIH LAMA LAGI (20x copy)
                    // Biar user puas baca endingnya
                    const lastFrame = framePaths[framePaths.length - 1];
                    for (let k = 0; k < 20; k++) framePaths.push(lastFrame);

                    const fileListStr = framePaths.join(" ");
                    
                    await new Promise((resolve, reject) => {
                        // UPDATE SETTINGAN KECEPATAN:
                        // -delay 80 = 0.8 detik per frame (Lambat & Jelas)
                        exec(`magick ${fileListStr} -loop 0 -delay 60 "${output}"`, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    // --- KIRIM ---
                    const st = fs.readFileSync(output);
                    await sendStickerWithMeta(sock, from, st, {
                        packname: "BangBot",
                        author: "Brat Animation"
                    });

                    // --- BERSIH-BERSIH ---
                    [...new Set(framePaths)].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
                    if (fs.existsSync(output)) fs.unlinkSync(output);

                } catch (e) {
                    console.error("BratVid Error:", e);
                    await sock.sendMessage(from, { text: "Error render animasi." }, { quoted: msg });
                }
            }

            // =================================================
            // TTS (KODE BAHASA OPSIONAL)
            // =================================================
            if (cmd === "!tts") {
                const parts = teks.trim().split(" ");
                parts.shift();

                let lang = "id";
                if (parts[0] && parts[0].length <= 5) {
                    lang = parts.shift();
                }

                const t = (parts.join(" ") || "").trim();

                if (!t) {
                    await sock.sendMessage(from, {
                        text: "Format: !tts [kode_bahasa] teks\nContoh: !tts id selamat pagi\natau: !tts en good morning"
                    });
                    return;
                }

                try {
                    const buf = await generateTTS(t, lang);

                    await sock.sendMessage(from, {
                        audio: buf,
                        mimetype: "audio/mpeg"
                    });
                } catch (err) {
                    console.error("TTS error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal generate TTS, coba lagi nanti ya Bang."
                    });
                }
            }

            // ---------- X / TWITTER ----------
            if (cmd === "!x" || cmd === "!twitter") {
                const url = teks.replace(new RegExp(cmd, "i"), "").trim().split(/\s+/)[0];

                if (!url) {
                    return sock.sendMessage(from, { text: "Masukkan URL X/Twitter." }, { quoted: msg });
                }
                if (!/https?:\/\/(x\.com|twitter\.com)\//i.test(url)) {
                    return sock.sendMessage(from, { text: "URL tidak valid. Gunakan link x.com / twitter.com." }, { quoted: msg });
                }

                return handleXWithYtDlp(sock, from, msg, url);
            }

            // =================================================
            // DOWNLOAD VIDEO / MEDIA
            // YT, FB, TH → yt-dlp
            // TT, X, PIN → API/helper khusus
            // IG punya handler sendiri di bawah
            if (["!yt", "!th", "!tt", "!pin"].includes(cmd)) {
                // Ambil URL setelah command
                const url = teks.replace(new RegExp(cmd, "i"), "").trim().split(" ")[0];

                if (!url) {
                    await sock.sendMessage(from, { text: "Masukkan URL." });
                    return;
                }

                // Cek limit harian dulu
                const limitCheck = checkDownloadLimit(sender, from);
                if (!limitCheck.ok) {
                    await sock.sendMessage(from, { text: limitCheck.msg });
                    return;
                }

                // ============================
                // CABANG BERDASARKAN PLATFORM
                // ============================

// =================================================
            // FITUR DOWNLOAD TIKTOK (NO WATERMARK)
            // =================================================
            if (cmd === "!tiktok" || cmd === "!tt") {
                const url = teks.replace(cmd, "").trim();

                if (!url) {
                    return sock.sendMessage(from, { text: `⚠️ Link TikTok-nya mana Bang?\nContoh: *${cmd} https://vt.tiktok.com/xxxx/*` }, { quoted: msg });
                }

                // Cek apakah URL valid
                if (!url.includes("tiktok.com")) {
                    return sock.sendMessage(from, { text: "⚠️ Link tidak valid. Pastikan link dari TikTok." }, { quoted: msg });
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // KITA PAKAI API "TIKLYDOWN" (Lebih Stabil & Gratis)
                    const apiUrl = `https://api.tiklydown.eu.org/api/download?url=${url}`;
                    const { data: res } = await axios.get(apiUrl);

                    // Cek apakah video ditemukan
                    if (!res || !res.video || !res.video.noWatermark) {
                        throw new Error("Video tidak ditemukan atau API limit.");
                    }

                    const captionTikTok = 
`*Author:* ${res.author.name} (@${res.author.unique_id})
*Judul:* ${res.title}
*Views:* ${res.stats.playCount}
*Likes:* ${res.stats.likeCount}

_Video dikirim tanpa watermark!_`;

                    // Kirim Video
                    await sock.sendMessage(from, { 
                        video: { url: res.video.noWatermark }, 
                        caption: captionTikTok 
                    }, { quoted: msg });
                    
                    // Kirim Audio/Musik (Opsional, kalau mau audionya aja)
                    // await sock.sendMessage(from, { audio: { url: res.music.play_url }, mimetype: 'audio/mp4' }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("TikTok Error:", e);
                    // OPSI BACKUP: KALAU TIKLYDOWN GAGAL, COBA LOVETIK / AGATZ
                    try {
                        const backupUrl = `https://api.agatz.xyz/api/tiktok?url=${url}`;
                        const { data: backupRes } = await axios.get(backupUrl);
                        
                        if (backupRes.status !== 200) throw new Error("Backup gagal.");

                        await sock.sendMessage(from, { 
                            video: { url: backupRes.data.data.no_watermark }, 
                            caption: "✅ (Backup Server) Sukses Download!" 
                        }, { quoted: msg });
                        
                    } catch (e2) {
                        await sock.sendMessage(from, { text: "❌ Gagal download Bang. Videonya diprivate atau server lagi down." }, { quoted: msg });
                    }
                }
            }

                // ---------- PINTEREST ----------
                if (cmd === "pin" || cmd === "!pin") {
                    const url = teks.replace(/!pin/i, "").trim();

                    if (!url || !url.includes("pinterest.com")) {
                        await sock.sendMessage(from, {
                            text: "Format: *!pin url_pinterest*\nContoh: !pin https://id.pinterest.com/pin/18718154695575332/"
                        }, { quoted: msg });
                        return;
                    }

                    const limitCheck = checkDownloadLimit(sender, from);
                    if (!limitCheck.ok) {
                        await sock.sendMessage(from, { text: limitCheck.message }, { quoted: msg });
                        return;
                    }

                    await sock.sendMessage(from, {
                        text: "Proses Bang!"
                    }, { quoted: msg });

                    const ok = await handlePinterestWithFallback(sock, from, msg, url);

                    if (!ok) {
                        await sock.sendMessage(from, {
                            text: "❌ Gagal mengunduh dari Pinterest (primary & backup). Coba beberapa saat lagi atau cek endpoint API di .env."
                        }, { quoted: msg });
                    }

                    return;
                }

                // ---------- DEFAULT: YT / FB / TH via yt-dlp ----------
                // (hanya !yt, !th yang jatuh ke sini)
                await sock.sendMessage(from, { text: "Proses Bang!" });

                try {
                    const out = `./dl_${Date.now()}.mp4`;
                    await downloadWithYtDlp(url, out);

                    const video = fs.readFileSync(out);
                    await sock.sendMessage(from, {
                        video,
                        caption: "Selesai Bang!"
                    });

                    fs.unlinkSync(out);
                } catch (err) {
                    console.error("Download error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal mengunduh video. Coba cek URL atau coba lagi nanti."
                    });
                }
            }

// =================================================
            // FITUR FACEBOOK (FIXED PHOTO & NEW ENGINE)
            // ✅ Fix Link Foto (Gak bakal buntung lagi)
            // ✅ Engine Baru: RyzenDesu (Biasanya lebih kebal blokir)
            // ✅ Fake User-Agent (Biar dikira browser PC)
            // =================================================
            if (cmd === "fb" || cmd === "fbdl" || cmd === "fbdownload" || cmd === "!fb") {
                let rawUrl = teks.replace(/!fb|fb|!fbdl|fbdl|!fbdownload|fbdownload/gi, "").trim();
                
                if (!rawUrl || !rawUrl.match(/(facebook\.com|fb\.watch|fb\.com)/gi)) {
                    return sock.sendMessage(from, { text: "⚠️ Linknya mana Bang?" }, { quoted: msg });
                }

                // 1. LOGIKA PEMBERSIH URL (YANG BENAR) 🧠
                let targetUrl = rawUrl;
                
                // Cek apakah ini Link Foto? (Ada 'photo', 'fbid', atau 'set=')
                const isPhoto = /photo|fbid|set=/.test(rawUrl);

                if (isPhoto) {
                    // KHUSUS FOTO: Jangan buang tanda tanya (?) karena ID-nya disitu!
                    // Kita cuma buang sampah tracker '&so=' kalau ada
                    targetUrl = rawUrl.split('&so=')[0]; 
                    console.log(`[FB] Mode: PHOTO (Full Link) | ${targetUrl}`);
                } else {
                    // KHUSUS VIDEO: Buang tanda tanya (?) biar bersih
                    // Dan ubah ke format /reel/ kalau dia format /videos/
                    let videoIdMatch = rawUrl.match(/(?:videos\/|reel\/|vb\.\d+\/|v\/|\?v=)(\d+)/);
                    if (videoIdMatch && videoIdMatch[1]) {
                        targetUrl = `https://www.facebook.com/reel/${videoIdMatch[1]}`;
                    } else {
                        targetUrl = rawUrl.split('?')[0];
                    }
                    console.log(`[FB] Mode: VIDEO (Clean Link) | ${targetUrl}`);
                }
                
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                // Header KTP Palsu (Biar API gak nolak request Koyeb)
                const fakeHeaders = {
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
                    }
                };

                try {
                    let resultMedia = null;

                    // --- ENGINE 1: RYZENDESU (Kuat & Stabil) ---
                    try {
                        console.log("[FB] Engine 1: RyzenDesu...");
                        const { data } = await axios.get(`https://api.ryzendesu.vip/api/downloader/fbdl?url=${encodeURIComponent(targetUrl)}`, fakeHeaders);
                        
                        if (data && data.url) {
                             // RyzenDesu biasanya return { url: '...', hd: '...' }
                             let urlVideo = data.hd || data.url || data.sd;
                             resultMedia = {
                                type: 'video',
                                url: urlVideo,
                                caption: "✅ Facebook Video (Ryzen)",
                                quality: data.hd ? "HD" : "SD"
                             };
                        } else if (data.result && Array.isArray(data.result)) {
                             // Kadang formatnya array
                             let vid = data.result.find(v => v.resolution === "HD") || data.result[0];
                             resultMedia = {
                                type: 'video',
                                url: vid.url,
                                caption: "✅ Facebook Video (Ryzen)",
                                quality: "HD/SD"
                             };
                        }
                    } catch (e) { console.log(`[FB] Engine 1 Skip: ${e.message}`); }

                    // --- ENGINE 2: WIDIPE (Cadangan) ---
                    if (!resultMedia) {
                        try {
                            console.log("[FB] Engine 2: WidiPe...");
                            const { data } = await axios.get(`https://widipe.com/download/fbdown?url=${encodeURIComponent(targetUrl)}`, fakeHeaders);
                            const res = data.result;
                            if (res) {
                                if (res.HD || res.Normal_video || res.SD) {
                                    resultMedia = {
                                        type: 'video',
                                        url: res.HD || res.Normal_video || res.SD,
                                        caption: "✅ Facebook Video (WidiPe)",
                                        quality: res.HD ? "HD" : "SD"
                                    };
                                }
                            }
                        } catch (e) { console.log(`[FB] Engine 2 Skip: ${e.message}`); }
                    }

                    // --- ENGINE 3: FALLBACK MANUAL (Buat Foto) ---
                    // Kalau API Video gagal semua, atau memang link foto, kita coba scrape simpel
                    if (!resultMedia && isPhoto) {
                        // Karena API downloader jarang support foto, kita asumsi link foto FB kadang bisa dibuka langsung
                        // Tapi karena FB butuh login, ini untung-untungan.
                        // Kita coba pakai screenshot logic atau kirim link original
                        return sock.sendMessage(from, { text: "❌ Maaf Bang, API Downloader saat ini cuma support Video. Untuk foto silakan screenshot manual ya." }, { quoted: msg });
                    }

                    // --- KIRIM HASIL ---
                    if (resultMedia) {
                        await sock.sendMessage(from, { 
                            video: { url: resultMedia.url }, 
                            caption: `${resultMedia.caption}\n📊 Quality: ${resultMedia.quality}`,
                            gifPlayback: false 
                        }, { quoted: msg });
                        
                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else {
                        throw new Error("Semua API Zonk / IP Koyeb Diblokir");
                    }

                } catch (e) {
                    console.error("[FB] Fatal:", e.message);
                    await sock.sendMessage(from, { text: "❌ Gagal Download. Server API menolak akses (IP Koyeb Limit)." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR INSTAGRAM (RECURSIVE FIX)
            // =================================================
            if (cmd === "!ig" || cmd === "!instagram") {
                const url = teks.replace(cmd, "").trim();

                if (!url) {
                    return sock.sendMessage(from, { text: `⚠️ Link Instagram-nya mana Bang?\nContoh: *${cmd} https://www.instagram.com/reel/xxxx/*` }, { quoted: msg });
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // Buat folder sementara unik
                    const folderName = `ig_${Date.now()}`;
                    const outputDir = path.join(__dirname, folderName);
                    
                    if (!fs.existsSync(outputDir)) {
                        fs.mkdirSync(outputDir);
                    }

                    // Jalankan Gallery-DL
                    // Kita pakai execSync biar bot nungguin download selesai dulu baru lanjut
                    const { execSync } = require("child_process");
                    
                    // Command download
                    execSync(`gallery-dl --cookies "instagram_cookies.txt" -d "${outputDir}" "${url}"`);

                    // --- FUNGSI PENCARI FILE RECURSIVE (PENCARI PINTAR) ---
                    // Fungsi ini akan mencari file sampai ke folder terdalam
                    const getAllFiles = (dirPath, arrayOfFiles) => {
                        files = arrayOfFiles || [];
                        const items = fs.readdirSync(dirPath);

                        items.forEach((item) => {
                            if (fs.statSync(path.join(dirPath, item)).isDirectory()) {
                                files = getAllFiles(path.join(dirPath, item), files);
                            } else {
                                files.push(path.join(dirPath, item));
                            }
                        });

                        return files;
                    };

                    // Cari semua file di folder output
                    const foundFiles = getAllFiles(outputDir);

                    // Filter cuma ambil file video/foto (buang file json/txt kalau ada)
                    const mediaFiles = foundFiles.filter(file => 
                        file.endsWith(".mp4") || file.endsWith(".jpg") || file.endsWith(".png") || file.endsWith(".jpeg")
                    );

                    if (mediaFiles.length === 0) {
                        throw new Error("File media tidak ditemukan setelah download.");
                    }

                    // Kirim semua file yang ditemukan
                    for (let file of mediaFiles) {
                        // Cek Video atau Foto
                        if (file.endsWith(".mp4")) {
                            await sock.sendMessage(from, { 
                                video: fs.readFileSync(file), 
                                caption: "" 
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { 
                                image: fs.readFileSync(file), 
                                caption: "" 
                            }, { quoted: msg });
                        }
                    }

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                    // Bersihkan file sampah setelah dikirim
                    fs.rmSync(outputDir, { recursive: true, force: true });

                } catch (e) {
                    console.error("IG Error:", e);
                    await sock.sendMessage(from, { text: "❌ Gagal download. Mungkin akun diprivate atau cookies kedaluwarsa." }, { quoted: msg });
                }
            }

            // =================================================
            // YT AUDIO
            // =================================================
            if (cmd === "!yta") {
                const url = teks.replace(/!yta/i, "").trim();
                if (!url) {
                    await sock.sendMessage(from, { text: "Masukkan URL." });
                    return;
                }

                const limitCheck = checkDownloadLimit(sender, from);
                if (!limitCheck.ok) {
                    await sock.sendMessage(from, { text: limitCheck.msg });
                    return;
                }

                const out = `./aud_${Date.now()}.mp3`;
                await sock.sendMessage(from, { text: "Proses Bang!" });

                try {
                    await downloadWithYtDlp(url, out, { audioOnly: true });

                    const aud = fs.readFileSync(out);
                    await sock.sendMessage(from, {
                        audio: aud,
                        mimetype: "audio/mpeg",
                        ptt: false
                    });

                    fs.unlinkSync(out);
                } catch (err) {
                    console.error("YTA error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal mengambil audio, Bang. Coba lagi nanti."
                    });
                }
            }

            // --- FITUR EFEK STIKER (BLUR & GRAY) ---
            if (cmd === "!sblur" || cmd === "!sgray") {
                try {
                    const isQuotedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                    const isImage = msg.message?.imageMessage;
                    const quote = isQuotedImage ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;

                    if (!isQuotedImage && !isImage) {
                        return sock.sendMessage(from, { text: "Reply gambarnya dulu, Bang!" }, { quoted: msg });
                    }

                    await sock.sendMessage(from, { text: "⏳ Sedang mengedit stiker..." }, { quoted: msg });

                    // 1. Download gambar
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./sticker_in_${stamp}.jpg`;
                    const outPath = `./sticker_out_${stamp}.webp`;
                    
                    fs.writeFileSync(inPath, buf);

                    // 2. Tentukan Filter FFmpeg berdasarkan command
                    // boxblur=20:1 -> Efek blur kuat
                    // hue=s=0 -> Saturation 0 (Hitam Putih/Grayscale)
                    let filter = "";
                    if (cmd === "!sblur") {
                        filter = ",boxblur=20:1"; 
                    } else if (cmd === "!sgray") {
                        filter = ",hue=s=0";
                    }

                    // 3. Konversi ke WebP (Stiker) + Resize 512x512 + Filter Effect
                    // Command ini meresize gambar agar muat di kotak stiker, memberi background transparan, lalu memberi efek
                    await execPromise(`ffmpeg -y -i "${inPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000${filter}" -f webp "${outPath}"`);

                    // 4. Kirim stiker
                    await sock.sendMessage(from, { 
                        sticker: fs.readFileSync(outPath) 
                    }, { quoted: msg });

                    // Cleanup
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Sticker Effect Error:", err);
                    await sock.sendMessage(from, { text: "Gagal membuat efek stiker, Bang." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR EMOJIMIX (DIRECT GOOGLE STABLE) ---
            if (cmd === "!emojimix" || cmd === "!mix") {
                const args = teks.replace(cmd, "").trim();
                // Pisahkan input berdasarkan tanda tambah (+) atau spasi
                let [emoji1, emoji2] = args.split(/[+ ]+/);

                if (!emoji1 || !emoji2) {
                    return sock.sendMessage(from, { text: "Caranya salah Bang.\nContoh: *!emojimix 🥺+😭*" }, { quoted: msg });
                }

                try {

                    // Kita gunakan wrapper 'emojik' yang mengarah langsung ke server Google
                    // Format URL: https://emojik.vercel.app/s/🥺_😭?size=512
                    // Kita encodeURIComponent biar emoji aneh-aneh tetap terbaca server
                    const url = `https://emojik.vercel.app/s/${encodeURIComponent(emoji1)}_${encodeURIComponent(emoji2)}?size=512`;

                    const { data } = await axios.get(url, {
                        responseType: 'arraybuffer',
                        headers: {
                            // Wajib pakai User-Agent biar request kita dianggap browser resmi
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                        }
                    });

                    // Validasi: Pastikan data yang diterima benar-benar file PNG
                    // Magic bytes untuk PNG selalu diawali: 0x89 0x50 0x4E 0x47
                    if (!data || data.length < 4 || data[0] !== 0x89) {
                        throw new Error("Respon bukan gambar PNG valid.");
                    }

                    const stamp = Date.now();
                    const inPath = `./emomix_in_${stamp}.png`;
                    const outPath = `./emomix_out_${stamp}.webp`;

                    fs.writeFileSync(inPath, data);

                    // Convert ke WebP (Stiker) pakai FFmpeg
                    await execPromise(`ffmpeg -y -i "${inPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -f webp "${outPath}"`);

                    await sock.sendMessage(from, { sticker: fs.readFileSync(outPath) }, { quoted: msg });

                    // Bersih-bersih file sampah
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Emojimix Error:", err.message);
                    
                    // Tangani Error 404 (Artinya kombinasi emoji ini GAK ADA di Google)
                    if (err.response && err.response.status === 404) {
                        await sock.sendMessage(from, { text: "Gagal Bang. Kombinasi emoji ini belum dibuat sama Google. Coba pasangan lain!" }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: "Gagal mengambil gambar. Server error." }, { quoted: msg });
                    }
                }
                return;
            }

            // --- FITUR PENCARI STIKER (FIXED) ---
            if (cmd === "!ssearch" || cmd === "!caristiker") {
                const query = teks.replace(cmd, "").trim();
                if (!query) return sock.sendMessage(from, { text: "Mau cari stiker apa Bang? Contoh: *!ssearch kucing*" }, { quoted: msg });

                try {
                    await sock.sendMessage(from, { text: `Mencari stiker "${query}"...` }, { quoted: msg });

                    const cheerio = require('cheerio');
                    
                    // Header "User-Agent" ini PENTING biar gak diblokir website target
                    const headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    };

                    // 1. Cari Pack Stiker
                    const searchUrl = `https://getstickerpack.com/stickers?query=${encodeURIComponent(query)}`;
                    const { data: html } = await axios.get(searchUrl, { headers });
                    const $ = cheerio.load(html);

                    // Ambil link pack (Coba 2 jenis selector biar pasti dapat)
                    let packUrls = [];
                    
                    // Selector 1 (Tampilan List)
                    $('.sticker-pack-list .sticker-pack-list-item a').each((i, el) => {
                        const href = $(el).attr('href');
                        if (href) packUrls.push(href);
                    });

                    // Selector 2 (Tampilan Grid - Fallback)
                    if (packUrls.length === 0) {
                        $('.sticker-pack-cols a').each((i, el) => {
                            const href = $(el).attr('href');
                            if (href && href.includes('/stickers/')) packUrls.push(href);
                        });
                    }

                    if (packUrls.length === 0) {
                        return sock.sendMessage(from, { text: "Tetap gak nemu Bang. Mungkin websitenya lagi down atau kata kuncinya terlalu aneh." }, { quoted: msg });
                    }

                    // 2. Pilih 1 Pack Random
                    const randomPackUrl = packUrls[Math.floor(Math.random() * packUrls.length)];
                    // console.log("Pack terpilih:", randomPackUrl); // Debug

                    // 3. Buka Pack & Ambil Stiker
                    const { data: packHtml } = await axios.get(randomPackUrl, { headers });
                    const $$ = cheerio.load(packHtml);
                    
                    let stickerImages = [];
                    $$('img.sticker-image').each((i, el) => {
                        // Ambil link gambar resolusi tinggi (data-src-large) atau biasa (src)
                        const imgUrl = $$(el).attr('data-src-large') || $$(el).attr('src');
                        if (imgUrl) stickerImages.push(imgUrl);
                    });

                    if (stickerImages.length === 0) {
                        return sock.sendMessage(from, { text: "Packnya kebuka, tapi isinya kosong Bang. Coba lagi." }, { quoted: msg });
                    }

                    // 4. Pilih 1 Stiker Random & Kirim
                    const randomSticker = stickerImages[Math.floor(Math.random() * stickerImages.length)];
                    
                    const { data: imgData } = await axios.get(randomSticker, { responseType: 'arraybuffer', headers });
                    const stamp = Date.now();
                    const inPath = `./stick_in_${stamp}.png`;
                    const outPath = `./stick_out_${stamp}.webp`;

                    fs.writeFileSync(inPath, imgData);

                    // Resize standar stiker WhatsApp (512x512)
                    await execPromise(`ffmpeg -y -i "${inPath}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -f webp "${outPath}"`);

                    await sock.sendMessage(from, { sticker: fs.readFileSync(outPath) }, { quoted: msg });

                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Sticker Search Error:", err.message);
                    await sock.sendMessage(from, { text: "Error koneksi saat cari stiker." }, { quoted: msg });
                }
                return;
            }

// =================================================
            // FITUR CEK STATUS SERVER (DIAGNOSTIC TOOL)
            // =================================================
            if (cmd === "!status" || cmd === "!cek" || cmd === "!ping") {
                await sock.sendMessage(from, { react: { text: "🩺", key: msg.key } });

                let report = "📊 *LAPORAN STATUS SERVER*\n--------------------------\n";
                const start = Date.now();

                // 1. CEK KONEKSI INTERNET (Ping Google)
                try {
                    await axios.get("https://www.google.com");
                    report += "🌐 *Internet Bot:* ✅ Aman\n";
                } catch (e) {
                    report += "🌐 *Internet Bot:* ❌ Down/Lambat\n";
                }

                // 2. CEK GROQ (Otak Curhat & Resep)
                try {
                    await groq.chat.completions.create({
                        messages: [{ role: "user", content: "hi" }],
                        model: "llama-3.3-70b-versatile",
                        max_tokens: 1
                    });
                    report += "🤖 *Groq AI (Curhat):* ✅ Aktif\n";
                } catch (e) {
                    report += "🤖 *Groq AI (Curhat):* ❌ Error (Cek Key/Model)\n";
                }

                // 3. CEK GEMINI (Mata Vision)
                try {
                    // Cek generate text simple
                    await model.generateContent("tes");
                    report += "🧠 *Gemini (Vision):* ✅ Aktif\n";
                } catch (e) {
                    report += "🧠 *Gemini (Vision):* ❌ Error (Cek Key)\n";
                }

                // 4. CEK UPLOAD GAMBAR (Catbox)
                try {
                    await axios.get("https://catbox.moe/user/api.php"); // Cek endpoint hidup aja
                    report += "📂 *Catbox (Upload):* ✅ Aktif\n";
                } catch (e) {
                    report += "📂 *Catbox (Upload):* ❌ Down\n";
                }

                // 5. CEK STIKER (Giphy)
                try {
                    // Cek akses ke Giphy public
                    await axios.get("https://api.giphy.com/v1/stickers/trending?api_key=TvF9Udz2Y1uZ91Ju&limit=1");
                    report += "🎨 *Giphy (Stiker):* ✅ Aktif\n";
                } catch (e) {
                    report += "🎨 *Giphy (Stiker):* ❌ Down\n";
                }

                // 6. CEK AGATZ (Remove BG)
                try {
                    await axios.get("https://api.agatz.xyz");
                    report += "✂️ *Agatz (RemoveBG):* ✅ Aktif\n";
                } catch (e) {
                    report += "✂️ *Agatz (RemoveBG):* ❌ Down\n";
                }

                // Hitung Kecepatan Respon
                const latency = Date.now() - start;
                report += `--------------------------\n⚡ *Kecepatan:* ${latency}ms`;

                await sock.sendMessage(from, { text: report }, { quoted: msg });
                await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
            }

// =================================================
            // FITUR GETS (SEARCH STICKER) - VERSI RYZE
            // =================================================
            if (cmd === "gets" || cmd === "!gets") {
                const query = args.join(" ");
                if (!query) return sock.sendMessage(from, { text: "⚠️ Mau cari stiker apa Bang?\nContoh: *!gets kucing*" }, { quoted: msg });

                console.log(`[GETS] Mencari stiker: ${query}`);
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // Pakai API Ryzendesu (Free & No API Key Needed)
                    const { data } = await axios.get(`https://api.ryzendesu.vip/api/sticker/getsticker?q=${encodeURIComponent(query)}`);
                    
                    // Cek jika ada hasil
                    if (!data || !data.result || data.result.length === 0) {
                        return sock.sendMessage(from, { text: `❌ Stiker *${query}* tidak ditemukan.` }, { quoted: msg });
                    }

                    // Ambil 1 stiker secara acak
                    const randomSticker = data.result[Math.floor(Math.random() * data.result.length)];

                    console.log(`[GETS] Mengirim stiker dari: ${randomSticker}`);

                    // Kirim sebagai stiker
                    await sock.sendMessage(from, { 
                        sticker: { url: randomSticker } 
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("[GETS] Error:", e.message);
                    await sock.sendMessage(from, { text: "❌ Server stiker sedang sibuk atau down. Coba lagi nanti." }, { quoted: msg });
                }
            }

            // --- FITUR CEK STATUS SERVER ---
            if (cmd === "!sysinfo" || cmd === "!info") {
                const speed = require('performance-now'); // Kalau belum ada, hapus baris ini dan bagian 'Kecepatan Respon'
                
                // Hitung Uptime (Durasi Bot Nyala)
                const uptime = process.uptime();
                const hari = Math.floor(uptime / (24 * 3600));
                const jam = Math.floor((uptime % (24 * 3600)) / 3600);
                const menit = Math.floor((uptime % 3600) / 60);
                const detik = Math.floor(uptime % 60);

                // Hitung RAM
                const totalRam = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
                const freeRam = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
                const usedRam = (os.totalmem() - os.freemem()) / 1024 / 1024 / 1024;
                
                let textInfo = `*SYSTEM INFORMATION*

*Uptime:* ${hari}d ${jam}h ${menit}m ${detik}s
*RAM:* ${usedRam.toFixed(2)} GB / ${totalRam} GB
*Platform:* ${os.platform()} (${os.arch()})
*Hostname:* ${os.hostname()}
*NodeJS:* ${process.version}

Bot berjalan lancar di PC Abang!`;

                await sock.sendMessage(from, { text: textInfo }, { quoted: msg });
                return;
            }

            // --- FITUR AI CHAT (ChatGPT-like) ---
            if (cmd === "!ai" || cmd === "!tanya" || cmd === "!gpt") {
                const query = teks.replace(cmd, "").trim();
                
                // Cek apakah user mengetik pertanyaan
                if (!query) {
                    return sock.sendMessage(from, { text: "Mau nanya apa Bang? Contoh: *!ai cara bikin kopi enak*" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "Proses Bang..." }, { quoted: msg });

                    // Menggunakan API Gratis dari Pollinations
                    // Model: OpenAI (secara default) atau sejenisnya
                    const url = `https://text.pollinations.ai/${encodeURIComponent(query)}`;
                    
                    const response = await axios.get(url);
                    
                    // Respons biasanya berupa teks langsung (raw text)
                    const answer = response.data;

                    if (!answer) {
                        throw new Error("Jawaban kosong");
                    }

                    // Kirim jawaban ke WhatsApp
                    await sock.sendMessage(from, { 
                        text: `*Jawaban AI:*\n\n${answer}` 
                    }, { quoted: msg });

                } catch (err) {
                    console.error("AI Error:", err.message);
                    await sock.sendMessage(from, { text: "Waduh, AI-nya lagi pusing (Server Error). Coba tanya yang lain dulu Bang." }, { quoted: msg });
                }
                return;
            }

// =================================================
            // FITUR SMART EDIT (GEMINI VISION + POLLINATIONS)
            // =================================================
            if (cmd === "!edit" || cmd === "!ubah") {
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                const isImage = msg.message.imageMessage;
                const userCommand = teks.replace(cmd, "").trim();

                if (!isQuotedImage && !isImage) {
                    return sock.sendMessage(from, { text: `⚠️ Kirim/Reply foto dengan caption perintah.\nContoh: *${cmd} rambut jadi merah*` }, { quoted: msg });
                }

                if (!userCommand) {
                    return sock.sendMessage(from, { text: "⚠️ Mau diedit jadi apa Bang? Tulis perintahnya." }, { quoted: msg });
                }

                // 1. React 'Jam' 🕑
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // 2. Download Gambar
                    let mediaBuffer;
                    if (isQuotedImage) {
                        mediaBuffer = await downloadMediaMessage(
                            { message: msg.message.extendedTextMessage.contextInfo.quotedMessage }, 'buffer', {}
                        );
                    } else {
                        mediaBuffer = await downloadMediaMessage(msg, 'buffer', {});
                    }

                    // --- TAHAP 1: GEMINI MELIHAT GAMBAR ---
                    // Kita suruh Gemini mendeskripsikan fisik orang di foto biar gak salah orang
                    const imagePart = {
                        inlineData: {
                            data: mediaBuffer.toString("base64"),
                            mimeType: "image/jpeg"
                        }
                    };

                    const visionPrompt = "Describe the main subject in this photo in English strictly for image generation prompt. Focus on: Gender, Age, Ethnicity, Hair style, Facial features, and Clothing. Keep it concise (1 sentence).";
                    
                    // Pastikan variabel 'model' (Gemini) sudah didefinisikan di atas
                    const resultVis = await model.generateContent([visionPrompt, imagePart]);
                    const description = resultVis.response.text().trim();

                    // --- TAHAP 2: GABUNGKAN DESKRIPSI + PERINTAH USER ---
                    // Gabungan: "Pria Indonesia kemeja putih (dari Gemini)" + "Rambut jadi merah (dari User)"
                    const finalPrompt = `((${description})), modify to: ${userCommand}, preserve original face identity, high quality, photorealistic`;

                    // 3. Upload ke Catbox (Buat Pollinations)
                    const imageUrl = await uploadToCatbox(mediaBuffer);

                    // 4. Generate pakai Pollinations (Model Flux Realism)
                    const randomSeed = Math.floor(Math.random() * 1000);
                    const finalUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1024&height=1024&seed=${randomSeed}&nologo=true&model=flux-realism&image=${encodeURIComponent(imageUrl)}`;

                    // 5. Kirim Hasil
                    await sock.sendMessage(from, { 
                        image: { url: finalUrl }, 
                        caption: `🎨 *EDIT SUKSES*\n\n📝 **Analisa AI:** "${description}"\n✨ **Edit:** "${userCommand}"` 
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("Smart Edit Error:", e);
                    await sock.sendMessage(from, { text: "❌ Gagal edit Bang. Server lagi sibuk." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR PLAY MUSIC V7.1 (FIXED + COBALT MIRROR)
            // =================================================
            if (cmd === "!play" || cmd === "!lagu" || cmd === "!song") {
                const query = teks.replace(cmd, "").trim();

                if (!query) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Judul lagunya apa Bang?\nContoh: *${cmd} Juicy Luicy Lantas*` 
                    }, { quoted: msg });
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // 1. CARI VIDEO DI YOUTUBE
                    const search = await yts(query);
                    const video = search.videos[0]; 

                    if (!video) {
                        return sock.sendMessage(from, { text: "❌ Lagu tidak ditemukan." }, { quoted: msg });
                    }

                    const infoLagu = 
`*Judul:* ${video.title}
*Durasi:* ${video.timestamp}
*Link:* ${video.url}

_Sedang mengambil audio..._`;

                    await sock.sendMessage(from, { 
                        image: { url: video.thumbnail }, 
                        caption: infoLagu 
                    }, { quoted: msg });

                    let audioUrl = "";

                    // --- CARA 1: BTCH DOWNLOADER (FIXED) ---
                    try {
                        console.log("Mencoba BTCH...");
                        const data = await youtube(video.url);
                        if (data && data.mp3) {
                            audioUrl = data.mp3;
                            console.log("BTCH Sukses!");
                        }
                    } catch (e) {
                        console.log("BTCH Gagal, lanjut backup...");
                    }

                    // --- CARA 2: COBALT MIRROR (BACKUP KUAT) ---
                    // Karena server official cobalt mati, kita pakai mirror (server orang lain)
                    if (!audioUrl) {
                        try {
                            console.log("Mencoba Cobalt Mirror...");
                            const cobaltBody = {
                                url: video.url,
                                vCodec: "h264",
                                vQuality: "720",
                                aFormat: "mp3",
                                isAudioOnly: true
                            };
                            
                            // Mirror yang biasanya hidup:
                            const mirrorUrl = "https://cobalt.smartlabel.uk/api/json"; 
                            
                            const { data: res } = await axios.post(mirrorUrl, cobaltBody, {
                                headers: {
                                    "Accept": "application/json",
                                    "Content-Type": "application/json",
                                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                                }
                            });

                            if (res.url) audioUrl = res.url;
                        } catch (e) {
                            console.log("Cobalt Mirror Gagal.");
                        }
                    }

                    if (!audioUrl) {
                        throw new Error("Semua server downloader gagal.");
                    }

                    // 3. KIRIM HASIL
                    await sock.sendMessage(from, { 
                        audio: { url: audioUrl }, 
                        mimetype: 'audio/mp4', 
                        ptt: false, 
                        fileName: `${video.title}.mp3`
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("Play V7.1 Error:", e);
                    // FALLBACK LINK
                    await sock.sendMessage(from, { 
                        text: `❌ *Gagal Download Audio*\n\nServer lagi down parah Bang. Download manual aja:\n${query.includes('http') ? query : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)}` 
                    }, { quoted: msg });
                }
            }

// =================================================
            // FITUR CURHAT V4.1 (GROQ - LLAMA 3.3 UPDATE)
            // =================================================
            if (cmd === "!curhat" || cmd === "!saran" || cmd === "!ai") {
                const curhatan = teks.replace(cmd, "").trim();

                if (!curhatan) {
                    return sock.sendMessage(from, { text: `⚠️ Mau curhat apa Bang?\nContoh: *${cmd} Aku lagi capek kerja*` }, { quoted: msg });
                }

                // React
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // Panggil Groq dengan Model TERBARU (Llama 3.3 70B)
                    const chatCompletion = await groq.chat.completions.create({
                        messages: [
                            {
                                role: "system",
                                content: "Kamu adalah 'BangBot', asisten WhatsApp yang asik, lucu, gaul (pakai lo-gue), dan solutif. Jawab singkat, padat, dan seperti teman dekat."
                            },
                            {
                                role: "user",
                                content: curhatan
                            }
                        ],
                        // GANTI NAMA MODEL JADI INI:
                        model: "llama-3.3-70b-versatile", 
                    });

                    const response = chatCompletion.choices[0]?.message?.content || "Waduh, AI-nya bingung mau jawab apa.";

                    await sock.sendMessage(from, { text: response }, { quoted: msg });
                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("Groq Error:", e);
                    await sock.sendMessage(from, { text: "❌ Server AI lagi update sistem Bang, coba lagi nanti." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR RESEP MASAKAN (POWERED BY AI)
            // =================================================
            if (cmd === "!resep" || cmd === "!masak") {
                const masakan = teks.replace(cmd, "").trim();

                if (!masakan) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Mau masak apa Chef?\nContoh: *${cmd} Rendang Sapi Padang*` 
                    }, { quoted: msg });
                }

                // 1. React 'Jam' 🕑
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // Kita suruh AI yang mikir resepnya
                    // Ganti 'groq' jadi 'model' kalau Abang pakai Gemini
                    const chatCompletion = await groq.chat.completions.create({
                        messages: [
                            {
                                role: "system",
                                content: "Kamu adalah Chef Profesional bintang 5. Tugasmu memberikan resep masakan yang enak, detail, dan mudah diikuti. Format jawaban: 'BAHAN-BAHAN' lalu 'CARA MEMBUAT'."
                            },
                            {
                                role: "user",
                                content: `Berikan resep lengkap untuk membuat: ${masakan}`
                            }
                        ],
                        // Di dalam kodingan !resep
                        model: "llama-3.3-70b-versatile", // Ganti yang lama "llama3-8b-8192" jadi ini
                    });

                    const resep = chatCompletion.choices[0]?.message?.content;

                    // 2. Kirim Resep
                    await sock.sendMessage(from, { 
                        text: `${resep}` 
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("Resep AI Error:", e);
                    await sock.sendMessage(from, { text: "❌ Dapur lagi kebakaran Bang (Error). Coba menu lain." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR ARTI NAMA
            // =================================================
            if (cmd === "!artinama" || cmd === "!nama") {
                const nama = teks.replace(cmd, "").trim();

                if (!nama) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Namanya siapa Bang?\nContoh: *${cmd} Agus Kotak*` 
                    }, { quoted: msg });
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    const arti = await artiNama(nama);

                    if (!arti) {
                        return sock.sendMessage(from, { text: "❌ Maaf, arti nama tidak ditemukan di kitab primbon." }, { quoted: msg });
                    }

                    const pesanBalasan = 
`*ARTI NAMA*

*Nama:* ${nama}
*Arti:*
${arti}

_Note: Ini cuma ramalan/arti kata, jangan baper ya Bang!_`;

                    await sock.sendMessage(from, { text: pesanBalasan }, { quoted: msg });

                } catch (e) {
                    console.log(e);
                    await sock.sendMessage(from, { text: "Gagal mencari arti nama." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR IMAGE GENERATOR (POLLINATIONS - NO WM)
            // =================================================
            if (cmd === "!img" || cmd === "!lukis") {
                const prompt = teks.replace(cmd, "").trim();

                if (!prompt) {
                    return sock.sendMessage(from, { text: `⚠️ Mau gambar apa?\nContoh: *${cmd} kucing cyberpunk*` }, { quoted: msg });
                }

                // React baru sesuai request (Jam)
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // Random seed biar gambar beda-beda terus
                    const randomSeed = Math.floor(Math.random() * 1000);
                    
                    // Tambahkan '&nologo=true' biar bersih
                    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${randomSeed}&width=1024&height=1024&model=flux&nologo=true`;

                    await sock.sendMessage(from, { 
                        image: { url: url }, 
                        caption: `Prompt: ${prompt}` 
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("Img Error:", e);
                    await sock.sendMessage(from, { text: "❌ Gagal membuat gambar." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR TO ANIME (UBAH FOTO JADI ANIME) - VERSI STABIL
            // =================================================
            if (cmd === "!toanime" || cmd === "!jadianime") {
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                const isImage = msg.message.imageMessage;

                if (!isQuotedImage && !isImage) {
                    return sock.sendMessage(from, { text: "⚠️ Kirim/Reply foto wajah dengan caption *!toanime*" }, { quoted: msg });
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });
                // Kirim pesan tunggu biar user tau bot lagi kerja

                try {
                    // 1. Download Gambar dari chat
                    let mediaBuffer;
                    if (isQuotedImage) {
                        // Kalau reply gambar
                        mediaBuffer = await downloadMediaMessage(
                            { message: msg.message.extendedTextMessage.contextInfo.quotedMessage }, 'buffer', {}
                        );
                    } else {
                        // Kalau kirim gambar langsung
                        mediaBuffer = await downloadMediaMessage(msg, 'buffer', {});
                    }

                    // 2. Upload ke Catbox (Wajib sukses dulu biar dapet URL)
                    const imageUrl = await uploadToCatbox(mediaBuffer);

                    // 3. Request ke API Anime (Pakai YanzBotz - biasanya lebih stabil)
                    // Kalau ini gagal, nanti bisa coba ganti URL-nya.
                    const apiUrl = `https://api.yanzbotz.my.id/api/toanime?url=${imageUrl}`;
                    
                    // Test dulu apakah API merespon dengan gambar
                    // const check = await axios.get(apiUrl);
                    // if (check.headers['content-type'] !== 'image/jpeg' && check.headers['content-type'] !== 'image/png') {
                    //     throw new Error("API tidak mengembalikan gambar.");
                    // }

                    // 4. Kirim Hasilnya langsung dari URL API
                    await sock.sendMessage(from, { 
                        image: { url: apiUrl }, 
                        caption: "" 
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("ToAnime Error:", e);
                    // Pesan error yang lebih jelas
                    let errorMsg = "❌ Gagal mengubah gambar.";
                    if (e.message.includes("Catbox")) errorMsg = "❌ Gagal upload gambar ke server sementara.";
                    if (e.response?.status >= 500) errorMsg = "❌ Server Anime lagi sibuk/down. Coba lagi nanti.";

                    await sock.sendMessage(from, { text: errorMsg }, { quoted: msg });
                }
            }

// =================================================
            // FITUR HD / REMINI (SERVER: AGATZ)
            // =================================================
            if (cmd === "!hd" || cmd === "!remini") {
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                const isImage = msg.message.imageMessage;

                if (!isQuotedImage && !isImage) {
                    return sock.sendMessage(from, { text: "⚠️ Kirim/Reply foto burik dengan caption *!hd*" }, { quoted: msg });
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // 1. Download & Upload
                    let mediaBuffer;
                    if (isQuotedImage) {
                        mediaBuffer = await downloadMediaMessage(
                            { message: msg.message.extendedTextMessage.contextInfo.quotedMessage }, 'buffer', {}
                        );
                    } else {
                        mediaBuffer = await downloadMediaMessage(msg, 'buffer', {});
                    }
                    
                    const imageUrl = await uploadToCatbox(mediaBuffer);

                    // 2. Request ke Agatz
                    // API ini mengembalikan JSON berisi URL hasil
                    const { data } = await axios.get(`https://api.agatz.xyz/api/remini?url=${imageUrl}`);

                    if (!data || !data.data || !data.data.url) {
                        throw new Error("Respon API kosong");
                    }

                    // 3. Kirim Hasil
                    await sock.sendMessage(from, { 
                        image: { url: data.data.url }, 
                        caption: "" 
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("HD Error:", e);
                    await sock.sendMessage(from, { text: "❌ Server HD lagi sibuk Bang, coba beberapa saat lagi." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR ALARM (SUPPORT WIB, WITA, WIT)
            // =================================================
            if (cmd === "!alarm" || cmd === "!ingatkan") {
                const args = teks.split(" ");
                let waktuInput = args[1]; // misal: 15.30
                
                // 1. Deteksi apakah user ngetik zona waktu?
                let timeZone = "Asia/Jakarta"; // Default WIB
                let zonaLabel = "WIB";
                let msgStartIndex = 2; // Default: pesan mulai dari kata ke-3

                // Cek kata ketiga (args[2]), apakah itu wib/wita/wit?
                if (args[2]) {
                    const cekZona = args[2].toLowerCase();
                    if (cekZona === "wib") {
                        timeZone = "Asia/Jakarta";
                        zonaLabel = "WIB";
                        msgStartIndex = 3;
                    } else if (cekZona === "wita") {
                        timeZone = "Asia/Makassar";
                        zonaLabel = "WITA";
                        msgStartIndex = 3;
                    } else if (cekZona === "wit") {
                        timeZone = "Asia/Jayapura";
                        zonaLabel = "WIT";
                        msgStartIndex = 3;
                    }
                }

                // Ambil isi pesan alarm sesuai posisi index tadi
                const pesanAlarm = args.slice(msgStartIndex).join(" ") || "Waktu Habis!";

                // Validasi Format Waktu
                if (!waktuInput || !/^\d{1,2}[:.]\d{2}$/.test(waktuInput)) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Format salah Bang.\n\nContoh:\n*${cmd} 15.30 WIB Sholat*\n*${cmd} 16.00 WITA Pulang Kerja*\n*${cmd} 06.00 WIT Bangun Pagi*` 
                    }, { quoted: msg });
                }

                waktuInput = waktuInput.replace('.', ':');
                const [targetJam, targetMenit] = waktuInput.split(':').map(Number);

                if (targetJam > 23 || targetMenit > 59) {
                    return sock.sendMessage(from, { text: "⚠️ Jam gak valid Bang (00:00 - 23:59)." }, { quoted: msg });
                }

                // 2. Set Waktu Menggunakan Zona yang Dipilih
                const now = moment().tz(timeZone);
                const targetWaktu = moment().tz(timeZone);

                targetWaktu.hour(targetJam);
                targetWaktu.minute(targetMenit);
                targetWaktu.second(0);

                // Kalau jam target < jam sekarang, berarti buat BESOK
                if (targetWaktu.isBefore(now)) {
                    targetWaktu.add(1, 'day');
                }

                const durasiMs = targetWaktu.diff(now);
                const jamDisplay = targetWaktu.format("HH:mm");
                const hariDisplay = targetWaktu.format("DD MMM");

                // Konfirmasi ke User
                await sock.sendMessage(from, { 
                    text: `✅ Alarm diset untuk *${jamDisplay} ${zonaLabel}* (${hariDisplay}).\n📝 Pesan: "${pesanAlarm}"` 
                }, { quoted: msg });

                // Mulai Timer
                setTimeout(async () => {
                    const infoSender = isGroup ? (msg.key.participant || sender) : sender;
                    
                    await sock.sendMessage(from, { 
                        text: `⏰ *ALARM ${jamDisplay} ${zonaLabel} BUNYI!* ⏰\n\n👤 *Untuk:* @${infoSender.split('@')[0]}\n📝 *Pesan:* ${pesanAlarm}`,
                        mentions: [infoSender]
                    });
                }, durasiMs);
            }

            // --- FITUR TRANSLATE (GOOGLE TRANSLATE) ---
            if (cmd === "!tr" || cmd === "!translate") {
                // Cara pakai 1: !tr id good morning
                // Cara pakai 2: Reply pesan lalu ketik !tr id
                let args = teks.replace(cmd, "").trim().split(" ");
                let lang = args[0]; // Kode bahasa (id, en, ja, ko, dll)
                let textToTranslate = args.slice(1).join(" ");

                // Cek apakah user me-reply pesan
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!textToTranslate && quotedMsg) {
                    textToTranslate = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || "";
                }

                if (!lang || !textToTranslate) {
                    return sock.sendMessage(from, { 
                        text: "⚠️ Format salah Bang.\n\nContoh:\n*!tr id* Good morning\nAtau reply pesan teman ketik *!tr en*" 
                    }, { quoted: msg });
                }

                try {
                    // Menggunakan API Google Translate publik (Client GTX)
                    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
                    const { data } = await axios.get(url);

                    // Data API Google Translate berbentuk array bersarang
                    let result = "";
                    data[0].forEach(item => {
                        if (item[0]) result += item[0];
                    });

                    await sock.sendMessage(from, { text: `*Terjemahan:* \n\n${result}` }, { quoted: msg });

                } catch (err) {
                    console.error("Translate Error:", err);
                    await sock.sendMessage(from, { text: "Gagal menerjemahkan. Cek kode bahasa (id/en/ja)." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR WIKIPEDIA (FIXED USER-AGENT) ---
            if (cmd === "!wiki" || cmd === "!wikipedia") {
                const query = teks.replace(cmd, "").trim();
                
                if (!query) {
                    return sock.sendMessage(from, { text: "Mau cari apa di Wikipedia Bang? Contoh: *!wiki Teknik Mesin*" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: `Proses Bang...` }, { quoted: msg });

                    // URL API Wikipedia Bahasa Indonesia
                    const wikiUrl = `https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;

                    // PENTING: Tambahkan Headers User-Agent
                    const { data } = await axios.get(wikiUrl, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        }
                    });

                    if (!data || data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') {
                        return sock.sendMessage(from, { text: "Artikel tidak ditemukan, Bang." }, { quoted: msg });
                    }

                    // Ambil Data Penting
                    const title = data.title;
                    const summary = data.extract; // Ringkasan artikel
                    const imgUrl = data.originalimage ? data.originalimage.source : null;
                    const pageUrl = data.content_urls.desktop.page;

                    const caption = `*WIKIPEDIA: ${title}*
                    
${summary}

*Selengkapnya:* ${pageUrl}`;

                    // Kirim Gambar jika ada
                    if (imgUrl) {
                        await sock.sendMessage(from, { 
                            image: { url: imgUrl },
                            caption: caption
                        }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: caption }, { quoted: msg });
                    }

                } catch (err) {
                    console.error("Wiki Error:", err.message);
                    if (err.response && err.response.status === 404) {
                        await sock.sendMessage(from, { text: "Artikel gak ketemu Bang. Coba cek ejaannya." }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: "Gagal mengambil data dari Wikipedia." }, { quoted: msg });
                    }
                }
                return;
            }

            // --- FITUR KALKULATOR ---
            if (cmd === "!kalkulator" || cmd === "!hitung") {
                const query = teks.replace(cmd, "").trim();
                
                if (!query) {
                    return sock.sendMessage(from, { text: "Masukkan angkanya Bang. Contoh: *!hitung 10*5+2*" }, { quoted: msg });
                }

                try {
                    // Membersihkan input agar hanya angka dan operator matematika yang diizinkan (Keamanan)
                    const cleanQuery = query.replace(/[^0-9+\-*/().]/g, '');
                    
                    // Evaluasi matematika (menggunakan Function constructor yang lebih aman dari eval langsung)
                    const hasil = new Function('return ' + cleanQuery)();

                    await sock.sendMessage(from, { 
                        text: `*Hasil:*\n${cleanQuery} = *${hasil}*` 
                    }, { quoted: msg });

                } catch (err) {
                    await sock.sendMessage(from, { text: "Hitungannya error Bang. Pastikan formatnya benar (contoh: 10*5)." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR KONVERSI MEDIA TAMBAHAN ---

            // 1. Video/Audio ke MP3
            if (cmd === "!tomp3" || cmd === "!toaudio") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;
                
                // Cek apakah ada media video atau audio
                const isVideo = quote.videoMessage;
                const isAudio = quote.audioMessage;

                if (!isVideo && !isAudio) {
                    return sock.sendMessage(from, { text: "Reply video atau audionya, Bang!" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "⏳ Sedang mengambil audio..." }, { quoted: msg });

                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./mp3_in_${stamp}.${isVideo ? 'mp4' : 'ogg'}`;
                    const outPath = `./mp3_out_${stamp}.mp3`;

                    fs.writeFileSync(inPath, buf);

                    // Konversi ke MP3 murni (hapus video jika ada)
                    await execPromise(`ffmpeg -y -i "${inPath}" -vn -b:a 128k -f mp3 "${outPath}"`);

                    await sock.sendMessage(from, { 
                        audio: fs.readFileSync(outPath), 
                        mimetype: 'audio/mp4',
                        fileName: `audio_${stamp}.mp3`
                    }, { quoted: msg });

                    // Bersih-bersih
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("ToMP3 Error:", err);
                    await sock.sendMessage(from, { text: "Gagal konversi ke MP3." }, { quoted: msg });
                }
                return;
            }

            // 2. Audio ke Voice Note (Fake VN)
            if (cmd === "!tovn") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;
                
                if (!quote.audioMessage && !quote.videoMessage) {
                    return sock.sendMessage(from, { text: "Reply audio/videonya dulu Bang." }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "⏳ Mengubah jadi VN..." }, { quoted: msg });

                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./vn_convert_in_${stamp}.mp4`;
                    const outPath = `./vn_convert_out_${stamp}.opus`;

                    fs.writeFileSync(inPath, buf);

                    // Konversi ke codec OPUS (standar VN WhatsApp)
                    await execPromise(`ffmpeg -y -i "${inPath}" -vn -c:a libopus -b:a 128k -vbr on -compression_level 10 "${outPath}"`);

                    await sock.sendMessage(from, { 
                        audio: fs.readFileSync(outPath), 
                        mimetype: 'audio/ogg; codecs=opus', 
                        ptt: true // ptt: true membuat pesan dikirim sebagai Voice Note (bukan file audio biasa)
                    }, { quoted: msg });

                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("ToVN Error:", err);
                    await sock.sendMessage(from, { text: "Gagal konversi ke VN." }, { quoted: msg });
                }
                return;
            }

            // 3. Media ke URL (Upload ke Catbox/Telegraph)
            if (cmd === "!tourl") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;
                
                // Support Image, Video, Sticker
                if (!quote.imageMessage && !quote.videoMessage && !quote.stickerMessage) {
                    return sock.sendMessage(from, { text: "Reply gambarnya Bang." }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "⏳ Sedang upload ke server..." }, { quoted: msg });

                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const tempFile = `./upload_${stamp}.jpg`; // Extensi sementara, nanti FormData yang atur
                    fs.writeFileSync(tempFile, buf);

                    // Upload ke Catbox.moe (Gratis & Cepat)
                    const FormData = require('form-data'); // Pastikan library ini ada, biasanya sudah sepaket sama axios/wa-socket
                    const bodyForm = new FormData();
                    bodyForm.append('reqtype', 'fileupload');
                    bodyForm.append('fileToUpload', fs.createReadStream(tempFile));

                    const { data } = await axios.post('https://catbox.moe/user/api.php', bodyForm, {
                        headers: {
                            ...bodyForm.getHeaders()
                        }
                    });

                    await sock.sendMessage(from, { text: `🔗 *Link Media:*\n${data}` }, { quoted: msg });

                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

                } catch (err) {
                    console.error("ToURL Error:", err);
                    await sock.sendMessage(from, { text: "Gagal upload media." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR JADWAL SHOLAT ---
            if (cmd === "!sholat" || cmd === "!jadwalsholat") {
                const kota = teks.replace(cmd, "").trim();
                
                if (!kota) {
                    return sock.sendMessage(from, { text: "Mau jadwal kota mana Bang? Contoh: *!sholat Jakarta*" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: `Mencari jadwal sholat di ${kota}...` }, { quoted: msg });

                    // Menggunakan API Aladhan (Gratis & Akurat untuk Indonesia)
                    const date = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
                    const { data } = await axios.get(`https://api.aladhan.com/v1/timingsByCity?city=${kota}&country=Indonesia&method=11`);
                    
                    const timings = data.data.timings;
                    const hijri = data.data.date.hijri;

                    const jadwalText = `*JADWAL SHOLAT*
*Kota:* ${kota.toUpperCase()}
*Tanggal:* ${data.data.date.readable}
*Hijriyah:* ${hijri.day} ${hijri.month.en} ${hijri.year}

Imsak: ${timings.Imsak}
Subuh: ${timings.Fajr}
Terbit: ${timings.Sunrise}
Dzuhur: ${timings.Dhuhr}
Ashar: ${timings.Asr}
Maghrib: ${timings.Maghrib}
Isya: ${timings.Isha}

_Semoga berkah ibadahnya Bang!_`;

                    await sock.sendMessage(from, { text: jadwalText }, { quoted: msg });

                } catch (err) {
                    console.error("Sholat Error:", err);
                    await sock.sendMessage(from, { text: "Kota tidak ditemukan atau nama kota salah ketik." }, { quoted: msg });
                }
                return;
            }

// =================================================
            // FITUR CEK JODOH (VARIASI KOMENTAR BANYAK)
            // =================================================
            if (cmd === "!cekjodoh" || cmd === "!jodoh" || cmd === "!match") {
                const raw = teks.replace(cmd, "").trim();
                
                if (!raw.includes("|")) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Format salah Bang.\nContoh: *${cmd} Nama Kamu | Nama Dia*` 
                    }, { quoted: msg });
                }

                const parts = raw.split("|");
                const nama1 = parts[0].trim();
                const nama2 = parts[1].trim();

                if (!nama1 || !nama2) {
                    return sock.sendMessage(from, { text: "Namanya jangan kosong Bang." }, { quoted: msg });
                }

                // 1. Hitung Persentase Acak (0 - 100)
                // Tips: Kalau mau hasil konsisten (nama sama = hasil sama), 
                // kita bisa pakai algoritma hashing sederhana. Tapi Random lebih seru buat mainan.
                const score = Math.floor(Math.random() * 101); 

                // 2. Tentukan Kategori / Komentar (Ada 6 Tier)
                let status = "";
                let comment = "";

                if (score <= 10) {
                    status = "💀 Musuh Bebuyutan";
                    comment = "Mending jauh-jauh deh, auranya negatif banget kalau bersatu.";
                } else if (score <= 30) {
                    status = "💔 Mustahil";
                    comment = "Dahlah Bang, cari yang lain aja. Temboknya terlalu tinggi.";
                } else if (score <= 50) {
                    status = "🚧 Friendzone Keras";
                    comment = "Cocoknya cuma jadi temen curhat doang, jangan baper.";
                } else if (score <= 70) {
                    status = "🤏 Lumayan Lah";
                    comment = "Ada potensi, tapi harus usaha keras biar dapet hatinya.";
                } else if (score <= 90) {
                    status = "❤️ Pasangan Serasi";
                    comment = "Wah ini sih udah cocok banget! Gas lamar.";
                } else { // 91 - 100
                    status = "💍 Jodoh Dunia Akhirat";
                    comment = "Fix no debat! Kalian diciptakan untuk bersama selamanya.";
                }

                // 3. Susun Bar (Visual Grafik)
                // Contoh: [████░░░░░░] 40%
                const filled = Math.floor(score / 10);
                const empty = 10 - filled;
                const bar = "█".repeat(filled) + "░".repeat(empty);

                // 4. Kirim Hasil
                const hasil = 
`💘 *KALKULATOR CINTA* 💘

👩‍❤️‍👨 *Pasangan:* ${nama1} x ${nama2}

📊 *Kecocokan:* ${score}%
${bar}

🏷️ *Status:* ${status}
💬 *Kata Bot:* "${comment}"`;

                // Kirim dengan gambar love (pakai thumb standar atau kosongin aja)
                await sock.sendMessage(from, { text: hasil }, { quoted: msg });
            }

            // --- FITUR OCR (IMAGE TO TEXT) ---
            if (cmd === "!ocr" || cmd === "!bacateks") {
                // Cek apakah user mengirim gambar atau me-reply gambar
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;
                
                if (!quote.imageMessage) {
                    return sock.sendMessage(from, { text: "Kirim/Reply gambar yang ada tulisannya, Bang." }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "🔍 Sedang memindai teks..." }, { quoted: msg });

                    // 1. Download gambar ke buffer
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");

                    // 2. Ubah buffer jadi Base64 agar bisa dikirim ke API
                    const base64Img = "data:image/jpeg;base64," + buf.toString('base64');

                    // 3. Kirim ke OCR.space API
                    // Kita gunakan library 'form-data' (sama seperti fitur !tourl)
                    const FormData = require('form-data');
                    const bodyForm = new FormData();
                    
                    bodyForm.append('base64Image', base64Img);
                    bodyForm.append('apikey', 'helloworld'); // Key gratisan (limit rendah), ganti jika punya sendiri
                    bodyForm.append('language', 'eng'); // Default English (paling akurat untuk demo key)
                    bodyForm.append('isOverlayRequired', 'false');

                    const { data } = await axios.post('https://api.ocr.space/parse/image', bodyForm, {
                        headers: {
                            ...bodyForm.getHeaders()
                        }
                    });

                    // 4. Ambil hasil teks
                    if (data.IsErroredOnProcessing) {
                        throw new Error(data.ErrorMessage[0]);
                    }

                    const hasilTeks = data.ParsedResults[0]?.ParsedText;

                    if (!hasilTeks || hasilTeks.trim() === "") {
                        await sock.sendMessage(from, { text: "Gambarnya gak kebaca Bang, atau gak ada tulisannya." }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { 
                            text: `*Hasil Scan:*\n\n${hasilTeks}` 
                        }, { quoted: msg });
                    }

                } catch (err) {
                    console.error("OCR Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memindai gambar." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR KOMPRESI VIDEO (FFmpeg Cerdas) ---
            if (cmd === "!vidcompress" || cmd === "!compress") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // Cek apakah yang di-reply adalah video
                if (!quote.videoMessage) {
                    return sock.sendMessage(from, { text: "Reply videonya Bang!" }, { quoted: msg });
                }

                // Ambil argumen target ukuran (default ke 14MB biar aman masuk WA biasa)
                // Cara pakai: !vidcompress (otomatis <16MB) atau !vidcompress 60 (target <60MB)
                let targetMB = parseFloat(teks.replace(cmd, "").trim());
                if (!targetMB || isNaN(targetMB)) targetMB = 14; // Default 14MB (aman buat limit 16MB WA)

                // Batasi input user biar ga error (Min 1MB, Max 100MB)
                if (targetMB < 1) targetMB = 1;
                if (targetMB > 100) targetMB = 100;

                try {
                    await sock.sendMessage(from, { text: `⏳ Mengompres video ke < ${targetMB} MB...` }, { quoted: msg });

                    // 1. Ambil durasi video dari metadata WhatsApp (dalam detik)
                    const duration = quote.videoMessage.seconds;
                    
                    if (!duration) {
                        return sock.sendMessage(from, { text: "Gagal membaca durasi video. Pastikan videonya valid." }, { quoted: msg });
                    }

                    // 2. Hitung Bitrate Video yang Diperlukan
                    // Rumus: (Target MB * 8192) / Durasi = Total Bitrate (kbps)
                    // Kita kurangi 128kbps untuk audio, sisanya untuk video.
                    const targetSizeInKbits = targetMB * 8192;
                    const totalBitrate = Math.floor(targetSizeInKbits / duration);
                    const audioBitrate = 128; // Standar audio
                    let videoBitrate = totalBitrate - audioBitrate;

                    // Safety: Jangan sampai bitrate video minus atau terlalu kecil (min 100kbps)
                    if (videoBitrate < 100) videoBitrate = 100;

                    console.log(`Durasi: ${duration}s, Target: ${targetMB}MB, Calc Bitrate: ${videoBitrate}k`);

                    // 3. Download & Proses
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./comp_in_${stamp}.mp4`;
                    const outPath = `./comp_out_${stamp}.mp4`;

                    fs.writeFileSync(inPath, buf);

                    // Command FFmpeg: Resize sedikit (720p) biar ringan + set Max Bitrate
                    await execPromise(`ffmpeg -y -i "${inPath}" -c:v libx264 -b:v ${videoBitrate}k -maxrate ${videoBitrate}k -bufsize ${videoBitrate * 2}k -vf "scale='min(720,iw)':-2" -c:a aac -b:a ${audioBitrate}k -preset fast "${outPath}"`);

                    // 4. Kirim Hasil
                    // Jika target > 16MB, kirim sebagai Dokumen biar ga pecah/gagal kirim
                    if (targetMB > 16) {
                        await sock.sendMessage(from, { 
                            document: fs.readFileSync(outPath), 
                            mimetype: 'video/mp4',
                            fileName: `compressed_${targetMB}MB.mp4`,
                            caption: `✅ Selesai! Target: ${targetMB} MB`
                        }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { 
                            video: fs.readFileSync(outPath), 
                            caption: `✅ Selesai! (< ${targetMB} MB)` 
                        }, { quoted: msg });
                    }

                    // Bersih-bersih
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Compress Error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengompres video." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR TRIM AUDIO (FORMAT MM:SS) ---
            if (cmd === "!trim" || cmd === "!potong") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.audioMessage && !quote.videoMessage) {
                    return sock.sendMessage(from, { text: "Reply audionya Bang!" }, { quoted: msg });
                }

                // Regex untuk menangkap format waktu (misal: 00:30-01:15 atau 30-75)
                // Mencari pola: angka:angka - angka:angka
                const args = teks.replace(cmd, "").trim();
                const times = args.split("-");

                if (times.length !== 2) {
                    return sock.sendMessage(from, { text: "Format salah Bang.\nContoh: *!trim 00:30-01:15*" }, { quoted: msg });
                }

                const startSec = parseTime(times[0].trim());
                const endSec = parseTime(times[1].trim());

                if (isNaN(startSec) || isNaN(endSec) || startSec >= endSec) {
                    return sock.sendMessage(from, { text: "Waktunya gak masuk akal Bang. Cek lagi." }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: `✂️ Memotong dari ${times[0]} sampai ${times[1]}...` }, { quoted: msg });

                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./trim_in_${stamp}.mp3`;
                    const outPath = `./trim_out_${stamp}.mp3`;

                    fs.writeFileSync(inPath, buf);

                    // Potong tanpa fade (Raw cut) agar user bisa atur fade sendiri nanti
                    const duration = endSec - startSec;
                    await execPromise(`ffmpeg -y -ss ${startSec} -t ${duration} -i "${inPath}" "${outPath}"`);

                    await sock.sendMessage(from, { 
                        audio: fs.readFileSync(outPath), 
                        mimetype: 'audio/mp4', 
                        ptt: false 
                    }, { quoted: msg });

                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Trim Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memotong audio." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR FADE IN / FADE OUT ---
            if (cmd === "!fadein" || cmd === "!fadeout") {
                const durasiFade = parseInt(teks.replace(cmd, "").trim()) || 3; // Default 3 detik jika kosong
                
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.audioMessage) {
                    return sock.sendMessage(from, { text: "Reply audio hasil trim-nya Bang!" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: `🎚️ Menerapkan efek ${cmd} (${durasiFade} detik)...` }, { quoted: msg });

                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./fade_in_${stamp}.mp3`;
                    const outPath = `./fade_out_${stamp}.mp3`;

                    fs.writeFileSync(inPath, buf);

                    let filter = "";
                    
                    if (cmd === "!fadein") {
                        // afade=t=in:st=0:d=3 (Tipe in, mulai detik 0, durasi 3)
                        filter = `afade=t=in:st=0:d=${durasiFade}`;
                    } else if (cmd === "!fadeout") {
                        // Untuk fadeout, kita butuh durasi total audionya dulu
                        // Kita pakai ffprobe (bagian dari ffmpeg) untuk cek durasi file
                        const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inPath}"`);
                        const totalDuration = parseFloat(stdout);
                        const startTime = totalDuration - durasiFade;
                        
                        // afade=t=out:st=WTF:d=3 (Tipe out, mulai detik akhir-3, durasi 3)
                        if (startTime < 0) {
                            return sock.sendMessage(from, { text: "Durasi fade kepanjangan dibanding lagunya Bang." }, { quoted: msg });
                        }
                        filter = `afade=t=out:st=${startTime}:d=${durasiFade}`;
                    }

                    await execPromise(`ffmpeg -y -i "${inPath}" -af "${filter}" "${outPath}"`);

                    await sock.sendMessage(from, { 
                        audio: fs.readFileSync(outPath), 
                        mimetype: 'audio/mp4', 
                        ptt: false 
                    }, { quoted: msg });

                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Fade Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memberi efek fade." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR RENAME FILE ---
            if (cmd === "!rename" || cmd === "!gantinama") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Cek apakah user me-reply dokumen
                if (!quote.documentMessage) {
                    return sock.sendMessage(from, { text: "Reply dokumen yang mau diganti namanya, Bang!" }, { quoted: msg });
                }

                // 2. Ambil nama baru dari teks command
                let newName = teks.replace(cmd, "").trim();

                if (!newName) {
                    return sock.sendMessage(from, { text: "Nama barunya apa Bang? Contoh: *!rename Tugasku.docx*" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "📝 Sedang mengganti nama file..." }, { quoted: msg });

                    // 3. Download file asli
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    
                    // 4. Cek Ekstensi File
                    // Kita ambil mimetype asli (misal: application/pdf)
                    const mime = quote.documentMessage.mimetype;
                    const currentExt = quote.documentMessage.fileName.split('.').pop(); // Ambil ekstensi lama (misal: pdf)

                    // Jika user lupa nulis ekstensi di nama baru (misal cuma "!rename Tugasku"), kita tambahkan otomatis
                    if (!newName.includes('.')) {
                        newName += `.${currentExt}`;
                    }

                    // 5. Kirim balik dengan nama baru
                    await sock.sendMessage(from, { 
                        document: buf, 
                        mimetype: mime, 
                        fileName: newName,
                        caption: `✅ Sukses ganti nama jadi: *${newName}*`
                    }, { quoted: msg });

                } catch (err) {
                    console.error("Rename Error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengganti nama file." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR AMBIL THUMBNAIL VIDEO ---
            if (cmd === "!thumbnail" || cmd === "!thumb") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Cek apakah yang di-reply adalah video
                if (!quote.videoMessage) {
                    return sock.sendMessage(from, { text: "Reply videonya Bang!" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "📸 Sedang memilih frame terbaik..." }, { quoted: msg });

                    // 2. Download video
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./thumb_in_${stamp}.mp4`;
                    const outPath = `./thumb_out_${stamp}.jpg`;

                    fs.writeFileSync(inPath, buf);

                    // 3. Jalankan FFmpeg
                    // -vf "thumbnail": Menggunakan filter otomatis untuk mencari frame terbaik
                    // -frames:v 1: Hanya mengambil 1 gambar
                    // -q:v 2: Kualitas gambar output tinggi (skala 1-31, makin kecil makin bagus)
                    await execPromise(`ffmpeg -y -i "${inPath}" -vf "thumbnail" -frames:v 1 -q:v 2 "${outPath}"`);

                    // 4. Kirim hasil gambar
                    await sock.sendMessage(from, { 
                        image: fs.readFileSync(outPath), 
                        caption: "✅ Nih thumbnailnya Bang." 
                    }, { quoted: msg });

                    // 5. Bersih-bersih file sementara
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Thumbnail Error:", err);
                    // Hapus file jika error di tengah jalan
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    await sock.sendMessage(from, { text: "Gagal mengambil thumbnail." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR SHORT (POTONG BAGIAN TERBAIK/TENGAH) ---
            if (cmd === "!short" || cmd === "!shorts") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Cek Video
                if (!quote.videoMessage) {
                    return sock.sendMessage(from, { text: "Reply videonya Bang!" }, { quoted: msg });
                }

                // 2. Parse Input User
                // Default: 30 detik
                // Cara pakai: !short (30s tengah), !short 15 (15s tengah), !short random (30s acak)
                let targetDuration = 30; // Default 30 detik
                const args = teks.replace(cmd, "").trim().toLowerCase();
                
                // Cek durasi custom (misal !short 60)
                const num = parseInt(args.split(" ")[0]);
                if (!isNaN(num) && num > 0) targetDuration = num;

                const isRandom = args.includes("random");

                try {
                    await sock.sendMessage(from, { text: `✂️ Memotong ${targetDuration} detik bagian ${isRandom ? 'ACAK' : 'TENGAH'}...` }, { quoted: msg });

                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./short_in_${stamp}.mp4`;
                    const outPath = `./short_out_${stamp}.mp4`;

                    fs.writeFileSync(inPath, buf);

                    // 3. Cek Durasi Total Video (via ffprobe)
                    // Kita butuh durasi akurat untuk menghitung titik tengah
                    const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inPath}"`);
                    const totalDuration = parseFloat(stdout);

                    if (totalDuration <= targetDuration) {
                        // Kalau video aslinya lebih pendek dari target, kirim balik aja atau batalkan
                        await sock.sendMessage(from, { text: "Videonnya kependekan Bang, gak bisa dipotong." }, { quoted: msg });
                        if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                        return;
                    }

                    // 4. Hitung Waktu Mulai (Start Time)
                    let startTime = 0;

                    if (isRandom) {
                        // Mode Random: Mulai dari 0 sampai (Total - Target)
                        const maxStart = totalDuration - targetDuration;
                        startTime = Math.random() * maxStart;
                    } else {
                        // Mode Tengah (Default): (Total / 2) - (Target / 2)
                        startTime = (totalDuration / 2) - (targetDuration / 2);
                    }

                    // Pastikan tidak minus
                    if (startTime < 0) startTime = 0;

                    // 5. Potong Pakai FFmpeg
                    // -ss sebelum -i agar proses seek lebih cepat (fast seek)
                    // -t durasi potongan
                    // -c:v libx264 -preset ultrafast: Re-encode cepat biar frame-nya pas (akurat)
                    await execPromise(`ffmpeg -y -ss ${startTime} -i "${inPath}" -t ${targetDuration} -c:v libx264 -preset ultrafast -c:a aac "${outPath}"`);

                    // 6. Kirim Hasil
                    await sock.sendMessage(from, { 
                        video: fs.readFileSync(outPath), 
                        caption: `✅ *Shorts Created!*\n⏱️ *Start:* Detik ke-${Math.floor(startTime)}\n⏱️ *Durasi:* ${targetDuration}s` 
                    }, { quoted: msg });

                    // Bersih-bersih
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Short Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memotong video." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR SCAN DOKUMEN (IMAGEMAGICK) ---
            if (cmd === "!scan" || cmd === "!scanner") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Cek apakah inputnya gambar
                if (!quote.imageMessage) {
                    return sock.sendMessage(from, { text: "Kirim/Reply foto dokumennya Bang!" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(from, { text: "🖨️ Sedang memindai dokumen..." }, { quoted: msg });

                    // 2. Download gambar
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./scan_in_${stamp}.jpg`;
                    // Output PNG agar teks lebih tajam (tidak ada kompresi JPG)
                    const outPath = `./scan_out_${stamp}.png`; 

                    fs.writeFileSync(inPath, buf);

                    // 3. Racikan Perintah ImageMagick untuk Efek Scanner
                    // Penjelasan command:
                    // magick "input" : Panggil program ImageMagick
                    // -colorspace Gray : Ubah jadi hitam putih (grayscale)
                    // -normalize : Regangkan histogram agar hitam makin pekat, putih makin terang (otomatis)
                    // -contrast-stretch 1%x10% : Paksa 1% pixel tergelap jadi hitam total, 10% pixel terang jadi putih total (High Contrast banget)
                    // -trim +repage : Auto-crop pinggiran kosong (jika backgroundnya warna solid/seragam)
                    // "output" : Simpan hasil
                    
                    const command = `magick "${inPath}" -colorspace Gray -normalize -contrast-stretch 1%x10% -trim +repage "${outPath}"`;

                    // Eksekusi perintah
                    await execPromise(command);

                    // 4. Kirim Hasil
                    await sock.sendMessage(from, { 
                        image: fs.readFileSync(outPath), 
                        caption: "✅ *Hasil Scan*" 
                    }, { quoted: msg });

                    // 5. Bersih-bersih
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Scan Error:", err);
                    await sock.sendMessage(from, { text: "Gagal scan. Pastikan ImageMagick sudah terinstall di Windows dan PATH sudah benar." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR NULIS (HANDWRITING FONT) ---
            if (cmd === "!nulis" || cmd === "!tulis") {
                let text = teks.replace(cmd, "").trim();
                if (!text) return sock.sendMessage(from, { text: "Mau nulis apa Bang?" }, { quoted: msg });

                try {

                    const stamp = Date.now();
                    const output = `./nulis_${stamp}.jpg`;
                    const paperPath = "./paper.jpg"; 
                    
                    // Nama file font yang Abang taruh di folder bot
                    const fontPath = "./tulis.ttf"; 

                    // Cek Kelengkapan File
                    if (!fs.existsSync(paperPath)) {
                        return sock.sendMessage(from, { text: "⚠️ File 'paper.jpg' gak ada Bang." }, { quoted: msg });
                    }
                    
                    // Fallback: Kalau lupa download font, pake Arial dulu biar gak error
                    const fontName = fs.existsSync(fontPath) ? fontPath : "Arial";

                    // --- KONFIGURASI TULISAN TANGAN ---
                    const paperWidth = 1000; // Lebar kertas dipaksa segini
                    // Font handwriting biasanya lebih tipis/kecil, jadi size-nya kita gedein dikit dibanding Arial
                    const fontSize = 28; // Font diperbesar       
                    const textWidth = 930; // Area tulis    
                    const textHeight = 1200; // Tinggi area tulis  
                    const marginLeft = 25;  // Margin Kiri 
                    const marginTop = 145;  // Margin Atas (Sesuaikan kalau nabrak garis paling atas)    
                    const lineSpacing = -4;  // Jarak antar baris  
                    
                    // Warna Tinta: Black, Navy (Biru Dongker), atau DarkSlateGray (Mirip Pensil)
                    const inkColor = "Black"; 

                    text = text.replace(/"/g, "'");

                    // COMMAND:
                    // -font "${fontName}" : Menggunakan font custom
                    // -fill ${inkColor}   : Mengubah warna tinta biar gak hitam pekat komputer
                    
                    const command = `magick "${paperPath}" -resize ${paperWidth}x -font "${fontName}" \\( -size ${textWidth}x${textHeight} -background none -fill ${inkColor} -pointsize ${fontSize} -interline-spacing ${lineSpacing} caption:"${text}" \\) -geometry +${marginLeft}+${marginTop} -composite "${output}"`;

                    await execPromise(command);

                    await sock.sendMessage(from, { 
                        image: fs.readFileSync(output), 
                        caption: "Selesai Bang!" 
                    }, { quoted: msg });

                    if (fs.existsSync(output)) fs.unlinkSync(output);

                } catch (err) {
                    console.error("Nulis Error:", err);
                    await sock.sendMessage(from, { text: "Gagal nulis Bang. Cek log error." }, { quoted: msg });
                }
                return;
            }

// =================================================
            // FITUR IQC (FIXED VARIABLE)
            // =================================================
            if (cmd === "iqc" || cmd === "!iqc" || cmd === "iphonechat" || cmd === "!iphonechat") {
                
                // DEFINISIKAN PUSHNAME BIAR GAK ERROR
                const pushname = msg.pushName || "User";

                console.log(`[IQC] Perintah diterima dari: ${pushname}`);
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                // 2. Ambil Input
                let input = teks.replace("!iqc", "").replace("iqc", "").replace("!iphonechat", "").replace("iphonechat", "").trim();

                // Kalau kosong tapi user nge-reply chat orang, ambil teks reply-nya
                if (!input && msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                    const quoted = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                    input = quoted.conversation || quoted.extendedTextMessage?.text || "";
                }

                if (!input) {
                    return sock.sendMessage(from, { 
                        text: "⚠️ Masukkan teks!\n\nContoh Biasa:\n*!iqc Halo Sayang*\n\nContoh Custom:\n*!iqc Halo | Telkomsel | 88*" 
                    }, { quoted: msg });
                }

                // 3. Parsing Data (Teks | Provider | Batre)
                let [messageText, carrier, battery] = input.split("|");

                // Default Value
                if (!messageText) messageText = input; 
                if (!carrier) carrier = "TELKOMSEL";   
                if (!battery) battery = "88";          

                // Bersihkan data
                messageText = messageText.trim();
                carrier = carrier.trim();
                battery = battery.trim().replace("%", ""); 

                // 4. Ambil Waktu Real-time
                let date = new Date();
                let time = date.toLocaleTimeString('id-ID', { 
                    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' 
                });

                // 5. Panggil API Siputzx
                let url = `https://brat.siputzx.my.id/iphone-quoted?time=${encodeURIComponent(time)}&messageText=${encodeURIComponent(messageText)}&carrierName=${encodeURIComponent(carrier)}&batteryPercentage=${encodeURIComponent(battery)}&signalStrength=4&emojiStyle=apple`;

                console.log(`[IQC] Requesting URL: ${url}`);

                try {
                    await sock.sendMessage(from, {
                        image: { url: url },
                        caption: ``
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (err) {
                    console.error('[IQC] Error:', err);
                    await sock.sendMessage(from, { text: "⚠️ Gagal koneksi ke API." }, { quoted: msg });
                }
            }

            // --- FITUR NOMOR HALAMAN PDF (PDF-LIB) ---
            if (cmd === "!pagenum" || cmd === "!nopage") {
                // Cara pakai: !pagenum bottom, !pagenum top-right
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.documentMessage || quote.documentMessage.mimetype !== 'application/pdf') {
                    return sock.sendMessage(from, { text: "Reply file PDF-nya Bang!" }, { quoted: msg });
                }

                // Default posisi: bottom (bawah tengah)
                let posisi = teks.replace(cmd, "").trim().toLowerCase().replace(" ", "-");
                if (!posisi) posisi = "bottom";

                try {

                    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

                    // 1. Download PDF
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    
                    // 2. Load PDF ke Memory
                    const pdfDoc = await PDFDocument.load(buf);
                    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
                    const pages = pdfDoc.getPages();
                    const totalPages = pages.length;

                    // 3. Loop Semua Halaman
                    for (let i = 0; i < totalPages; i++) {
                        const page = pages[i];
                        const { width, height } = page.getSize();
                        const text = `${i + 1}`; // Hanya angka halaman
                        // Kalau mau format "Page 1 of 10", ganti jadi: const text = `Page ${i + 1} of ${totalPages}`;
                        
                        const textSize = 12;
                        const textWidth = helveticaFont.widthOfTextAtSize(text, textSize);
                        const textHeight = helveticaFont.heightAtSize(textSize);

                        let x, y;

                        // Logika Koordinat (0,0 ada di pojok Kiri Bawah)
                        if (posisi.includes("top-right") || posisi.includes("kanan-atas")) {
                            x = width - textWidth - 20; // 20 poin dari kanan
                            y = height - 20 - textHeight; // 20 poin dari atas
                        } else if (posisi.includes("top-left") || posisi.includes("kiri-atas")) {
                            x = 20; // 20 poin dari kiri
                            y = height - 20 - textHeight;
                        } else { 
                            // Default: bottom / bawah-tengah
                            x = (width / 2) - (textWidth / 2); // Tepat di tengah horizontal
                            y = 20; // 20 poin dari bawah
                        }

                        // Gambar Nomor Halaman
                        page.drawText(text, {
                            x: x,
                            y: y,
                            size: textSize,
                            font: helveticaFont,
                            color: rgb(0, 0, 0), // Warna Hitam
                        });
                    }

                    // 4. Simpan dan Kirim
                    const pdfBytes = await pdfDoc.save();
                    const stamp = Date.now();
                    const outPath = `./pagenum_out_${stamp}.pdf`;
                    
                    fs.writeFileSync(outPath, pdfBytes);

                    await sock.sendMessage(from, { 
                        document: fs.readFileSync(outPath), 
                        mimetype: 'application/pdf',
                        fileName: `numbered_${posisi}.pdf`,
                        caption: `✅ Selesai! Total ${totalPages} halaman.`
                    }, { quoted: msg });

                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("PageNum Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memberi nomor halaman. Pastikan file PDF tidak dikunci password." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR SMART FILENAME CLEANER ---
            if (cmd === "!cleaname" || cmd === "!autonama") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Cek Dokumen
                if (!quote.documentMessage) {
                    return sock.sendMessage(from, { text: "Reply dokumen yang namanya berantakan, Bang!" }, { quoted: msg });
                }

                try {
                    const originalName = quote.documentMessage.fileName || "File_Tanpa_Nama.bin";
                    
                    // 2. Logika Pembersihan (The Brain)
                    // Ambil ekstensi (pdf, docx, dll)
                    const extIndex = originalName.lastIndexOf('.');
                    let ext = "";
                    let nameBody = originalName;

                    if (extIndex > 0) {
                        ext = originalName.substring(extIndex); // .pdf
                        nameBody = originalName.substring(0, extIndex); // nama_file
                    }

                    // STEP A: Decode URI (Mengubah %20 jadi spasi)
                    try { nameBody = decodeURIComponent(nameBody); } catch (e) {}

                    // STEP B: Ganti simbol pemisah (_, -, +) menjadi spasi
                    nameBody = nameBody.replace(/[_\-+]/g, ' ');

                    // STEP C: Hapus pola duplikat download: (1), (2), "Copy of", "Salinan"
                    // Regex: \s* (spasi opsional), \( (kurung buka), \d+ (angka), \) (kurung tutup)
                    nameBody = nameBody.replace(/\s*\(\d+\)/g, ''); 
                    nameBody = nameBody.replace(/copy of|salinan/gi, '');

                    // STEP D: Hapus spasi ganda akibat penghapusan di atas
                    nameBody = nameBody.replace(/\s+/g, ' ').trim();

                    // STEP E: Title Case (Huruf Besar Setiap Awal Kata)
                    nameBody = nameBody.replace(/\w\S*/g, (txt) => {
                        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
                    });

                    // Gabungkan kembali
                    const cleanName = `${nameBody}${ext}`;

                    // 3. Proses Kirim Ulang
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const mime = quote.documentMessage.mimetype;

                    await sock.sendMessage(from, { 
                        document: buf, 
                        mimetype: mime,
                        fileName: cleanName,
                        caption: `✅ *Auto Cleaned!*\n\n📂 *Asli:* ${originalName}\n✨ *Baru:* ${cleanName}`
                    }, { quoted: msg });

                } catch (err) {
                    console.error("Cleaname Error:", err);
                    await sock.sendMessage(from, { text: "Gagal membersihkan nama file." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR SPLIT BILL / PATUNGAN ---
            if (cmd === "!bill" || cmd === "!patungan") {
                // 1. Ambil semua argumen teks
                let args = teks.replace(cmd, "").trim();
                
                // Cek apakah user nge-tag member
                const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                
                // 2. Ambil Nominal Uang (Regex ambil angka pertama yang besar)
                // Menghapus titik/koma biar jadi angka murni
                const cleanArgs = args.replace(/[.,]/g, ""); 
                const matchNominal = cleanArgs.match(/\d+/);
                
                if (!matchNominal) {
                    return sock.sendMessage(from, { 
                        text: "Nominalnya berapa Bang?\n\n*Cara Pakai:*\n1. Tag orang: *!bill 50000 @Asep @Udin*\n2. Jumlah orang: *!bill 50000 5*" 
                    }, { quoted: msg });
                }

                const totalTagihan = parseInt(matchNominal[0]);
                let jumlahOrang = 0;
                let listOrang = [];

                // 3. Tentukan Pembaginya (Berdasarkan Tag atau Angka Manual)
                if (mentions.length > 0) {
                    // Kalau pakai tag, jumlah orang = jumlah tag
                    jumlahOrang = mentions.length;
                    listOrang = mentions;
                } else {
                    // Kalau gak pakai tag, cari angka kedua sebagai jumlah orang
                    // Hapus nominal dari args, cari sisa angkanya
                    const sisaArgs = cleanArgs.replace(totalTagihan.toString(), "");
                    const matchOrang = sisaArgs.match(/\d+/);
                    
                    if (matchOrang) {
                        jumlahOrang = parseInt(matchOrang[0]);
                    } else {
                        return sock.sendMessage(from, { text: "Mau dibagi ke berapa orang Bang?" }, { quoted: msg });
                    }
                }

                // Safety check
                if (jumlahOrang < 1) return sock.sendMessage(from, { text: "Gak bisa dibagi ke 0 orang Bang." }, { quoted: msg });

                // 4. Hitung Per Orang (Dibulatkan ke atas kelipatan 100 perak biar gampang transfer)
                let perOrang = Math.ceil((totalTagihan / jumlahOrang) / 100) * 100;
                
                // Format Rupiah
                const formatRp = (angka) => "Rp " + angka.toLocaleString("id-ID");

                // 5. Susun Pesan
                let resultText = `*SPLIT BILL / PATUNGAN*

*Total:* ${formatRp(totalTagihan)}
*Jumlah:* ${jumlahOrang} orang
---------------------------
*Per Orang:* ${formatRp(perOrang)}
---------------------------`;

                // Kalau pakai tag, sebutin nama-namanya biar dinotice
                if (listOrang.length > 0) {
                    resultText += `\n\n*Bayar woy:*`;
                    // Kita kirim mention array terpisah di sendMessage nanti
                } else {
                    resultText += `\n\n_Silakan ditagih ke temannya Bang!_`;
                }

                // Tambahan template rek (Opsional, bisa dihardcode nomor Abang)
                // resultText += `\n\n💳 BCA: 1234567890 (Agus)`;

                await sock.sendMessage(from, { 
                    text: resultText,
                    mentions: listOrang // Tag orangnya beneran
                }, { quoted: msg });

                return;
            }

            // --- FITUR CEK HARGA (SOURCE: KLIKNKLIK) ---
            if (cmd === "!harga" || cmd === "!price") {
                const query = teks.replace(cmd, "").trim();
                if (!query) return sock.sendMessage(from, { text: "Mau cek harga apa Bang? Contoh: *!harga iphone 15*" }, { quoted: msg });

                try {

                    const cheerio = require('cheerio');
                    const https = require('https');

                    // Tetap pakai SSL Bypass buat jaga-jaga
                    const agent = new https.Agent({ rejectUnauthorized: false });

                    // KliknKlik Search URL
                    const searchUrl = `https://kliknklik.com/search?controller=search&s=${encodeURIComponent(query)}`;
                    
                    const { data: html } = await axios.get(searchUrl, {
                        httpsAgent: agent,
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        }
                    });

                    const $ = cheerio.load(html);
                    let results = [];

                    // Selector KliknKlik (Struktur standar PrestaShop)
                    $('.product-miniature').slice(0, 5).each((i, el) => {
                        const title = $(el).find('.product-title a').text().trim();
                        const price = $(el).find('.price').text().trim();
                        const link = $(el).find('.product-title a').attr('href');
                        const img = $(el).find('.thumbnail-container img').attr('src');

                        if (title && price) {
                            results.push({ title, price, link, img });
                        }
                    });

                    if (results.length === 0) {
                        return sock.sendMessage(from, { text: "Barang tidak ditemukan di KliknKlik Bang. Coba cari gadget/elektronik lain." }, { quoted: msg });
                    }

                    // Susun Pesan
                    let replyText = `💸 *HARGA GADGET: ${query.toUpperCase()}* 💸\n_Sumber: KliknKlik.com_\n\n`;
                    
                    results.forEach((item, index) => {
                        replyText += `${index + 1}. *${item.title}*\n`;
                        replyText += `   💰 ${item.price}\n`;
                        replyText += `   🔗 ${item.link}\n\n`;
                    });

                    if (results[0].img) {
                        await sock.sendMessage(from, { 
                            image: { url: results[0].img },
                            caption: replyText 
                        }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: replyText }, { quoted: msg });
                    }

                } catch (err) {
                    console.error("Harga Error:", err.message);
                    await sock.sendMessage(from, { text: "Gagal mengambil data harga." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR BRAINSTORM HELPER (AI POWERED) ---

            // 1. GENERATOR IDE (Divergent)
            if (cmd === "!ide" || cmd === "!brainstorm") {
                const topic = teks.replace(cmd, "").trim();

                if (!topic) {
                    return sock.sendMessage(from, { text: "Butuh ide tentang apa Bang? Contoh: *!ide Judul Skripsi Teknik Mesin tentang Energi Terbarukan*" }, { quoted: msg });
                }

                try {

                    // Prompt khusus agar AI memberikan list ide yang variatif
                    const prompt = `Berikan 10 ide kreatif, unik, dan out-of-the-box tentang "${topic}". Tuliskan dalam format poin-poin yang jelas dan bahasa Indonesia yang santai tapi cerdas.`;
                    
                    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}`;
                    const { data } = await axios.get(url);

                    await sock.sendMessage(from, { 
                        text: `Topik: ${topic}\n\n${data}` 
                    }, { quoted: msg });

                } catch (err) {
                    console.error("Ide Error:", err.message);
                    await sock.sendMessage(from, { text: "Gagal mencari ide. Otak AI lagi buntu." }, { quoted: msg });
                }
                return;
            }

            // 2. ANALISIS SWOT (Analytical)
            if (cmd === "!swot" || cmd === "!analisa") {
                const topic = teks.replace(cmd, "").trim();

                if (!topic) {
                    return sock.sendMessage(from, { text: "Apa yang mau dianalisa Bang? Contoh: *!swot Bisnis Jasa 3D Printing*" }, { quoted: msg });
                }

                try {

                    // Prompt khusus SWOT
                    const prompt = `Buatkan analisis SWOT (Strengths, Weaknesses, Opportunities, Threats) secara detail dan kritis untuk topik: "${topic}". Berikan strategi singkat di akhir.`;
                    
                    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}`;
                    const { data } = await axios.get(url);

                    await sock.sendMessage(from, { 
                        text: `Objek: ${topic}\n\n${data}` 
                    }, { quoted: msg });

                } catch (err) {
                    console.error("SWOT Error:", err.message);
                    await sock.sendMessage(from, { text: "Gagal menganalisa." }, { quoted: msg });
                }
                return;
            }

            // 3. THE 5 WHYS (Root Cause Analysis - Teknik Engineering)
            if (cmd === "!why" || cmd === "!akarmasalah") {
                const problem = teks.replace(cmd, "").trim();

                if (!problem) {
                    return sock.sendMessage(from, { text: "Masalahnya apa Bang? Contoh: *!why Mesin motor cepat panas*" }, { quoted: msg });
                }

                try {

                    // Prompt Teknik 5 Whys (Toyota Method)
                    const prompt = `Gunakan metode "The 5 Whys" untuk mencari akar penyebab dari masalah: "${problem}". Jelaskan rantai sebab-akibatnya dari Why 1 sampai Why 5, lalu berikan solusi akhir (Root Cause Fix).`;
                    
                    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}`;
                    const { data } = await axios.get(url);

                    await sock.sendMessage(from, { 
                        text: `Masalah: ${problem}\n\n${data}` 
                    }, { quoted: msg });

                } catch (err) {
                    console.error("Why Error:", err.message);
                    await sock.sendMessage(from, { text: "Gagal mencari akar masalah." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR EMERGENCY INFO ---

            // 1. DATABASE NOMOR PENTING
            if (cmd === "!nomor" || cmd === "!darurat") {
                const info = `*NOMOR DARURAT INDONESIA*

*Polisi:* 110
*Ambulans:* 118 / 119
*Pemadam:* 113
*SAR / Basarnas:* 115
*PLN (Listrik):* 123
*Telkom:* 147
*Keracunan:* (021) 4250767

_Simpan nomor ini atau gunakan bot saat panik._`;

                await sock.sendMessage(from, { text: info }, { quoted: msg });
                return;
            }

            // 2. PANDUAN P3K (PERTOLONGAN PERTAMA)
            if (cmd === "!p3k" || cmd === "!firstaid") {
                const topic = teks.replace(cmd, "").trim().toLowerCase();

                // Database P3K Sederhana
                const guide = {
"pingsan": "*PINGSAN:*\n1. Baringkan telentang, naikkan kaki lebih tinggi dari jantung.\n2. Longgarkan pakaian yang ketat.\n3. Coba sadarkan (tepuk bahu/panggil).\n4. Jangan beri minum jika belum sadar penuh.",
"luka bakar": "*LUKA BAKAR RINGAN:*\n1. Guyur air mengalir (kran) selama 10-20 menit. JANGAN pakai es batu/odol!\n2. Tutup dengan kain bersih/kasa steril.\n3. Jangan pecahkan gelembung luka.",
"mimisan": "*MIMISAN:*\n1. Duduk tegak, condongkan tubuh ke depan (JANGAN tengadah ke belakang!).\n2. Jepit cuping hidung selama 10-15 menit.\n3. Bernapas lewat mulut.",
"tersedak": "*TERSEDAK:*\n1. Minta korban batuk sekuat tenaga.\n2. Jika tidak bisa napas, lakukan *Heimlich Maneuver* (peluk dari belakang, tekan ulu hati ke arah atas).",
"patah tulang": "*PATAH TULANG:*\n1. Jangan gerakkan bagian yang sakit.\n2. Pasang bidai/spalk (kayu/kardus) dan ikat agar tidak bergeser.\n3. Segera bawa ke RS.",
"keracunan": "*KERACUNAN MAKANAN:*\n1. Minum air putih/susu yang banyak.\n2. Minum norit/arang aktif jika ada.\n3. Jangan paksa muntah jika zatnya korosif (pemutih/bensin)."
                };

                if (!topic || !guide[topic]) {
                    let list = Object.keys(guide).map(k => `• ${k}`).join("\n");
                    return sock.sendMessage(from, { 
                        text: `*PANDUAN P3K*\nKetik topik yang diinginkan:\n\n${list}\n\nContoh: *!p3k mimisan*` 
                    }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `*GUIDE: ${topic.toUpperCase()}*\n\n${guide[topic]}` }, { quoted: msg });
                return;
            }

            // 3. CARI RUMAH SAKIT TERDEKAT (Location Based)
            if (cmd === "!carirs" || cmd === "!hospital") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // Cek apakah user mengirim lokasi (Location Message)
                if (!quote.locationMessage) {
                    return sock.sendMessage(from, { 
                        text: "📍 Kirim lokasi Anda (Share Location) lalu reply dengan *!carirs* untuk mencari RS terdekat." 
                    }, { quoted: msg });
                }

                try {
                    const lat = quote.locationMessage.degreesLatitude;
                    const long = quote.locationMessage.degreesLongitude;

                    // Kita gunakan Google Maps Search Link
                    // Format: https://www.google.com/maps/search/rumah+sakit/@lat,long,zoom
                    const mapUrl = `https://www.google.com/maps/search/rumah+sakit+terdekat/@${lat},${long},15z`;

                    await sock.sendMessage(from, { 
                        location: { degreesLatitude: lat, degreesLongitude: long }, // Kirim balik lokasi titik pusat
                        text: `*RUMAH SAKIT TERDEKAT*\n\nKlik link ini untuk melihat peta:\n ${mapUrl}` 
                    }, { quoted: msg });

                } catch (err) {
                    console.error("Loc Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memproses lokasi." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR PDF METADATA VIEWER ---
            if (cmd === "!pdfmeta" || cmd === "!cekpdf") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.documentMessage || quote.documentMessage.mimetype !== 'application/pdf') {
                    return sock.sendMessage(from, { text: "Reply file PDF-nya Bang!" }, { quoted: msg });
                }

                try {

                    const { PDFDocument } = require('pdf-lib');
                    
                    // 1. Download File
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");

                    // 2. Load PDF (ignoreEncryption: true biar tetap bisa baca meta meski dilock password, kalau bisa)
                    const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });

                    // 3. Ambil Data
                    const title = pdfDoc.getTitle() || "-";
                    const author = pdfDoc.getAuthor() || "-";
                    const subject = pdfDoc.getSubject() || "-";
                    const creator = pdfDoc.getCreator() || "-"; // Software pembuat (misal: Microsoft Word)
                    const producer = pdfDoc.getProducer() || "-"; // Library konversi (misal: Quartz PDFContext)
                    const creationDate = pdfDoc.getCreationDate() ? pdfDoc.getCreationDate().toLocaleString("id-ID") : "-";
                    const modDate = pdfDoc.getModificationDate() ? pdfDoc.getModificationDate().toLocaleString("id-ID") : "-";
                    const pageCount = pdfDoc.getPageCount();
                    const keywords = pdfDoc.getKeywords() || "-";

                    // 4. Susun Laporan
                    const infoText = `*Laporan Investigasi PDF*

*Judul:* ${title}
*Penulis (Author):* ${author}
*Subjek:* ${subject}
*Software Creator:* ${creator}
*PDF Producer:* ${producer}
---------------------------
*Dibuat:* ${creationDate}
*Diedit:* ${modDate}
*Jumlah Halaman:* ${pageCount}
*Keywords:* ${keywords}

_Catatan: Metadata ini bisa diedit, tapi seringkali orang lupa menghapusnya._`;

                    await sock.sendMessage(from, { text: infoText }, { quoted: msg });

                } catch (err) {
                    console.error("PDF Meta Error:", err);
                    await sock.sendMessage(from, { text: "Gagal membaca metadata. Mungkin file rusak atau terenkripsi kuat." }, { quoted: msg });
                }
                return;
            }

// =================================================
            // FITUR LIRIK (ITUNES + LYRICS.OVH)
            // ✅ API Resmi Apple (Search) + API Open Source (Lyrics)
            // =================================================
            if (cmd === "!lirik" || cmd === "!lyrics") {
                let input = teks.replace(/!lirik|lirik|!lyrics|lyrics/gi, "").trim();

                if (!input) {
                    return sock.sendMessage(from, { text: "⚠️ Masukkan judul lagu!\nContoh: *!lirik Komang*" }, { quoted: msg });
                }

                console.log(`[LIRIK] Mencari Metadata di iTunes: ${input}`);
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // 1. CARI JUDUL & ARTIS YANG BENAR VIA ITUNES API (Anti Blokir)
                    const itunesRes = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(input)}&entity=song&limit=1`);
                    
                    if (!itunesRes.data || itunesRes.data.resultCount === 0) {
                         return sock.sendMessage(from, { text: `❌ Lagu *"${input}"* tidak ditemukan di iTunes.` }, { quoted: msg });
                    }

                    const songData = itunesRes.data.results[0];
                    const artist = songData.artistName;
                    const title = songData.trackName;
                    const cover = songData.artworkUrl100.replace('100x100', '600x600'); // Ambil cover HD

                    console.log(`[LIRIK] Target: ${artist} - ${title}`);
                    console.log(`[LIRIK] Mengambil teks dari Lyrics.ovh...`);

                    // 2. AMBIL LIRIK DARI LYRICS.OVH
                    // Format URL: https://api.lyrics.ovh/v1/NamaArtis/JudulLagu
                    const lyricsRes = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, {
                        timeout: 10000 // 10 Detik
                    });

                    const lyrics = lyricsRes.data.lyrics;

                    if (!lyrics) {
                        return sock.sendMessage(from, { text: `❌ Musik ketemu (${title}), tapi teks lirik belum tersedia di database.` }, { quoted: msg });
                    }

                    // 3. KIRIM HASIL
                    let caption = `*${title}*\n`;
                    caption += `*Artist:* ${artist}\n`;
                    caption += `*Album:* ${songData.collectionName || '-'}\n`;
                    caption += `──────────────────\n\n`;
                    caption += `${lyrics}`;

                    await sock.sendMessage(from, { 
                        image: { url: cover },
                        caption: caption
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("[LIRIK] Error:", e.message);
                    
                    // Error handling khusus Lyrics.ovh
                    if (e.response && e.response.status === 404) {
                        await sock.sendMessage(from, { text: "❌ Lagu ditemukan di iTunes, tapi liriknya belum ada di database Lyrics.ovh." }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: "❌ Terjadi kesalahan koneksi (Server Lirik Down)." }, { quoted: msg });
                    }
                }
            }

            // --- FITUR TREND DETECTOR & BERITA ---
            if (cmd === "!trending" || cmd === "!fyi" || cmd === "!berita") {
                const Parser = require('rss-parser');
                // Konfigurasi parser untuk membaca tag khusus Google Trends
                const parser = new Parser({
                    customFields: {
                        item: [
                            ['ht:approx_traffic', 'traffic'], // Ambil jumlah pencarian
                            ['ht:news_item', 'news'],        // Ambil cuplikan berita
                            ['ht:picture', 'picture'],       // Ambil gambar
                        ]
                    }
                });

                try {
                    if (cmd === "!berita") {
                        // --- MODE BERITA (CNN INDONESIA) ---
                        
                        // RSS CNN Indonesia (Nasional)
                        const feed = await parser.parseURL('https://www.cnnindonesia.com/nasional/rss');
                        
                        let text = `*BERITA TERKINI (CNN)*\n\n`;
                        
                        // Ambil 5 berita teratas
                        feed.items.slice(0, 5).forEach((item, i) => {
                            text += `${i + 1}. *${item.title}*\n`;
                            text += `${item.link}\n`;
                            text += `${new Date(item.pubDate).toLocaleString('id-ID')}\n\n`;
                        });

                        await sock.sendMessage(from, { text: text }, { quoted: msg });

                    } else {
                        // --- MODE GOOGLE TRENDS ---

                        // RSS Google Trends Indonesia (geo=ID)
                        const feed = await parser.parseURL('https://trends.google.com/trends/trendingsearches/daily/rss?geo=ID');

                        let text = `*GOOGLE TRENDS INDONESIA* 🇮🇩\n_Apa yang lagi dicari orang hari ini?_\n\n`;

                        // Ambil 5-7 tren teratas
                        feed.items.slice(0, 7).forEach((item, i) => {
                            const traffic = item.traffic || "Ramai";
                            text += `${i + 1}. *${item.title}*\n`;
                            text += `Volume: ${traffic}\n`;
                            // Google Trends RSS deskripsinya kadang HTML, kita ambil judul aja/link
                            text += `${item.link}\n\n`;
                        });

                        await sock.sendMessage(from, { text: text }, { quoted: msg });
                    }

                } catch (err) {
                    console.error("Trend Error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengambil data tren/berita." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR PROTEKSI PDF (LOCK & UNLOCK) ---

            // 1. KUNCI PDF (ENCRYPT)
            if (cmd === "!pdfprotect" || cmd === "!lockpdf") {
                const password = teks.replace(cmd, "").trim();
                
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.documentMessage || quote.documentMessage.mimetype !== 'application/pdf') {
                    return sock.sendMessage(from, { text: "Reply file PDF-nya Bang!" }, { quoted: msg });
                }
                if (!password) {
                    return sock.sendMessage(from, { text: "Passwordnya apa Bang? Contoh: *!pdfprotect rahasia123*" }, { quoted: msg });
                }

                try {

                    const { PDFDocument, StandardFonts } = require('pdf-lib');
                    
                    // Download & Load
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const pdfDoc = await PDFDocument.load(buf);

                    // Enkripsi
                    // userPassword: Password untuk membuka file
                    // ownerPassword: Password untuk edit permission (kita samakan saja biar gampang)
                    // permissions: Kita kunci semuanya (print, copy, modify)
                    pdfDoc.encrypt({
                        userPassword: password,
                        ownerPassword: password,
                        permissions: {
                            printing: 'highResolution', // Boleh print (opsional, bisa dimatikan)
                            modifying: false,
                            copying: false,
                            annotating: false,
                            fillingForms: false,
                            contentAccessibility: false,
                            documentAssembly: false,
                        },
                    });

                    // Simpan
                    const pdfBytes = await pdfDoc.save();
                    const stamp = Date.now();
                    const outPath = `./protected_${stamp}.pdf`;
                    fs.writeFileSync(outPath, pdfBytes);

                    await sock.sendMessage(from, { 
                        document: fs.readFileSync(outPath), 
                        mimetype: 'application/pdf',
                        fileName: `locked_protected.pdf`,
                        caption: `*Sukses Dikunci!*\nPassword: ${password}`
                    }, { quoted: msg });

                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Protect Error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengunci PDF." }, { quoted: msg });
                }
                return;
            }

            // 2. BUKA KUNCI PDF (DECRYPT)
            if (cmd === "!pdfunlock" || cmd === "!unlockpdf") {
                const password = teks.replace(cmd, "").trim();

                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.documentMessage || quote.documentMessage.mimetype !== 'application/pdf') {
                    return sock.sendMessage(from, { text: "Reply file PDF yang terkunci Bang!" }, { quoted: msg });
                }
                if (!password) {
                    return sock.sendMessage(from, { text: "Masukkan password lamanya buat ngebuka. Contoh: *!pdfunlock rahasia123*" }, { quoted: msg });
                }

                try {

                    const { PDFDocument } = require('pdf-lib');
                    
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");

                    // 1. Coba Load dengan Password
                    let srcDoc;
                    try {
                        srcDoc = await PDFDocument.load(buf, { password: password });
                    } catch (e) {
                        return sock.sendMessage(from, { text: "❌ Password salah Bang! Gagal membuka file." }, { quoted: msg });
                    }

                    // 2. Trik Unlock: Salin halaman ke dokumen baru yang bersih
                    const newDoc = await PDFDocument.create();
                    const indices = srcDoc.getPageIndices();
                    const copiedPages = await newDoc.copyPages(srcDoc, indices);

                    copiedPages.forEach((page) => newDoc.addPage(page));

                    // 3. Simpan (Otomatis tanpa password)
                    const pdfBytes = await newDoc.save();
                    const stamp = Date.now();
                    const outPath = `./unlocked_${stamp}.pdf`;
                    fs.writeFileSync(outPath, pdfBytes);

                    await sock.sendMessage(from, { 
                        document: fs.readFileSync(outPath), 
                        mimetype: 'application/pdf',
                        fileName: `unlocked_clean.pdf`,
                        caption: `*Sukses Dibuka!*\nPassword telah dihapus.`
                    }, { quoted: msg });

                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Unlock Error:", err);
                    await sock.sendMessage(from, { text: "Gagal membuka kunci PDF." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR ROTATE PDF (PUTAR HALAMAN) ---
            if (cmd === "!pdfrotate" || cmd === "!putar") {
                const args = teks.replace(cmd, "").trim().toLowerCase();
                
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.documentMessage || quote.documentMessage.mimetype !== 'application/pdf') {
                    return sock.sendMessage(from, { text: "Reply file PDF yang miring Bang!" }, { quoted: msg });
                }

                // Tentukan derajat putaran (Default: 90 derajat ke kanan/searah jarum jam)
                let degreesToAdd = 90;

                if (args.includes("180")) {
                    degreesToAdd = 180; // Balik atas-bawah
                } else if (args.includes("270") || args.includes("kiri") || args.includes("left")) {
                    degreesToAdd = 270; // Putar ke kiri (berlawanan jarum jam)
                }

                try {

                    const { PDFDocument, degrees } = require('pdf-lib');

                    // 1. Download & Load
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const pdfDoc = await PDFDocument.load(buf);
                    const pages = pdfDoc.getPages();

                    // 2. Loop Semua Halaman & Putar
                    pages.forEach((page) => {
                        // Ambil rotasi sekarang (default biasanya 0)
                        const currentRotation = page.getRotation().angle;
                        
                        // Hitung rotasi baru (modulo 360 biar tetap dalam lingkaran)
                        const newRotation = (currentRotation + degreesToAdd) % 360;
                        
                        page.setRotation(degrees(newRotation));
                    });

                    // 3. Simpan
                    const pdfBytes = await pdfDoc.save();
                    const stamp = Date.now();
                    const outPath = `./rotate_${stamp}.pdf`;
                    fs.writeFileSync(outPath, pdfBytes);

                    await sock.sendMessage(from, { 
                        document: fs.readFileSync(outPath), 
                        mimetype: 'application/pdf',
                        fileName: `rotated_${degreesToAdd}.pdf`,
                        caption: `✅ Sukses diputar ${degreesToAdd}°`
                    }, { quoted: msg });

                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Rotate Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memutar PDF. Pastikan file tidak dikunci password." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR EXTRACT PDF (COMOT HALAMAN) ---
            if (cmd === "!pdfextract" || cmd === "!comot") {
                // Cara pakai: 
                // 1. Rentang: !comot 1-5
                // 2. Acak: !comot 1,5,9
                // 3. Campur: !comot 1-3, 5, 10
                
                const args = teks.replace(cmd, "").trim();

                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.documentMessage || quote.documentMessage.mimetype !== 'application/pdf') {
                    return sock.sendMessage(from, { text: "Reply file PDF-nya Bang!" }, { quoted: msg });
                }
                if (!args) {
                    return sock.sendMessage(from, { text: "Halaman berapa? Contoh: *!comot 1,5,9* atau *!comot 1-10*" }, { quoted: msg });
                }

                try {

                    const { PDFDocument } = require('pdf-lib');

                    // 1. Download & Load
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const srcDoc = await PDFDocument.load(buf);
                    const totalPages = srcDoc.getPageCount();
                    const newDoc = await PDFDocument.create();

                    // 2. Parsing Halaman (Logika Baru)
                    // Kita pecah dulu berdasarkan koma, lalu cek apakah ada rentang (-)
                    let rawParts = args.split(","); 
                    let finalIndices = [];

                    rawParts.forEach(part => {
                        part = part.trim();
                        if (part.includes("-")) {
                            // Mode Rentang (misal: "1-5")
                            const range = part.split("-");
                            const start = parseInt(range[0]);
                            const end = parseInt(range[1]);

                            if (!isNaN(start) && !isNaN(end) && start <= end) {
                                for (let i = start; i <= end; i++) {
                                    // Validasi biar gak minta halaman di luar batas
                                    if (i >= 1 && i <= totalPages) finalIndices.push(i - 1);
                                }
                            }
                        } else {
                            // Mode Satuan (misal: "9")
                            const num = parseInt(part);
                            if (!isNaN(num) && num >= 1 && num <= totalPages) {
                                finalIndices.push(num - 1); // PDF-Lib index mulai dari 0
                            }
                        }
                    });

                    // Hapus duplikat halaman (opsional, biar rapi)
                    // finalIndices = [...new Set(finalIndices)]; 

                    // Cek hasil parsing
                    if (finalIndices.length === 0) {
                        return sock.sendMessage(from, { text: `⚠️ Halaman tidak valid atau melebihi jumlah halaman asli (${totalPages} hal).` }, { quoted: msg });
                    }

                    // 3. Salin Halaman
                    const copiedPages = await newDoc.copyPages(srcDoc, finalIndices);
                    copiedPages.forEach((page) => newDoc.addPage(page));

                    // 4. Simpan & Kirim
                    const pdfBytes = await newDoc.save();
                    const stamp = Date.now();
                    const outPath = `./extract_${stamp}.pdf`;
                    fs.writeFileSync(outPath, pdfBytes);

                    await sock.sendMessage(from, { 
                        document: fs.readFileSync(outPath), 
                        mimetype: 'application/pdf',
                        fileName: `comot_pages.pdf`,
                        caption: `✅ Berhasil mengambil ${finalIndices.length} halaman.\n📑 Halaman: ${args}`
                    }, { quoted: msg });

                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Extract Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memotong PDF. Pastikan file tidak dipassword." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR DELETE HALAMAN PDF ---
            if (cmd === "!pdfdelete" || cmd === "!hapushal") {
                // Cara pakai: 
                // !hapushal 1 (Hapus halaman 1, sisa halaman 2 sampai akhir)
                // !hapushal 1,3,5 (Hapus halaman ganjil itu)
                // !hapushal 1-5 (Hapus 5 halaman pertama)
                
                const args = teks.replace(cmd, "").trim();

                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.documentMessage || quote.documentMessage.mimetype !== 'application/pdf') {
                    return sock.sendMessage(from, { text: "Reply file PDF-nya Bang!" }, { quoted: msg });
                }
                if (!args) {
                    return sock.sendMessage(from, { text: "Halaman mana yang mau dibuang? Contoh: *!hapushal 2* atau *!hapushal 1-3*" }, { quoted: msg });
                }

                try {

                    const { PDFDocument } = require('pdf-lib');

                    // 1. Download & Load
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const srcDoc = await PDFDocument.load(buf);
                    const totalPages = srcDoc.getPageCount();
                    const newDoc = await PDFDocument.create();

                    // 2. Tentukan Halaman yang Mau DIHAPUS (Blacklist)
                    let rawParts = args.split(","); 
                    let deleteIndices = [];

                    rawParts.forEach(part => {
                        part = part.trim();
                        if (part.includes("-")) {
                            // Range (1-5)
                            const range = part.split("-");
                            const start = parseInt(range[0]);
                            const end = parseInt(range[1]);
                            if (!isNaN(start) && !isNaN(end) && start <= end) {
                                for (let i = start; i <= end; i++) {
                                    deleteIndices.push(i - 1); // Convert ke index 0-based
                                }
                            }
                        } else {
                            // Satuan (5)
                            const num = parseInt(part);
                            if (!isNaN(num)) {
                                deleteIndices.push(num - 1);
                            }
                        }
                    });

                    // 3. Tentukan Halaman yang DISIMPAN (Whitelist)
                    // Logika: Ambil semua halaman KECUALI yang ada di list deleteIndices
                    let keepIndices = [];
                    for (let i = 0; i < totalPages; i++) {
                        if (!deleteIndices.includes(i)) {
                            keepIndices.push(i);
                        }
                    }

                    // Validasi: Jangan sampai user menghapus SEMUA halaman
                    if (keepIndices.length === 0) {
                        return sock.sendMessage(from, { text: "Waduh Bang, kalau dihapus semua nanti filenya kosong dong!" }, { quoted: msg });
                    }
                    
                    // Validasi: Kalau halaman yang dihapus gak ada di PDF
                    if (keepIndices.length === totalPages) {
                        return sock.sendMessage(from, { text: "Gak ada yang dihapus Bang, nomor halamannya gak ketemu." }, { quoted: msg });
                    }

                    // 4. Salin Halaman yang Tersisa
                    const copiedPages = await newDoc.copyPages(srcDoc, keepIndices);
                    copiedPages.forEach((page) => newDoc.addPage(page));

                    // 5. Simpan & Kirim
                    const pdfBytes = await newDoc.save();
                    const stamp = Date.now();
                    const outPath = `./delete_${stamp}.pdf`;
                    fs.writeFileSync(outPath, pdfBytes);

                    await sock.sendMessage(from, { 
                        document: fs.readFileSync(outPath), 
                        mimetype: 'application/pdf',
                        fileName: `deleted_pages.pdf`,
                        caption: `✅ Berhasil membuang halaman: ${args}\n📄 Sisa: ${keepIndices.length} halaman.`
                    }, { quoted: msg });

                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Delete PDF Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memproses PDF." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR IMAGE TO PDF ---
            if (cmd === "!img2pdf" || cmd === "!topdf") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Cek apakah user me-reply gambar
                if (!quote.imageMessage) {
                    return sock.sendMessage(from, { text: "Reply foto yang mau dijadikan PDF Bang!" }, { quoted: msg });
                }

                try {

                    const { PDFDocument } = require('pdf-lib');

                    // 2. Download Gambar
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");

                    // 3. Buat PDF Baru
                    const pdfDoc = await PDFDocument.create();
                    
                    // Embed gambar (WhatsApp biasanya kirim JPG)
                    // Kita gunakan try-catch untuk deteksi format (JPG/PNG)
                    let image;
                    try {
                        image = await pdfDoc.embedJpg(buf);
                    } catch (e) {
                        // Kalau gagal JPG, coba PNG
                        image = await pdfDoc.embedPng(buf);
                    }

                    // 4. Buat Halaman Sesuai Ukuran Gambar
                    // Biar hasilnya pas, gak kepotong, gak ada margin putih
                    const page = pdfDoc.addPage([image.width, image.height]);

                    // 5. Gambar Image di PDF
                    page.drawImage(image, {
                        x: 0,
                        y: 0,
                        width: image.width,
                        height: image.height,
                    });

                    // 6. Simpan & Kirim
                    const pdfBytes = await pdfDoc.save();
                    const stamp = Date.now();
                    const outPath = `./img2pdf_${stamp}.pdf`;
                    fs.writeFileSync(outPath, pdfBytes);

                    await sock.sendMessage(from, { 
                        document: fs.readFileSync(outPath), 
                        mimetype: 'application/pdf',
                        fileName: `image_converted.pdf`,
                        caption: "✅ Jadi PDF nih Bang!" 
                    }, { quoted: msg });

                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Img2Pdf Error:", err);
                    await sock.sendMessage(from, { text: "Gagal konversi. Pastikan format gambarnya JPG/PNG." }, { quoted: msg });
                }
                return;
            }            

            // --- FITUR HEIC TO JPG (IPHONE CONVERTER) ---
            if (cmd === "!heic2jpg" || cmd === "!tojpg") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Cek apakah user me-reply dokumen
                if (!quote.documentMessage) {
                    return sock.sendMessage(from, { text: "Reply file HEIC (Dokumen) yang mau diubah, Bang!" }, { quoted: msg });
                }

                // 2. Cek Ekstensi File
                const fileName = quote.documentMessage.fileName || "";
                // Regex cek akhiran .heic atau .heif (case insensitive)
                if (!/.(heic|heif)$/i.test(fileName)) {
                    return sock.sendMessage(from, { text: "Ini bukan file HEIC Bang. Cek lagi filenya." }, { quoted: msg });
                }

                try {

                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./heic_in_${stamp}.heic`;
                    const outPath = `./heic_out_${stamp}.jpg`;

                    fs.writeFileSync(inPath, buf);

                    // 3. Jalankan ImageMagick
                    // Perintah simpel: magick input.heic output.jpg
                    await execPromise(`magick "${inPath}" "${outPath}"`);

                    // 4. Kirim Hasil (Sebagai Foto Biasa biar bisa langsung dilihat)
                    await sock.sendMessage(from, { 
                        image: fs.readFileSync(outPath), 
                        caption: "✅ Sukses konversi ke JPG (Bisa dibuka di Android/PC)" 
                    }, { quoted: msg });

                    // Bersih-bersih
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("HEIC Error:", err);
                    await sock.sendMessage(from, { text: "Gagal konversi. Pastikan file tidak rusak." }, { quoted: msg });
                }
                return;
            }
            
            // --- FITUR KONVERSI WEBP/STIKER KE GAMBAR (JPG/PNG) ---
            if (cmd === "!webp2jpg" || cmd === "!tojpg" || cmd === "!webp2png" || cmd === "!topng") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Validasi Input
                // Cek apakah yang direply adalah Stiker, Gambar, atau Dokumen Gambar
                const isSticker = quote.stickerMessage;
                const isImage = quote.imageMessage;
                // Cek dokumen, pastikan mimetype-nya image (misal image/webp, image/jpeg)
                const isImageDoc = quote.documentMessage && quote.documentMessage.mimetype.startsWith('image/');

                if (!isSticker && !isImage && !isImageDoc) {
                    return sock.sendMessage(from, { text: "Reply stiker atau file gambarnya Bang!" }, { quoted: msg });
                }

                try {
                    // 2. Tentukan Format Output Berdasarkan Command
                    // Cek apakah command mengandung kata "png"
                    const isTargetPng = cmd.includes("png");
                    const outputExt = isTargetPng ? "png" : "jpg";
                    const outputLabel = isTargetPng ? "PNG" : "JPG";

                    // 3. Download Media
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./conv_in_${stamp}.tmp`; // Input temp
                    const outPath = `./conv_out_${stamp}.${outputExt}`; // Output sesuai target

                    fs.writeFileSync(inPath, buf);

                    // 4. Racik Perintah ImageMagick
                    let command = "";

                    if (isTargetPng) {
                        // Jika target PNG, konversi biasa (transparansi dipertahankan)
                        command = `magick "${inPath}" "${outPath}"`;
                    } else {
                        // Jika target JPG (tidak support transparan)
                        // Kita tambahkan background putih dan ratakan (flatten)
                        // Kalau tidak diginiin, bagian transparan di stiker bakal jadi hitam legam.
                        command = `magick "${inPath}" -background white -flatten "${outPath}"`;
                    }

                    // Eksekusi
                    await execPromise(command);

                    // 5. Kirim Hasil
                    await sock.sendMessage(from, { 
                        image: fs.readFileSync(outPath), 
                        caption: `✅ Sukses jadi ${outputLabel}` 
                    }, { quoted: msg });

                    // 6. Bersih-bersih
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Webp Convert Error:", err);
                    await sock.sendMessage(from, { text: "Gagal konversi gambar." }, { quoted: msg });
                    // Hapus file temp jika error di tengah jalan
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                }
                return;
            }

            // --- FITUR AUDIO CONVERTER (FFMPEG) ---
            if (cmd === "!audioconvert" || cmd === "!tomp3" || cmd === "!towav" || cmd === "!toogg") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Cek Input Audio
                // Bisa berupa Voice Note, Audio, atau Dokumen Audio
                const isAudio = quote.audioMessage;
                const isDoc = quote.documentMessage && quote.documentMessage.mimetype.startsWith('audio/');

                if (!isAudio && !isDoc) {
                    return sock.sendMessage(from, { text: "Reply voice note atau file audionya Bang!" }, { quoted: msg });
                }

                // 2. Tentukan Format Tujuan
                // Logika: Cek argumen (!audioconvert wav) ATAU cek command (!towav)
                let targetFormat = "mp3"; // Default
                const args = teks.replace(cmd, "").trim().toLowerCase();

                if (cmd.includes("wav") || args === "wav") targetFormat = "wav";
                else if (cmd.includes("ogg") || args === "ogg") targetFormat = "ogg";
                else if (cmd.includes("mp3") || args === "mp3") targetFormat = "mp3";
                else if (cmd.includes("m4a") || args === "m4a") targetFormat = "m4a";

                try {

                    // 3. Download & Siapkan Path
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./audio_in_${stamp}.tmp`;
                    const outPath = `./audio_out_${stamp}.${targetFormat}`;

                    fs.writeFileSync(inPath, buf);

                    // 4. Racik Command FFmpeg
                    let ffmpegCmd = "";

                    if (targetFormat === "mp3") {
                        // MP3: Codec mp3lame, Bitrate 128k (Standar)
                        ffmpegCmd = `ffmpeg -y -i "${inPath}" -acodec libmp3lame -b:a 128k "${outPath}"`;
                    } else if (targetFormat === "wav") {
                        // WAV: Uncompressed (Kualitas tinggi, size besar)
                        ffmpegCmd = `ffmpeg -y -i "${inPath}" "${outPath}"`;
                    } else if (targetFormat === "ogg") {
                        // OGG: Codec libvorbis
                        ffmpegCmd = `ffmpeg -y -i "${inPath}" -c:a libvorbis "${outPath}"`;
                    } else {
                        // Default/M4A: AAC (Standar audio modern)
                        ffmpegCmd = `ffmpeg -y -i "${inPath}" -c:a aac "${outPath}"`;
                    }

                    // Eksekusi
                    await execPromise(ffmpegCmd);

                    // 5. Kirim Hasil
                    // Kita kirim sebagai 'document' agar nama filenya jelas & tidak dikompres lagi oleh WA
                    await sock.sendMessage(from, { 
                        document: fs.readFileSync(outPath), 
                        mimetype: `audio/${targetFormat}`,
                        fileName: `converted_audio.${targetFormat}`,
                        caption: `✅ Selesai Bang! (${targetFormat.toUpperCase()})` 
                    }, { quoted: msg });

                    // 6. Bersih-bersih
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Audio Convert Error:", err);
                    await sock.sendMessage(from, { text: "Gagal konversi audio." }, { quoted: msg });
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                }
                return;
            }

            // --- FITUR VIDEO CUTTER (SUPPORT MENIT:DETIK) ---
            if (cmd === "!cut" || cmd === "!potong") {
                // Cara pakai: 
                // 1. Detik biasa: !cut 10 30 (Detik 10 s.d 30)
                // 2. Menit:detik: !cut 1:15 2:30 (Menit 1:15 s.d 2:30)
                
                const args = teks.replace(cmd, "").trim().split(" ");
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.videoMessage) {
                    return sock.sendMessage(from, { text: "Reply videonya Bang!" }, { quoted: msg });
                }
                if (args.length < 2) {
                    return sock.sendMessage(from, { text: "⚠️ Masukkan waktu awal dan akhir.\n\nContoh: *!cut 1:00 1:30*\n(Potong dari menit 1 pas sampai menit 1 lewat 30)" }, { quoted: msg });
                }

                // --- Helper Function: Konversi Waktu ke Detik ---
                const parseToSeconds = (input) => {
                    if (input.includes(":")) {
                        const parts = input.split(":");
                        const min = parseInt(parts[0]);
                        const sec = parseInt(parts[1]);
                        return (min * 60) + sec;
                    }
                    return parseInt(input); // Kalau cuma angka (misal "90") langsung return
                };

                const startTime = parseToSeconds(args[0]);
                const endTime = parseToSeconds(args[1]);

                // Validasi
                if (isNaN(startTime) || isNaN(endTime)) {
                    return sock.sendMessage(from, { text: "Format waktunya salah Bang. Gunakan *mm:ss* atau detik." }, { quoted: msg });
                }
                if (startTime >= endTime) {
                    return sock.sendMessage(from, { text: "⚠️ Waktu akhir harus lebih besar dari waktu awal, Bang." }, { quoted: msg });
                }

                // Hitung durasi
                const duration = endTime - startTime;

                try {
                    // Tampilkan pesan konfirmasi yang enak dibaca user
                    const displayStart = new Date(startTime * 1000).toISOString().substr(14, 5); // Format mm:ss
                    const displayEnd = new Date(endTime * 1000).toISOString().substr(14, 5);
                    
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./cut_in_${stamp}.mp4`;
                    const outPath = `./cut_out_${stamp}.mp4`;

                    fs.writeFileSync(inPath, buf);

                    // Proses FFmpeg
                    // Kita pakai preset ultrafast biar cepat
                    await execPromise(`ffmpeg -y -ss ${startTime} -i "${inPath}" -t ${duration} -c:v libx264 -preset ultrafast -c:a copy "${outPath}"`);

                    await sock.sendMessage(from, { 
                        video: fs.readFileSync(outPath), 
                        caption: `✅ *Cut Selesai!* (${duration}s)` 
                    }, { quoted: msg });

                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Cut Error:", err);
                    await sock.sendMessage(from, { text: "Gagal memotong video." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR PDF FONT INSPECTOR ---
            if (cmd === "!pdffonts" || cmd === "!cekfont") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                if (!quote.documentMessage || quote.documentMessage.mimetype !== 'application/pdf') {
                    return sock.sendMessage(from, { text: "Reply file PDF-nya Bang!" }, { quoted: msg });
                }

                try {

                    const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
                    
                    // 1. Download & Load
                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const pdfDoc = await PDFDocument.load(buf);

                    // 2. Scanning Low-Level Objects
                    // Kita akan meloop seluruh objek di dalam PDF untuk mencari yang Type-nya "Font"
                    const fontsFound = new Set();
                    
                    // enumerateIndirectObjects() mengembalikan list [reference, object]
                    const objects = pdfDoc.context.enumerateIndirectObjects();

                    for (const [ref, obj] of objects) {
                        if (obj instanceof PDFDict) {
                            // Cek apakah objek ini adalah Font
                            const type = obj.lookup(PDFName.of('Type'));
                            if (type === PDFName.of('Font')) {
                                
                                // Ambil BaseFont (Nama Fontnya)
                                const baseFont = obj.lookup(PDFName.of('BaseFont'));
                                const subType = obj.lookup(PDFName.of('Subtype'));
                                
                                if (baseFont && baseFont instanceof PDFName) {
                                    // Decode nama font (biasanya format /ABCDE+Arial-Bold)
                                    let fontName = baseFont.decodeText();
                                    
                                    // Bersihkan prefix acak (6 huruf + tanda +) jika ada (Subset font)
                                    if (fontName.includes("+")) {
                                        fontName = fontName.split("+")[1];
                                    }

                                    // Ambil tipe font (TrueType, Type1, dll)
                                    let fontType = subType ? subType.decodeText() : "Unknown";

                                    fontsFound.add(`🔤 ${fontName} _(${fontType})_`);
                                }
                            }
                        }
                    }

                    // 3. Susun Laporan
                    let resultText = `*Laporan Font PDF*\n`;
                    resultText += `*File:* ${quote.documentMessage.fileName}\n`;
                    resultText += `---------------------------\n`;

                    if (fontsFound.size > 0) {
                        resultText += Array.from(fontsFound).join("\n");
                    } else {
                        resultText += "⚠️ Tidak ditemukan definisi font spesifik (Mungkin teks sudah dikonversi jadi kurva/gambar).";
                    }

                    resultText += `\n---------------------------\n_Total: ${fontsFound.size} jenis font terdeteksi._`;

                    await sock.sendMessage(from, { text: resultText }, { quoted: msg });

                } catch (err) {
                    console.error("Font Inspect Error:", err);
                    await sock.sendMessage(from, { text: "Gagal mendeteksi font. Struktur PDF mungkin terlalu kompleks." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR KONVERSI WARNA (RGB <-> CMYK) ---
            if (cmd === "!rgb2cmyk" || cmd === "!tocmyk" || cmd === "!cmyk2rgb" || cmd === "!torgb") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quote = ctx?.quotedMessage ? ctx.quotedMessage : msg.message;

                // 1. Validasi Input (Gambar atau Dokumen Gambar)
                const isImage = quote.imageMessage;
                const isDoc = quote.documentMessage && quote.documentMessage.mimetype.startsWith('image/');

                if (!isImage && !isDoc) {
                    return sock.sendMessage(from, { text: "Reply gambarnya Bang!" }, { quoted: msg });
                }

                try {
                    // Tentukan Arah Konversi
                    const isToCMYK = (cmd === "!rgb2cmyk" || cmd === "!tocmyk");
                    const targetSpace = isToCMYK ? "CMYK" : "sRGB"; // sRGB adalah standar layar HP/Monitor
                    
                    const textProcess = isToCMYK 
                        ? "" 
                        : "";

                    await sock.sendMessage(from, { text: textProcess }, { quoted: msg });

                    const buf = await downloadMediaMessage({ message: quote }, "buffer");
                    const stamp = Date.now();
                    const inPath = `./col_in_${stamp}.jpg`;
                    const outPath = `./col_out_${stamp}.jpg`;

                    fs.writeFileSync(inPath, buf);

                    // 2. Jalankan ImageMagick
                    // -colorspace mengubah profil warna pixel
                    await execPromise(`magick "${inPath}" -colorspace ${targetSpace} "${outPath}"`);

                    // 3. Kirim Hasil (Logika Cerdas)
                    if (isToCMYK) {
                        // --- KASUS KE CMYK ---
                        // Kita HARUS kirim sebagai DOKUMEN.
                        // Kalau kirim sebagai Image, server WhatsApp akan re-encode balik ke RGB, 
                        // nanti pas di-print warnanya tetap salah.
                        await sock.sendMessage(from, { 
                            document: fs.readFileSync(outPath), 
                            mimetype: 'image/jpeg',
                            fileName: `converted_cmyk.jpg`,
                            caption: "✅ *Mode CMYK (Print Safe)*\n\n⚠️ _Jangan kaget kalau dibuka di HP warnanya agak aneh/negatif. Itu normal untuk file CMYK. Langsung bawa ke percetakan aja._" 
                        }, { quoted: msg });
                    } else {
                        // --- KASUS KE RGB ---
                        // Kita kirim sebagai GAMBAR biasa biar langsung kelihatan hasilnya.
                        await sock.sendMessage(from, { 
                            image: fs.readFileSync(outPath), 
                            caption: "✅ *Mode RGB (Screen Safe)*\nWarnanya sudah normal buat dilihat di HP." 
                        }, { quoted: msg });
                    }

                    // 4. Bersih-bersih
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Color Convert Error:", err);
                    await sock.sendMessage(from, { text: "Gagal konversi warna." }, { quoted: msg });
                }
                return;
            }

            // --- FITUR UNIT CONVERTER ADVANCED (MATHJS) ---
            if (cmd === "!convert" || cmd === "!konversi") {
                // Cara pakai: !convert 10 inch to cm
                // Atau: !convert 100 psi to bar
                
                const args = teks.replace(cmd, "").trim();

                if (!args) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ *Format Salah Bang!*
Gunakan format: *[angka] [satuan_asal] to [satuan_tujuan]*

*Contoh Teknik:*
*Tekanan:* !convert 30 psi to bar
*Suhu:* !convert 100 degC to degF
*Panjang:* !convert 5 inch to cm
*Data:* !convert 1024 MB to GB
*Kecepatan:* !convert 100 km/h to m/s
*Energi:* !convert 500 cal to joule` 
                    }, { quoted: msg });
                }

                try {
                    const { evaluate } = require('mathjs');

                    // MathJS mengevaluasi string "10 inch to cm" secara otomatis
                    // Hasilnya biasanya presisi tinggi, kita bulatkan sedikit biar enak dilihat
                    const result = evaluate(args);

                    // Cek apakah result memiliki method toJSON (artinya dia objek unit, bukan angka doang)
                    let output = "";
                    if (typeof result === 'object' && result.toString) {
                        output = result.toString(); 
                    } else {
                        output = result; // Kalau user iseng hitung matematika biasa (!convert 5 * 5)
                    }

                    await sock.sendMessage(from, { 
                        text: `*Konversi Unit*\n\nInput: ${args}\nHasil: *${output}*` 
                    }, { quoted: msg });

                } catch (err) {
                    console.error("Convert Error:", err.message);
                    // Error handling kalau satuan tidak dikenal
                    await sock.sendMessage(from, { 
                        text: "❌ Satuan tidak dikenali atau sintaks salah.\nPastikan pakai bahasa Inggris, misal: *degC* (bukan Celcius), *hour* (bukan jam)." 
                    }, { quoted: msg });
                }
                return;
            }

            // =================================================
            // QR GENERATOR — TEKS
            // =================================================
            if (cmd === "!qr") {
            const text = teks.replace(/!qr/i, "").trim();

            if (!text) {
                await sock.sendMessage(from, { text: "Format: *!qr <teks/url>*\nContoh: !qr https://google.com" });
                return;
            }

            try {
                // generate PNG buffer
                const pngBuffer = await QRCode.toBuffer(text, {
                type: "png",
                width: 900,
                margin: 2,
                errorCorrectionLevel: "M",
                });

                // kirim sebagai IMAGE (bukan sticker)
                await sock.sendMessage(from, {
                image: pngBuffer,
                caption: `QR untuk:\n${text}`,
                });

            } catch (err) {
                console.error("QR ERROR:", err?.message || err);
                await sock.sendMessage(from, { text: "Gagal membuat QR." });
            }

            return;
            }

            // =================================================
            // QR WIFI — GENERATE QR WIFI T:WPA/WEP
            // =================================================
            if (cmd === "!qrwifi") {
                const raw = teks.replace(/!qrwifi/i, "").trim();

                if (!raw || !raw.includes("|")) {
                    await sock.sendMessage(from, {
                        text:
            "Format: !qrwifi ssid|password|Tipe\n" +
            "Contoh: !qrwifi RumahOzzy|rahasia123|WPA\n" +
            "Tipe: WEP / WPA / WPA2 (default: WPA)."
                    });
                    return;
                }

                const parts = raw.split("|");
                const ssid = (parts[0] || "").trim();
                const pass = (parts[1] || "").trim();
                let sec = (parts[2] || "WPA").trim().toUpperCase();

                if (!ssid) {
                    await sock.sendMessage(from, { text: "SSID tidak boleh kosong, Bang." });
                    return;
                }
                if (!sec) sec = "WPA";

                const wifiString = `WIFI:T:${sec};S:${ssid};P:${pass};;`;

                const baseName = Date.now();
                const pngPath = `./qrwifi_${baseName}.png`;
                const webpPath = `./qrwifi_${baseName}.webp`;

                try {
                    await QRCode.toFile(pngPath, wifiString, {
                        width: 800,
                        margin: 1
                    });

                    const magickCmd =
                        `magick "${pngPath}" ` +
                        `-trim +repage ` +
                        `-resize 430x430 ` +
                        `-gravity center ` +
                        `-background white -extent 512x512 ` +
                        `"${webpPath}"`;

                    await execAsync(magickCmd);

                    const buffer = fs.readFileSync(webpPath);

                    await sendStickerWithMeta(sock, from, buffer, {
                        packname: "BangBot WiFi",
                        author: "BangBot"
                    });

                } catch (err) {
                    console.error("QR WiFi Error:", err);
                    await sock.sendMessage(from, { text: "Gagal membuat QR WiFi, Bang." });
                } finally {
                    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
                    if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
                }
            }

            // =================================================
            // QR VCARD — KONTAK → STIKER QR
            // =================================================
            if (cmd === "!qrvcard") {
                const raw = teks.replace(/!qrvcard/i, "").trim();

                if (!raw || !raw.includes("|")) {
                    await sock.sendMessage(from, {
                        text:
            "Format: !qrvcard nama|telp|email\n" +
            "Contoh: !qrvcard BangBot|628123456789|email@example.com"
                    });
                    return;
                }

                const parts = raw.split("|");
                const name  = (parts[0] || "").trim();
                const tel   = (parts[1] || "").trim();
                const email = (parts[2] || "").trim();

                if (!name) {
                    await sock.sendMessage(from, { text: "Nama tidak boleh kosong, Bang." });
                    return;
                }

                const vcard =
            `BEGIN:VCARD
            VERSION:3.0
            FN:${name}
            TEL:${tel}
            EMAIL:${email}
            END:VCARD`;

                const baseName = Date.now();
                const pngPath = `./qrvcard_${baseName}.png`;
                const webpPath = `./qrvcard_${baseName}.webp`;

                try {
                    await QRCode.toFile(pngPath, vcard, {
                        width: 800,
                        margin: 1
                    });

                    const magickCmd =
                        `magick "${pngPath}" ` +
                        `-trim +repage ` +
                        `-resize 430x430 ` +
                        `-gravity center ` +
                        `-background white -extent 512x512 ` +
                        `"${webpPath}"`;

                    await execAsync(magickCmd);

                    const buffer = fs.readFileSync(webpPath);

                    await sendStickerWithMeta(sock, from, buffer, {
                        packname: "BangBot vCard",
                        author: "BangBot"
                    });

                } catch (err) {
                    console.error("QR vCard Error:", err);
                    await sock.sendMessage(from, { text: "Gagal membuat QR vCard, Bang." });
                } finally {
                    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
                    if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
                }
            }

            // =================================================
            // BARCODE GENERATOR — KODE ANGKA / TEKS → STIKER
            // =================================================
            if (cmd === "!barcode") {
                const data = teks.replace(/!barcode/i, "").trim();

                if (!data) {
                    await sock.sendMessage(from, {
                        text: "Format: !barcode 12345678\nBisa angka atau teks pendek."
                    });
                    return;
                }

                const baseName = Date.now();
                const pngPath  = `./barcode_${baseName}.png`;
                const webpPath = `./barcode_${baseName}.webp`;

                try {
                    // generate barcode (1D)
                    const magickBarcode =
                        `magick -size 800x300 -background white -gravity center "barcode:${data}" "${pngPath}"`;
                    await execAsync(magickBarcode);

                    // bungkus jadi 512x512 biar cocok stiker
                    const magickWrap =
                        `magick "${pngPath}" ` +
                        `-resize 700x250 ` +
                        `-gravity center -background white -extent 512x512 ` +
                        `"${webpPath}"`;
                    await execAsync(magickWrap);

                    const buffer = fs.readFileSync(webpPath);

                    await sendStickerWithMeta(sock, from, buffer, {
                        packname: "BangBot Barcode",
                        author: "BangBot"
                    });

                } catch (err) {
                    console.error("Barcode Error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal membuat barcode. Pastikan ImageMagick mendukung 'barcode:' coder."
                    });
                } finally {
                    if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
                    if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath);
                }
            }

            // =================================================
            // QR DECODE — DARI REPLY GAMBAR / STIKER
            // =================================================
            if (cmd === "!qrdecode") {
                const buf = await getQuotedMediaBuffer(msg);

                if (!buf) {
                    await sock.sendMessage(from, {
                        text: "Reply ke *gambar QR* atau stiker QR, lalu ketik *!qrdecode*, Bang."
                    });
                    return;
                }

                try {
                    const result = await decodeQrFromBuffer(buf);

                    if (!result) {
                        await sock.sendMessage(from, {
                            text: "QR tidak terbaca atau tidak ada data yang valid, Bang."
                        });
                        return;
                    }

                    await sock.sendMessage(from, {
                        text: `*Hasil QR Decode:*\n${result}`
                    });
                } catch (err) {
                    console.error("qrdecode error:", safeErr(err));
                    await sock.sendMessage(from, {
                        text: "Gagal membaca QR. Pastikan gambarnya jelas dan tidak blur, Bang."
                    });
                }
            }

            // =================================================
            // QRAUTO — DECODE QR DARI GAMBAR TERAKHIR DI CHAT
            // =================================================
            if (cmd === "!qrauto") {
                const lastMsg = LAST_QR_IMAGE[from];

                if (!lastMsg) {
                    await sock.sendMessage(from, {
                        text: "Belum ada gambar di chat ini. Kirim/forward gambar QR dulu, Bang."
                    });
                    return;
                }

                try {
                    const buf = await downloadMediaMessage(lastMsg, "buffer");
                    const result = await decodeQrFromBuffer(buf);

                    if (!result) {
                        await sock.sendMessage(from, {
                            text: "QR tidak terbaca dari gambar terakhir, Bang."
                        });
                        return;
                    }

                    await sock.sendMessage(from, {
                        text: `*Hasil QR Decode (Auto):*\n${result}`
                    });
                } catch (err) {
                    console.error("qrauto error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal membaca QR otomatis dari gambar terakhir."
                    });
                }
            }

            // =================================================
            // QRFULLSCAN — SCAN BANYAK QR DALAM SATU GAMBAR
            // =================================================
            if (cmd === "!qrfullscan") {
                // Prioritas: reply image, kalau tidak ada pakai LAST_QR_IMAGE
                let buf = await getQuotedMediaBuffer(msg);

                if (!buf) {
                    const lastMsg = LAST_QR_IMAGE[from];
                    if (lastMsg) {
                        buf = await downloadMediaMessage(lastMsg, "buffer");
                    }
                }

                if (!buf) {
                    await sock.sendMessage(from, {
                        text: "Reply ke gambar yang berisi banyak QR, atau kirim dulu gambar QR ke chat ini lalu pakai *!qrfullscan*, Bang."
                    });
                    return;
                }

                const ts = Date.now();
                const imgPath = `./qrscan_${ts}.png`;

                try {
                    fs.writeFileSync(imgPath, buf);

                    // Coba pakai zbarimg (bisa baca banyak QR sekaligus)
                    let lines = [];
                    try {
                        const out = await execAsync(`zbarimg --quiet --raw "${imgPath}"`);
                        lines = out
                            .split(/\r?\n/)
                            .map(l => l.trim())
                            .filter(Boolean);
                    } catch (e) {
                        console.error("zbarimg error (mungkin belum terinstal):", e);
                    }

                    if (!lines.length) {
                        // fallback: single decode dengan qrcode-reader
                        const result = await decodeQrFromBuffer(buf);
                        if (!result) {
                            await sock.sendMessage(from, {
                                text: "Tidak ditemukan QR yang bisa dibaca di gambar ini, Bang."
                            });
                            return;
                        }

                        await sock.sendMessage(from, {
                            text: `*Hasil Scan (single QR, fallback):*\n${result}`
                        });
                        return;
                    }

                    // Tampilkan semua hasil
                    let msgText = "*Hasil QR Full Scan:*\n\n";
                    lines.forEach((val, idx) => {
                        msgText += `${idx + 1}. ${val}\n`;
                    });

                    await sock.sendMessage(from, { text: msgText });

                } catch (err) {
                    console.error("qrfullscan error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal full-scan QR. Pastikan zbarimg terinstal jika ingin banyak QR sekaligus."
                    });
                } finally {
                    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
                }
            }

            // =================================================
            // PDF SPLIT: Reply PDF + !pdfsplit 1,3,5-7
            // =================================================
            if (cmd === "!pdfsplit") {
                const spec = teks.replace(new RegExp(cmd, "i"), "").trim();

                if (!spec) {
                    await sock.sendMessage(from, {
                        text:
            `Format:
            - Reply PDF lalu ketik: *!pdfsplit 1*
            - *!pdfsplit 1-3*
            - *!pdfsplit 1,3,5-7*

            Catatan: nomor halaman mulai dari 1.`
                    }, { quoted: msg });
                    return;
                }

                try {
                    let pdfBuf = null;

                    // 1) Kalau user kirim PDF langsung dengan caption !pdfsplit ...
                    if (type === "documentMessage" && msg.message?.documentMessage?.mimetype?.includes("pdf")) {
                        pdfBuf = await downloadMediaMessage(msg, "buffer");
                    } else {
                        // 2) Kalau pakai reply ke PDF
                        const ctx = msg.message?.extendedTextMessage?.contextInfo;
                        const quotedDoc = ctx?.quotedMessage?.documentMessage;

                        if (!quotedDoc || !quotedDoc.mimetype?.includes("pdf")) {
                            await sock.sendMessage(from, { text: "Reply ke *file PDF* dulu, Bang." }, { quoted: msg });
                            return;
                        }

                        pdfBuf = await downloadMediaMessage({ message: ctx.quotedMessage }, "buffer");
                    }

                    if (!pdfBuf) throw new Error("PDF buffer kosong.");

                    const src = await PDFDocument.load(pdfBuf);
                    const total = src.getPageCount();

                    const pages = parsePageSpec(spec, total);
                    if (!pages) {
                        await sock.sendMessage(from, {
                            text: `❌ Format halaman tidak valid atau di luar range.\nPDF ini punya ${total} halaman.\nContoh: *!pdfsplit 1-3* atau *!pdfsplit 1,3,5-7*`
                        }, { quoted: msg });
                        return;
                    }

                    const outPdf = await PDFDocument.create();
                    const copied = await outPdf.copyPages(src, pages);
                    copied.forEach(p => outPdf.addPage(p));

                    const outBytes = await outPdf.save();
                    const outName = `BangBot_PDFSplit_${Date.now()}_p${spec.replace(/[^\d,-]/g, "")}.pdf`;

                    await sock.sendMessage(from, {
                        document: Buffer.from(outBytes),
                        mimetype: "application/pdf",
                        fileName: outName
                    }, { quoted: msg });

                } catch (err) {
                    console.error("[PDFSPLIT ERROR]", err);
                    await sock.sendMessage(from, { text: `❌ Gagal potong PDF.\nError: ${err.message || err}` }, { quoted: msg });
                }

                return;
            }

            // =================================================
            // PPT -> PDF (LibreOffice): !ppt2pdf
            // - Reply PPT/PPTX lalu ketik !ppt2pdf
            // - atau kirim PPT/PPTX dengan caption !ppt2pdf
            // =================================================
            if (cmd === "!ppt2pdf") {
            try {
                // Ambil dokumen: bisa dari message langsung atau dari quoted
                let docMsg = null;

                // 1) File dikirim langsung
                if (type === "documentMessage" && msg.message?.documentMessage) {
                docMsg = msg.message.documentMessage;
                } else {
                // 2) Reply ke file
                const ctx = msg?.message?.extendedTextMessage?.contextInfo;
                const quoted = ctx?.quotedMessage;
                docMsg = quoted?.documentMessage || null;
                }

                if (!docMsg) {
                await sock.sendMessage(from, { text: "Reply file PPT/PPTX dulu, Bang.\nContoh: reply PPT lalu ketik *!ppt2pdf*." }, { quoted: msg });
                return;
                }

                const fileName = docMsg.fileName || "";
                let safeFileName = fileName;

                // ===== FALLBACK jika fileName kosong (BAILEYS ISSUE) =====
                if (!safeFileName) {
                const mime = docMsg.mimetype || "";

                if (mime.includes("word")) safeFileName = "document.docx";
                else if (mime.includes("spreadsheet") || mime.includes("excel")) safeFileName = "sheet.xlsx";
                else if (mime.includes("presentation") || mime.includes("powerpoint")) safeFileName = "slides.pptx";
                else {
                    await sock.sendMessage(from, {
                    text: "❌ File Office tidak dikenali (mime tidak valid)."
                    }, { quoted: msg });
                    return;
                }
                }

                const mime = docMsg.mimetype || "";

                const isPpt =
                /\.pptx?$/i.test(fileName) ||
                /presentation/i.test(mime) ||
                /powerpoint/i.test(mime);

                if (!isPpt) {
                await sock.sendMessage(from, { text: "File harus PPT/PPTX." }, { quoted: msg });
                return;
                }

                // Download file ke disk
                const workDir = path.join(__dirname, "downloads", "ppt2pdf");
                ensureDir(workDir);

                const stamp = Date.now();
                const inExt = /\.ppt$/i.test(fileName) ? ".ppt" : ".pptx";
                const inPath = path.join(workDir, `ppt_${stamp}${inExt}`);

                // download buffer dari message/quoted
                const buffer = (type === "documentMessage")
                ? await downloadMediaMessage(msg, "buffer")
                : await downloadMediaMessage({ message: msg.message.extendedTextMessage.contextInfo.quotedMessage }, "buffer");

                fs.writeFileSync(inPath, buffer);

                // Convert via LibreOffice headless
                const soffice = getSofficeCmd();

                // Catatan: --convert-to pdf akan menghasilkan file bernama sama dengan input (beda ext) di outdir
                const cmdLine = `${soffice} --headless --nologo --nolockcheck --nodefault --norestore --convert-to pdf --outdir "${workDir}" "${inPath}"`;
                await execPromise(cmdLine);

                const outPath = inPath.replace(/\.(pptx|ppt)$/i, ".pdf");

                if (!fs.existsSync(outPath)) {
                // fallback: cari pdf terbaru di folder (kalau LO menghasilkan nama berbeda)
                const pdfs = fs.readdirSync(workDir).filter(f => f.toLowerCase().endsWith(".pdf"));
                const latest = pdfs
                    .map(f => ({ f, t: fs.statSync(path.join(workDir, f)).mtimeMs }))
                    .sort((a,b) => b.t - a.t)[0]?.f;

                if (!latest) throw new Error("Output PDF tidak ditemukan setelah konversi.");
                const latestPath = path.join(workDir, latest);

                await sock.sendMessage(from, {
                    document: fs.readFileSync(latestPath),
                    mimetype: "application/pdf",
                    fileName: latest
                }, { quoted: msg });

                // cleanup
                try { fs.unlinkSync(inPath); } catch {}
                try { fs.unlinkSync(latestPath); } catch {}
                return;
                }

                const outName = (fileName.replace(/\.(pptx|ppt)$/i, "") || `BangBot_${stamp}`) + ".pdf";

                await sock.sendMessage(from, {
                document: fs.readFileSync(outPath),
                mimetype: "application/pdf",
                fileName: outName
                }, { quoted: msg });

                // cleanup
                try { fs.unlinkSync(inPath); } catch {}
                try { fs.unlinkSync(outPath); } catch {}

            } catch (err) {
                console.error("[PPT2PDF ERROR]", err);

                // Error paling umum: soffice tidak ditemukan
                const msgErr = String(err?.message || err || "");
                if (/soffice/i.test(msgErr) || /not recognized|ENOENT/i.test(msgErr)) {
                await sock.sendMessage(from, {
                    text:
            "❌ Gagal konversi: LibreOffice (soffice) tidak ditemukan.\n" +
            "Solusi:\n" +
            "1) Install LibreOffice\n" +
            "2) Pastikan `soffice --version` jalan di CMD, atau set ENV `SOFFICE_PATH` ke soffice.exe"
                }, { quoted: msg });
                return;
                }

                await sock.sendMessage(from, { text: `❌ Gagal konversi PPT → PDF.\nError: ${msgErr}` }, { quoted: msg });
            }

            return;
            }

            // =================================================
            // VOCAL REMOVE (karaoke): !vocalremove
            // Reply audio/video atau kirim dengan caption !vocalremove
            // =================================================
            if (cmd === "!vocalremove") {

            try {

                // Ambil media (audio/video) dari message langsung atau quoted
                let mediaMsg = null;
                let mediaType = null;

                if (type === "audioMessage" || type === "videoMessage") {
                mediaMsg = msg;
                mediaType = type;
                } else {
                const ctx = msg?.message?.extendedTextMessage?.contextInfo;
                const quoted = ctx?.quotedMessage;

                if (quoted?.audioMessage) {
                    mediaMsg = { message: quoted };
                    mediaType = "audioMessage";
                } else if (quoted?.videoMessage) {
                    mediaMsg = { message: quoted };
                    mediaType = "videoMessage";
                }
                }

                if (!mediaMsg) {
                await sock.sendMessage(from, {
                    text: "Reply audio/video dulu, Bang.\nContoh: reply lagu lalu ketik *!vocalremove*."
                }, { quoted: msg });
                return;
                }

                // Download ke buffer
                const buf = await downloadMediaMessage(mediaMsg, "buffer");
                if (!buf || !buf.length) throw new Error("Gagal download media.");

                // Siapkan folder kerja
                const workDir = path.join(__dirname, "downloads", "vocalremove");
                ensureDir(workDir);

                const stamp = Date.now();
                const inPath = path.join(workDir, `in_${stamp}.${mediaType === "videoMessage" ? "mp4" : "m4a"}`);
                const outPath = path.join(workDir, `karaoke_${stamp}.mp3`);

                fs.writeFileSync(inPath, buf);

                // Filter karaoke: center channel removal (simple & fast)
                // Catatan: ini metode "classic karaoke", hasil tergantung mixing lagu.
                const ffCmd =
                `ffmpeg -y -i "${inPath}" ` +
                `-af "pan=stereo|c0=c0-c1|c1=c1-c0,highpass=f=120,lowpass=f=15000" ` +
                `-q:a 3 "${outPath}"`;

                await execPromise(ffCmd);

                if (!fs.existsSync(outPath)) throw new Error("Output karaoke tidak ditemukan.");

                const outBuf = fs.readFileSync(outPath);

                await sock.sendMessage(from, {
                audio: outBuf,
                mimetype: "audio/mpeg",
                fileName: `BangBot_Karaoke_${stamp}.mp3`
                }, { quoted: msg });

                // cleanup
                try { fs.unlinkSync(inPath); } catch {}
                try { fs.unlinkSync(outPath); } catch {}

            } catch (err) {
                const msgErr = String(err?.message || err || "");
                console.error("[VOCALREMOVE ERROR]", err);

                // FFmpeg tidak ditemukan
                if (/ffmpeg/i.test(msgErr) || /not recognized|ENOENT/i.test(msgErr)) {
                await sock.sendMessage(from, {
                    text:
            "❌ FFmpeg tidak ditemukan.\n" +
            "Solusi:\n" +
            "1) Install FFmpeg\n" +
            "2) Pastikan `ffmpeg -version` jalan di CMD / PATH"
                }, { quoted: msg });
                return;
                }

                await sock.sendMessage(from, {
                text: `❌ Gagal vocal remove.\nError: ${msgErr}`
                }, { quoted: msg });
            }

            return;
            }

            // =================================================
            // OFFICE -> PDF (LibreOffice)
            // Commands: !office2pdf, !doc2pdf, !xls2pdf, !ppt2pdf
            // Cara: reply file Office lalu ketik command
            // =================================================
            if (["!office2pdf", "!doc2pdf", "!xls2pdf", "!ppt2pdf"].includes(cmd)) {
                try {
                    let docMsg = null;
                    let mediaMsg = null;

                    // Mendeteksi apakah pesan langsung atau reply
                    if (msg.message?.documentMessage) {
                        docMsg = msg.message.documentMessage;
                        mediaMsg = msg;
                    } else {
                        const ctx = msg?.message?.extendedTextMessage?.contextInfo;
                        if (ctx?.quotedMessage?.documentMessage) {
                            docMsg = ctx.quotedMessage.documentMessage;
                            mediaMsg = { message: ctx.quotedMessage };
                        }
                    }

                    if (!docMsg) {
                        return sock.sendMessage(from, { text: "Reply dokumennya dulu, Bang!" }, { quoted: msg });
                    }

                    // --- PENGAMBILAN NAMA FILE SECARA PAKSA ---
                    // Mencari nama di berbagai properti metadata WhatsApp
                    const fileName = docMsg.fileName || 
                                    docMsg.title || 
                                    docMsg.caption || 
                                    teks.split("\n")[0].replace(cmd, "").trim() || 
                                    `Dokumen_${Date.now()}.docx`;

                    console.log(`[DEBUG] Nama file terdeteksi: ${fileName}`);

                    await handleOfficeToPdf(sock, from, msg, mediaMsg, fileName);

                } catch (err) {
                    console.error("ERROR OFFICE2PDF:", err);
                    await sock.sendMessage(from, { text: `Gagal: ${err.message}` }, { quoted: msg });
                }
                return;
            }

            // =================================================
            // PDF MERGE: !pdfmerge
            // - Reply PDF + !pdfmerge => add to queue
            // - !pdfmerge (no reply) => merge queued PDFs
            // - !pdfmerge clear => clear queue
            // =================================================
            if (cmd === "!pdfmerge") {
            const arg = (teks || "").replace(new RegExp(cmd, "i"), "").trim().toLowerCase();
            const chatId = from;
            const q = getPdfQueue(chatId);

            if (arg === "clear" || arg === "reset") {
                // cleanup files
                for (const it of q) { try { fs.unlinkSync(it.path); } catch {} }
                pdfMergeQueue.set(chatId, []);
                await sock.sendMessage(from, { text: "✅ Antrian PDF merge sudah dikosongkan." }, { quoted: msg });
                return;
            }

            // ambil quoted message (kalau user reply file)
            const ctx = msg?.message?.extendedTextMessage?.contextInfo;
            const quoted = ctx?.quotedMessage;

            const quotedDoc =
                quoted?.documentMessage ||
                quoted?.documentWithCaptionMessage?.message?.documentMessage;

            // Jika user reply PDF => tambah ke queue
            if (quotedDoc) {
                const mimetype = quotedDoc.mimetype || "";
                const fileName = quotedDoc.fileName || `file_${Date.now()}.pdf`;

                if (!/pdf/i.test(mimetype) && !/\.pdf$/i.test(fileName)) {
                await sock.sendMessage(from, { text: "Reply harus file PDF." }, { quoted: msg });
                return;
                }

                // download quoted pdf
                const dlDir = require("path").join(__dirname, "downloads", "pdfmerge");
                ensureDir(dlDir);

                const tmpPath = require("path").join(dlDir, `pdf_${Date.now()}_${Math.random().toString(16).slice(2)}.pdf`);

                // downloadMediaMessage butuh objek pesan full; kita “rekonstruksi” minimal dengan quoted
                const quotedMsgObj = { message: quoted };
                const buffer = await downloadMediaMessage(quotedMsgObj, "buffer", {}, { logger: P({ level: "silent" }) });

                fs.writeFileSync(tmpPath, buffer);

                q.push({ path: tmpPath, name: fileName, by: sender, ts: Date.now() });

                await sock.sendMessage(from, {
                text: `✅ Ditambahkan ke antrian.\nTotal: ${q.length} PDF.\n\nReply PDF lain dengan *!pdfmerge* untuk tambah.\nKetik *!pdfmerge* tanpa reply untuk gabung.`
                }, { quoted: msg });

                return;
            }

            // Jika tidak reply: lakukan merge jika >= 2
            if (q.length < 2) {
                await sock.sendMessage(from, {
                text: `⚠️ Antrian kurang dari 2 PDF.\n\nCara pakai:\n1) Reply PDF → *!pdfmerge* (tambah)\n2) Reply PDF lain → *!pdfmerge*\n3) Ketik *!pdfmerge* (tanpa reply) untuk gabung\n\nReset: *!pdfmerge clear*`
                }, { quoted: msg });
                return;
            }

            try {
                const outBuf = await mergePdfsToBuffer(q.map(x => x.path));
                const outName = `BangBot_Merged_${Date.now()}.pdf`;

                await sock.sendMessage(from, {
                document: outBuf,
                mimetype: "application/pdf",
                fileName: outName
                }, { quoted: msg });

            } catch (e) {
                console.error("[PDFMERGE ERROR]", e);
                await sock.sendMessage(from, { text: "❌ Gagal menggabungkan PDF." }, { quoted: msg });
            } finally {
                // cleanup & clear queue
                for (const it of q) { try { fs.unlinkSync(it.path); } catch {} }
                pdfMergeQueue.set(chatId, []);
            }

            return;
            }

            // =================================================
            // AUDIO MIX: !audiomix
            // Reply audio 2x (atau voice note) untuk digabung overlay
            // =================================================
            if (cmd === "!audiomix") {
            const arg = teks.replace(new RegExp(cmd, "i"), "").trim().toLowerCase();
            const chatId = from;

            const q = getAudioMixQueue(chatId);

            if (arg === "clear" || arg === "reset") {
                for (const it of q) { try { fs.unlinkSync(it.path); } catch {} }
                audioMixQueue.set(chatId, []);
                await sock.sendMessage(from, { text: "Antrian audiomix dikosongkan." }, { quoted: msg });
                return;
            }

            if (arg === "list") {
                if (!q.length) {
                await sock.sendMessage(from, { text: "Antrian audiomix kosong. Reply audio lalu ketik *!audiomix*." }, { quoted: msg });
                return;
                }
                const lines = q.map((it, i) => `${i + 1}) ${it.name || path.basename(it.path)}`).join("\n");
                await sock.sendMessage(from, { text: `Antrian audiomix:\n${lines}` }, { quoted: msg });
                return;
            }

            // Ambil audio dari message langsung atau quoted
            let mediaMsg = null;
            let fileName = null;

            if (type === "audioMessage" && msg.message?.audioMessage) {
                mediaMsg = msg;
                fileName = "audio_1.m4a";
            } else {
                const ctx = msg?.message?.extendedTextMessage?.contextInfo;
                const quoted = ctx?.quotedMessage;

                if (quoted?.audioMessage) {
                mediaMsg = { message: quoted };
                fileName = quoted.audioMessage?.fileName || "audio_q.m4a";
                }
            }

            if (!mediaMsg) {
                await sock.sendMessage(from, {
                text:
            `Reply 2 audio untuk digabung.
            Langkah:
            1) Reply audio #1 → *!audiomix*
            2) Reply audio #2 → *!audiomix*
            Reset: *!audiomix clear*`
                }, { quoted: msg });
                return;
            }

            try {
                const workDir = path.join(__dirname, "downloads", "audiomix");
                ensureDir(workDir);

                const stamp = Date.now();
                const inPath = path.join(workDir, `mix_${stamp}_${Math.random().toString(16).slice(2)}.m4a`);
                const buf = await downloadMediaMessage(mediaMsg, "buffer");
                fs.writeFileSync(inPath, buf);

                q.push({ path: inPath, name: fileName, by: sender, ts: Date.now() });

                // kalau belum 2 file, tunggu
                if (q.length < 2) {
                await sock.sendMessage(from, {
                    text: `Audio ditambahkan (${q.length}/2).\nReply audio kedua lalu ketik *!audiomix* lagi.`
                }, { quoted: msg });
                return;
                }

                // sudah 2 file: proses overlay mix

                const a = q[0].path;
                const b = q[1].path;

                const outPath = path.join(workDir, `audiomix_${Date.now()}.mp3`);

                // Overlay mix (amix). duration=longest biar yang lebih panjang tetap utuh.
                // dropout_transition untuk transisi jika salah satu habis.
                const ffCmd =
                `ffmpeg -y -i "${a}" -i "${b}" ` +
                `-filter_complex "amix=inputs=2:duration=longest:dropout_transition=2,volume=1.0" ` +
                `-q:a 3 "${outPath}"`;

                await execPromise(ffCmd);

                if (!fs.existsSync(outPath)) throw new Error("Output audiomix tidak ditemukan.");

                await sock.sendMessage(from, {
                audio: fs.readFileSync(outPath),
                mimetype: "audio/mpeg",
                fileName: `BangBot_AudioMix_${Date.now()}.mp3`
                }, { quoted: msg });

                // cleanup
                for (const it of q) { try { fs.unlinkSync(it.path); } catch {} }
                audioMixQueue.set(chatId, []);
                try { fs.unlinkSync(outPath); } catch {}

            } catch (err) {
                console.error("[AUDIOMIX ERROR]", err);
                await sock.sendMessage(from, { text: `❌ Gagal audiomix.\nError: ${err.message || err}` }, { quoted: msg });

                // jangan lupa: kalau error, bersihkan queue supaya tidak nyangkut
                for (const it of q) { try { fs.unlinkSync(it.path); } catch {} }
                audioMixQueue.set(chatId, []);
            }

            return;
            }

            // =================================================
            // PING — cek delay dari server bot (Windows)
            // =================================================
            if (cmd === "!ping") {
                const host = teks.replace(/!ping/i, "").trim();

                if (!host) {
                    await sock.sendMessage(from, { 
                        text: "Format: *!ping google.com*" 
                    });
                    return;
                }

                try {
                    const output = await execAsync(`ping -n 1 ${host}`);

                    // Ambil waktu ping (ms)
                    const match = output.match(/Average = (\d+ms)/i)
                        || output.match(/Average = (\d+ ms)/i)
                        || output.match(/time[=<]\s?(\d+ms)/i);

                    const pingText = match ? match[1] : "Tidak diketahui";

                    await sock.sendMessage(from, {
                        text: `🏓 *Ping Result*\nHost: ${host}\nDelay: *${pingText}*`
                    });
                } catch (err) {
                    await sock.sendMessage(from, {
                        text: `Gagal ping host: ${host}`
                    });
                }

                return;
            }

            // =================================================
            // IPINFO — Info domain / IP tanpa API key
            // =================================================
            if (cmd === "!ipinfo") {
                const host = teks.replace(/!ipinfo/i, "").trim();

                if (!host) {
                    await sock.sendMessage(from, {
                        text: "Format: *!ipinfo <domain / IP>*\nContoh: !ipinfo google.com"
                    });
                    return;
                }

                try {
                    const url = `http://ip-api.com/json/${host}?fields=status,message,query,country,city,timezone,isp,org,as,lat,lon`;
                    const res = await axios.get(url);
                    const data = res.data;

                    if (data.status !== "success") {
                        await sock.sendMessage(from, {
                            text: `❌ Tidak dapat mengambil data untuk: *${host}*\nAlasan: ${data.message}`
                        });
                        return;
                    }

                    await sock.sendMessage(from, {
                        text:
            `🌐 *IP / Domain Info*

            • *Query* : ${data.query}
            • *Country* : ${data.country}
            • *City* : ${data.city}
            • *Timezone* : ${data.timezone}

            • *ISP* : ${data.isp}
            • *Organization* : ${data.org}
            • *ASN* : ${data.as}

            • *Latitude* : ${data.lat}
            • *Longitude* : ${data.lon}

            Data dari: ip-api.com`
                    });

                } catch (err) {
                    console.error("ipinfo error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal mengambil informasi IP/Domain."
                    });
                }

                return;
            }

            // =================================================
            // CUACA — Info cuaca tanpa API key
            // =================================================
            if (cmd === "!cuaca") {
                const lokasi = teks.replace(/!cuaca/i, "").trim();

                if (!lokasi) {
                    await sock.sendMessage(from, {
                        text: "Format: *!cuaca <nama kota>*\nContoh: !cuaca Yogyakarta"
                    });
                    return;
                }

                try {
                    // API gratis dari wttr.in
                    const url = `https://wttr.in/${encodeURIComponent(lokasi)}?format=j1`;
                    const res = await axios.get(url);
                    const data = res.data;

                    // Ambil data utama
                    const current = data.current_condition[0];
                    const weatherDesc = current.weatherDesc[0].value;

                    const suhu = current.temp_C;
                    const humidity = current.humidity;
                    const wind = current.windspeedKmph;

                    await sock.sendMessage(from, {
                        text:
            `*Cuaca ${lokasi}*

Suhu: *${suhu}°C*
Kondisi: *${weatherDesc}*
Kelembapan: *${humidity}%*
Angin: *${wind} km/h*

Sumber: wttr.in`
                    });

                } catch (err) {
                    console.error("Cuaca error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal mengambil data cuaca. Pastikan nama kota benar."
                    });
                }

                return;
            }

            // =================================================
            // vn2teks
            // =================================================
            if (cmd === "!voice2text" || cmd === "!transcribe") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quotedAud = ctx?.quotedMessage?.audioMessage;

                if (!quotedAud) return sock.sendMessage(from, { text: "Reply VN-nya dulu, Bang!" }, { quoted: msg });

                try {
                    const buf = await downloadMediaMessage({ message: ctx.quotedMessage }, "buffer");

                    const stamp = Date.now();
                    const inPath = `./vn_in_${stamp}.ogg`;
                    const outPath = `./vn_out_${stamp}.mp3`;
                    fs.writeFileSync(inPath, buf);

                    // WAJIB: Gunakan '-ac 1' (mono) agar AI Wit.ai bisa mendeteksi suara dengan jelas
                    await execPromise(`ffmpeg -y -i "${inPath}" -ar 16000 -ac 1 -f mp3 "${outPath}"`);
                    
                    const audioData = fs.readFileSync(outPath);
                    const hasilTeks = await transcribeAudio(audioData);

                    if (!hasilTeks) {
                        await sock.sendMessage(from, { text: "Gagal mendeteksi suara. Pastikan VN jelas dan gunakan Bahasa Indonesia." }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: `"${hasilTeks}"` }, { quoted: msg });
                    }

                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                } catch (err) {
                    console.error(err);
                    await sock.sendMessage(from, { text: "Error saat memproses audio." }, { quoted: msg });
                }
                return;
            }

            // =================================================
            // gempa
            // =================================================
            if (cmd === "!gempa") {
                try {                    
                    const g = await fetchGempaTerkini();
                    
                    const teksGempa = `⚠️ *INFO GEMPA TERKINI* ⚠️

*Waktu:* ${g.Tanggal} | ${g.Jam}
*Magnitudo:* ${g.Magnitude}
*Kedalaman:* ${g.Kedalaman}
*Koordinat:* ${g.Coordinates}
*Lokasi:* ${g.Wilayah}
*Potensi:* ${g.Potensi}

*Peta Lokasi:*
https://data.bmkg.go.id/DataMKG/TEWS/${g.Shakemap}`;

                    await sock.sendMessage(from, { 
                        image: { url: `https://data.bmkg.go.id/DataMKG/TEWS/${g.Shakemap}` },
                        caption: teksGempa 
                    }, { quoted: msg });

                } catch (err) {
                    console.error("Gempa Error:", err);
                    await sock.sendMessage(from, { text: "❌ Gagal mengambil data gempa. Server BMKG mungkin sedang sibuk." }, { quoted: msg });
                }
                return;
            }

// =================================================
// KURS BI — API Resmi Bank Indonesia (XML) + retry + cache
// =================================================
if (cmd === "!kurs") {
    await handleKursBI(sock, from, msg, axios);
    return;
}


// =================================================
// CRYPTO — harga crypto realtime (CoinGecko)
// Format: !crypto btc | !crypto eth | !crypto sol
// =================================================
if (cmd === "!crypto") {
    const sym = (args[1] || "").toLowerCase().trim();
    if (!sym) {
        await sock.sendMessage(from, { text: "Format: *!crypto btc*\nContoh: !crypto eth" }, { quoted: msg });
        return;
    }

    const coinId = CRYPTO_MAP[sym];
    if (!coinId) {
        await sock.sendMessage(from, {
            text: `Coin tidak dikenal: *${sym}*\nContoh: btc, eth, sol, bnb, ada, doge, xrp`
        }, { quoted: msg });
        return;
    }

    try {
        const data = await getCryptoPrice(coinId);

        const usd = data.usd;
        const idr = data.idr;
        const chUsd = data.usd_24h_change;
        const chIdr = data.idr_24h_change;

        const sign = (v) => (typeof v === "number" && v >= 0 ? "+" : "");
        const text =
`*CRYPTO PRICE* (${sym.toUpperCase()})
• USD: $${fmtNumber(usd, "en-US", 2)}
• IDR: Rp ${fmtNumber(idr, "id-ID", 0)}
• 24h: USD ${sign(chUsd)}${(chUsd ?? 0).toFixed(2)}% | IDR ${sign(chIdr)}${(chIdr ?? 0).toFixed(2)}%

Sumber: CoinGecko`;

        await sock.sendMessage(from, { text }, { quoted: msg });
    } catch (e) {
        console.error("[CRYPTO ERROR]", safeErr(e));
        await sock.sendMessage(from, { text: "❌ Gagal mengambil harga crypto. Coba lagi nanti." }, { quoted: msg });
    }

    return;
}

            // =================================================
            // NEWS — BERITA TERBARU CNN INDONESIA
            // =================================================
            if (cmd === "!news") {
                await sock.sendMessage(from, {
                    text: "Proses Bang!"
                });

                const newsList = await getLatestNews(5);

                if (!newsList.length) {
                    await sock.sendMessage(from, {
                        text: "Gagal mengambil berita saat ini, Bang. Coba lagi nanti."
                    });
                    return;
                }

                let text = "*Berita Terbaru (CNN Indonesia)*\n\n";
                newsList.forEach((n, i) => {
                    text += `${i + 1}. ${n.title}\n${n.link}\n\n`;
                });

                await sock.sendMessage(from, { text });
                return;
            }

            // =================================================
            // ANIME INFO (Jikan / MyAnimeList)
            // =================================================
            if (cmd === "!anime") {
                const query = teks.replace(/!anime/i, "").trim();

                if (!query) {
                    await sock.sendMessage(from, {
                        text: "Format: *!anime judul_anime*\nContoh: !anime one piece"
                    });
                    return;
                }

                try {
                    const res = await axios.get(`${JIKAN_BASE}/anime`, {
                        params: {
                            q: query,
                            limit: 1,
                            sfw: true
                        },
                        timeout: 15000
                    });

                    const list = res.data?.data || [];
                    if (!list.length) {
                        await sock.sendMessage(from, {
                            text: `Anime dengan kata kunci *${query}* tidak ditemukan, Bang.`
                        });
                        return;
                    }

                    const a = list[0];

                    const title = a.title || "-";
                    const titleJp = a.title_japanese || "-";
                    const type = a.type || "-";
                    const status = a.status || "-";
                    const episodes = a.episodes || "-";
                    const duration = a.duration || "-";
                    const score = a.score || "-";
                    const year = a.year || (a.aired?.prop?.from?.year || "-");
                    const url = a.url || "-";
                    const genres = (a.genres || []).map(g => g.name).join(", ") || "-";
                    const synopsisFull = a.synopsis || "-";
                    const synopsis = synopsisFull.length > 600
                        ? synopsisFull.slice(0, 600) + "..."
                        : synopsisFull;

                    await sock.sendMessage(from, {
                        text:
`*Info Anime*

Judul      : *${title}*
Judul JP   : ${titleJp}
Tipe       : ${type}
Status     : ${status}
Tahun      : ${year}
Episode    : ${episodes}
Durasi     : ${duration}
Skor MAL   : ${score}
Genre      : ${genres}

Sinopsis:
${synopsis}

Link:
${url}`
                    });

                } catch (err) {
                    console.error("!anime error:", err?.message || err);
                    await sock.sendMessage(from, {
                        text: "Gagal ambil data anime dari server, coba lagi sebentar lagi ya Bang."
                    });
                }

                return;
            }

            // =================================================
            // MOVIE INFO (OMDb API) — butuh OMDB_API_KEY
            // =================================================
            if (cmd === "!movie") {
                const query = teks.replace(/!movie/i, "").trim();

                if (!query) {
                    await sock.sendMessage(from, {
                        text: "Format: *!movie judul_film*\nContoh: !movie interstellar"
                    });
                    return;
                }

                if (!OMDB_API_KEY || OMDB_API_KEY === "ISI_API_KEY_OMDB_KAMU_DI_SINI") {
                    await sock.sendMessage(from, {
                        text:
`Fitur *!movie* butuh OMDb API key.

Silakan:
1) Daftar gratis di https://www.omdbapi.com/apikey.aspx
2) Masukkan API key ke variabel *OMDB_API_KEY* di kode atau environment.

Setelah itu restart bot.`
                    });
                    return;
                }

                try {
                    const url = `https://www.omdbapi.com/`;
                    const res = await axios.get(url, {
                        params: {
                            apikey: OMDB_API_KEY,
                            t: query,
                            plot: "short"
                        },
                        timeout: 15000
                    });

                    const data = res.data;

                    if (!data || data.Response === "False") {
                        await sock.sendMessage(from, {
                            text: `Film dengan judul *${query}* tidak ditemukan, Bang.`
                        });
                        return;
                    }

                    const title = data.Title || "-";
                    const year = data.Year || "-";
                    const rated = data.Rated || "-";
                    const released = data.Released || "-";
                    const runtime = data.Runtime || "-";
                    const genre = data.Genre || "-";
                    const director = data.Director || "-";
                    const actors = data.Actors || "-";
                    const plotFull = data.Plot || "-";
                    const plot = plotFull.length > 600 ? plotFull.slice(0, 600) + "..." : plotFull;
                    const rating = data.imdbRating || "-";
                    const votes = data.imdbVotes || "-";
                    const imdbId = data.imdbID || "";
                    const imdbLink = imdbId ? `https://www.imdb.com/title/${imdbId}/` : "-";

                    await sock.sendMessage(from, {
                        text:
`*Info Film*

Judul      : *${title}*
Tahun      : ${year}
Rating     : ${rated}
Rilis      : ${released}
Durasi     : ${runtime}
Genre      : ${genre}

Sutradara  : ${director}
Pemain     : ${actors}

IMDB       : ${rating} / 10 (${votes} votes)

Sinopsis:
${plot}

Link IMDB:
${imdbLink}`
                    });

                } catch (err) {
                    console.error("!movie error:", err?.message || err);
                    await sock.sendMessage(from, {
                        text: "Gagal ambil data film dari OMDb, Bang. Coba lagi nanti."
                    });
                }

                return;
            }

            // =================================================
            // CEK RESI (BinderByte / No API key needed)
            // =================================================
            if (cmd === "!cekresi") {
                const raw = teks.replace(/!cekresi/i, "").trim();

                if (!raw) {
                    await sock.sendMessage(from, {
                        text: "Format:\n• !cekresi <nomor resi>\n• !cekresi <kurir> <resi>\n\nContoh:\n!cekresi JT1234567890\n!cekresi jne 1234567890"
                    });
                    return;
                }

                let parts = raw.split(/\s+/);
                let courier = null;
                let resi = null;

                // Kasus: !cekresi jne 123456
                if (parts.length >= 2) {
                    if (COURIERS[parts[0].toLowerCase()]) {
                        courier = COURIERS[parts[0].toLowerCase()];
                        resi = parts.slice(1).join("");
                    }
                }

                // Auto detect jika user hanya input nomor
                if (!courier) courier = detectCourier(raw);
                if (!resi) resi = raw.replace(/\D/g, "");

                if (!resi) {
                    await sock.sendMessage(from, { text: "Nomor resi tidak valid." });
                    return;
                }

                if (!courier) {
                    await sock.sendMessage(from, {
                        text: "Tidak dapat mendeteksi kurir.\nGunakan format:\n!cekresi jne 1234567890"
                    });
                    return;
                }

                // === SPX Shopee Express (scraping API internal SPX) ===
                if (courier === "spx") {
                    try {
                        const url = `https://spx.co.id/api/v2/track?tracking_number=${resi}`;
                        const res = await axios.get(url, {
                            headers: {
                                "User-Agent": "Mozilla/5.0"
                            }
                        });

                        const data = res.data;

                        if (!data?.data) {
                            await sock.sendMessage(from, {
                                text: `Resi SPX tidak ditemukan: *${resi}*`
                            });
                            return;
                        }

                        const info = data.data;
                        const history = info.details
                            .map(h => `• ${h.status}\n  ${h.time}`)
                            .join("\n\n");

                        await sock.sendMessage(from, {
                            text:
                `*CEK RESI SPX (Shopee Express)*
                Nomor : *${resi}*
                Status: *${info.status || "-"}*
                Dari  : ${info.origin || "-"}
                Ke    : ${info.destination || "-"}

                Riwayat:
                ${history}`
                        });

                        return;

                    } catch (err) {
                        console.error("SPX error:", err);
                        await sock.sendMessage(from, { text: "Gagal mengambil data SPX." });
                        return;
                    }
                }

                try {
                    const url = `https://api.binderbyte.com/v1/track?api_key=demo&courier=${courier}&awb=${resi}`;
                    const res = await axios.get(url);
                    const data = res.data;

                    if (data.status !== 200) {
                        await sock.sendMessage(from, {
                            text: `Resi tidak ditemukan / salah.\nKurir: ${courier}\nResi: ${resi}`
                        });
                        return;
                    }

                    const info = data.data;

                    let history = info.history
                        .map(h => `• ${h.desc}\n  ${h.date}`)
                        .join("\n\n");

                    await sock.sendMessage(from, {
                        text:
            `*CEK RESI (${courier.toUpperCase()})*
            Nomor : *${resi}*
            Status: *${info.status}*
            Dari  : ${info.origin}
            Ke    : ${info.destination}

            Riwayat:
            ${history}`
                    });

                } catch (err) {
                    console.error("cekresi error", err);
                    await sock.sendMessage(from, { text: "Gagal mengambil data resi." });
                }

                return;
            }

            // =================================================
            // SSWEB — Screenshot Website (tanpa API key)
            // =================================================
            if (cmd === "!ssweb") {
            const raw = teks.replace(/!ssweb/i, "").trim();
            if (!raw) {
                await sock.sendMessage(from, { text: "Format: *!ssweb <url>*\nContoh: !ssweb https://wikipedia.org" });
                return;
            }

            let url = raw;
            if (!/^https?:\/\//i.test(url)) url = "https://" + url;

            try { new URL(url); } catch {
                await sock.sendMessage(from, { text: "URL tidak valid, Bang." });
                return;
            }
            try {
                const img = await fetchWebsiteScreenshot(axios, url);
                await sock.sendMessage(from, {
                image: img,
                caption: `Screenshot:\n${url}`,
                });
            } catch (err) {
                console.error("ssweb error:", err?.response?.status || err?.message || err);
                await sock.sendMessage(from, { text: "Gagal mengambil screenshot website. Coba URL lain / ulangi beberapa saat." });
            }

            return;
            }

            // =================================================
            // SHORTENER — Pendekin URL (tanpa API key)
            // Provider: bitly (simple text response)
            // =================================================
            if (cmd === "!shortlink") {
            const raw = teks.replace(/!shortlink/i, "").trim();
            if (!raw) {
                await sock.sendMessage(from, {
                text: "Format: *!shortlink <url>*\nContoh: !shortlink https://google.com"
                });
                return;
            }

            let url = raw;
            if (!/^https?:\/\//i.test(url)) url = "https://" + url;

            try { new URL(url); } catch {
                await sock.sendMessage(from, { text: "URL tidak valid." });
                return;
            }
            try {
                const shortUrl = await shortenWithBitly(axios, url);
                await sock.sendMessage(from, {
                text: `Asli  : ${url}\nShort : ${shortUrl}`
                });
            } catch (err) {
                console.error("bitly error:", err?.response?.data || err.message);
                await sock.sendMessage(from, {
                text: "Gagal memendekkan URL via Bitly. Pastikan token valid."
                });
            }

            return;
            }

            // =================================================
            // UNSHORT — Kembalikan URL pendek ke URL asli
            // =================================================
            if (cmd === "!unshortlink") {
                const raw = teks.replace(/!unshortlink/i, "").trim();

                if (!raw) {
                    await sock.sendMessage(from, {
                        text: "Format: *!unshortlink <url>*\nContoh: !unshortlink https://is.gd/abc123"
                    });
                    return;
                }

                // Normalisasi URL
                let url = raw;
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    url = "https://" + url;
                }

                await sock.sendMessage(from, {
                    text: `Mengecek URL asli...\n${url}`
                });

                try {
                    const response = await axios.head(url, {
                        maxRedirects: 5,
                        validateStatus: () => true
                    });

                    const finalUrl = response.request.res.responseUrl || url;

                    await sock.sendMessage(from, {
                        text:
            `Short : ${url}
Asli  : ${finalUrl}`
                    });

                } catch (err) {
                    console.error("unshort error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal unshort URL. Pastikan URL valid & bisa diakses, Bang."
                    });
                }

                return;
            }

            // =================================================
            // STALKIG — Cek info akun Instagram (publik)
            // =================================================
            if (cmd === "!stalkig") {
                const raw = teks.replace(/!stalkig/i, "").trim();

                if (!raw) {
                    await sock.sendMessage(from, {
                        text:
            `Format: *!stalkig username*

            Contoh:
            !stalkig instagram
            !stalkig bangbot_official`
                    });
                    return;
                }

                // Bersihkan username: hilangkan @ kalau ada
                const username = raw.replace(/^@/, "").split(" ")[0];

                await sock.sendMessage(from, {
                    text: `Cek info Instagram *@${username}* dulu ya Bang!`
                });

                try {
                    // Endpoint publik (kadang berubah, jadi memang tidak 100% pasti)
                    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

                    const res = await axios.get(url, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                            "Accept": "application/json",
                            "X-IG-App-ID": "936619743392459"
                        },
                        // Biar kalau status bukan 200 tetap masuk ke catch manual kita
                        validateStatus: () => true
                    });

                    if (!res.data || !res.data.data || !res.data.data.user) {
                        await sock.sendMessage(from, {
                            text:
            `Gagal ambil data Instagram *@${username}*.

            Kemungkinan:
            - Usernamenya salah / tidak ada
            - Akunnya private / dibatasi
            - Instagram lagi ngerestriksi akses publik`
                        });
                        return;
                    }

                    const u = res.data.data.user;

                    const fullName   = u.full_name || "-";
                    const bio        = (u.biography || "").trim() || "(bio kosong)";
                    const followers  = u.edge_followed_by?.count ?? 0;
                    const following  = u.edge_follow?.count ?? 0;
                    const posts      = u.edge_owner_to_timeline_media?.count ?? 0;
                    const isPrivate  = u.is_private ? "Ya (Private)"   : "Tidak (Public)";
                    const isVerified = u.is_verified ? "Ya (Verified)" : "Tidak";

                    const link = `https://www.instagram.com/${username}`;

                    await sock.sendMessage(from, {
                        text:
            `*Instagram Stalker*

            Username : @${username}
            Nama     : ${fullName}
            Verified : ${isVerified}
            Private  : ${isPrivate}

            Followers: ${followers}
            Following: ${following}
            Posting  : ${posts}

            Bio:
            ${bio}

            Link profil:
            ${link}`
                    });

                } catch (err) {
                    console.error("stalkig error:", err);
                    await sock.sendMessage(from, {
                        text:
            `Gagal mengambil data Instagram *@${username}*.

            Kemungkinan:
            - Koneksi server ke Instagram bermasalah
            - Instagram mengubah sistem / memblok request

            Coba lagi nanti ya Bang.`
                    });
                }

                return;
            }

            // =================================================
            // SSCHAT — Ubah teks / reply jadi gambar chat
            // =================================================
            if (cmd === "!sschat") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;

                // 1) Ambil teks setelah !sschat
                let content = teks.replace(/!sschat/i, "").trim();

                // 2) Kalau kosong, tapi ada reply → pakai teks dari pesan yang di-reply
                if (!content && ctx?.quotedMessage) {
                    content =
                        ctx.quotedMessage.conversation ||
                        ctx.quotedMessage?.extendedTextMessage?.text ||
                        ctx.quotedMessage?.imageMessage?.caption ||
                        ctx.quotedMessage?.videoMessage?.caption ||
                        "";
                }

                if (!content) {
                    await sock.sendMessage(from, {
                        text:
            `Format:
            • *!sschat teks*  → buat screenshot chat dari teks
            • Reply pesan lalu ketik *!sschat* → jadikan pesan itu screenshot chat`
                    });
                    return;
                }

                // Nama/nomor "pengirim" yang mau ditampilkan di header
                const displayName = (sender || "").split("@")[0] || "User";

                const ts = Date.now();
                const outPath = `./sschat_${ts}.png`;

                try {
                    const width  = 1080;
                    const height = 1920;

                    // Background gelap
                    const img = new Jimp(width, height, 0xff101820);

                    const fontHeader = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
                    const fontName   = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
                    const fontText   = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

                    // Bar atas "WhatsApp"
                    img.print(fontHeader, 40, 40, "WhatsApp Chat");

                    // Nama kontak
                    img.print(fontName, 40, 100, displayName);

                    // Bubble dasar (putih), kita pakai print dengan area wrap
                    const bubbleX = 60;
                    const bubbleY = 220;
                    const bubbleW = width - 120;
                    const bubbleH = height - 320;

                    // Bubble warna hijau muda ala chat (pakai rectangle kasar)
                    const bubble = new Jimp(bubbleW, bubbleH, 0xffDCF8C6);
                    img.composite(bubble, bubbleX, bubbleY);

                    img.print(
                        fontText,
                        bubbleX + 30,
                        bubbleY + 30,
                        {
                            text: content,
                            alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
                            alignmentY: Jimp.VERTICAL_ALIGN_TOP
                        },
                        bubbleW - 60,
                        bubbleH - 60
                    );

                    await img.writeAsync(outPath);
                    const buf = fs.readFileSync(outPath);

                    await sock.sendMessage(from, {
                        image: buf,
                        caption: "Selesai Bang, ini screenshot chat-nya."
                    });

                } catch (err) {
                    console.error("sschat error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal membuat screenshot chat, Bang."
                    });
                } finally {
                    if (fs.existsSync(outPath)) {
                        fs.unlinkSync(outPath);
                    }
                }

                return;
            }

            // =================================================
            // SUMMARIZE TEKS (reply atau teks setelah command)
            // =================================================
            if (cmd === "!summarize") {
            const input = teks.replace(/!summarize/i, "").trim();

            if (!input) {
                await sock.sendMessage(from, {
                text: "Format: *!summarize <teks>*"
                });
                return;
            }

            const summary = summarizeTextStrict(input);

            await sock.sendMessage(from, {
                text: "📝 *Ringkasan:*\n\n" + summary
            });

            return;
            }

            // =================================================
            // PARAFRASE TEKS (reply atau teks setelah command)
            // =================================================
            if (cmd === "!parafrase") {
                let sourceText = "";

                // 1) Coba ambil dari reply
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quoted = ctx?.quotedMessage;

                if (quoted) {
                    const qConv  = quoted.conversation;
                    const qExt   = quoted.extendedTextMessage?.text;
                    const qImage = quoted.imageMessage?.caption;
                    const qVideo = quoted.videoMessage?.caption;
                    const qDoc   = quoted.documentMessage?.caption;

                    sourceText =
                        qConv ||
                        qExt ||
                        qImage ||
                        qVideo ||
                        qDoc ||
                        "";
                }

                // 2) Kalau tidak ada reply, ambil teks setelah !parafrase
                if (!sourceText) {
                    sourceText = teks.replace(/!parafrase/i, "").trim();
                }

                // 3) Kalau tetap kosong → kirim cara pakai
                if (!sourceText) {
                    await sock.sendMessage(from, {
                        text:
`Format pemakaian *!parafrase*:

1) Reply ke teks yang mau diubah lalu ketik:
   *!parafrase*

2) Atau:
   *!parafrase* teks yang mau diubah`
                    });
                    return;
                }

                const para = paraphraseText(sourceText);

                await sock.sendMessage(from, {
                    text:
`📝 *Parafrase Teks*:

${para}`
                });

                return;
            }

                        // =================================================
            // MEME GENERATOR — !meme atas|bawah (reply foto atau caption di foto)
            // =================================================
            if (cmd === "!meme") {
                // Ambil teks setelah !meme
                const raw = teks.replace(/!meme/i, "").trim();

                if (!raw || !raw.includes("|")) {
                    await sock.sendMessage(from, {
                        text:
`Format: *!meme teks_atas|teks_bawah*

Contoh:
*!meme AKU CAPEK|TAPI TETEP NGODING*

Bisa dipakai dengan:
1) Reply ke foto lalu ketik: *!meme atas|bawah*
2) Kirim foto + caption: *!meme atas|bawah*`
                    });
                    return;
                }

                const parts = raw.split("|");
                const topRaw = (parts[0] || "").trim();
                const bottomRaw = (parts[1] || "").trim();

                const topText = topRaw.toUpperCase();
                const bottomText = bottomRaw.toUpperCase();

                // Cari sumber gambar
                let imgMsg = null;

                // 1) Kalau reply ke foto
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                if (ctx?.quotedMessage?.imageMessage) {
                    imgMsg = { message: ctx.quotedMessage };
                }
                // 2) Kalau pesan ini foto dengan caption !meme
                else if (msg.message?.imageMessage) {
                    imgMsg = msg;
                }
                // 3) Opsional: fallback ke gambar terakhir di chat (kalau kamu pakai LAST_QR_IMAGE untuk ini juga)
                else if (LAST_QR_IMAGE[from]?.message?.imageMessage) {
                    imgMsg = LAST_QR_IMAGE[from];
                }

                if (!imgMsg) {
                    await sock.sendMessage(from, {
                        text:
"Kirim foto + caption *!meme atas|bawah* atau reply ke foto lalu ketik *!meme atas|bawah*, Bang."
                    });
                    return;
                }

                try {
                    const buffer = await downloadMediaMessage(imgMsg, "buffer");

                    const ts = Date.now();
                    const inPath = `./meme_in_${ts}.jpg`;
                    const outPath = `./meme_out_${ts}.jpg`;

                    fs.writeFileSync(inPath, buffer);

                    // Escape double quote agar aman di command
                    const escTop = topText.replace(/"/g, '\\"');
                    const escBottom = bottomText.replace(/"/g, '\\"');

                    // NOTE:
                    // - Pastikan font "Impact" terinstal di Windows
                    //   Kalau tidak ada, bisa ganti dengan 'Arial-Black' atau font lain.
                    const cmdMeme =
                        `magick "${inPath}" ` +
                        `-resize 800x800^ -gravity center -extent 800x800 ` +
                        `-font Impact -stroke black -strokewidth 4 -fill white -pointsize 64 ` +
                        `-gravity north -annotate +0+40 "${escTop}" ` +
                        `-gravity south -annotate +0+40 "${escBottom}" ` +
                        `"${outPath}"`;

                    await execAsync(cmdMeme);

                    const outBuf = fs.readFileSync(outPath);

                    await sock.sendMessage(from, {
                        image: outBuf,
                        caption: "Ini memenya, Bang."
                    });

                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

                } catch (err) {
                    console.error("Meme generator error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal bikin meme, Bang. Cek apakah ImageMagick & font Impact sudah terpasang."
                    });
                }

                return;
            }

            // =================================================
            // SPEEDTEST (pakai python -m speedtest --simple)
            // =================================================
            if (cmd === "!speedtest") {
                await sock.sendMessage(from, {
                    text: "Menjalankan speedtest! (butuh ±10–30 detik)"
                });

                try {
                    const result = await execAsync(`python -m speedtest --simple`);

                    if (!result.trim()) {
                        throw new Error("No output from speedtest");
                    }

                    await sock.sendMessage(from, {
                        text:
`*Hasil Speedtest Server Bot*

${result}

Selesai Bang.`
                    });
                } catch (err) {
                    console.error("Speedtest error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal menjalankan speedtest. Coba cek di server:\n`python -m speedtest --simple`"
                    });
                }
            }

// =================================================
            // FITUR REMOVE BACKGROUND (SERVER: AGATZ)
            // =================================================
            if (cmd === "!removebg" || cmd === "!hapusbg" || cmd === "!png") {
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                const isImage = msg.message.imageMessage;

                if (!isQuotedImage && !isImage) {
                    return sock.sendMessage(from, { text: `⚠️ Kirim/Reply foto dengan caption *${cmd}*` }, { quoted: msg });
                }

                // 1. React 'Jam' 🕑
                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // 2. Download Gambar
                    let mediaBuffer;
                    if (isQuotedImage) {
                        mediaBuffer = await downloadMediaMessage(
                            { message: msg.message.extendedTextMessage.contextInfo.quotedMessage }, 'buffer', {}
                        );
                    } else {
                        mediaBuffer = await downloadMediaMessage(msg, 'buffer', {});
                    }

                    // 3. Upload ke Catbox (Pastikan fungsi uploadToCatbox ada di bawah)
                    const imageUrl = await uploadToCatbox(mediaBuffer);

                    // 4. Panggil API Agatz
                    // Agatz mengembalikan JSON, bukan gambar langsung
                    const { data: res } = await axios.get(`https://api.agatz.xyz/api/removebg?url=${imageUrl}`);

                    if (!res || !res.data || !res.data.url) {
                        throw new Error("Respon API Agatz kosong.");
                    }

                    // 5. Kirim Hasil (Ambil URL dari dalam JSON)
                    await sock.sendMessage(from, { 
                        document: { url: res.data.url }, 
                        mimetype: "image/png",
                        fileName: "removebg-bangbot.png",
                        caption: "✨ *BACKGROUND TERHAPUS*" 
                    }, { quoted: msg });

                    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });

                } catch (e) {
                    console.error("RemoveBG Error:", e);
                    await sock.sendMessage(from, { text: "❌ Server lagi pada tumbang Bang. Coba lagi nanti ya." }, { quoted: msg });
                }
            }

// =================================================
            // FITUR HD / REMINI (AI REPLICATE)
            // =================================================
            if (cmd === "!hd" || cmd === "!remini" || cmd === "!perjelas") {
                // Cek apakah ada gambar?
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                const isImage = msg.message.imageMessage;
                
                if (!isQuotedImage && !isImage) {
                    return sock.sendMessage(from, { text: "⚠️ Kirim/Reply foto burik dengan caption *!hd*" }, { quoted: msg });
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // 1. Download Gambar
                    let mediaBuffer;
                    if (isQuotedImage) {
                        mediaBuffer = await downloadMediaMessage(
                            { message: msg.message.extendedTextMessage.contextInfo.quotedMessage }, 'buffer', {}
                        );
                    } else {
                        mediaBuffer = await downloadMediaMessage(msg, 'buffer', {});
                    }

                    // 2. Convert ke Base64 (Wajib buat Replicate)
                    const base64Image = `data:image/jpeg;base64,${mediaBuffer.toString('base64')}`;

                    // 3. Kirim ke Replicate (Model: Real-ESRGAN)
                    // Model ini jago banget bikin foto pecah jadi tajem (Upscale 4x)
                    const output = await replicate.run(
                        "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fccffa9990142941f540251853",
                        {
                            input: {
                                image: base64Image,
                                scale: 4, // Perbesar 4x lipat
                                face_enhance: true // Perbaiki wajah juga
                            }
                        }
                    );

                    // Output Replicate biasanya langsung URL gambar hasil
                    if (output) {
                        await sock.sendMessage(from, { 
                            image: { url: output }, 
                            caption: "*SUKSES JADI HD!*"
                        }, { quoted: msg });

                        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
                    } else {
                        throw new Error("Hasil AI kosong.");
                    }

                } catch (e) {
                    console.error("HD Error:", e);
                    await sock.sendMessage(from, { text: "❌ Gagal memproses gambar. Pastikan server Replicate aman." }, { quoted: msg });
                }
            }

            // =================================================
            // KONVERSI MEDIA
            // =================================================

            // !toimg — STICKER / IMAGE → JPG
            if (cmd === "!toimg") {
                const buf = await getQuotedMediaBuffer(msg);

                if (!buf) {
                    await sock.sendMessage(from, {
                        text: "Reply ke stiker atau foto yang mau diubah jadi gambar, Bang."
                    });
                    return;
                }

                const inPath = `./conv_in_${Date.now()}.png`;
                const outPath = `./conv_out_${Date.now()}.jpg`;

                try {
                    fs.writeFileSync(inPath, buf);

                    const cmdConv =
                        `magick "${inPath}" -background white -alpha remove -alpha off ` +
                        `-quality 90 "${outPath}"`;

                    await execAsync(cmdConv);

                    const img = fs.readFileSync(outPath);

                    await sock.sendMessage(from, {
                        image: img,
                        caption: "Selesai Bang, ini hasil konversi ke gambar."
                    });

                } catch (err) {
                    console.error("!toimg error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengonversi ke gambar." });
                } finally {
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                }
            }

            // !tovid — ANIMATED STICKER / GIF → MP4
            if (cmd === "!tovid") {
                const buf = await getQuotedMediaBuffer(msg);

                if (!buf) {
                    await sock.sendMessage(from, {
                        text: "Reply ke stiker bergerak / GIF yang mau diubah jadi video, Bang."
                    });
                    return;
                }

                const inPath = `./conv_in_${Date.now()}.webp`;
                const outPath = `./conv_out_${Date.now()}.mp4`;

                try {
                    fs.writeFileSync(inPath, buf);

                    const ffCmd =
                        `ffmpeg -y -i "${inPath}" -movflags +faststart -pix_fmt yuv420p ` +
                        `-vf "scale=512:-1:flags=lanczos" -t 10 "${outPath}"`;

                    await execAsync(ffCmd);

                    const vid = fs.readFileSync(outPath);

                    await sock.sendMessage(from, {
                        video: vid,
                        caption: "Selesai Bang!"
                    });

                } catch (err) {
                    console.error("!tovid error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengonversi ke video." });
                } finally {
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                }
            }

            // !togif — VIDEO → GIF
            if (cmd === "!togif") {
                const buf = await getQuotedMediaBuffer(msg);

                if (!buf) {
                    await sock.sendMessage(from, {
                        text: "Reply ke video yang mau diubah jadi GIF, Bang (maks ~6 detik)."
                    });
                    return;
                }

                const inPath = `./conv_in_${Date.now()}.mp4`;
                const outPath = `./conv_out_${Date.now()}.gif`;

                try {
                    fs.writeFileSync(inPath, buf);

                    const ffCmd =
                        `ffmpeg -y -i "${inPath}" ` +
                        `-t 6 -vf "fps=12,scale=320:-1:flags=lanczos" -loop 0 "${outPath}"`;

                    await execAsync(ffCmd);

                    const gif = fs.readFileSync(outPath);

                    await sock.sendMessage(from, {
                        video: gif,
                        gifPlayback: true,
                        caption: "Ini GIF-nya Bang."
                    });

                } catch (err) {
                    console.error("!togif error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengonversi video ke GIF." });
                } finally {
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                }
            }

            // !compress — KOMPRES FOTO / VIDEO
            if (cmd === "!compress") {
                const buf = await getQuotedMediaBuffer(msg);

                if (!buf) {
                    await sock.sendMessage(from, {
                        text: "Reply ke foto atau video yang mau dikompres, Bang."
                    });
                    return;
                }

                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                const quoted = ctx?.quotedMessage || {};
                const isVideo = !!quoted.videoMessage;

                const inPath = `./conv_in_${Date.now()}.${isVideo ? "mp4" : "jpg"}`;
                const outPath = `./conv_out_${Date.now()}.${isVideo ? "mp4" : "jpg"}`;

                try {
                    fs.writeFileSync(inPath, buf);

                    if (isVideo) {
                        const ffCmd =
                            `ffmpeg -y -i "${inPath}" -vcodec libx264 -crf 30 -preset veryfast ` +
                            `-acodec aac -b:a 96k -movflags +faststart "${outPath}"`;
                        await execAsync(ffCmd);

                        const vid = fs.readFileSync(outPath);
                        await sock.sendMessage(from, {
                            video: vid,
                            caption: "Selesai Bang!"
                        });
                    } else {
                        const magickCmd =
                            `magick "${inPath}" -resize 1280x1280\\> -quality 70 "${outPath}"`;
                        await execAsync(magickCmd);

                        const img = fs.readFileSync(outPath);
                        await sock.sendMessage(from, {
                            image: img,
                            caption: "Sudah dikompres, Bang."
                        });
                    }

                } catch (err) {
                    console.error("!compress error:", err);
                    await sock.sendMessage(from, { text: "Gagal mengompres media." });
                } finally {
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                }
            }

            // =================================================
            // AUDIO TOOLS
            // =================================================

            // !bass — bass boost
            if (cmd === "!bass") {
                await processQuotedAudioEffect(
                    msg,
                    sock,
                    from,
                    "bass=g=10,volume=4dB",
                    {
                        caption: "Sudah dibikin bass boost, Bang.",
                        help: "Reply ke *audio/voice note* yang mau di-bass boost, Bang."
                    }
                );
            }

            // !nightcore — pitch naik + agak cepat
            if (cmd === "!nightcore") {
                await processQuotedAudioEffect(
                    msg,
                    sock,
                    from,
                    "asetrate=44100*1.25,atempo=1.0,aresample=44100",
                    {
                        caption: "Mode nightcore selesai, Bang.",
                        help: "Reply ke *audio/voice note* yang mau dibuat nightcore, Bang."
                    }
                );
            }

            // !slow — diperlambat
            if (cmd === "!slow") {
                await processQuotedAudioEffect(
                    msg,
                    sock,
                    from,
                    "atempo=0.8",
                    {
                        caption: "Audio sudah diperlambat, Bang.",
                        help: "Reply ke *audio/voice note* yang mau diperlambat, Bang."
                    }
                );
            }

            // !vchip — suara cempreng (chipmunk)
            if (cmd === "!vchip") {
                await processQuotedAudioEffect(
                    msg,
                    sock,
                    from,
                    "asetrate=44100*1.4,atempo=1.0,aresample=44100",
                    {
                        caption: "Suara chipmunk jadi, Bang.",
                        help: "Reply ke *audio/voice note* yang mau dibuat cempreng, Bang."
                    }
                );
            }

            // !vn — kirim ulang sebagai voice note (ptt: true)
            if (cmd === "!vn") {
                await processQuotedAudioEffect(
                    msg,
                    sock,
                    from,
                    "", // tanpa filter, hanya re-encode
                    {
                        caption: "Dikirim ulang sebagai VN, Bang.",
                        ptt: true,
                        help: "Reply ke *audio/voice note* yang mau dijadikan VN, Bang."
                    }
                );
            }

            // =================================================
            // PDF → IMG (reply ATAU PDF terakhir di chat)
            // =================================================
            if (cmd === "!pdf2img") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;

                let pdfMsg = null;

                // PRIORITAS 1 — reply PDF
                if (ctx?.quotedMessage?.documentMessage && ctx.quotedMessage.documentMessage.mimetype.includes("pdf")) {
                    pdfMsg = { message: ctx.quotedMessage };
                }

                // PRIORITAS 2 — PDF di pesan ini (caption)
                else if (msg.message?.documentMessage && msg.message.documentMessage.mimetype.includes("pdf")) {
                    pdfMsg = msg;
                }

                // PRIORITAS 3 — PDF sebelumnya di chat (karena caption PDF TIDAK terkirim)
                else if (LAST_PDF[from]) {
                    pdfMsg = LAST_PDF[from];
                }

                // Jika tetap tidak ada
                if (!pdfMsg) {
                    await sock.sendMessage(from, {
                        text:
            `Tidak ditemukan PDF, Bang.
            Cara pakai:
            1) Kirim PDF → kemudian ketik *!pdf2img*
            2) Atau reply ke PDF → *!pdf2img*`
                    });
                    return;
                }

                try {
                    await sock.sendMessage(from, { text: "Proses Bang!" });

                    const pdfBuffer = await downloadMediaMessage(pdfMsg, "buffer");

                    const ts = Date.now();
                    const pdfPath = `./pdf_${ts}.pdf`;
                    const outPrefix = `./pdf_${ts}_page`;

                    fs.writeFileSync(pdfPath, pdfBuffer);

                    // Convert via Poppler, 300 dpi (tajam)
                    const cmd = `pdftoppm -png -r 300 "${pdfPath}" "${outPrefix}"`;
                    await execAsync(cmd);

                    const files = fs.readdirSync(".")
                        .filter(f => f.startsWith(`pdf_${ts}_page`) && f.endsWith(".png"))
                        .sort();

                    if (!files.length) throw new Error("No PDF output");

                    for (const file of files) {
                        const img = fs.readFileSync(file);
                        await sock.sendMessage(from, {
                            image: img,
                            caption: "Selesai Bang!"
                        });
                        fs.unlinkSync(file);
                    }

                    fs.unlinkSync(pdfPath);

                } catch (err) {
                    console.error("PDF2IMG error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal convert PDF. Pastikan Poppler sudah terinstal (pdftoppm)."
                    });
                }

                return;
            }

            // !compresspdf — kompres PDF
            if (cmd === "!compresspdf") {
                const ctx = msg.message?.extendedTextMessage?.contextInfo;

                // 1) Coba REPLY dulu
                let quotedDoc = ctx?.quotedMessage?.documentMessage;
                let directDoc = msg.message?.documentMessage;

                let targetDoc = quotedDoc || directDoc;

                if (!targetDoc || !(targetDoc.mimetype || "").includes("pdf")) {
                    await sock.sendMessage(from, {
                        text: "Kirim PDF dengan caption *!compresspdf* atau reply ke PDF lalu ketik *!compresspdf*, Bang."
                    });
                    return;
                }

                let buf;
                if (quotedDoc) {
                    buf = await downloadMediaMessage(
                        { message: ctx.quotedMessage },
                        "buffer"
                    );
                } else {
                    buf = await downloadMediaMessage(
                        msg,
                        "buffer"
                    );
                }

                const inPath = `./pdf_in_${Date.now()}.pdf`;
                const outPdf = `./pdf_out_${Date.now()}.pdf`;

                try {
                    fs.writeFileSync(inPath, buf);

                    const magickCmd =
                        `magick -density 120 "${inPath}" ` +
                        `-compress jpeg -quality 60 "${outPdf}"`;

                    await execAsync(magickCmd);

                    const pdfBuf = fs.readFileSync(outPdf);
                    const baseName = targetDoc.fileName || "file.pdf";

                    await sock.sendMessage(from, {
                        document: pdfBuf,
                        mimetype: "application/pdf",
                        fileName: `compressed_${baseName}`
                    });

                } catch (err) {
                    console.error("compresspdf error:", err);
                    await sock.sendMessage(from, {
                        text: "Gagal kompres PDF. Pastikan ImageMagick bisa baca/tulis PDF."
                    });
                } finally {
                    if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
                    if (fs.existsSync(outPdf)) fs.unlinkSync(outPdf);
                }
            }

            // =================================================
            // FUN & INTERACTION
            // =================================================

            if (cmd === "!quote") {
                const quotes = [
                    "Jangan takut gagal, takutlah untuk tidak mencoba.",
                    "Jangan berhenti ketika lelah. Berhenti ketika selesai.",
                    "Hidup ini singkat, jangan habiskan waktumu untuk membenci.",
                    "Kegagalan adalah bumbu yang membuat keberhasilan terasa nikmat.",
                    "Jadilah versi terbaik dari dirimu sendiri.",
                    "Belajarlah dari masa lalu, hiduplah untuk hari ini, dan bermimpilah untuk masa depan.",
                    "Masa depan tidak ditentukan oleh keberuntungan, tetapi oleh kerja keras dan ketekunan.",
                    "Jangan takut dengan masa depan. Ciptakanlah masa depan yang kamu inginkan.",
                    "Hidup adalah seni menyeimbangkan antara menerima dan memperjuangkan.",
                    "Waktu adalah guru terbaik, meski kadang memberi pelajaran dengan cara yang keras.",
                    "Orang kuat bukan mereka yang tak pernah jatuh, tetapi mereka yang selalu bangkit.",
                    "Hidup adalah perjalanan, bukan perlombaan.",
                    "Keberanian sejati adalah tetap berdiri tegak meski dunia mencoba menjatuhkanmu.",
                    "Sukses dimulai dari keberanian untuk mencoba.",
                    "Jangan hanya menunggu kesempatan, ciptakanlah kesempatan.",
                    "Orang sukses bukan mereka yang tak pernah gagal, tetapi mereka yang tak pernah menyerah.",
                    "Tidak ada jalan pintas menuju sukses yang berkelas.",
                    "Jangan turunkan standar hanya untuk diterima orang lain.",
                    "Orang yang tepat akan melihatmu berharga bahkan di saat terburukmu.",
                    "Cinta bukanlah tentang memiliki, tetapi tentang memberi ruang untuk tumbuh bersama."
                ];
                await sock.sendMessage(from, { text: quotes[Math.floor(Math.random() * quotes.length)] });
            }

            if (cmd === "!joke") {
                const jokes = [
                    "Kenapa matahari tenggelam? Karena nggak bisa berenang",
                    "Burung, burung apa yang suka nolak? Burung GakGak",
                    "Sayuran apa yang dingin? Kembang Cold",
                    "Gula, gula apa yang bukan gula? Gula Aren't",
                    "Nama kota apa yang banyak bapak-bapaknya? PurwoDaddy",
                    "Bakso apa yang nggak boleh dilihat? Bakso Aurat",
                    "Hewan apa yang taat lalu lintas? Unta-makan keselamatan",
                    "Ikan, ikan apa yang bisa terbang? Lelelawar",
                    "Kenapa air mata warnanya bening? Kalau warna ijo namanya air matcha",
                    "Susu, susu apa yang selalu telat? Susu keDelay",
                    "Superhero yang selalu selamat di setiap keadaan? AkuAman",
                    "Roti, roti apa yang suka nyuri? JamBread",
                    "Kenapa ginjal ada dua? Karena kalau satu Ganjil",
                    "Huruf apa yang paling kedinginan? B, karena berada di tengah-tengah AC",
                    "Kera, kera apa yang diinjak nggak marah? Keramik",
                    "Gajah, gajah apa yang baik? Gajahat",
                    "Siapa pemain bola yang punya usaha pengobatan? David Bekam",
                    "Bubur apa yang kecil tapi bisa digedein? Bubur Zoom-Zoom",
                    "Hewan apa yang bersaudara? Katak Beradik"
                ];
                await sock.sendMessage(from, { text: jokes[Math.floor(Math.random() * jokes.length)] });
            }

            if (cmd === "!pantun") {
                const pantun = [
                    "Jalan-jalan ke kota Blitar,\nBeli roti sama keju.\nKalau Bang lagi bingung mikir,\nBangBot siap bantu selalu.",
                    "Ke pasar beli tomat,\nTidak lupa beli pepaya.\nBang jangan banyak curhat,\nNanti aku jatuh cinta.",
                    "Burung merpati terbang melayang,\nHinggap sebentar di atas dahan.\nBang jangan banyak bimbang,\nMasalah pasti ada jalan.",
                    "Pergi ke pasar beli batik,\nWarnanya merah sungguh merekah.\nJadilah anak yang berbudi baik,\nAgar hidupmu penuh berkah.",
                    "Sungguh enak makan ketupat,\nDimakan saat hari raya.\nPunya teman suka merapat,\nKalau ada maunya saja.",
                    "Burung pipit terbang ke bukit,\nHinggap sebentar di pohon jati.\nBangun pagi janganlah sakit,\nTebarkan senyum sejukkan hati.",
                    "Buah mangga buah kuini,\nJatuh satu ke dalam kali.\nJangan menyesal di hari nanti,\nGunakan waktu sebaik mungkin.",
                    "Jalan-jalan ke kota Paris,\nLihat gedung berbaris-baris.\nWajahmu itu sangatlah manis,\nMembuat hatiku teriris-iris.",
                    "Kalau tuan tajam pikiran,\nAmbil galah tolong jolokkan.\nKalau tuan bijak aturan,\nBinatang apa tanduk di hidung?",
                    "Kapal berlayar di lautan biru,\nOmbak datang memecah sunyi.\nWalau punya teman yang baru,\nTeman lama jangan dibenci.",
                    "Pohon kelapa tumbuh menjulang,\nDaunnya lebat tempat berteduh.\nIngat ibadah sebelum pulang,\nAgar hati tidak keruh.",
                    "Berburu ke padang datar,\nDapat rusa belang kaki.\nBerguru kepalang ajar,\nBagai bunga kembang tak jadi.",
                    "Kalau ada sumur di ladang,\nBoleh kita menumpang mandi.\nKalau ada umurku panjang,\nBoleh kita berjumpa lagi.",
                    "Pergi ke toko beli paku,\nPaku dipukul kena jari.\nRajin-rajinlah membaca buku,\nAgar ilmu menerangi diri.",
                    "Makan bakso pakai cuka,\nMinumnya es teh manis.\nSiapa yang tidak suka,\nLihat gadis berwajah manis.",
                    "Ada kancil mencuri timun,\nDikejar sama Pak Tani.\nJangan sering duduk melamun,\nHidup ini harus berani.",
                    "Minum jamu rasanya pahit,\nBeli di pasar Kota Tua.\nWalau dompet sedang sakit,\nAsal ada kamu aku bahagia.",
                    "Anak ayam turun sepuluh,\nMati satu tinggal sembilan.\nTuntut ilmu bersungguh-sungguh,\nSupaya tidak ketinggalan.",
                    "Beli baju warna biru,\nDipakai untuk pergi bertamu.\nKalau punya teman baru,\nJangan lupakan teman lamamu.",
                    "Main layang di tanah lapang,\nBenang putus nyangkut di dahan.\nHati senang bukan kepalang,\nDapat rezeki dari Tuhan.",
                    "Bunga mawar bunga melati,\nTumbuh subur di taman kota.\nHanya kamu di dalam hati,\nTempat aku menjalin cinta.",
                    "Pagi-pagi minum kopi,\nDitemani pisang goreng.\nDunia ini terasa sepi,\nKalau wajahmu terlihat coreng.",
                    "Jalan-jalan ke Bekasi,\nBeli odading lima ribu.\nJangan lupa makan nasi,\nSupaya kuat menahan rindu."
                ];
                await sock.sendMessage(from, { text: pantun[Math.floor(Math.random() * pantun.length)] });
            }

            if (cmd === "!8ball") {
                const ans = [
                    "Ya, tentu saja.",
                    "Tidak Bang.",
                    "Mungkin saja.",
                    "Coba tanya lagi nanti.",
                    "Bang, aku ragu sih.",
                    "Kayaknya iya.",
                    "Kayaknya tidak."
                ];
                await sock.sendMessage(from, { text: ans[Math.floor(Math.random() * ans.length)] });
            }

            if (cmd === "!coin") {
                const hasil = Math.random() < 0.5 ? "HEAD" : "TAIL";
                await sock.sendMessage(from, { text: `Koin jatuh pada: *${hasil}*` });
            }

            if (cmd === "!siapa") {
                if (!isGroup) {
                    await sock.sendMessage(from, { text: "Command ini hanya untuk di grup, Bang." });
                } else {
                    const meta = await sock.groupMetadata(from);
                    const members = meta.participants.map(p => p.id);
                    const pick = members[Math.floor(Math.random() * members.length)];
                    const question = teks.replace(/!siapa/i, "").trim() || "Yang paling ganteng di sini";

                    await sock.sendMessage(from, {
                        text: `${question}\nJawabannya: @${pick.split("@")[0]}`,
                        mentions: [pick]
                    });
                }
            }

            // =================================================
            // KHODAM CHECKER (HIBURAN) — support reply / input / auto
            // =================================================
            if (cmd === "!khodam") {
                let targetName = "";
                let repliedUser = null;

                // 1) Cek kalau user reply ke pesan orang lain
                const ctx = msg.message?.extendedTextMessage?.contextInfo;
                repliedUser = ctx?.participant;

                // 2) Ambil teks setelah !khodam
                const after = teks.replace(/!khodam/i, "").trim();

                // PRIORITAS:
                // --------------------------------------------------------------------------------
                // 1) Jika reply → pakai nama yg direply
                // 2) Jika user mengisi nama manual → pakai input
                // 3) Jika kosong → pakai nomor pengirim
                // --------------------------------------------------------------------------------

                if (repliedUser) {
                    // pakai nomor user yg direply
                    targetName = repliedUser.split("@")[0];
                } else if (after) {
                    // pakai nama yang diketik
                    targetName = after;
                } else {
                    // fallback → nomor pengirim
                    targetName = sender.split("@")[0];
                }

                // Daftar khodam random hiburan
                const khodams = [
                    "Buaya Sunda",
                    "Macan Birahi",
                    "Tutup Panci",
                    "Kaleng Khong Guan",
                    "Tutup Odol",
                    "Beruang Sunda",
                    "Kanebo Kering",
                    "Kapal Karam",
                    "Gergaji Mesin",
                    "Serigala Overthinking",
                    "Tumis Kangkung",
                    "Nyi Roro Kidul",
                    "Burung Hantu Begadang",
                    "Payung Robek",
                    "Ayam Sayur",
                    "Tali Jemuran",
                    "Tuyul Kesandung",
                    "LC Karaoke",
                    "Cupang Betina",
                    "Sundel Bolong",
                    "Suster Ngesot",
                    "Martabak Telor",
                    "Sandal Swallow",
                    "Pensil Inul",
                    "Harimau Pink",
                    "Siluman Oyo",
                    "Tuyul Mager",
                    "Kunti Bogel",
                    "Kuntilanak Moshing"
                ];

                // Random pick
                const picked = khodams[Math.floor(Math.random() * khodams.length)];

                await sock.sendMessage(from, {
                    text:
`Target : *${targetName}*
Khodam terdeteksi : *${picked}*`
                });

                return;
            }

            // =================================================
            // TEKS & KREATIVITAS
            // =================================================

            if (cmd === "!story") {
                const stories = [
                    "Suatu hari Bang berjalan di jalan sepi. Tiba-tiba BangBot muncul dan berkata: 'Bang, mau stiker apa hari ini?'",
                    "Di sebuah kota kecil, ada seorang pemuda yang selalu membantu orang. Suatu hari ia bertemu bot aneh bernama BangBot. Hidupnya berubah sejak itu.",
                    "Bang sedang galau. Tiba-tiba angin berhembus pelan sambil membawa suara: 'Tenang Bang, semua akan baik-baik saja.'",
                    "Dulu dia hanya seorang pemimpi yang sering diremehkan oleh dunia, namun berkat dukungan tulus dari pasangan yang selalu percaya padanya, kini dia berdiri di puncak kesuksesan sebagai bukti bahwa cinta adalah energi paling hebat untuk mengubah takdir.",
                    "Membangun bisnis dari nol terasa sangat berat bagi mereka berdua, namun setiap kali rasa lelah datang mereka saling menggenggam tangan dan berjanji bahwa rumah impian mereka akan segera nyata sebagai buah dari kesabaran dan kerja keras yang tiada henti.",
                    "Dia memutuskan untuk berhenti menangisi masa lalu dan mulai fokus memperbaiki diri demi masa depan yang lebih cerah, karena dia percaya bahwa seseorang yang tepat akan datang di saat dia sudah menjadi versi terbaik dari dirinya sendiri.",
                    "Lautan luas memisahkan raga mereka selama bertahun-tahun demi mengejar pendidikan tinggi di negeri orang, namun jarak tersebut justru menjadi guru yang mengajarkan bahwa kesetiaan dan tekad yang kuat adalah kunci utama untuk meraih kebahagiaan sejati.",
                    "Setiap tetes keringatnya saat bekerja lembur adalah surat cinta paling jujur untuk keluarganya, dia tidak banyak bicara namun tindakannya membuktikan bahwa tanggung jawab dan kasih sayang adalah pondasi utama dalam membangun masa depan yang kokoh."
                ];
                await sock.sendMessage(from, { text: stories[Math.floor(Math.random() * stories.length)] });
            }

            if (cmd === "!katabijak") {
                const bijak = [
                    "Kesuksesan dimulai dari keberanian untuk mencoba.",
                    "Hidup adalah perjalanan, nikmati setiap langkahnya.",
                    "Masalah bukan penghalang, tapi guru yang menyamar.",
                    "Tidak ada hasil tanpa proses, Bang."
                ];
                await sock.sendMessage(from, { text: bijak[Math.floor(Math.random() * bijak.length)] });
            }

            if (cmd === "!puji") {
                const target = teks.replace(/!puji/i, "").trim();
                if (!target) {
                    await sock.sendMessage(from, { text: "Format: !puji nama" });
                } else {
                    const pujian = [
                        `${target} itu orangnya baik banget.`,
                        `${target} selalu bikin suasana jadi lebih hidup.`,
                        `${target} punya hati yang tulus.`,
                        `${target} itu keren, Bang!`
                    ];
                    await sock.sendMessage(from, { text: pujian[Math.floor(Math.random() * pujian.length)] });
                }
            }

            if (cmd === "!roast") {
                const target = teks.replace(/!roast/i, "").trim();
                if (!target) {
                    await sock.sendMessage(from, { text: "Format: !roast nama" });
                } else {
                    const roast = [
                        `${target} itu kadang lemot, tapi tetep disayang kok.`,
                        `${target} serius deh… ngopi dulu gih.`,
                        `${target} itu unik. Kadang overthinking, kadang overacting.`,
                        `Aku bingung sama ${target}… tapi yaudah sih.`
                    ];
                    await sock.sendMessage(from, { text: roast[Math.floor(Math.random() * roast.length)] });
                }
            }

            if (cmd === "!cinta") {
                const text = teks.replace(/!cinta/i, "").trim();
                if (!text.includes("dan")) {
                    await sock.sendMessage(from, { text: "Format: !cinta nama1 dan nama2" });
                } else {
                    const [n1, n2] = text.split(/dan/i).map(t => t.trim());
                    const score = Math.floor(Math.random() * 51) + 50;
                    await sock.sendMessage(from, {
                        text: `Kecocokan cinta *${n1}* ❤️ *${n2}* adalah *${score}%*`
                    });
                }
            }

            if (cmd === "!reverse") {
                const text = teks.replace(/!reverse/i, "").trim();
                if (!text) {
                    await sock.sendMessage(from, { text: "Format: !reverse teks" });
                } else {
                    await sock.sendMessage(from, { text: text.split("").reverse().join("") });
                }
            }

            // =================================================
            // MINI-GAME
            // =================================================

            if (cmd === "!tebakangka") {
                const angka = Math.floor(Math.random() * 10) + 1;
                await sock.sendMessage(from, {
                    text: `Aku sudah pilih angka 1–10.\nCoba tebak, Bang! (Jawaban: ${angka})`
                });
            }

            // =================================================
            // DADU — LEMPAR 1–6 DADU
            // =================================================
            if (cmd === "!dadu") {
                // Format: !dadu [jumlah]
                // contoh: !dadu 3
                let jumlah = parseInt(args[1] || "1", 10);
                if (isNaN(jumlah)) jumlah = 1;

                // batas aman
                if (jumlah < 1) jumlah = 1;
                if (jumlah > 6) jumlah = 6;

                const hasil = [];
                for (let i = 0; i < jumlah; i++) {
                    const angka = Math.floor(Math.random() * 6) + 1;
                    // mapping angka ke emoji dadu
                    const emojiMap = {
                        1: "🎲 (1)",
                        2: "🎲 (2)",
                        3: "🎲 (3)",
                        4: "🎲 (4)",
                        5: "🎲 (5)",
                        6: "🎲 (6)"
                    };
                    hasil.push(emojiMap[angka] || `🎲 (${angka})`);
                }

                await sock.sendMessage(from, {
                    text:
`🎲 *Lempar Dadu*

Jumlah dadu : ${jumlah}
Hasil       : 
${hasil.map((h, i) => `Dadu ${i + 1}: ${h}`).join("\n")}`
                });

                return;
            }

            // --- GAME: SLOT MACHINE (VERSI JUDI ASLI) ---
            if (cmd === "!slot" || cmd === "!judi") {
                const sender = msg.key.participant || msg.key.remoteJid;
                const args = teks.split(" ");
                let bet = parseInt(args[1]); // !slot 1000

                // Validasi Taruhan
                if (!bet || isNaN(bet)) {
                    // Kalau gak pasang taruhan, main gratisan (demo)
                    bet = 0; 
                }

                if (bet > 0) {
                    if (getBalance(sender) < bet) {
                        return sock.sendMessage(from, { text: "Duitmu kurang Bang! Minimal punya saldo seharga taruhan." }, { quoted: msg });
                    }
                    // Potong saldo dulu di awal
                    addBalance(sender, -bet);
                }

                const emojis = ["🍒", "🍋", "🍉", "7️⃣", "💎"];
                const randomIcon = () => emojis[Math.floor(Math.random() * emojis.length)];

                const slot1 = randomIcon();
                const slot2 = randomIcon();
                const slot3 = randomIcon();

                await sock.sendMessage(from, { text: "🎰 *PUTAR RODA NASIB...*" }, { quoted: msg });
                await new Promise(r => setTimeout(r, 1500)); // Delay biar tegang

                let resultText = `
🎰 *SLOT MACHINE* 🎰
-------------------
${slot1}  |  ${slot2}  |  ${slot3}
-------------------
`;

                // Logika Hadiah
                if (slot1 === slot2 && slot2 === slot3) {
                    // JACKPOT (Semua Sama) -> Menang 10x Lipat
                    let winAmount = bet * 10;
                    if (slot1 === "7️⃣") winAmount = bet * 20; // Super Jackpot
                    
                    if (bet > 0) addBalance(sender, winAmount);
                    
                    resultText += `\n🎉 *JACKPOT!!*\nKamu menang: *Rp ${winAmount}*`;
                } else if (slot1 === slot2 || slot2 === slot3 || slot1 === slot3) {
                    // KEMBAR 2 -> Balik Modal + Bonus Dikit (2x)
                    let winAmount = bet * 2;
                    if (bet > 0) addBalance(sender, winAmount);
                    
                    resultText += `\n✨ *Lumayan!*\nKamu menang: *Rp ${winAmount}*`;
                } else {
                    // ZONK -> Uang hilang (sudah dipotong di awal)
                    resultText += `\n💀 *ZONK!* Uangmu hangus.`;
                }

                if (bet === 0) resultText += `\n_(Mode Demo: Pasang taruhan biar seru, cth: !slot 5000)_`;
                
                await sock.sendMessage(from, { text: resultText }, { quoted: msg });
                return;
            }

            // =================================================
            // TEBAK KATA — MODE SIMPLE
            // =================================================
            if (cmd === "!tebakkata") {
                const soal = TEBAK_KATA_BANK[Math.floor(Math.random() * TEBAK_KATA_BANK.length)];

                tebakkataSessions.set(from, {
                    answer: soal.answer.toLowerCase(),
                    hint: soal.hint,
                    tries: 0
                });

                const garis = soal.answer.replace(/./g, "_ ").trim();

                await sock.sendMessage(from, {
                    text:
`*Game Tebak Kata*

Tebak kata berikut ini:

Huruf: ${garis}
Hint : ${soal.hint}

Ketik jawaban kamu di chat ini *tanpa pakai tanda seru (!)*.
Contoh: kopi`
                });

                return;
            }

            // =================================================
            // TEBAK GAMBAR (VERSI EMOJI)
            // =================================================
            if (cmd === "!tebakgambar") {
                const soal = TEBAK_GAMBAR_BANK[Math.floor(Math.random() * TEBAK_GAMBAR_BANK.length)];

                tebakgambarSessions.set(from, {
                    answer: soal.answer.toLowerCase(),
                    hint: soal.hint,
                    tries: 0,
                    emoji: soal.question
                });

                await sock.sendMessage(from, {
                    text:
`*Game Tebak Gambar (Emoji)*

${soal.question}

Hint : ${soal.hint}

Tebak maksud gambar di atas.
Ketik jawaban kamu di chat ini *tanpa pakai tanda seru (!)*.`
                });

                return;
            }

            // =================================================
            // CAK LONTONG — TEBAKAN NGACO
            // =================================================
            if (cmd === "!caklontong") {
                const soal = CAK_LONTONG_BANK[Math.floor(Math.random() * CAK_LONTONG_BANK.length)];

                caklontongSessions.set(from, {
                    answer: soal.answer.toLowerCase(),
                    explain: soal.explain,
                    tries: 0,
                    question: soal.question
                });

                await sock.sendMessage(from, {
                    text:
`*Game Cak Lontong*

Soal:
${soal.question}

Ketik jawaban kamu di chat ini *tanpa pakai tanda seru (!)*.
Ketik *nyerah* kalau mau lihat jawaban + penjelasan.`
                });

                return;
            }

            // =================================================
            // FAMILY 100 — TEBAK JAWABAN SURVEI
            // =================================================
            if (cmd === "!family100") {
                const soal = FAMILY100_BANK[Math.floor(Math.random() * FAMILY100_BANK.length)];

                family100Sessions.set(from, {
                    question: soal.question,
                    answers: soal.answers.map(a => a.toLowerCase()),
                    tries: 0
                });

                await sock.sendMessage(from, {
                    text:
`*Game Family 100*

Pertanyaan:
${soal.question}

Tebak salah satu jawabannya.
Ketik jawaban kamu di chat ini *tanpa pakai tanda seru (!)*.
Ketik *nyerah* kalau mau lihat semua jawaban survei.`
                });

                return;
            }


            if (cmd === "!suit") {
                const user = args[1];
                const choices = ["batu", "gunting", "kertas"];
                if (!choices.includes(user)) {
                    await sock.sendMessage(from, {
                        text: "Pilih: batu/gunting/kertas\nContoh: !suit batu"
                    });
                } else {
                    const bot = choices[Math.floor(Math.random() * choices.length)];

                    const result =
                        (user === bot) ? "Seri Bang!"
                            : (user === "batu" && bot === "gunting") ||
                              (user === "gunting" && bot === "kertas") ||
                              (user === "kertas" && bot === "batu")
                            ? "Bang menang!"
                            : "BangBot menang!";

                    await sock.sendMessage(from, {
                        text: `Bang pilih: ${user}\nBangBot pilih: ${bot}\n\n${result}`
                    });
                }
            }

            if (cmd === "!tebaklirik") {
                const lirik = [
                    "Ku ingin kau tahu, diriku di sini menunggu...",
                    "Aku yang jatuh cinta, kau yang tak peka...",
                    "Walau badai menghadang, ku tetap di sini..."
                ];
                const pick = lirik[Math.floor(Math.random() * lirik.length)];
                await sock.sendMessage(from, {
                    text: `Tebak judul lagu dari lirik:\n\n"${pick}"`
                });
            }

            if (cmd === "!pilih") {
                const text = teks.replace(/!pilih/i, "").trim();
                if (!text.includes("|")) {
                    await sock.sendMessage(from, { text: "Format: !pilih opsi1 | opsi2 | opsi3" });
                } else {
                    const opsi = text.split("|").map(o => o.trim()).filter(Boolean);
                    const pick = opsi[Math.floor(Math.random() * opsi.length)];
                    await sock.sendMessage(from, { text: `Aku pilih: *${pick}*` });
                }
            }
        }

        // =====================================================
        // HANDLER JAWABAN GAME MINI (KETIKA BUKAN COMMAND)
        // =====================================================
        if (!lower.startsWith("!") && teks) {
            const jawaban = lower.trim();

            // ---------------------------
            // TEBAK KATA
            // ---------------------------
            const tk = tebakkataSessions.get(from);
            if (tk) {
                if (jawaban === tk.answer) {
                    await sock.sendMessage(from, {
                        text:
`✅ *Benar Bang!*

Jawaban yang benar adalah: *${tk.answer}*`
                    });
                    tebakkataSessions.delete(from);
                } else {
                    tk.tries += 1;
                    if (tk.tries >= 3) {
                        await sock.sendMessage(from, {
                            text:
`❌ Masih salah, Bang.

Jawaban yang benar: *${tk.answer}*`
                        });
                        tebakkataSessions.delete(from);
                    } else {
                        await sock.sendMessage(from, {
                            text:
`❌ Belum tepat, Bang.
Hint : ${tk.hint}
Kesempatan: ${tk.tries}/3`
                        });
                    }
                }
                return;
            }

            // ---------------------------
            // TEBAK GAMBAR (EMOJI)
            // ---------------------------
            const tg = tebakgambarSessions.get(from);
            if (tg) {
                if (jawaban === tg.answer) {
                    await sock.sendMessage(from, {
                        text:
`✅ *Benar Bang!*

Emoji: ${tg.emoji}
Jawaban: *${tg.answer}*`
                    });
                    tebakgambarSessions.delete(from);
                } else {
                    tg.tries += 1;
                    if (tg.tries >= 3) {
                        await sock.sendMessage(from, {
                            text:
`❌ Masih salah.

Emoji  : ${tg.emoji}
Jawaban yang benar: *${tg.answer}*`
                        });
                        tebakgambarSessions.delete(from);
                    } else {
                        await sock.sendMessage(from, {
                            text:
`❌ Belum tepat, Bang.
Emoji: ${tg.emoji}
Hint : ${tg.hint}
Kesempatan: ${tg.tries}/3`
                        });
                    }
                }
                return;
            }

            // ---------------------------
            // CAK LONTONG
            // ---------------------------
            const ck = caklontongSessions.get(from);
            if (ck) {
                if (jawaban === "nyerah") {
                    await sock.sendMessage(from, {
                        text:
`*Jawaban & Penjelasan Cak Lontong*

Soal   : ${ck.question}
Jawaban: *${ck.answer}*

Penjelasan:
${ck.explain}`
                    });
                    caklontongSessions.delete(from);
                } else if (jawaban === ck.answer) {
                    await sock.sendMessage(from, {
                        text:
`*Benar Bang!*

Jawaban: *${ck.answer}*

Penjelasan:
${ck.explain}`
                    });
                    caklontongSessions.delete(from);
                } else {
                    ck.tries += 1;
                    if (ck.tries >= 3) {
                        await sock.sendMessage(from, {
                            text:
`❌ Salah lagi, Bang.

Jawaban: *${ck.answer}*

Penjelasan:
${ck.explain}`
                        });
                        caklontongSessions.delete(from);
                    } else {
                        await sock.sendMessage(from, {
                            text:
`❌ Belum tepat, Bang.
Ketik *nyerah* kalau mau lihat jawaban + penjelasan.
Kesempatan: ${ck.tries}/3`
                        });
                    }
                }
                return;
            }

            // ---------------------------
            // FAMILY 100
            // ---------------------------
            const f100 = family100Sessions.get(from);
            if (f100) {
                if (jawaban === "nyerah") {
                    await sock.sendMessage(from, {
                        text:
`*Jawaban Family 100*

Pertanyaan:
${f100.question}

Jawaban survei:
- ${f100.answers.join("\n- ")}`
                    });
                    family100Sessions.delete(from);
                } else {
                    const match = f100.answers.find(a => jawaban.includes(a));
                    if (match) {
                        await sock.sendMessage(from, {
                            text:
`*Jawaban kamu cocok dengan survei!*

Pertanyaan:
${f100.question}

Jawaban kamu : *${jawaban}*
Cocok dengan : *${match}*

Jawaban lain:
- ${f100.answers.join("\n- ")}`
                        });
                        family100Sessions.delete(from);
                    } else {
                        f100.tries += 1;
                        if (f100.tries >= 5) {
                            await sock.sendMessage(from, {
                                text:
`❌ Belum ada jawaban yang cocok, Bang.

Pertanyaan:
${f100.question}

Jawaban survei:
- ${f100.answers.join("\n- ")}`
                            });
                            family100Sessions.delete(from);
                        } else {
                            await sock.sendMessage(from, {
                                text:
`❌ Belum masuk survei, Bang.
Coba jawaban lain atau ketik *nyerah* untuk lihat semua jawaban.
Percobaan: ${f100.tries}/5`
                            });
                        }
                    }
                }
                return;
            }
        }

            // --- FITUR EKONOMI & RPG ---

            // 1. Cek Dompet (!dompet / !balance)
            if (cmd === "!dompet" || cmd === "!balance" || cmd === "!uang") {
                const sender = msg.key.participant || msg.key.remoteJid;
                const duit = getBalance(sender);
                
                // Format uang biar ada titiknya (Rp 1.000.000)
                const formatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
                
                await sock.sendMessage(from, { text: `💰 *DOMPET ANDA*\n\n👤 User: @${sender.split('@')[0]}\n💵 Saldo: *${formatter.format(duit)}*` }, { quoted: msg });
                return;
            }

            // 2. Absen Harian (!daily / !klaim)
            if (cmd === "!daily" || cmd === "!klaim") {
                const sender = msg.key.participant || msg.key.remoteJid;
                
                // Cek cooldown (biar gak spam klaim)
                if (!userBalance[sender + '_daily']) userBalance[sender + '_daily'] = 0;
                
                const lastClaim = userBalance[sender + '_daily'];
                const now = Date.now();
                const cooldown = 24 * 60 * 60 * 1000; // 24 Jam
                
                if (now - lastClaim < cooldown) {
                    const sisaWaktu = cooldown - (now - lastClaim);
                    const jam = Math.floor(sisaWaktu / (1000 * 60 * 60));
                    const menit = Math.floor((sisaWaktu % (1000 * 60 * 60)) / (1000 * 60));
                    return sock.sendMessage(from, { text: `⏳ Sabar Bang! Kamu sudah klaim hari ini.\n\nCoba lagi dalam: *${jam} jam ${menit} menit*` }, { quoted: msg });
                }

                // Beri Hadiah Random (1000 - 5000)
                const reward = Math.floor(Math.random() * 4000) + 1000;
                addBalance(sender, reward);
                
                // Simpan waktu klaim
                userBalance[sender + '_daily'] = now;
                saveDb();

                await sock.sendMessage(from, { text: `🎉 *DAILY REWARD*\n\nKamu mendapatkan: *Rp ${reward}*\nJangan lupa klaim lagi besok!` }, { quoted: msg });
                return;
            }

            // 3. Transfer Uang (!transfer @tag jumlah)
            if (cmd === "!transfer" || cmd === "!tf") {
                const sender = msg.key.participant || msg.key.remoteJid;
                const args = teks.split(" ");
                const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                const amount = parseInt(args[2]); // !tf @tag 5000

                if (!target || !amount || isNaN(amount)) {
                    return sock.sendMessage(from, { text: "Format salah Bang.\nContoh: *!transfer @udin 5000*" }, { quoted: msg });
                }

                if (target === sender) {
                    return sock.sendMessage(from, { text: "Mau nyuci uang Bang? Gak bisa transfer ke diri sendiri." }, { quoted: msg });
                }

                if (getBalance(sender) < amount) {
                    return sock.sendMessage(from, { text: "💸 Uangmu gak cukup Bang. Kerja dulu sana!" }, { quoted: msg });
                }

                // Proses Transfer
                addBalance(sender, -amount); // Kurangi pengirim
                addBalance(target, amount);  // Tambah penerima

                await sock.sendMessage(from, { text: `✅ *TRANSFER SUKSES*\n\nDikirim ke: @${target.split('@')[0]}\nJumlah: *Rp ${amount}*\n\nSisa Saldo: Rp ${getBalance(sender)}`, mentions: [target] }, { quoted: msg });
                return;
            }

            // 4. Leaderboard / Top Global (!top)
            if (cmd === "!top" || cmd === "!leaderboard") {
                // Ambil semua user, filter yang bukan properti sistem (kayak _daily), lalu urutkan
                const sorted = Object.keys(userBalance)
                    .filter(id => id.endsWith('@s.whatsapp.net'))
                    .sort((a, b) => userBalance[b] - userBalance[a])
                    .slice(0, 10); // Ambil 10 teratas

                let textTop = `🏆 *TOP 10 SULTAN GRUP* 🏆\n\n`;
                const formatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

                sorted.forEach((id, index) => {
                    textTop += `${index + 1}. @${id.split('@')[0]} = ${formatter.format(userBalance[id])}\n`;
                });

                textTop += `\n_Ayo kerja biar masuk list!_`;
                
                await sock.sendMessage(from, { text: textTop, mentions: sorted }, { quoted: msg });
                return;
            }

            // --- RPG: KERJA / WORK ---
            if (cmd === "!kerja" || cmd === "!work") {
                const sender = msg.key.participant || msg.key.remoteJid;

                // Cooldown Kerja (misal 5 menit)
                if (!userBalance[sender + '_work']) userBalance[sender + '_work'] = 0;
                const lastWork = userBalance[sender + '_work'];
                const now = Date.now();
                const cooldown = 5 * 60 * 1000; 

                if (now - lastWork < cooldown) {
                    const sisa = Math.ceil((cooldown - (now - lastWork)) / 1000 / 60);
                    return sock.sendMessage(from, { text: `🥵 Kamu capek Bang. Istirahat dulu *${sisa} menit* lagi.` }, { quoted: msg });
                }

                // Daftar Pekerjaan Random
                const jobs = [
                    { text: "membantu nenek menyeberang jalan", gaji: 500 },
                    { text: "menjual gorengan", gaji: 1500 },
                    { text: "menjadi badut lampu merah", gaji: 2000 },
                    { text: "menangkap maling ayam", gaji: 5000 },
                    { text: "menemukan dompet di jalan", gaji: 10000 },
                    { text: "memijat admin grup", gaji: 3000 }
                ];

                const job = jobs[Math.floor(Math.random() * jobs.length)];
                addBalance(sender, job.gaji);
                userBalance[sender + '_work'] = now;
                saveDb();

                await sock.sendMessage(from, { text: `💼 Kamu selesai *${job.text}*.\n💰 Gaji: *Rp ${job.gaji}*` }, { quoted: msg });
                return;
            }

            // --- GAME: MATH MODE ---
            if (cmd === "!math" || cmd === "!mtk") {
                if (math[from]) return sock.sendMessage(from, { text: "Masih ada soal matematika yang belum terjawab!" }, { quoted: msg });

                // Generate Angka Random
                const a = Math.floor(Math.random() * 50) + 1; // 1-50
                const b = Math.floor(Math.random() * 20) + 1; // 1-20
                
                // Pilih Operator (+, -, *)
                const ops = ['+', '-', '*'];
                const op = ops[Math.floor(Math.random() * ops.length)];

                // Hitung Jawaban
                let result;
                if (op === '+') result = a + b;
                else if (op === '-') result = a - b;
                else if (op === '*') result = a * b;

                const soal = `${a} ${op} ${b}`;

                // Simpan Sesi
                math[from] = {
                    jawaban: result,
                    timer: setTimeout(() => {
                        if (math[from]) {
                            sock.sendMessage(from, { text: `⏰ *WAKTU HABIS!*\n\nJawabannya adalah: *${result}*` });
                            delete math[from];
                        }
                    }, 30000) // Waktu 30 Detik
                };

                await sock.sendMessage(from, { text: `🧮 *KUIS MATEMATIKA*\n\nBerapa hasil dari:\n👉 *${soal}* = ???\n\n_Jawab cepat dapet duit!_` }, { quoted: msg });
                return;
            }

            // --- GAME: SIAPAKAH AKU ---
            if (cmd === "!siapakahaku" || cmd === "!tebakaku") {
                if (siapakahaku[from]) return sock.sendMessage(from, { text: "Selesaikan dulu soal yang ada Bang!" }, { quoted: msg });

                // DATABASE SOAL SIAPA AKU
                const bankSoal = [
                    // --- CONTOH LAMA (TETAP) ---
                    { soal: "Aku punya kaki 4, tapi tidak bisa berjalan. Siapakah aku?", jawab: "meja" },
                    { soal: "Aku semakin dipotong, aku semakin tinggi. Siapakah aku?", jawab: "celana" },

                    // --- TAMBAHAN BARU (BANYAK) ---
                    { soal: "Aku punya banyak gigi, tapi tidak bisa menggigit. Siapakah aku?", jawab: "sisir" },
                    { soal: "Aku dimatikan saat kamu tidur, dan dinyalakan saat gelap. Siapakah aku?", jawab: "lampu" },
                    { soal: "Aku selalu datang, tapi tidak pernah sampai. Siapakah aku?", jawab: "besok" },
                    { soal: "Punya leher tapi tak punya kepala. Punya lengan tapi tak punya tangan. Siapakah aku?", jawab: "baju" },
                    { soal: "Aku berat, tapi bisa terbang tinggi. Siapakah aku?", jawab: "pesawat" },
                    { soal: "Aku punya mata tapi tidak bisa melihat. Siapakah aku?", jawab: "badai" }, // Mata badai
                    { soal: "Kalau aku pecah, baru aku berguna. Siapakah aku?", jawab: "telur" },
                    { soal: "Aku makin ngeringin badanmu, aku malah makin basah. Siapakah aku?", jawab: "handuk" },
                    { soal: "Aku punya tulang, tapi tidak punya daging dan kulit. Siapakah aku?", jawab: "payung" }, // Rangka payung
                    { soal: "Aku punya kota, gunung, dan sungai, tapi tidak ada tanah atau air. Siapakah aku?", jawab: "peta" },
                    { soal: "Aku milikmu, tapi orang lain lebih sering menggunakannya daripada kamu. Siapakah aku?", jawab: "nama" },
                    { soal: "Aku bisa dipegang tapi tidak bisa dilihat. Siapakah aku?", jawab: "telinga" }, // Pegang telinga sendiri susah dilihat tanpa cermin
                    { soal: "Aku punya kepala tapi tidak punya rambut. Siapakah aku?", jawab: "paku" },
                    { soal: "Aku berjalan tanpa kaki, aku menangis tanpa mata. Siapakah aku?", jawab: "awan" },
                    { soal: "Aku penuh dengan lubang, tapi masih bisa menampung air. Siapakah aku?", jawab: "spons" },
                    { soal: "Aku dibeli untuk makanan, tapi aku sendiri tidak bisa dimakan. Siapakah aku?", jawab: "piring" },
                    { soal: "Aku punya 8 kaki dan bisa membuat jaring. Siapakah aku?", jawab: "laba-laba" },
                    { soal: "Aku punya leher panjang dan makan daun di pohon tinggi. Siapakah aku?", jawab: "jerapah" },
                    { soal: "Aku raja hutan yang punya rambut tebal di leher. Siapakah aku?", jawab: "singa" },
                    { soal: "Aku hewan besar yang punya belalai. Siapakah aku?", jawab: "gajah" },
                    { soal: "Aku tidur dengan posisi terbalik (kepala di bawah). Siapakah aku?", jawab: "kelelawar" },
                    { soal: "Aku tidak punya kaki tapi bisa bergerak cepat di tanah. Siapakah aku?", jawab: "ular" },
                    { soal: "Aku hewan yang membawa rumahku kemana-mana. Siapakah aku?", jawab: "siput" }, // atau kura-kura
                    { soal: "Aku putih, kecil, dan rasanya asin. Siapakah aku?", jawab: "garam" },
                    { soal: "Aku manis, disukai semut, dan berasal dari tebu. Siapakah aku?", jawab: "gula" },
                    { soal: "Aku air yang jatuh dari langit. Siapakah aku?", jawab: "hujan" },
                    { soal: "Aku jembatan warna-warni yang muncul setelah hujan. Siapakah aku?", jawab: "pelangi" },
                    { soal: "Aku bulat, ditendang-tendang, dan diperebutkan 22 orang. Siapakah aku?", jawab: "bola" },
                    { soal: "Aku alas kaki yang selalu diinjak-injak. Siapakah aku?", jawab: "sandal" },
                    { soal: "Aku lubang dua di wajahmu untuk bernapas. Siapakah aku?", jawab: "hidung" },
                    { soal: "Aku keras, putih, dan ada di dalam mulut. Siapakah aku?", jawab: "gigi" },
                    { soal: "Aku jendela dunia yang penuh tulisan. Siapakah aku?", jawab: "buku" },
                    { soal: "Aku selalu mengikutimu kemanapun kamu pergi saat ada cahaya. Siapakah aku?", jawab: "bayangan" },
                    { soal: "Aku benda yang bisa ngomong dan menampilkan gambar bergerak. Siapakah aku?", jawab: "televisi" },
                    { soal: "Aku kendaraan panjang yang berjalan di atas rel. Siapakah aku?", jawab: "kereta" },
                    { soal: "Aku punya sayap besi tapi bukan burung. Siapakah aku?", jawab: "pesawat" },
                    { soal: "Aku tempat menyimpan uang yang aman. Siapakah aku?", jawab: "bank" }, // atau celengan
                    { soal: "Aku buah kuning yang melengkung dan disukai monyet. Siapakah aku?", jawab: "pisang" },
                    { soal: "Aku sayuran oranye makanan kelinci. Siapakah aku?", jawab: "wortel" },
                    { soal: "Aku benda cair yang bikin lantai licin. Siapakah aku?", jawab: "minyak" }, // atau sabun
                    { soal: "Aku bisa panas bisa dingin, dan selalu dicari saat haus. Siapakah aku?", jawab: "air" },
                    { soal: "Aku punya jarum tapi tidak bisa menjahit. Siapakah aku?", jawab: "jam" },
                    { soal: "Aku dipakai di kepala untuk melindungi dari panas. Siapakah aku?", jawab: "topi" },
                    { soal: "Aku punya tuts hitam putih dan menghasilkan musik. Siapakah aku?", jawab: "piano" },
                    { soal: "Aku bulat, bersinar di malam hari, dan bisa sabit atau purnama. Siapakah aku?", jawab: "bulan" },
                    { soal: "Aku pusat tata surya yang sangat panas. Siapakah aku?", jawab: "matahari" },
                    { soal: "Aku berkedip-kedip kecil di langit malam. Siapakah aku?", jawab: "bintang" },
                    { soal: "Aku serangga kecil yang suka menghisap darah. Siapakah aku?", jawab: "nyamuk" }
                ];

                const random = bankSoal[Math.floor(Math.random() * bankSoal.length)];

                siapakahaku[from] = {
                    jawaban: random.jawab,
                    timer: setTimeout(() => {
                        if (siapakahaku[from]) {
                            sock.sendMessage(from, { text: `⏰ *WAKTU HABIS!*\n\nJawabannya adalah: *${random.jawab.toUpperCase()}*` });
                            delete siapakahaku[from];
                        }
                    }, 60000) // Waktu 60 Detik
                };

                await sock.sendMessage(from, { text: `*SIAPAKAH AKU?*\n\n"${random.soal}"\n\n_Reply pesan ini untuk menjawab!_` }, { quoted: msg });
                return;
            }

            // --- FITUR AFK ---
            if (cmd === "!afk") {
                const alasan = teks.replace(cmd, "").trim() || "Tanpa alasan";
                const sender = msg.key.participant || msg.key.remoteJid;

                afk[sender] = {
                    alasan: alasan,
                    waktu: Date.now()
                };

                await sock.sendMessage(from, { text: `💤 *MODE AFK AKTIF*\n\nAlasan: ${alasan}\n\n_Bot akan memberi tahu siapa saja yang ngetag kamu._` }, { quoted: msg });
                return;
            }

            // --- FITUR KBBI (KAMUS) ---
            if (cmd === "!kbbi") {
                const kata = teks.replace(cmd, "").trim();
                if (!kata) return sock.sendMessage(from, { text: "Kata apa yang mau dicari Bang? Contoh: *!kbbi cinta*" }, { quoted: msg });

                try {
                    const cheerio = require('cheerio');
                    // Scrape Website Resmi KBBI Kemdikbud
                    const { data } = await axios.get(`https://kbbi.kemdikbud.go.id/entri/${kata}`);
                    const $ = cheerio.load(data);

                    let definisi = [];
                    $('li').each((i, el) => {
                        const arti = $(el).text().trim();
                        if (arti) definisi.push(arti);
                    });

                    // Filter hasil yang tidak relevan
                    definisi = definisi.filter(d => !d.includes("→") && d.length > 5).slice(0, 5);

                    if (definisi.length === 0) {
                        return sock.sendMessage(from, { text: `Kata *"${kata}"* tidak ditemukan di KBBI.` }, { quoted: msg });
                    }

                    let reply = `*KBBI: ${kata.toUpperCase()}*\n`;
                    definisi.forEach((def, i) => {
                        reply += `\n${i + 1}. ${def}`;
                    });

                    await sock.sendMessage(from, { text: reply }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: "Gagal mengambil data KBBI." }, { quoted: msg });
                }
                return;
            }

            // 2. AL-QURAN (AYAT & AUDIO)
            if (cmd === "!quran" || cmd === "!ngaji") {
                const args = teks.split(" ");
                // Format: !quran 1 1 (Surah ke-1, Ayat ke-1)
                const surat = args[1];
                const ayat = args[2];

                if (!surat || !ayat) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Format salah Bang.\nContoh: *${cmd} 1 5*\n_(Artinya: Surah Al-Fatihah ayat 5)_` 
                    }, { quoted: msg });
                }

                await sock.sendMessage(from, { react: { text: "🕑", key: msg.key } });

                try {
                    // Pakai API EQuran.id
                    const url = `https://equran.id/api/v2/surat/${surat}`;
                    const { data: res } = await axios.get(url);

                    if (res.code !== 200) {
                        return sock.sendMessage(from, { text: "Surah tidak ditemukan." }, { quoted: msg });
                    }

                    const dataSurat = res.data;
                    const dataAyat = dataSurat.ayat.find(a => a.nomorAyat == ayat);

                    if (!dataAyat) {
                        return sock.sendMessage(from, { text: `Ayat ke-${ayat} tidak ada di surah ini.` }, { quoted: msg });
                    }

                    const pesanQuran = 
`*AL-QURAN DIGITAL*

Surah: *${dataSurat.namaLatin}* (${dataSurat.arti})
Ayat: *${ayat}*

${dataAyat.teksArab}

*Artinya:*
"${dataAyat.teksIndonesia}"

_Audio sedang dikirim..._`;

                    // Kirim Teks
                    await sock.sendMessage(from, { text: pesanQuran }, { quoted: msg });

                    // Kirim Audio Ayat (Kalau ada)
                    if (dataAyat.audio && dataAyat.audio['05']) {
                        await sock.sendMessage(from, { 
                            audio: { url: dataAyat.audio['05'] }, 
                            mimetype: 'audio/mp4', 
                            ptt: true // Kirim sebagai VN
                        }, { quoted: msg });
                    }

                } catch (e) {
                    console.error("Quran Error:", e);
                    await sock.sendMessage(from, { text: "Gagal mengambil ayat." }, { quoted: msg });
                }
            }

            // 3. KISAH NABI
            if (cmd === "!kisahnabi" || cmd === "!nabi") {
                const nabi = teks.replace(cmd, "").trim().toLowerCase();

                if (!nabi) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Masukkan nama Nabinya Bang.\nContoh: *${cmd} adam*` 
                    }, { quoted: msg });
                }

                try {
                    const url = `https://raw.githubusercontent.com/Zhirrr/My-SQL-Results/master/kisahnabi/${nabi}.json`;
                    const { data } = await axios.get(url);

                    if (!data || !data.name) {
                        return sock.sendMessage(from, { text: "❌ Kisah nabi tersebut tidak ditemukan." }, { quoted: msg });
                    }

                    const kisah = 
`*KISAH NABI ${data.name.toUpperCase()}*
*Lahir:* ${data.thn_kelahiran}
*Tempat:* ${data.tmp}
*Usia:* ${data.usia}

*Cerita:*
${data.description}`;

                    // Kirim gambar thumbnail (dari data image)
                    await sock.sendMessage(from, { 
                        image: { url: data.image }, 
                        caption: kisah 
                    }, { quoted: msg });

                } catch (e) {
                    await sock.sendMessage(from, { text: "Gagal mengambil kisah nabi. Pastikan ejaan nama benar." }, { quoted: msg });
                }
            }

            // 4. ASMAUL HUSNA (RANDOM)
            if (cmd === "!asmaulhusna") {
                try {
                    const url = "https://raw.githubusercontent.com/BochilTeam/database/master/agama/asmaulhusna.json";
                    const { data } = await axios.get(url);
                    
                    // Ambil random
                    const randomAsma = data[Math.floor(Math.random() * data.length)];

                    const pesanAsma = 
`*ASMAUL HUSNA*

*Arab:* ${randomAsma.arabic}
*Latin:* ${randomAsma.latin}
*Artinya:* "${randomAsma.translation_id}"`;

                    await sock.sendMessage(from, { text: pesanAsma }, { quoted: msg });

                } catch (e) {
                    await sock.sendMessage(from, { text: "Gagal mengambil data." }, { quoted: msg });
                }
            }

            // --- FITUR DOA HARIAN ---
            if (cmd === "!doaharian" || cmd === "!doa") {
                try {
                    // Ambil Database Doa
                    const { data } = await axios.get('https://raw.githubusercontent.com/Zhirrr/My-SQL-Results/master/data/doaharian.json');
                    
                    // Ambil Random 1 Doa
                    const randomDoa = data[Math.floor(Math.random() * data.length)];

                    const reply = `*DOA HARIAN*\n\n*${randomDoa.title}*\n\n${randomDoa.arabic}\n\n_${randomDoa.latin}_\n\n"Artinya: ${randomDoa.translation}"`;

                    await sock.sendMessage(from, { text: reply }, { quoted: msg });

                } catch (err) {
                    await sock.sendMessage(from, { text: "Gagal mengambil data doa." }, { quoted: msg });
                }
                return;
            }

// =================================================
            // MENU UMUM & TOLERANSI
            // =================================================

            // 1. ALKITAB (KRISTEN/KATOLIK)
            if (cmd === "!alkitab" || cmd === "!injil") {
                const query = teks.replace(cmd, "").trim();

                if (!query) {
                    return sock.sendMessage(from, { 
                        text: `⚠️ Mau cari ayat apa Bang?\nContoh: *${cmd} Yohanes 3:16*` 
                    }, { quoted: msg });
                }

                try {
                    // Menggunakan API publik untuk Alkitab (Terjemahan Baru)
                    const url = `https://beeble.me/api/v1/passage/${encodeURIComponent(query)}`;
                    const { data } = await axios.get(url);

                    if (!data || !data.data || data.data.length === 0) {
                        return sock.sendMessage(from, { text: "❌ Ayat tidak ditemukan. Pastikan penulisan benar (cth: Matius 1:1)." }, { quoted: msg });
                    }

                    const result = data.data[0];
                    const verses = result.verses.map(v => `*${v.verse}.* ${v.text}`).join("\n");

                    const pesanAlkitab = 
`*ALKITAB DIGITAL*

*Kitab:* ${result.book.name}
*Pasal:* ${result.chapter}

${verses}

_Semoga memberkati Bang!_`;

                    await sock.sendMessage(from, { text: pesanAlkitab }, { quoted: msg });

                } catch (e) {
                    console.error("Alkitab Error:", e);
                    await sock.sendMessage(from, { text: "Gagal mengambil ayat. Server sedang sibuk." }, { quoted: msg });
                }
            }

            // 2. MOTIVASI (UNIVERSAL/NETRAL)
            if (cmd === "!motivasi" || cmd === "!bijak") {
                // Database kata-kata bijak (Bisa ditambahin sendiri)
                const quotes = [
                    "Janganlah kegelapan masa lalu menutupi cahaya masa depan.",
                    "Satu-satunya cara untuk melakukan pekerjaan hebat adalah dengan mencintai apa yang kamu lakukan.",
                    "Kesuksesan bukanlah kunci kebahagiaan. Kebahagiaanlah kunci kesuksesan.",
                    "Hidup itu seperti sepeda. Agar tetap seimbang, kau harus terus bergerak.",
                    "Jangan menunggu peluang, ciptakanlah peluang itu.",
                    "Mimpi tidak akan menjadi kenyataan melalui sihir; itu membutuhkan keringat, tekad, dan kerja keras.",
                    "Kegagalan adalah bumbu yang memberi rasa pada kesuksesan.",
                    "Jadilah versi terbaik dari dirimu sendiri, bukan versi kedua dari orang lain.",
                    "Tuhan tidak akan memberi cobaan melampaui batas kemampuan hamba-Nya.",
                    "Berbuat baiklah tanpa perlu alasan."
                ];

                const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

                const pesanMotivasi = 
`*KATA BIJAK HARI INI*

"${randomQuote}"

_Tetap semangat Bang!_`;

                await sock.sendMessage(from, { text: pesanMotivasi }, { quoted: msg });
            }

            // 3. FAKTA UNIK (PENGETAHUAN UMUM)
            if (cmd === "!faktaunik" || cmd === "!fakta") {
                const fakta = [
                    "Madu adalah satu-satunya makanan yang tidak bisa basi.",
                    "Siput bisa tidur selama 3 tahun.",
                    "Nama paling umum di dunia adalah Mohammed.",
                    "Otot terkuat di tubuh manusia adalah lidah.",
                    "Perempuan berkedip dua kali lebih banyak dari laki-laki.",
                    "Semut tidak pernah tidur.",
                    "Coca-Cola awalnya berwarna hijau.",
                    "Indonesia adalah negara kepulauan terbesar di dunia.",
                    "Jerapah membersihkan telinganya dengan lidah sendiri.",
                    "Manusia tidak bisa menjilat sikunya sendiri (Coba aja kalau gak percaya)."
                ];

                const randomFakta = fakta[Math.floor(Math.random() * fakta.length)];

                await sock.sendMessage(from, { 
                    text: `*TAHUKAH KAMU?*\n\n${randomFakta}` 
                }, { quoted: msg });
            }

        // =====================================================
        // VIDEO → STIKER ANIMASI BIASA (!tostick)
        // =====================================================
        if (lower.startsWith("!tostick")) {
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            const quoted = ctx?.quotedMessage?.videoMessage;

            if (!quoted) {
                await sock.sendMessage(from, { text: "Reply ke video!" });
                return;
            }

            try {
                const buf = await downloadMediaMessage(
                    { message: ctx.quotedMessage },
                    "buffer"
                );

                const input = "./vid.mp4";
                const output = "./vid.webp";

                fs.writeFileSync(input, buf);

                const cmd =
                    `ffmpeg -i "${input}" -vf ` +
                    `"fps=15,scale=512:-1:force_original_aspect_ratio=decrease,` +
                    `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white" ` +
                    `-loop 0 -t 6 "${output}"`;

                exec(cmd, async (err) => {
                    if (err) {
                        console.error("Video to sticker error:", err);
                        await sock.sendMessage(from, {
                            text: "Gagal mengubah video jadi stiker."
                        });
                        return;
                    }

                    try {
                        const st = fs.readFileSync(output);

                        await sendStickerWithMeta(sock, from, st, {
                            packname: "BangBot",
                            author: "BangBot"
                        });

                        fs.unlinkSync(input);
                        fs.unlinkSync(output);
                    } catch (e) {
                        console.error("Send animated sticker error:", e);
                    }
                });
            } catch (err) {
                console.error("Download video error:", err);
            }
        }
    });
}

startBot();   