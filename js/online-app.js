"use strict";

(() => {
  const config = window.BINGO_ONLINE_CONFIG || {};
  const supabaseFactory = window.supabase;
  const RECONNECT_SECONDS = 45;
  const HEARTBEAT_MS = 15_000;
  const STORAGE_KEY = "bingo-reversible-online-room";

  const ui = {
    createForm: document.querySelector("#createRoomForm"),
    joinForm: document.querySelector("#joinRoomForm"),
    joinCode: document.querySelector("#joinRoomCode"),
    message: document.querySelector("#onlineMessage"),
    connectionBadge: document.querySelector("#connectionBadge"),
    connectionDetail: document.querySelector("#connectionDetail"),
    roomPanel: document.querySelector("#roomPanel"),
    roomCode: document.querySelector("#roomCodeDisplay"),
    roomMembers: document.querySelector("#roomMembers"),
    copyInvite: document.querySelector("#copyInviteButton"),
    ready: document.querySelector("#readyButton")
  };

  let client = null;
  let currentUser = null;
  let currentRoom = null;
  let currentSeat = null;
  let channel = null;
  let heartbeatId = null;

  function configured() {
    return Boolean(
      config.supabaseUrl
      && config.supabasePublishableKey
      && supabaseFactory?.createClient
    );
  }

  function setFormsDisabled(disabled) {
    document.querySelectorAll("#createRoomForm input, #createRoomForm select, #createRoomForm button, #joinRoomForm input, #joinRoomForm button")
      .forEach(element => { element.disabled = disabled; });
  }

  function setMessage(text = "", type = "") {
    ui.message.textContent = text;
    ui.message.className = `online-message${type ? ` ${type}` : ""}`;
  }

  function setConnection(text, state = "") {
    ui.connectionBadge.textContent = text;
    ui.connectionBadge.className = `connection-badge${state ? ` ${state}` : ""}`;
  }

  function normalizeCode(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function rpcRow(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }

  function roomStorage() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveRoomStorage(room) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      roomId: room.id,
      code: room.code,
      seat: currentSeat
    }));
  }

  function clearRoomStorage() {
    localStorage.removeItem(STORAGE_KEY);
  }

  async function ensureAnonymousSession() {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;

    if (sessionData.session?.user) return sessionData.session.user;

    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    return data.user;
  }

  async function createRoom(event) {
    event.preventDefault();
    if (!client) return;
    setMessage("Création du salon…");
    setFormsDisabled(true);

    try {
      const { data, error } = await client.rpc("create_online_room", {
        p_series_length: Number(document.querySelector("#createSeriesLength").value),
        p_timers_enabled: document.querySelector("#createTimersEnabled").checked,
        p_debug_enabled: document.querySelector("#createDebugEnabled").checked
      });
      if (error) throw error;
      const result = rpcRow(data);
      if (!result?.room_id) throw new Error("Le serveur n’a pas renvoyé le salon créé.");
      currentSeat = Number(result.seat) || 1;
      await openRoom(result.room_id);
      setMessage("Salon créé. Partagez le code ou le lien.", "success");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Impossible de créer le salon.", "error");
      setFormsDisabled(false);
    }
  }

  async function joinRoom(event) {
    event?.preventDefault();
    if (!client) return;
    const code = normalizeCode(ui.joinCode.value);
    ui.joinCode.value = code;
    if (code.length !== 6) {
      setMessage("Le code doit contenir 6 caractères.", "error");
      return;
    }

    setMessage("Connexion au salon…");
    setFormsDisabled(true);

    try {
      const { data, error } = await client.rpc("join_online_room", { p_code: code });
      if (error) throw error;
      const result = rpcRow(data);
      if (!result?.room_id) throw new Error("Salon introuvable ou déjà complet.");
      currentSeat = Number(result.seat) || 2;
      await openRoom(result.room_id);
      setMessage("Salon rejoint.", "success");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Impossible de rejoindre ce salon.", "error");
      setFormsDisabled(false);
    }
  }

  async function openRoom(roomId) {
    await closeRoomSubscription();

    const { data: room, error: roomError } = await client
      .from("online_rooms")
      .select("id, code, status, series_length, timers_enabled, debug_enabled, created_at, updated_at")
      .eq("id", roomId)
      .single();
    if (roomError) throw roomError;

    currentRoom = room;
    saveRoomStorage(room);
    history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(room.code)}`);
    ui.roomPanel.classList.remove("online-hidden");
    ui.roomCode.textContent = room.code;
    setFormsDisabled(true);
    await refreshMembers();
    subscribeRoom();
    startHeartbeat();
  }

  async function refreshRoom() {
    if (!currentRoom) return;
    const { data, error } = await client
      .from("online_rooms")
      .select("id, code, status, series_length, timers_enabled, debug_enabled, created_at, updated_at")
      .eq("id", currentRoom.id)
      .single();
    if (!error && data) currentRoom = data;
  }

  async function refreshMembers() {
    if (!currentRoom) return;
    const { data, error } = await client
      .from("online_room_players")
      .select("seat, user_id, ready, last_seen")
      .eq("room_id", currentRoom.id)
      .order("seat", { ascending: true });
    if (error) throw error;

    const now = Date.now();
    const players = new Map((data || []).map(player => [Number(player.seat), player]));
    const html = [1, 2].map(seat => {
      const player = players.get(seat);
      const local = player?.user_id === currentUser.id;
      const connected = player && (now - new Date(player.last_seen).getTime()) <= RECONNECT_SECONDS * 1000;
      const marker = seat === 1 ? "p1" : "p2";
      const name = seat === 1 ? "Joueur 1 · Créateur" : "Joueur 2 · Invité";
      const status = !player
        ? "En attente…"
        : `${local ? "Vous · " : ""}${player.ready ? "Prêt" : "Pas encore prêt"}${connected ? " · connecté" : " · reconnexion"}`;
      return `
        <div class="room-member">
          <strong><span class="player-dot ${marker}"></span>${name}</strong>
          <small>${status}</small>
        </div>
      `;
    }).join("");

    ui.roomMembers.innerHTML = html;
    const own = players.get(Number(currentSeat));
    ui.ready.textContent = own?.ready ? "Je ne suis plus prêt" : "Je suis prêt";

    await refreshRoom();
    if (currentRoom?.status === "ready") {
      setMessage("Les deux joueurs sont prêts. La synchronisation du plateau est la prochaine étape.", "success");
    }
  }

  function subscribeRoom() {
    if (!currentRoom) return;
    channel = client
      .channel(`online-room-${currentRoom.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "online_rooms",
        filter: `id=eq.${currentRoom.id}`
      }, refreshMembers)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "online_room_players",
        filter: `room_id=eq.${currentRoom.id}`
      }, refreshMembers)
      .subscribe(status => {
        if (status === "SUBSCRIBED") setConnection("Connecté au salon", "connected");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection("Connexion instable", "error");
      });
  }

  async function closeRoomSubscription() {
    if (channel && client) await client.removeChannel(channel);
    channel = null;
    stopHeartbeat();
  }

  function startHeartbeat() {
    stopHeartbeat();
    touchRoom();
    heartbeatId = window.setInterval(touchRoom, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatId !== null) window.clearInterval(heartbeatId);
    heartbeatId = null;
  }

  async function touchRoom() {
    if (!client || !currentRoom) return;
    const { error } = await client.rpc("touch_online_room", { p_room_id: currentRoom.id });
    if (error) console.warn("Heartbeat du salon :", error.message);
  }

  async function toggleReady() {
    if (!client || !currentRoom) return;
    ui.ready.disabled = true;
    try {
      const { data: players, error: readError } = await client
        .from("online_room_players")
        .select("ready")
        .eq("room_id", currentRoom.id)
        .eq("user_id", currentUser.id)
        .single();
      if (readError) throw readError;
      const { error } = await client.rpc("set_online_ready", {
        p_room_id: currentRoom.id,
        p_ready: !players.ready
      });
      if (error) throw error;
      await refreshMembers();
    } catch (error) {
      setMessage(error.message || "Impossible de modifier l’état prêt.", "error");
    } finally {
      ui.ready.disabled = false;
    }
  }

  async function copyInvite() {
    if (!currentRoom) return;
    const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(currentRoom.code)}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Lien d’invitation copié.", "success");
    } catch {
      window.prompt("Copiez ce lien :", url);
    }
  }

  async function resumeFromUrlOrStorage() {
    const urlCode = normalizeCode(new URLSearchParams(location.search).get("room"));
    const stored = roomStorage();
    const code = urlCode.length === 6 ? urlCode : normalizeCode(stored?.code);
    if (code.length !== 6) return;
    ui.joinCode.value = code;
    await joinRoom();
  }

  async function initialize() {
    ui.joinCode.addEventListener("input", () => {
      ui.joinCode.value = normalizeCode(ui.joinCode.value);
    });
    ui.createForm.addEventListener("submit", createRoom);
    ui.joinForm.addEventListener("submit", joinRoom);
    ui.copyInvite.addEventListener("click", copyInvite);
    ui.ready.addEventListener("click", toggleReady);
    window.addEventListener("beforeunload", stopHeartbeat);

    if (!configured()) {
      setFormsDisabled(true);
      setConnection("Configuration requise");
      setMessage("Ajoutez la Project URL et la clé publishable Supabase dans js/online-config.js.");
      return;
    }

    try {
      setConnection("Connexion à Supabase…");
      ui.connectionDetail.textContent = "Authentification anonyme en cours. Aucun compte ni e-mail n’est demandé aux joueurs.";
      client = supabaseFactory.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      currentUser = await ensureAnonymousSession();
      setConnection("Service en ligne", "connected");
      ui.connectionDetail.textContent = "Identité anonyme créée. Vous pouvez créer ou rejoindre un salon privé.";
      setFormsDisabled(false);
      await resumeFromUrlOrStorage();
    } catch (error) {
      console.error(error);
      setConnection("Connexion impossible", "error");
      setMessage(error.message || "Impossible de se connecter à Supabase.", "error");
      setFormsDisabled(true);
    }
  }

  initialize();
})();
