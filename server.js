const express = require('express');
const { Pool } = require('pg');
const { OpenAI } = require('openai');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1); // Pro správnou kompatibilitu za školním proxy
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

        const prompt = `Jsi tvrdý hardwarový expert s naprostou pamětí na světové benchmark žebříčky (Antutu pro mobily/tablety a PassMark/3DMark pro PC a laptopy).
Tvojí úlohou je vybrat 100% REÁLNÝ dosud existující produkt v kategorii "${category}".
Výkonnostní preference uživatele je: ${pricePref === 'levnější' ? 'vyber levný model ze spodku benchmarků (malé skóre).' : pricePref === 'dražší' ? 'vyber absolutní vlajkovou loď z TOP 10 tabulek žebříčků (obří skóre).' : 'vyber střední třídu se středním skórem.'}.
Vyber reálný kus podle těchto parametrů. Nic dalšího nezdůvodňuj a striktně vydej tento formát:

Název: [Přesný reálný název vybraného produktu]
Cena: [Odhadovaná cena v Kč]
Benchmark: [Uveď jméno žebříčku a bodové skóre vybraného modelu, např. Antutu v10: 1 530 000 bodů]
Parametry: [Procesor, RAM, Displej, Baterka/GPU - jen výčet s čárkami]
Komentář: [Krátká analytická věta k tomuto stroji]
FPS: [Uveď konkrétní číslo například u dvou her]`;

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

        const prompt = `Kriticky zhodnoť produkt nazvaný "${query}". Je tento kus hardwaru dobrý pro běžného uživatele k nákupu? Zkus také navrhnout jednu lepší, nebo naopak levnější alternativu.
Odpověz striktně v tomto formátu (bez dalších řečí):
Hodnocení: [Tvoje zhodnocení max na 2 věty]
Alternativa: [Pouze přesný název tvé navrhované alternativy]`;

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

app.listen(port, "0.0.0.0", () => {
    console.log(`Server is running on port ${port}`);
});
