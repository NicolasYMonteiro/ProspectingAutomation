const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');

// Config MySQL
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'leads_db'
};

const DAILY_LIMIT = 15;

// Configuração do cliente WhatsApp
const whatsappClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-dev-shm-usage'
    ],
    timeout: 60000
  }
});

// Obtem os leads do dia
async function getDailyLeads() {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    const [rows] = await connection.execute(`
      SELECT id, nome, telefone, nicho 
      FROM leads 
      WHERE id =312
      ORDER BY RAND()
    `, [DAILY_LIMIT]);

    return rows;
  } catch (error) {
    console.error('Erro ao buscar leads:', error);
    return [];
  } finally {
    if (connection) await connection.end();
  }
}

// Marca leads como enviados
async function markAsSent(leadIds) {
  if (!leadIds.length) return;

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    const placeholders = leadIds.map(() => '?').join(',');

    await connection.execute(`
      UPDATE leads 
      SET enviado = 1, data_envio = NOW()
        WHERE id IN  (${placeholders})
    `, leadIds);

  } catch (error) {
    console.error('Erro ao marcar leads como enviados:', error);
  } finally {
    if (connection) await connection.end();
  }
}

// Cria mensagem personalizada
function createMessage(lead) {
  return `Olá ${lead.nome.split(' ')[0]}! 👋

Meu nome é Nícolas, sou desenvolvedor de sistemas e web sites. 
Vi que você atua como ${lead.nicho} e gostaria de conversar sobre [OFERTA ESPECÍFICA].

Podemos agendar uma conversa esta semana?`;
}

// Função de normalização + geração de variações
async function getValidWhatsAppNumbers(rawNumber, client) {
  if (!rawNumber) return [];

  const cleaned = rawNumber.replace(/\D/g, '');
  let baseNumber = cleaned.startsWith('55') ? cleaned.substring(2) : cleaned;

  if (baseNumber.length < 10 || baseNumber.length > 11) {
    return [];
  }

  const ddd = baseNumber.substring(0, 2);
  let subscriber = baseNumber.substring(2);

  const possibilities = [];

  if (subscriber.length === 9 && subscriber.startsWith('9')) {
    possibilities.push(`55${ddd}${subscriber}`);
    possibilities.push(`55${ddd}${subscriber.substring(1)}`);
  } else if (subscriber.length === 8) {
    possibilities.push(`55${ddd}${subscriber}`);
    possibilities.push(`55${ddd}9${subscriber}`);
  } else {
    possibilities.push(`55${ddd}${subscriber}`);
  }

  const validNumbers = [];
  for (const num of [...new Set(possibilities)]) {
    const exists = await client.isRegisteredUser(`${num}@c.us`);
    if (exists) validNumbers.push(num);
  }

  return validNumbers;
}

// Função para enviar mensagem com confirmação para todos os números válidos
async function sendMessageWithConfirmation(number, message) {
  try {
    const validNumbers = await getValidWhatsAppNumbers(number, whatsappClient);

    if (validNumbers.length === 0) {
      throw new Error('Nenhum formato válido encontrado para este número.');
    }

    const sentMessages = [];

    for (const validNumber of validNumbers) {
      const internationalNumber = `${validNumber}@c.us`;

      console.log('\n📨 Enviando mensagem para:', internationalNumber);
      const sentMsg = await whatsappClient.sendMessage(internationalNumber, message);
      console.log('✅ Mensagem enviada. ID:', sentMsg.id.id);

      sentMessages.push({ number: validNumber, messageId: sentMsg.id.id });
    }

    return { success: true, sentMessages };
  } catch (error) {
    console.error('❌ Erro:', error.message);
    return { success: false, error: error.message };
  }
}

// Função principal
async function main() {
  console.log('\n🚀 Buscando leads...');
  const leads = await getDailyLeads();

  if (leads.length === 0) {
    console.log('Nenhum lead encontrado para hoje.');
    return;
  }

  console.log(`Encontrados ${leads.length} leads. Enviando mensagens...\n`);

  const sentIds = [];

  for (const lead of leads) {
    const message = createMessage(lead);

    console.log(`\n➡️ Lead #${lead.id} - ${lead.nome} (${lead.telefone})`);
    const result = await sendMessageWithConfirmation(lead.telefone, message);

    if (result.success) {
      sentIds.push(lead.id);
    }

    // Aguardar alguns segundos entre mensagens para evitar bloqueio
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  if (sentIds.length) {
    await markAsSent(sentIds);
    console.log(`\n✅ ${sentIds.length} leads marcados como enviados.`);
  } else {
    console.log('\n⚠️ Nenhuma mensagem foi enviada com sucesso.');
  }
}

// Eventos do WhatsApp
whatsappClient.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('\nEscaneie o QR Code com seu WhatsApp:');
});

whatsappClient.on('authenticated', () => {
  console.log('\nAutenticação realizada com sucesso!');
});

whatsappClient.on('auth_failure', (msg) => {
  console.error('\nFalha na autenticação:', msg);
  process.exit(1);
});

whatsappClient.on('ready', () => {
  console.log('\nWhatsApp conectado com sucesso!');
  main();
});

whatsappClient.on('disconnected', () => {
  console.log('\nWhatsApp desconectado');
  process.exit();
});

// Inicialização
whatsappClient.initialize().catch(err => {
  console.error('\nErro na inicialização:', err);
  process.exit(1);
});
