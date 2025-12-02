Com base nos arquivos fornecidos e nos requisitos detalhados, preparei o **README.md** completo para o seu projeto. Ele está formatado profissionalmente para ser colocado diretamente no seu repositório (GitHub/GitLab).

Aqui está o conteúdo do arquivo:

-----

# AO3 Mobile Reader (MVP)

Um leitor mobile nativo e não oficial para o **Archive of Our Own (AO3)**, focado em acessibilidade, personalização de leitura e integração com Text-to-Speech (TTS).

## 📋 Resumo do Projeto

### O Problema

O Archive of Our Own (AO3) é uma das maiores plataformas de fanfics do mundo, mas não possui um aplicativo móvel oficial. A leitura via navegador mobile, embora funcional, carece de recursos nativos de acessibilidade (como TTS robusto), personalização avançada de layout e uma experiência de usuário fluida fora do navegador.

### A Solução

Um aplicativo desenvolvido em **React Native (Expo)** que atua como um wrapper inteligente sobre o AO3. Ele extrai o conteúdo (HTML) das fanfics e o renderiza em uma interface nativa limpa, permitindo ajustes de fonte, espaçamento e leitura em voz alta via IA ou motor nativo.

### Público-Alvo

Leitores ávidos de fanfics que desejam uma experiência de leitura mais confortável (Eu mesmo :P).

### Escopo do MVP (Minimum Viable Product)

  * Login seguro (gerenciamento de sessão via cookies).
  * Visualização de capítulos com formatação customizável (fonte, tamanho, espaçamento).
  * Navegação entre capítulos.
  * Visualização de comentários e respostas aninhadas.
  * **Text-to-Speech (TTS):** Suporte a motor nativo e Google Cloud/Gemini.

-----

## 🏗 Arquitetura

O aplicativo funciona sem um backend intermediário ("Serverless" no contexto da aplicação). Ele se comunica diretamente com os servidores do AO3 via requisições HTTP e WebView, processando o HTML recebido diretamente no dispositivo do usuário.

### Diagrama de Fluxo de Dados

```
    User[Usuário] -->|Interage| App[App React Native]
    App -->|Auth/Fetch| AO3[Servidores AO3]
    AO3 -->|HTML Response| App
    App -->|Extração/Parsing| Parser[HTML Parser & Regex]
    Parser -->|Texto Limpo| ReaderUI[Interface de Leitura]
    Parser -->|Estrutura de Comentários| CommentDrawer[Gaveta de Comentários]
    ReaderUI -->|Texto| TTS[Motor TTS (Expo ou Google API)]
```

### Tecnologias Principais

  * **Frontend:** React Native (Expo SDK 50+), TypeScript.
  * **Navegação/Web:** `react-native-webview` (para injeção de scripts e extração de sessão).
  * **Armazenamento:** `AsyncStorage` (persistência de configurações).
  * **UI/Icons:** `lucide-react-native`, `@expo/vector-icons`.
  * **Áudio:** `expo-speech` (TTS local), `expo-av`.

-----

## 🚀 Execução Local

### Pré-requisitos

  * Node.js (LTS) instalado.
  * Gerenciador de pacotes (`npm`, `yarn` ou `pnpm`).
  * Dispositivo físico com **Expo Go** instalado ou Emulador (Android Studio/Xcode).

### Instalação

1.  Clone o repositório:

    ```bash
    git clone https://github.com/seu-usuario/ao3-reader.git
    cd ao3-reader
    ```

2.  Instale as dependências:

    ```bash
    npm install
    # ou
    yarn install
    ```

3.  Execute o projeto:

    ```bash
    npx expo start
    ```

-----

## 🤖 Inteligência Artificial (Text-to-Speech)

O projeto implementa uma interface para leitura em voz alta utilizando duas abordagens:

1.  **Expo Speech (Nativo):** Utiliza o motor de voz padrão do sistema operacional (gratuito e offline).
2.  **Google Cloud TTS / Gemini:** Integração implementada para vozes neurais de alta qualidade.

### Configuração da API de IA

Para utilizar as vozes neurais do Google ("Zephyr", "Puck", etc.), é necessário uma API Key.

1.  Obtenha uma chave em [Google AI Studio / Cloud Console](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com).
2.  No aplicativo, vá em **Configurações (ícone de engrenagem) \> Aba Voz (TTS) \> Selecione "Gemini TTS"**.
3.  Insira sua API Key no campo designado.

> **Nota sobre limitações:** A funcionalidade do Gemini/Google TTS foi implementada no código (`geminiTTS.ts`), porém, devido à necessidade de vincular um cartão de crédito para faturamento na Google Cloud Platform (mesmo na camada gratuita), os testes extensivos não foram realizados por questões financeiras. O código faz requisições para `texttospeech.googleapis.com`.

-----

## 🌐 Rotas e Backend

**Não existe um backend próprio.** O AO3 não possui uma API pública oficial.

  * **Método:** O aplicativo utiliza técnicas de *Web Scraping* ético e *Session Hijacking* (do bem) através de uma `WebView` oculta para autenticar o usuário e realizar requisições (`fetchWithSession`).
  * **Parsing:** O HTML retornado pelo AO3 é processado via Regex e manipulação de DOM dentro da WebView para transformar páginas web em objetos JSON utilizáveis pelo React Native (capítulos, comentários, metadados).

-----

## 🔐 Credenciais de Teste

O AO3 utiliza um sistema restrito de criação de contas baseado em **Convites**, o que impede a criação de usuários "fake" ou de teste para este repositório.

  * **Como testar:** Recomenda-se utilizar sua própria conta pessoal do AO3.
  * **Segurança:** Suas credenciais são enviadas diretamente para o formulário de login do AO3 dentro de uma WebView segura. O app armazena apenas o cookie de sessão localmente.

-----

## 🧪 Testes Manuais

Para verificar os fluxos principais do MVP:

1.  **Login:**
      * Inicie o app.
      * Insira usuário e senha do AO3.
      * Verifique se o redirecionamento ocorre para a Home com seu nome de usuário.
2.  **Leitura:**
      * O app carrega uma URL de Fanfic padrão (hardcoded para testes no MVP) ou navega via link.
      * O texto deve aparecer formatado.
      * Abra as configurações (engrenagem) e altere o tamanho da fonte. O texto deve reagir imediatamente.
3.  **Comentários:**
      * Clique no ícone de balão de fala.
      * Verifique se os comentários carregam e se as respostas (replies) estão indentadas corretamente.
4.  **TTS:**
      * Clique no ícone de fone de ouvido.
      * Dê "Play". O parágrafo atual deve ser destacado e o áudio deve começar (usando o motor nativo por padrão).

-----

## 🎨 Decisões de Design

  * **Inspiração:** A UI/UX foi fortemente inspirada no antigo aplicativo do **Fanfiction.net**. Apesar de abandonado, ele possuía uma excelente interface de leitura focada em contraste e simplicidade, algo que falta em leitores web modernos.
  * **Gestão de Estado:** Optou-se pelo uso de `useState` e `useEffect` locais combinados com passagem de props para manter a simplicidade do MVP, sem a sobrecarga de Redux ou Context API complexos neste estágio.
  * **WebView vs Native:** A decisão de usar uma "Hidden WebView" para extração de dados (`FanficReader.tsx`) foi necessária para lidar com o Cloudflare e a estrutura dinâmica do HTML do AO3, garantindo que os cookies de sessão fossem mantidos corretamente.

-----

## ⚠️ Limitações e Backlog (Roadmap)

Atualmente, o app é um MVP funcional com as seguintes limitações conhecidas que serão abordadas em versões futuras:

  * **Display de Perfis:** Ao clicar em um usuário, o perfil abre no navegador em vez de uma tela nativa.
  * **Blurb Group Works:** As caixas de informações (tags, resumo, stats) que aparecem nas listas de busca ainda não foram implementadas nativamente.
  * **Interação:** Não é possível postar comentários ou dar "Kudos" nativamente (apenas visualização).
  * **Modo Offline:** Implementar o download de fanfics (EPUB/HTML) para leitura sem internet.
  * **Busca:** Implementar uma interface nativa para os filtros de busca do AO3.

-----

## 📄 Licença

Este projeto é desenvolvido para fins educacionais e de portfólio.
Todo o conteúdo acessado pelo aplicativo pertence aos seus respectivos criadores e ao Archive of Our Own (OTW).

Icons by [Lucide](https://lucide.dev/).

