const API_V2 = "https://api-v2.soundcloud.com";
const API_V1 = "https://api.soundcloud.com";

async function getCookieToken() {
  const urls = ["https://soundcloud.com/", "https://api-v2.soundcloud.com/", "https://api.soundcloud.com/"];
  for (const url of urls) {
    try {
      const cookie = await chrome.cookies.get({ url, name: "oauth_token" });
      if (cookie && cookie.value) {
        return cookie.value;
      }
    } catch (_error) {
      // Keep trying the other domains.
    }
  }
  return "";
}

async function getManualConfig() {
  return await chrome.storage.local.get(["soundcloudManualClientId", "soundcloudManualToken", "soundcloudManualAuthHeader"]);
}

async function getClientId(knownClientId) {
  const manual = await getManualConfig();
  if (manual.soundcloudManualClientId) {
    if (/^[0-9A-Za-z]{32}$/.test(manual.soundcloudManualClientId)) {
      return manual.soundcloudManualClientId;
    }
    throw new Error("client_id manual invalido. Ele deve ter 32 letras/numeros.");
  }

  if (/^[0-9A-Za-z]{32}$/.test(knownClientId || "")) {
    await chrome.storage.local.set({ soundcloudClientId: knownClientId, soundcloudClientIdAt: Date.now() });
    return knownClientId;
  }

  const saved = await chrome.storage.local.get(["soundcloudClientId", "soundcloudClientIdAt"]);
  if (saved.soundcloudClientId && saved.soundcloudClientIdAt && Date.now() - saved.soundcloudClientIdAt < 24 * 60 * 60 * 1000) {
    return saved.soundcloudClientId;
  }

  throw new Error("Configure o client_id no popup da extensao ou recarregue uma pagina do SoundCloud que ja tenha carregado musicas.");
}

async function getAuthorization(knownToken) {
  const manual = await getManualConfig();
  if (manual.soundcloudManualAuthHeader) {
    return manual.soundcloudManualAuthHeader;
  }
  if (manual.soundcloudManualToken) {
    return "OAuth " + manual.soundcloudManualToken;
  }

  const cookieToken = await getCookieToken();
  if (cookieToken) {
    return "OAuth " + cookieToken;
  }

  if (knownToken) {
    if (/^(OAuth|Bearer)\s+/i.test(knownToken)) {
      return knownToken;
    }
    return "OAuth " + knownToken;
  }

  return "";
}

function query(params) {
  return new URLSearchParams(params).toString();
}

async function soundcloudFetch(url, options) {
  const authorization = options.authorization || (options.token ? "OAuth " + options.token : "");
  const init = {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json",
      "Device-Locale": "pt-BR"
    }
  };
  if (options.clientId) {
    init.headers["X-Client-Id"] = options.clientId;
  }
  if (authorization) {
    init.headers.Authorization = authorization;
  }
  if (options.body) {
    init.body = JSON.stringify(options.body);
  }

  let response = await fetch(url, init);
  let text = await response.text();

  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    let endpoint = url;
    try {
      const parsed = new URL(url);
      endpoint = init.method + " " + parsed.hostname + parsed.pathname;
    } catch (_error) {
      endpoint = init.method + " " + url;
    }
    const detail = data.error_description || data.message || data.error || data.raw || "";
    throw new Error("HTTP " + response.status + " em " + endpoint + (detail ? ": " + detail : ""));
  }
  return data;
}

async function collectCollection(firstUrl, authorization) {
  const items = [];
  let url = firstUrl;
  let pages = 0;

  while (url && pages < 100) {
    const data = await soundcloudFetch(url, { authorization });
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

async function resolveTracks(tracks, clientId, authorization) {
  const resolved = [];
  const failed = [];
  const seen = new Set();

  for (const track of tracks) {
    try {
      if (track.id && !seen.has(Number(track.id))) {
        seen.add(Number(track.id));
        resolved.push({
          id: Number(track.id),
          title: track.title || "",
          artist: track.artist || "",
          url: track.url || ""
        });
        continue;
      }

      const url = API_V2 + "/resolve?" + query({ url: track.url, client_id: clientId });
      const data = await soundcloudFetch(url, { authorization });
      const id = Number(data.id);
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      resolved.push({
        id,
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

async function getOwnPlaylists(clientId, authorization) {
  let items = [];
  try {
    const url = API_V2 + "/me/playlists?" + query({
      client_id: clientId,
      limit: "200",
      linked_partitioning: "1",
      representation: "compact"
    });
    items = await collectCollection(url, authorization);
  } catch (_firstError) {
    const url = API_V1 + "/me/playlists?" + query({
      client_id: clientId,
      limit: "200",
      linked_partitioning: "true",
      show_tracks: "false"
    });
    items = await collectCollection(url, authorization);
  }
  return items.map((playlist) => ({
    id: playlist.id,
    title: playlist.title || "",
    sharing: playlist.sharing || "",
    track_count: playlist.track_count || 0,
    url: playlist.permalink_url || ""
  }));
}

async function createPlaylist(message) {
  const clientId = await getClientId(message.clientId);
  const authorization = await getAuthorization(message.token);
  if (!authorization) {
    throw new Error("Nao encontrei token da sua sessao. Abra o SoundCloud, faca login e recarregue a pagina.");
  }

  const { resolved, failed } = await resolveTracks(message.tracks || [], clientId, authorization);
  if (!resolved.length) {
    return { added: 0, already_exists: 0, failed, not_processed: 0, playlist: null };
  }

  const body = {
    playlist: {
      title: message.title,
      sharing: message.sharing || "private",
      tracks: resolved.map((track) => ({ id: track.id }))
    }
  };

  let playlist;
  try {
    playlist = await soundcloudFetch(API_V1 + "/playlists?" + query({ client_id: clientId }), {
      method: "POST",
      authorization,
      body
    });
  } catch (_firstError) {
    playlist = await soundcloudFetch(API_V2 + "/playlists?" + query({ client_id: clientId }), {
      method: "POST",
      authorization,
      body
    });
  }

  return {
    playlist: {
      id: playlist.id,
      title: playlist.title || message.title,
      url: playlist.permalink_url || ""
    },
    added: resolved.length,
    already_exists: 0,
    failed,
    not_processed: 0
  };
}

async function addToPlaylist(message) {
  const clientId = await getClientId(message.clientId);
  const authorization = await getAuthorization(message.token);
  if (!authorization) {
    throw new Error("Nao encontrei token da sua sessao. Abra o SoundCloud, faca login e recarregue a pagina.");
  }

  const playlistId = String(message.playlistId || "");
  if (!playlistId) {
    throw new Error("Escolha uma playlist.");
  }

  const playlist = await soundcloudFetch(API_V2 + "/playlists/" + playlistId + "?" + query({
    client_id: clientId,
    representation: "full"
  }), { authorization });

  const existingIds = [];
  for (const track of playlist.tracks || []) {
    if (track && track.id) {
      existingIds.push(Number(track.id));
    }
  }

  const { resolved, failed } = await resolveTracks(message.tracks || [], clientId, authorization);
  const existingSet = new Set(existingIds);
  const newIds = [];
  for (const track of resolved) {
    if (!existingSet.has(track.id)) {
      newIds.push(track.id);
      existingSet.add(track.id);
    }
  }

  if (newIds.length) {
    const body = {
      playlist: {
        tracks: existingIds.concat(newIds).map((id) => ({ id }))
      }
    };
    try {
      await soundcloudFetch(API_V1 + "/playlists/" + playlistId + "?" + query({ client_id: clientId }), {
        method: "PUT",
        authorization,
        body
      });
    } catch (_firstError) {
      await soundcloudFetch(API_V2 + "/playlists/" + playlistId + "?" + query({ client_id: clientId }), {
        method: "PUT",
        authorization,
        body
      });
    }
  }

  return {
    added: newIds.length,
    already_exists: resolved.length - newIds.length,
    failed,
    not_processed: 0
  };
}

async function updatePlaylistTracks(message) {
  const clientId = await getClientId(message.clientId);
  const authorization = await getAuthorization(message.token);
  const playlistId = String(message.playlistId || "");
  const trackIds = Array.isArray(message.trackIds) ? message.trackIds : [];

  if (!authorization) {
    throw new Error("Nao encontrei token da sua sessao.");
  }
  if (!playlistId) {
    throw new Error("playlistId obrigatorio.");
  }
  if (!trackIds.length) {
    throw new Error("Nenhuma faixa para salvar.");
  }

  const body = {
    playlist: {
      tracks: trackIds.map((id) => Number(String(id).replace(/^soundcloud:tracks:/, "")))
    }
  };

  const errors = [];
  const attempts = [
    { method: "PUT", url: API_V1 + "/playlists/" + playlistId + "?" + query({ client_id: clientId }) },
    { method: "PATCH", url: API_V1 + "/playlists/" + playlistId + "?" + query({ client_id: clientId }) },
    { method: "PUT", url: API_V2 + "/playlists/" + playlistId + "?" + query({ client_id: clientId }) }
  ];

  for (const attempt of attempts) {
    try {
      await soundcloudFetch(attempt.url, {
        method: attempt.method,
        clientId,
        authorization,
        body
      });
      return {
        ok: true,
        endpoint: attempt.method + " " + new URL(attempt.url).hostname + new URL(attempt.url).pathname
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.join("\n"));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "bsc.status") {
      const authorization = await getAuthorization(message.token);
      const clientId = await getClientId(message.clientId);
      return { ok: true, hasToken: Boolean(authorization), clientId };
    }

    if (message.type === "bsc.playlists") {
      const authorization = await getAuthorization(message.token);
      const clientId = await getClientId(message.clientId);
      if (!authorization) {
        throw new Error("Nao encontrei token da sua sessao.");
      }
      return { playlists: await getOwnPlaylists(clientId, authorization) };
    }

    if (message.type === "bsc.createPlaylist") {
      return await createPlaylist(message);
    }

    if (message.type === "bsc.addToPlaylist") {
      return await addToPlaylist(message);
    }

    if (message.type === "bsc.updatePlaylistTracks") {
      return await updatePlaylistTracks(message);
    }

    throw new Error("Mensagem desconhecida.");
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
