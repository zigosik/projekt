const express = require('express');
const { Pool } = require('pg');
const { OpenAI } = require('openai');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Připojení k PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'secret',
  database: process.env.DB_NAME || 'hw_advisor',
  port: 5432,
});

async function initDB() {
  let retries = 5;
  while(retries) {
    try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS viewed_products (
            id SERIAL PRIMARY KEY,
            category VARCHAR(50),
            price_preference VARCHAR(20),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS search_history (
            id SERIAL PRIMARY KEY,
            search_query TEXT,
            is_vulgar BOOLEAN,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log("Database initialized");
        break;
    } catch(err) {
        console.error("Failed to connect to DB, retrying...", err.message);
        retries -= 1;
        await new Promise(res => setTimeout(res, 3000));
    }
  }
}
initDB();

// Očekává se, že na portálu bude nadefinováno přes system ENV variables 
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'sk-test',
    baseURL: process.env.OPENAI_BASE_URL || 'https://kurim.ithope.eu/v1'
});

// Jednoduchý cenzor (pro splnění požadavku nevyhledávat vulgarity)
const vulgarWords = ['kurv', 'pic', 'prdel', 'zmrd', 'kokot', 'debil', 'idiot'];
function isVulgar(text) {
    const lowerText = text.toLowerCase();
    return vulgarWords.some(word => lowerText.includes(word));
}

// 1. API: Hover mechanismus
app.post('/api/evaluate-hover', async (req, res) => {
    try {
        const { category, pricePref } = req.body; 
        
        await pool.query(
            'INSERT INTO viewed_products (category, price_preference) VALUES ($1, $2)',
            [category, pricePref]
        );

        const prompt = `Představ si, že navrhuješ reálný kus hardwaru v kategorii "${category}".
Cenová preference uživatele je: ${pricePref === 'levnější' ? 'chce levnější model' : pricePref === 'dražší' ? 'chce prémiový dražší model' : 'chce standardní model'}.
Vymysli a popiš konkrétní zařízení. Nezdůvodňuj proč, jen vydej daný formát:

Název: [Reálný nebo vymyšlený název]
Parametry: [Procesor, RAM, Displej, Baterka - jen výčet s čárkami]
Komentář: [Jedna krátká věta, proč to doporučuješ]
FPS: [Uveď konkrétní číslo například GTA V: 60 FPS, CS2: 120 FPS]`;

        const response = await openai.chat.completions.create({
            model: "gemma3:27b",
            messages: [{ role: 'user', content: prompt }]
        });

        res.json({ success: true, text: response.choices[0].message.content });
    } catch (err) {
        console.error("AI Error:", err);
        res.status(500).json({ success: false, error: "Nebylo možné získat odpověď od AI." });
    }
});

// 2. API: Vyhledávání produktu
app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        const vulgar = isVulgar(query);

        await pool.query(
            'INSERT INTO search_history (search_query, is_vulgar) VALUES ($1, $2)',
            [query, vulgar]
        );

        if (vulgar) {
            return res.json({ success: false, error: "Zadaný název obsahuje zakázaná slova, vyhledávání zrušeno." });
        }

        const prompt = `Zhodnoť nanejvýš ve 2-3 větách produkt nazvaný "${query}". Je tento kus hardwaru dobrý pro běžného uživatele k nákupu?`;

        const response = await openai.chat.completions.create({
            model: "gemma3:27b",
            messages: [{ role: 'user', content: prompt }]
        });

        res.json({ success: true, text: response.choices[0].message.content });
    } catch (err) {
        console.error("Search API Error:", err);
        res.status(500).json({ success: false, error: "Vyhledávání selhalo." });
    }
});

// 3. API: Získání historie (abychom mohli do DB i zapisovat i čist) - podle zadání
app.get('/api/history', async (req, res) => {
    try {
        const viewedResult = await pool.query('SELECT category, price_preference, created_at FROM viewed_products ORDER BY id DESC LIMIT 5');
        const searchResult = await pool.query('SELECT search_query, is_vulgar, created_at FROM search_history ORDER BY id DESC LIMIT 5');
        
        res.json({
            success: true,
            viewed: viewedResult.rows,
            searches: searchResult.rows
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "Nepodařilo se načíst historii z DB." });
    }
});

app.listen(port, () => {
    console.log(\`Server is running on port \${port}\`);
});
