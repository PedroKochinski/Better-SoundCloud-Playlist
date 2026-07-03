async function activeSoundCloudTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id || !tab.url || !tab.url.startsWith("https://soundcloud.com/")) {
    return null;
  }
  return tab;
}

function extractClientId(value) {
  const text = String(value || "").trim();
  const patterns = [
    /(?:client_id|clientId|clientID)\s*[:=]\s*["']?([0-9A-Za-z]{32})/,
    /["'](?:client_id|clientId|clientID)["']\s*:\s*["']([0-9A-Za-z]{32})["']/,
    /client_id=([0-9A-Za-z]{32})/,
    /client_id%3D([0-9A-Za-z]{32})/i,
    /^([0-9A-Za-z]{32})$/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function extractAuth(value) {
  const text = String(value || "").trim();
  if (!text) {
    return { token: "", authHeader: "" };
  }
  const header = text.match(/(?:Authorization:\s*)?(OAuth|Bearer)\s+([A-Za-z0-9._-]+)/i);
  if (header) {
    return { token: header[2], authHeader: header[1] + " " + header[2] };
  }
  const queryToken = text.match(/oauth_token=([^&\s]+)/i);
  if (queryToken) {
    const token = decodeURIComponent(queryToken[1]);
    return { token, authHeader: "OAuth " + token };
  }
  return { token: text, authHeader: "" };
}

async function loadConfig() {
  const saved = await chrome.storage.local.get(["soundcloudManualClientId", "soundcloudManualToken", "soundcloudManualAuthHeader"]);
  document.getElementById("clientIdInput").value = saved.soundcloudManualClientId || "";
  document.getElementById("tokenInput").value = saved.soundcloudManualAuthHeader || saved.soundcloudManualToken || "";
  document.getElementById("configStatus").textContent = saved.soundcloudManualClientId ? "client_id manual salvo." : "Cole o client_id do Network para evitar buscas automaticas.";
}

async function saveConfig() {
  const status = document.getElementById("configStatus");
  const rawClientId = document.getElementById("clientIdInput").value;
  const rawToken = document.getElementById("tokenInput").value;
  const clientId = extractClientId(rawClientId);
  const auth = extractAuth(rawToken);

  if (rawClientId.trim() && !clientId) {
    status.textContent = "client_id invalido. Cole o valor de 32 letras/numeros ou a URL com client_id=...";
    return;
  }

  await chrome.storage.local.set({
    soundcloudManualClientId: clientId,
    soundcloudManualToken: auth.token,
    soundcloudManualAuthHeader: auth.authHeader
  });

  document.getElementById("clientIdInput").value = clientId;
  document.getElementById("tokenInput").value = auth.authHeader || auth.token;
  status.textContent = clientId ? "Configuracao salva. Agora recarregue a aba do SoundCloud." : "Configuracao limpa.";
}

async function clearConfig() {
  await chrome.storage.local.remove(["soundcloudManualClientId", "soundcloudManualToken", "soundcloudManualAuthHeader", "soundcloudClientId", "soundcloudClientIdAt"]);
  document.getElementById("clientIdInput").value = "";
  document.getElementById("tokenInput").value = "";
  document.getElementById("configStatus").textContent = "Configuracao limpa.";
}

async function refreshStatus() {
  const status = document.getElementById("status");
  const tab = await activeSoundCloudTab();
  if (!tab) {
    status.textContent = "Abra uma pagina do SoundCloud.";
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "bsc.selectionStatus" });
    status.textContent = response.selected + " selecionadas | " + response.visible + " visiveis | client_id " + (response.clientId ? "ok" : "nao encontrado");
  } catch (_error) {
    status.textContent = "Recarregue a pagina do SoundCloud para ativar a extensao.";
  }
}

document.getElementById("saveConfigBtn").addEventListener("click", saveConfig);
document.getElementById("clearConfigBtn").addEventListener("click", clearConfig);
document.getElementById("copyNativePayloadBtn").addEventListener("click", async () => {
  const status = document.getElementById("configStatus");
  const saved = await chrome.storage.local.get(["soundcloudLastNativePlaylistPayload"]);
  if (!saved.soundcloudLastNativePlaylistPayload || !saved.soundcloudLastNativePlaylistPayload.body) {
    status.textContent = "Nenhum payload nativo capturado ainda.";
    return;
  }
  await navigator.clipboard.writeText(saved.soundcloudLastNativePlaylistPayload.body);
  status.textContent = "Payload nativo copiado.";
});
document.getElementById("copyExtensionPayloadBtn").addEventListener("click", async () => {
  const status = document.getElementById("configStatus");
  const saved = await chrome.storage.local.get(["soundcloudLastExtensionPlaylistPayload"]);
  if (!saved.soundcloudLastExtensionPlaylistPayload || !saved.soundcloudLastExtensionPlaylistPayload.body) {
    status.textContent = "Nenhum payload da extensao salvo ainda.";
    return;
  }
  await navigator.clipboard.writeText(saved.soundcloudLastExtensionPlaylistPayload.body);
  status.textContent = "Payload da extensao copiado.";
});
document.getElementById("selectVisibleBtn").addEventListener("click", async () => {
  const tab = await activeSoundCloudTab();
  if (!tab) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "bsc.selectVisible" });
    refreshStatus();
  } catch (_error) {
    document.getElementById("status").textContent = "Recarregue a pagina do SoundCloud.";
  }
});

loadConfig();
refreshStatus();
