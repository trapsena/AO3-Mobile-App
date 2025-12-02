// server.js

// Carrega automaticamente as variáveis de ambiente definidas no arquivo `.env`.
// Assim, valores como GEMINI_API_KEY e PORT ficam disponíveis via process.env.
import 'dotenv/config';

// Importa o framework Express, usado para criar e gerenciar rotas HTTP.
import express from 'express';

// Importa o middleware CORS, que permite que clientes (como o front-end) em domínios diferentes
// possam acessar este servidor sem bloqueio por política de mesma origem.
import cors from 'cors';

// Importa o multer, que é um middleware de upload de arquivos para o Express.
import multer from 'multer';

// Importa módulos nativos do Node.js para manipular caminhos e arquivos.
import path from 'node:path';
import fs from 'node:fs/promises';

// Importa as instâncias de conexão com a API Gemini e o gerenciador de arquivos.
// Essas instâncias vêm do módulo `gemini-client.js`.
import { genai, fileManager } from './gemini-client.js';

// Cria uma nova aplicação Express.
const app = express();

// Aplica o middleware CORS globalmente.
app.use(cors());

// Configura o Express para aceitar requisições JSON com tamanho de até 10 MB.
app.use(express.json({ limit: '10mb' }));

// ---------------------
// CONFIGURAÇÃO DE UPLOAD
// ---------------------

// O multer será responsável por receber arquivos enviados pelo cliente (ex: imagens).
const upload = multer({
  dest: 'uploads/', // Diretório temporário onde os arquivos serão armazenados.
  limits: { fileSize: 10 * 1024 * 1024 }, // Limite de 10 MB por arquivo.
  fileFilter(_req, file, cb) {
    // Permite apenas arquivos cujo MIME type começa com "image/"
    if ((file.mimetype || '').startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Envie uma imagem válida (png, jpeg, etc.)'));
    }
  },
});

// -----------------------------
// ROTA 1 — CHAT SOMENTE TEXTO
// -----------------------------

app.post('/chat', async (req, res) => {
  try {
    const { prompt } = req.body; // Recebe o texto enviado pelo cliente.

    // Validação: se o prompt estiver vazio, retorna erro 400.
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: 'Campo "prompt" é obrigatório' });
    }

    // Obtém o modelo Gemini "2.5-flash" (modelo rápido e versátil).
    const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Monta o conteúdo da requisição para o modelo.
    // O campo `contents` é um array de mensagens, onde cada item representa uma interação.
    const resp = await model.generateContent({
      contents: [
        {
          parts: [
            { text: prompt }, // O texto enviado pelo usuário.
          ],
          role: 'user', // Define o papel do remetente.
        },
      ],
    });

    // Extrai o texto da resposta gerada pelo modelo.
    const replyText = resp.response.text();

    // Retorna a resposta em formato JSON para o cliente.
    return res.json({ reply: replyText });
  } catch (err) {
    // Captura e exibe erros no console e retorna um status 500 ao cliente.
    console.error('Erro /chat:', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// -----------------------------------
// ROTA 2 — CHAT COM IMAGEM + TEXTO
// -----------------------------------

app.post('/chat-image', upload.single('image'), async (req, res) => {
  try {
    const { prompt } = req.body; // Texto opcional enviado junto com a imagem.

    // Validação: garante que uma imagem foi enviada.
    if (!req.file) {
      return res.status(400).json({ error: 'Campo "image" é obrigatório' });
    }

    // Caminho do arquivo temporário salvo pelo multer.
    const imgPath = path.resolve(req.file.path);

    // Lê o conteúdo do arquivo como buffer.
    const imgBuf = await fs.readFile(imgPath);

    // Captura o tipo MIME original da imagem (ex: image/png).
    const mimeType = req.file.mimetype;

    // Remove o arquivo temporário após a leitura (boa prática).
    await fs.unlink(imgPath).catch(() => { });

    // Converte a imagem para base64, formato aceito pela API Gemini para inlineData.
    const base64 = imgBuf.toString('base64');

    // Monta o conteúdo que será enviado ao modelo.
    // O `inlineData` é usado para enviar imagens diretamente no corpo da requisição.
    const contents = [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType, // Tipo da imagem (ex: image/jpeg)
              data: base64, // Conteúdo da imagem em base64
            },
          },
          {
            text: prompt || '', // Texto adicional opcional.
          },
        ],
        role: 'user', // O papel do remetente.
      },
    ];

    // Cria o modelo Gemini e envia o conteúdo.
    const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const resp = await model.generateContent({ contents });

    // Extrai o texto da resposta do modelo.
    const replyText = resp.response.text();

    // Retorna a resposta como JSON para o cliente.
    return res.json({ reply: replyText });
  } catch (err) {
    // Captura e trata possíveis erros.
    console.error('Erro /chat-image:', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// -----------------------------------
// CONFIGURAÇÃO DO SERVIDOR HTTP
// -----------------------------------

// Define a porta via variável de ambiente ou usa 3001 como padrão.
const port = process.env.PORT || 3001;

// Inicia o servidor e exibe mensagem no console.
app.listen(port, () => {
  console.log(`Backend rodando em http://localhost:${port}`);
});
