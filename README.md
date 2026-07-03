# Better SoundCloud Playlist

Extensao local para Chrome/Chromium que permite selecionar varias musicas no SoundCloud e adicionar todas de uma vez a uma playlist.

## O que faz

- Adiciona um checkbox `+ Playlist` nas faixas do SoundCloud.
- Permite selecionar varias faixas em paginas de busca, playlists, likes, artista e listas comuns.
- Mostra uma barra flutuante com:
  - `Criar playlist`;
  - `Adicionar existente`;
  - `Selecionar visiveis`;
  - `Limpar`.
- Lista suas playlists usando a sessao logada do SoundCloud.
- Evita duplicatas quando consegue carregar as faixas da playlist.
- Usa o fluxo web do proprio SoundCloud, sem pedir sua senha.

## Instalar

1. Abra `chrome://extensions`.
2. Ative `Modo do desenvolvedor`.
3. Clique em `Carregar sem compactacao`.
4. Selecione esta pasta do projeto.
5. Abra `https://soundcloud.com`.
6. Faca login e recarregue a pagina.

## Configurar

Abra o popup da extensao e cole o `client_id` do SoundCloud.

Para obter:

1. Abra DevTools no SoundCloud.
2. Va em `Network`.
3. Filtre por `api-v2.soundcloud.com`.
4. Abra uma request com status `200`.
5. Copie o valor de `client_id` na URL.
6. Cole no popup e clique em `Salvar`.

Se necessario, cole tambem o header inteiro:

```text
Authorization: OAuth ...
```

## Usar

1. Marque as faixas com `+ Playlist`.
2. Clique em `Adicionar existente` para escolher uma playlist sua.
3. Ou clique em `Criar playlist` para criar uma nova playlist.

Quando o SoundCloud pedir DataDome/CAPTCHA, a extensao abre a pagina de validacao. Resolva manualmente e clique em `Ja resolvi` para tentar a request novamente.

## Payload nativo

Para adicionar faixas, o SoundCloud usa:

```json
{
  "playlist": {
    "tracks": [1336719547, 1632738219]
  }
}
```

A extensao replica esse formato no endpoint:

```text
PUT https://api-v2.soundcloud.com/playlists/{playlist_id}
```

## Debug

O popup tem botoes para copiar:

- `Payload nativo`: ultimo request body bem-sucedido capturado do SoundCloud.
- `Payload da extensao`: ultimo request body enviado pela extensao.

Esses botoes copiam apenas o corpo da request, sem `Authorization`, cookies ou headers.

## Arquivos

```text
manifest.json      manifest MV3
content.js         UI injetada no SoundCloud
content.css        estilos da UI injetada
page_bridge.js     bridge para executar fetch no contexto soundcloud.com
background.js      fallback e armazenamento local
popup.html         popup da extensao
popup.css          estilos do popup
popup.js           configuracao e acoes do popup
```

## Limites

Esta extensao depende dos endpoints internos atuais do SoundCloud. Se o SoundCloud mudar a API web, selecao visual pode continuar funcionando, mas criacao/adicao de playlist pode precisar de ajuste.
