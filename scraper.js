const axios = require("axios");
const mysql = require("mysql2/promise");

const API_KEY = "";

// Configurações para Salvador, BA
const LOCATION = "Salvador, Bahia";
const COORDINATES = "@-12.9711,-38.5108,15z"; 

// Configurações do banco
const dbConfig = {
  host: "localhost",
  user: "root",     
  password: "root", 
  database: "leads_db",
};

// Delay entre requisições para evitar bloqueio
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function searchLeads(query, location = LOCATION, maxPages = 3) {
  let allResults = [];

  for (let page = 0; page < maxPages; page++) {
    const params = {
      engine: "google_maps",
      q: `${query} em ${location}`,
      hl: "pt-BR",
      type: "search",
      api_key: API_KEY,
      start: page * 20,
      ll: COORDINATES // Usando o formato correto
    };

    try {
      console.log(`📄 Buscando página ${page + 1} para ${query}...`);
      const response = await axios.get("https://serpapi.com/search.json", { params });

      if (!response.data.local_results) {
        console.log(`⚠️  Nenhum resultado encontrado para ${query} na página ${page + 1}`);
        break;
      }

      allResults = [...allResults, ...response.data.local_results];
      await delay(2000); // Delay de 2 segundos entre requisições
    } catch (err) {
      console.error(`❌ Erro na página ${page + 1} para ${query}:`, err.response?.data?.error || err.message);
      break;
    }
  }

  return allResults;
}

(async () => {
  const connection = await mysql.createConnection(dbConfig);
  const niches = ["pizzaria", "hamburgueria", "comida japonesa", "delivery"];
  let totalLeads = 0;

  for (const niche of niches) {
    console.log(`\n🔍 Iniciando busca por: ${niche}`);
    const results = await searchLeads(niche);

    const nicheLeads = results
      .filter(place => !place.website) // Apenas os sem website
      .map(place => ({
        nome: place.title,
        telefone: place.phone || "Não disponível",
        endereco: place.address || "Não disponível",
        nicho: niche,
        link: place.place_id
          ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
          : "Não disponível",
      }));
    // Inserindo no banco
    for (const lead of nicheLeads) {
      try {
        await connection.execute(
          "INSERT INTO leads (nome, telefone, endereco, nicho, link) VALUES (?, ?, ?, ?, ?)",
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