(function () {
  "use strict";

  const API_V2 = "https://api-v2.soundcloud.com";
  const selected = new Map();
  const pageFetchRequests = new Map();
  let scanTimer = null;
  let pageBridgePromise = null;
  let pageFetchId = 1;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function toast(message, keep) {
    const old = document.querySelector(".bsc-toast");
    if (old) {
      old.remove();
    }
    const box = document.createElement("div");
    box.className = "bsc-toast";
    box.textContent = message;
    document.body.appendChild(box);
    if (!keep) {
      setTimeout(() => box.remove(), 5200);
    }
    return box;
  }

  function fullUrl(href) {
    try {
      const url = new URL(href, location.origin);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_error) {
      return "";
    }
  }

  function isTrackUrl(url) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parsed.hostname !== "soundcloud.com" && !parsed.hostname.endsWith(".soundcloud.com")) {
        return false;
      }
      if (parts.length < 2 || parts[1] === "sets") {
        return false;
      }
      const blockedFirst = ["you", "discover", "stream", "search", "pages", "popular", "charts", "upload", "messages", "notifications", "settings", "sign-in", "sign-up"];
      const blockedSecond = ["sets", "albums", "tracks", "reposts", "likes", "comments"];
      return !blockedFirst.includes(parts[0]) && !blockedSecond.includes(parts[1]);
    } catch (_error) {
      return false;
    }
  }

  function cardForAnchor(anchor) {
    const selectors = [
      ".soundList__item",
      ".trackItem",
      ".searchItem",
      ".compactTrackList__item",
      ".systemPlaylistTrackList__item",
      ".sound",
      "li",
      "article"
    ];
    for (const selector of selectors) {
      const item = anchor.closest(selector);
      if (item) {
        return item;
      }
    }
    return anchor.parentElement;
  }

  function infoFromCard(card, anchor) {
    const url = fullUrl(anchor.getAttribute("href"));
    let title = (anchor.getAttribute("title") || anchor.textContent || "").trim();
    let artist = "";
    const artistLink = card.querySelector(".soundTitle__username, .userBadge__usernameLink, a[class*='username'], a[class*='user']");
    if (artistLink) {
      artist = (artistLink.textContent || "").trim();
    }
    if (!title) {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      artist = artist || parts[0] || "";
      title = parts[1] || url;
    }
    return { title, artist, url };
  }

  function addControls(card, info) {
    if (!card || !info.url || card.dataset.bscPlaylistEnhanced === "1") {
      return;
    }
    card.dataset.bscPlaylistEnhanced = "1";
    if (getComputedStyle(card).position === "static") {
      card.style.position = "relative";
    }

    const tools = document.createElement("label");
    tools.className = "bsc-card-tools";
    tools.dataset.url = info.url;
    tools.title = "Selecionar para playlist";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(info.url);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selected.set(info.url, info);
      } else {
        selected.delete(info.url);
      }
      syncSelection();
    });

    const label = document.createElement("span");
    label.textContent = "+ Playlist";

    tools.appendChild(checkbox);
    tools.appendChild(label);
    card.appendChild(tools);
  }

  function collectVisibleTracks() {
    const tracks = new Map();
    document.querySelectorAll("a[href]").forEach((anchor) => {
      const url = fullUrl(anchor.getAttribute("href"));
      if (!isTrackUrl(url)) {
        return;
      }
      const card = cardForAnchor(anchor);
      if (!card) {
        return;
      }
      const info = infoFromCard(card, anchor);
      if (!tracks.has(info.url)) {
        tracks.set(info.url, info);
      }
    });
    return Array.from(tracks.values());
  }

  function scan() {
    document.querySelectorAll("a[href]").forEach((anchor) => {
      const url = fullUrl(anchor.getAttribute("href"));
      if (!isTrackUrl(url)) {
        return;
      }
      const card = cardForAnchor(anchor);
      if (card) {
        addControls(card, infoFromCard(card, anchor));
      }
    });
    renderBar();
    syncSelection();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 300);
  }

  function syncSelection() {
    document.querySelectorAll(".bsc-card-tools").forEach((tools) => {
      const checkbox = tools.querySelector("input");
      if (checkbox) {
        checkbox.checked = selected.has(tools.dataset.url);
      }
    });

    const bar = document.querySelector(".bsc-floating");
    if (bar) {
      bar.style.display = selected.size ? "flex" : "none";
      const count = bar.querySelector("strong");
      if (count) {
        count.textContent = selected.size + " selecionadas";
      }
    }
  }

  function clearSelection() {
    selected.clear();
    syncSelection();
  }

  function clientIdFromText(text) {
    const patterns = [
      /(?:client_id|clientId|clientID)\s*[:=]\s*["']?([0-9A-Za-z]{32})/,
      /["'](?:client_id|clientId|clientID)["']\s*:\s*["']([0-9A-Za-z]{32})["']/,
      /client_id=([0-9A-Za-z]{32})/,
      /client_id%3D([0-9A-Za-z]{32})/i,
      /client_id%22%3A%22([0-9A-Za-z]{32})/i
    ];
    for (const pattern of patterns) {
      const match = String(text || "").match(pattern);
      if (match) {
        return match[1];
      }
    }
    return "";
  }

  function findPageClientId() {
    const saved = sessionStorage.getItem("bscSoundCloudClientId") || localStorage.getItem("bscSoundCloudClientId");
    if (/^[0-9A-Za-z]{32}$/.test(saved || "")) {
      return saved;
    }

    const entries = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .concat([location.href]);
    for (const name of entries) {
      const clientId = clientIdFromText(name);
      if (clientId) {
        sessionStorage.setItem("bscSoundCloudClientId", clientId);
        return clientId;
      }
    }

    const elements = document.querySelectorAll("script[src], link[href], a[href], img[src], source[src]");
    for (const element of elements) {
      const text = element.getAttribute("src") || element.getAttribute("href") || "";
      const clientId = clientIdFromText(text);
      if (clientId) {
        sessionStorage.setItem("bscSoundCloudClientId", clientId);
        return clientId;
      }
    }

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const value = localStorage.getItem(key) || "";
      const clientId = clientIdFromText(key + " " + value);
      if (clientId) {
        sessionStorage.setItem("bscSoundCloudClientId", clientId);
        return clientId;
      }
    }

    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      const value = sessionStorage.getItem(key) || "";
      const clientId = clientIdFromText(key + " " + value);
      if (clientId) {
        sessionStorage.setItem("bscSoundCloudClientId", clientId);
        return clientId;
      }
    }

    const htmlClientId = clientIdFromText(document.documentElement.innerHTML);
    if (htmlClientId) {
      sessionStorage.setItem("bscSoundCloudClientId", htmlClientId);
      return htmlClientId;
    }

    return "";
  }

  function appVersionFromText(text) {
    const match = String(text || "").match(/app_version=([0-9]+)/);
    return match ? match[1] : "";
  }

  function findPageAppVersion() {
    const saved = sessionStorage.getItem("bscSoundCloudAppVersion") || localStorage.getItem("bscSoundCloudAppVersion");
    if (/^[0-9]+$/.test(saved || "")) {
      return saved;
    }

    const entries = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .concat([location.href]);
    for (const name of entries) {
      const appVersion = appVersionFromText(name);
      if (appVersion) {
        sessionStorage.setItem("bscSoundCloudAppVersion", appVersion);
        return appVersion;
      }
    }

    return "1782999645";
  }

  function renderBar() {
    if (document.querySelector(".bsc-floating")) {
      return;
    }

    const bar = document.createElement("div");
    bar.className = "bsc-floating";

    const count = document.createElement("strong");
    count.textContent = "0 selecionadas";

    const create = document.createElement("button");
    create.type = "button";
    create.textContent = "Criar playlist";
    create.addEventListener("click", showCreateDialog);

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "Adicionar existente";
    add.addEventListener("click", showAddDialog);

    const selectVisible = document.createElement("button");
    selectVisible.type = "button";
    selectVisible.className = "secondary";
    selectVisible.textContent = "Selecionar visiveis";
    selectVisible.addEventListener("click", () => {
      collectVisibleTracks().forEach((track) => selected.set(track.url, track));
      syncSelection();
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "secondary";
    clear.textContent = "Limpar";
    clear.addEventListener("click", clearSelection);

    bar.appendChild(count);
    bar.appendChild(create);
    bar.appendChild(add);
    bar.appendChild(selectVisible);
    bar.appendChild(clear);
    document.body.appendChild(bar);
  }

  function closeDialog() {
    document.querySelector(".bsc-dialog")?.remove();
    document.querySelector(".bsc-dialog-backdrop")?.remove();
  }

  function makeDialog(title) {
    closeDialog();
    const backdrop = document.createElement("div");
    backdrop.className = "bsc-dialog-backdrop";
    backdrop.addEventListener("click", closeDialog);

    const dialog = document.createElement("div");
    dialog.className = "bsc-dialog";
    dialog.innerHTML = "<h3>" + escapeHtml(title) + "</h3>";
    document.body.appendChild(backdrop);
    document.body.appendChild(dialog);
    return dialog;
  }

  function showCaptchaDialog(captchaUrl) {
    return new Promise((resolve, reject) => {
      const dialog = makeDialog("Captcha SoundCloud");
      dialog.innerHTML += `
        <p>O SoundCloud pediu uma validacao DataDome antes de alterar a playlist.</p>
        <p><a href="${escapeHtml(captchaUrl)}" target="_blank" rel="noreferrer">Abrir captcha</a></p>
        <div class="bsc-dialog-actions">
          <button class="secondary" id="bsc-captcha-cancel" type="button">Cancelar</button>
          <button id="bsc-captcha-done" type="button">Ja resolvi</button>
        </div>
        <div class="bsc-dialog-result">Resolva o captcha na aba aberta e depois clique em "Ja resolvi".</div>
      `;

      const popup = window.open(captchaUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        dialog.querySelector(".bsc-dialog-result").textContent = "O navegador bloqueou a aba. Use o link acima para abrir o captcha.";
      }

      dialog.querySelector("#bsc-captcha-cancel").addEventListener("click", () => {
        closeDialog();
        reject(new Error("Captcha cancelado."));
      });
      dialog.querySelector("#bsc-captcha-done").addEventListener("click", () => {
        closeDialog();
        resolve();
      });
    });
  }

  function selectedTracks() {
    return Array.from(selected.values());
  }

  function sendToBackground(message) {
    return chrome.runtime.sendMessage(message).then((response) => {
      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : "Erro no background da extensao.");
      }
      return response.data;
    });
  }

  function query(params) {
    return new URLSearchParams(params).toString();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function trackKey(id) {
    return String(id || "")
      .replace(/^soundcloud:tracks:/, "")
      .replace(/^soundcloud%3Atracks%3A/i, "");
  }

  function trackUrn(id) {
    const value = String(id || "");
    if (value.startsWith("soundcloud:tracks:")) {
      return value;
    }
    return "soundcloud:tracks:" + trackKey(value);
  }

  function ensurePageBridge() {
    if (pageBridgePromise) {
      return pageBridgePromise;
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) {
        return;
      }
      if (event.data.source === "bsc-native-playlist-payload") {
        chrome.storage.local.set({
          soundcloudLastNativePlaylistPayload: {
            method: event.data.method,
            url: event.data.url,
            status: event.data.status,
            body: event.data.body,
            savedAt: new Date().toISOString()
          }
        });
        return;
      }
      if (event.data.source !== "bsc-page-fetch-result") {
        return;
      }
      const pending = pageFetchRequests.get(event.data.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pageFetchRequests.delete(event.data.id);
      if (event.data.error) {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve(event.data);
      }
    });

    pageBridgePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("page_bridge.js");
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("Nao consegui carregar o bridge da extensao na pagina."));
      };
      (document.head || document.documentElement).appendChild(script);
    });

    return pageBridgePromise;
  }

  async function pageFetch(url, options) {
    await ensurePageBridge();
    const id = pageFetchId;
    pageFetchId += 1;
    const method = options && options.method ? options.method : "GET";
    const authorization = options && options.authorization ? options.authorization : "";
    const clientId = options && options.clientId ? options.clientId : "";
    const body = options && options.body ? options.body : null;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pageFetchRequests.delete(id);
        reject(new Error("Timeout chamando API do SoundCloud."));
      }, 45000);
      pageFetchRequests.set(id, { resolve, reject, timeout });
      window.postMessage({
        source: "bsc-page-fetch",
        id,
        url,
        method,
        authorization,
        clientId,
        body
      }, "*");
    });
  }

  async function soundcloudPageFetch(url, options) {
    try {
      return await soundcloudPageFetchOnce(url, options || {});
    } catch (error) {
      if (error.captchaUrl && (!options || options.captchaRetry !== false)) {
        await showCaptchaDialog(error.captchaUrl);
        await delay(1500);
        return await soundcloudPageFetchOnce(url, { ...(options || {}), captchaRetry: false });
      }
      throw error;
    }
  }

  async function soundcloudPageFetchOnce(url, options) {
    const response = await pageFetch(url, options || {});
    let data = {};
    if (response.text) {
      try {
        data = JSON.parse(response.text);
      } catch (_error) {
        data = { raw: response.text };
      }
    }
    if (!response.ok) {
      if (response.bodySent) {
        chrome.storage.local.set({
          soundcloudLastExtensionPlaylistPayload: {
            method: response.method,
            url: response.url,
            status: response.status,
            body: response.bodySent,
            savedAt: new Date().toISOString()
          }
        });
      }
      if (data.url && String(data.url).includes("captcha-delivery.com")) {
        const captchaError = new Error("Captcha DataDome necessario para continuar.");
        captchaError.captchaUrl = data.url;
        captchaError.status = response.status;
        throw captchaError;
      }
      let endpoint = url;
      try {
        const parsed = new URL(url);
        endpoint = response.method + " " + parsed.hostname + parsed.pathname;
      } catch (_error) {
        endpoint = response.method + " " + url;
      }
      const detail = data.error_description || data.message || data.error || data.raw || "";
      throw new Error("HTTP " + response.status + " em " + endpoint + (detail ? ": " + detail : ""));
    }
    return data;
  }

  async function soundcloudConfig() {
    const saved = await chrome.storage.local.get(["soundcloudManualClientId", "soundcloudManualToken", "soundcloudManualAuthHeader"]);
    const clientId = saved.soundcloudManualClientId || findPageClientId();
    if (!/^[0-9A-Za-z]{32}$/.test(clientId || "")) {
      throw new Error("Configure um client_id valido no popup da extensao.");
    }

    let authorization = "";
    if (saved.soundcloudManualAuthHeader) {
      authorization = saved.soundcloudManualAuthHeader;
    } else if (saved.soundcloudManualToken) {
      authorization = "OAuth " + saved.soundcloudManualToken;
    }

    return {
      clientId,
      authorization,
      appVersion: findPageAppVersion(),
      appLocale: "pt_BR"
    };
  }

  function apiV2Query(config, extra) {
    return query({
      client_id: config.clientId,
      app_version: config.appVersion,
      app_locale: config.appLocale,
      ...extra
    });
  }

  async function collectPageCollection(firstUrl, clientId, authorization) {
    const items = [];
    let url = firstUrl;
    let pages = 0;

    while (url && pages < 100) {
      const data = await soundcloudPageFetch(url, { clientId, authorization });
      if (Array.isArray(data)) {
        items.push(...data);
        break;
      }
      if (Array.isArray(data.collection)) {
        items.push(...data.collection);
      }
      url = data.next_href || "";
      pages += 1;
    }

    return items;
  }

  async function resolveTracksInPage(tracks, clientId, authorization) {
    const resolved = [];
    const failed = [];
    const seen = new Set();

    for (const track of tracks) {
      try {
        if (track.id && !seen.has(trackKey(track.id))) {
          seen.add(trackKey(track.id));
          resolved.push({
            id: track.id,
            urn: track.urn || trackUrn(track.id),
            title: track.title || "",
            artist: track.artist || "",
            url: track.url || ""
          });
          continue;
        }

        const url = API_V2 + "/resolve?" + query({ url: track.url, client_id: clientId });
        const data = await soundcloudPageFetch(url, { clientId, authorization });
        const id = data.id;
        if (!id || seen.has(trackKey(id))) {
          continue;
        }
        seen.add(trackKey(id));
        resolved.push({
          id,
          urn: data.urn || trackUrn(id),
          title: data.title || track.title || "",
          artist: data.user && data.user.username ? data.user.username : track.artist || "",
          url: data.permalink_url || track.url || ""
        });
      } catch (error) {
        failed.push({
          title: track.title || "",
          artist: track.artist || "",
          url: track.url || "",
          error: error.message
        });
      }
    }

    return { resolved, failed };
  }

  async function getOwnPlaylistsInPage() {
    const config = await soundcloudConfig();
    const url = API_V2 + "/me/library/all?" + apiV2Query(config, {
      limit: "200",
      offset: "0",
      linked_partitioning: "1"
    });
    const items = await collectPageCollection(url, config.clientId, config.authorization);
    const playlists = [];
    const seen = new Set();

    for (const item of items) {
      if (!item || item.type !== "playlist" || !item.playlist || !item.playlist.id) {
        continue;
      }
      if (seen.has(String(item.playlist.id))) {
        continue;
      }
      seen.add(String(item.playlist.id));
      playlists.push(item.playlist);
    }

    return playlists.map((playlist) => ({
      id: playlist.id,
      title: playlist.title || "",
      sharing: playlist.sharing || "",
      track_count: playlist.track_count || 0,
      url: playlist.permalink_url || ""
    }));
  }

  async function createPlaylistInPage(title, sharing, tracks) {
    const config = await soundcloudConfig();
    const { resolved, failed } = await resolveTracksInPage(tracks, config.clientId, config.authorization);
    if (!resolved.length) {
      return { added: 0, already_exists: 0, failed, not_processed: 0, playlist: null };
    }

    const body = {
      playlist: {
        title,
        sharing,
        tracks: resolved.map((track) => Number(trackKey(track.id)))
      }
    };

    const playlist = await soundcloudPageFetch(API_V2 + "/playlists?" + apiV2Query(config, {}), {
      method: "POST",
      clientId: config.clientId,
      authorization: config.authorization,
      body
    });
    return {
      playlist: {
        id: playlist.id,
        title: playlist.title || title,
        url: playlist.permalink_url || ""
      },
      added: resolved.length,
      already_exists: 0,
      failed,
      not_processed: 0
    };
  }

  async function addToPlaylistInPage(playlistId, tracks) {
    const config = await soundcloudConfig();
    const playlist = await soundcloudPageFetch(API_V2 + "/playlists/" + playlistId + "?" + apiV2Query(config, {
      representation: "full"
    }), { clientId: config.clientId, authorization: config.authorization });

    const existingIds = [];
    for (const track of playlist.tracks || []) {
      if (track && track.id) {
        existingIds.push(trackKey(track.id));
      }
    }

    const { resolved, failed } = await resolveTracksInPage(tracks, config.clientId, config.authorization);
    const existingSet = new Set(existingIds.map((id) => trackKey(id)));
    const newIds = [];
    for (const track of resolved) {
      if (!existingSet.has(trackKey(track.id))) {
        newIds.push(trackKey(track.id));
        existingSet.add(trackKey(track.id));
      }
    }

    if (!newIds.length) {
      return {
        added: 0,
        already_exists: resolved.length,
        failed,
        not_processed: 0
      };
    }

    const allIds = existingIds.concat(newIds);

    const payloads = [
      {
        label: "API v2 playlist.tracks number array",
        body: { playlist: { tracks: allIds.map((id) => Number(trackKey(id))) } }
      },
      {
        label: "API v2 playlist.tracks string array",
        body: { playlist: { tracks: allIds.map((id) => String(trackKey(id))) } }
      },
      {
        label: "API v2 playlist.tracks string id object",
        body: { playlist: { tracks: allIds.map((id) => ({ id: String(trackKey(id)) })) } }
      }
    ];

    const errors = [];
    for (const payload of payloads) {
      try {
        await soundcloudPageFetch(API_V2 + "/playlists/" + playlistId + "?" + apiV2Query(config, {}), {
          method: "PUT",
          clientId: config.clientId,
          authorization: config.authorization,
          body: payload.body
        });
        return {
          added: newIds.length,
          already_exists: resolved.length - newIds.length,
          failed,
          not_processed: 0
        };
      } catch (error) {
        errors.push(payload.label + ": " + error.message);
      }
    }

    try {
      await sendToBackground({
        type: "bsc.updatePlaylistTracks",
        playlistId,
        clientId: config.clientId,
        token: config.authorization,
        trackIds: allIds
      });
    } catch (backgroundError) {
      errors.push("Fallback background: " + backgroundError.message);
      throw new Error(errors.join("\n"));
    }

    return {
      added: newIds.length,
      already_exists: resolved.length - newIds.length,
      failed,
      not_processed: 0
    };
  }

  async function showCreateDialog() {
    if (!selected.size) {
      toast("Selecione pelo menos uma faixa.");
      return;
    }

    const dialog = makeDialog("Criar playlist");
    dialog.innerHTML += `
      <label>Nome da playlist</label>
      <input id="bsc-create-title" type="text" placeholder="Minha playlist">
      <label>Privacidade</label>
      <select id="bsc-create-sharing">
        <option value="private">Privada</option>
        <option value="public">Publica</option>
      </select>
      <div class="bsc-dialog-actions">
        <button class="secondary" id="bsc-create-cancel" type="button">Cancelar</button>
        <button id="bsc-create-submit" type="button">Criar</button>
      </div>
      <div class="bsc-dialog-result"></div>
    `;

    dialog.querySelector("#bsc-create-cancel").addEventListener("click", closeDialog);
    dialog.querySelector("#bsc-create-submit").addEventListener("click", async () => {
      const title = dialog.querySelector("#bsc-create-title").value.trim();
      const sharing = dialog.querySelector("#bsc-create-sharing").value;
      const resultBox = dialog.querySelector(".bsc-dialog-result");
      if (!title) {
        resultBox.textContent = "Informe o nome da playlist.";
        return;
      }
      resultBox.textContent = "Criando playlist...";
      try {
        const result = await createPlaylistInPage(title, sharing, selectedTracks());
        resultBox.textContent =
          "Adicionadas: " + result.added +
          "\nJa existentes: " + result.already_exists +
          "\nFalhas: " + result.failed.length +
          "\nNao processadas: " + result.not_processed +
          (result.playlist && result.playlist.url ? "\n" + result.playlist.url : "");
      } catch (error) {
        resultBox.textContent = error.message + "\n\nSe isso falhar por token/API, use o botao Adicionar existente ou crie a playlist vazia no SoundCloud e tente adicionar nela.";
      }
    });
  }

  async function showAddDialog() {
    if (!selected.size) {
      toast("Selecione pelo menos uma faixa.");
      return;
    }

    const dialog = makeDialog("Adicionar a playlist");
    dialog.innerHTML += `
      <label>Playlist</label>
      <select id="bsc-playlist-select">
        <option value="">Carregando...</option>
      </select>
      <div class="bsc-dialog-actions">
        <button class="secondary" id="bsc-add-cancel" type="button">Cancelar</button>
        <button id="bsc-add-submit" type="button">Adicionar</button>
      </div>
      <div class="bsc-dialog-result"></div>
    `;

    const select = dialog.querySelector("#bsc-playlist-select");
    const resultBox = dialog.querySelector(".bsc-dialog-result");
    dialog.querySelector("#bsc-add-cancel").addEventListener("click", closeDialog);

    try {
      const playlists = await getOwnPlaylistsInPage();
      if (!playlists.length) {
        select.innerHTML = '<option value="">Nenhuma playlist encontrada</option>';
      } else {
        select.innerHTML = playlists
          .map((playlist) => '<option value="' + escapeHtml(playlist.id) + '">' + escapeHtml(playlist.title) + " (" + playlist.track_count + ")</option>")
          .join("");
      }
    } catch (error) {
      select.innerHTML = '<option value="">Erro ao carregar</option>';
      resultBox.textContent = error.message;
    }

    dialog.querySelector("#bsc-add-submit").addEventListener("click", async () => {
      const playlistId = select.value;
      if (!playlistId) {
        resultBox.textContent = "Escolha uma playlist.";
        return;
      }
      resultBox.textContent = "Adicionando faixas...";
      try {
        const result = await addToPlaylistInPage(playlistId, selectedTracks());
        resultBox.textContent =
          "Adicionadas: " + result.added +
          "\nJa existentes: " + result.already_exists +
          "\nFalhas: " + result.failed.length +
          "\nNao processadas: " + result.not_processed;
      } catch (error) {
        resultBox.textContent = error.message;
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "bsc.selectionStatus") {
      sendResponse({
        selected: selected.size,
        visible: collectVisibleTracks().length,
        clientId: findPageClientId(),
        url: location.href
      });
      return false;
    }
    if (message.type === "bsc.selectVisible") {
      collectVisibleTracks().forEach((track) => selected.set(track.url, track));
      syncSelection();
      sendResponse({ selected: selected.size });
      return false;
    }
    return false;
  });

  scan();
  ensurePageBridge().catch(() => {});
  setInterval(scan, 3000);
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
})();
