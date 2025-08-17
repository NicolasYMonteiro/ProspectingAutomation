const axios = require("axios");
const mysql = require("mysql2/promise");

const API_KEY = "5aa549fc5da3d9400e82e3bab9f559a07d711a2b6de44645a12885cd14c49efc";

// ---- Pegando parâmetros da linha de comando ----
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("❌ Uso: node scraper.js \"pizzaria,hamburgueria\" \"Salvador, Bahia\"");
  process.exit(1);
}

const niches = args[0].split(",").map(n => n.trim());
const LOCATION = args[1];

// Configurações do banco
const dbConfig = {
  host: "localhost",
  user: "root",     
  password: "root", 
  database: "leads_db",
};

// Delay entre requisições
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---- Função para buscar coordenadas da cidade ----
async function getCoordinates(location) {
  try {
    const response = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: {
        q: location,
        format: "json",
        limit: 1
      },
      headers: {
        'User-Agent': 'Your App Name (your@email.com)' // Nominatim requer identificação
      }
    });

    if (response.data && response.data.length > 0) {
      const { lat, lon } = response.data[0];
      return `@${lat},${lon},14z`;
    } else {
      throw new Error("Localização não encontrada");
    }
  } catch (err) {
    console.error("❌ Erro ao buscar coordenadas:", err.message);
    console.error("💡 Dica: Verifique se a localização está escrita corretamente");
    process.exit(1);
  }
}


// ---- Função para buscar leads ----
async function searchLeads(query, location, coordinates, maxPages = 3) {
  let allResults = [];

  for (let page = 0; page < maxPages; page++) {
    const params = {
      engine: "google_maps",
      q: `${query} em ${location}`,
      hl: "pt-BR",
      type: "search",
      api_key: API_KEY,
      start: page * 20,
      ll: coordinates,
    };

    try {
      console.log(`📄 Buscando página ${page + 1} para ${query} em ${location}...`);
      const response = await axios.get("https://serpapi.com/search.json", { params });

      if (!response.data.local_results) {
        console.log(`⚠️ Nenhum resultado encontrado para ${query} na página ${page + 1}`);
        break;
      }

      allResults = [...allResults, ...response.data.local_results];
      await delay(2000); // 2s entre requisições
    } catch (err) {
      console.error(`❌ Erro na página ${page + 1} para ${query}:`, err.response?.data?.error || err.message);
      break;
    }
  }

  return allResults;
}

// ---- Execução principal ----
(async () => {
  const connection = await mysql.createConnection(dbConfig);
  let totalLeads = 0;

  console.log(`📍 Buscando coordenadas de: ${LOCATION}`);
  const COORDINATES = await getCoordinates(LOCATION);
  console.log(`✅ Coordenadas encontradas: ${COORDINATES}`);

  for (const niche of niches) {
    console.log(`\n🔍 Iniciando busca por: ${niche} em ${LOCATION}`);
    const results = await searchLeads(niche, LOCATION, COORDINATES);

    const nicheLeads = results
      .filter(place => !place.website) // Apenas sem site
      .map(place => ({
        nome: place.title,
        telefone: place.phone || "Não disponível",
        endereco: place.address || "Não disponível",
        nicho: niche,
        link: place.place_id
          ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
          : "Não disponível",
      }));

    for (const lead of nicheLeads) {
      try {
        await connection.execute(
          "INSERT INTO leads (nome, telefone, endereço, nicho, link) VALUES (?, ?, ?, ?, ?)",
          [lead.nome, lead.telefone, lead.endereco, lead.nicho, lead.link]
        );
      } catch (err) {
        console.error("⚠️ Erro ao inserir lead:", err.message);
      }
    }

    totalLeads += nicheLeads.length;
    console.log(`✅ ${nicheLeads.length} leads salvos para ${niche}`);
  }

  await connection.end();
  console.log(`\n🎉 Total de leads salvos no MySQL: ${totalLeads}`);
})();
