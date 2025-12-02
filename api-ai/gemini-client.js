// gemini-client.js

// Importa e carrega variáveis de ambiente do arquivo .env automaticamente.
// Isso permite acessar valores como GEMINI_API_KEY via process.env.
import 'dotenv/config';

// Importa a classe principal da biblioteca oficial do Google Generative AI.
// Essa classe é usada para criar uma instância que se comunica com os modelos Gemini.
import { GoogleGenerativeAI } from '@google/generative-ai';

// Importa o gerenciador de arquivos do lado do servidor.
// Essa classe é usada para upload, download e gerenciamento de arquivos (imagens, áudios, vídeos, etc.)
// diretamente com a API Gemini.
import { GoogleAIFileManager } from '@google/generative-ai/server';

// Verifica se a variável de ambiente GEMINI_API_KEY foi definida.
// Caso contrário, lança um erro e interrompe a execução.
// Essa verificação garante que a API não tentará rodar sem uma chave válida.
if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY não definido');
}

// Cria uma instância principal do cliente da API Gemini, passando a chave da API.
// Essa instância (`genai`) será usada para interagir com os modelos generativos,
// como enviar prompts de texto, gerar imagens, realizar análises, etc.
export const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Cria uma instância do gerenciador de arquivos.
// Ela permite enviar arquivos (como imagens ou vídeos) para serem usados como entrada nos modelos Gemini,
// além de gerenciar os arquivos armazenados na nuvem do Google AI.
export const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
