"use strict";

(() => {
  const config = window.BINGO_ONLINE_CONFIG || {};
  const supabaseFactory = window.supabase;
  const RECONNECT_SECONDS = 45;
  const HEARTBEAT_MS = 5_000;
  const COUNTDOWN_DURATION_MS = 5_000;
  const CLOCK_TICK_MS = 200;
  const STORAGE_KEY = "bingo-reversible-online-room";
  const ROOM_COLUMNS = "id, code, status, series_length, timers_enabled, debug_enabled, countdown_started_at, started_at, created_at, updated_at";

  const COLORS = {
    red: { label: "Rouge", css: "red" },
    blue: { label: "Bleu", css: "blue" },
    yellow: { label: "Jaune", css: "yellow" }
  };
  const TILE_TYPES = {
    rb: { label: "Rouge / Bleu", faces: [{ center: "red", border: "blue" }, { center: "blue", border: "red" }] },
    yr: { label: "Jaune / Rouge", faces: [{ center: "yellow", border: "red" }, { center: "red", border: "yellow" }] },
    by: { label: "Bleu / Jaune", faces: [{ center: "blue", border: "yellow" }, { center: "yellow", border: "blue" }] }
  };

  const ui = {
    createForm: document.querySelector("#createRoomForm"),
    joinForm: document.querySelector("#joinRoomForm"),
    joinCode: document.querySelector("#joinRoomCode"),
    message: document.querySelector("#onlineMessage"),
    connectionBadge: document.querySelector("#connectionBadge"),
    connectionDetail: document.querySelector("#connectionDetail"),
    lobby: document.querySelector(".online-grid"),
    roomPanel: document.querySelector("#roomPanel"),
    roomCode: document.querySelector("#roomCodeDisplay"),
    roomMembers: document.querySelector("#roomMembers"),
    countdown: document.querySelector("#roomCountdown"),
    countdownValue: document.querySelector("#roomCountdownValue"),
    copyInvite: document.querySelector("#copyInviteButton"),
    ready: document.querySelector("#readyButton"),
    gameScreen: document.querySelector("#onlineGameScreen"),
    gameRoomCode: document.querySelector("#gameRoomCode"),
    gamePlayerSeat: document.querySelector("#gamePlayerSeat"),
    gameSeriesLength: document.querySelector("#gameSeriesLength"),
    gameTimersEnabled: document.querySelector("#gameTimersEnabled"),
    gameConnectionBadge: document.querySelector("#gameConnectionBadge"),
    opponentConnection: document.querySelector("#opponentConnection"),
    board: document.querySelector("#onlineBoard"),
    boardHint: document.querySelector("#onlineBoardHint"),
    actionButtons: document.querySelector("#onlineActionButtons"),
    reserveList: document.querySelector("#onlineReserveList"),
    reserveOwner: document.querySelector("#onlineReserveOwner"),
    emptyCount: document.querySelector("#onlineEmptyCount"),
    turnText: document.querySelector("#onlineTurnText"),
    phaseText: document.querySelector("#onlinePhaseText"),
    roundLabel: document.querySelector("#onlineRoundLabel"),
    moveLabel: document.querySelector("#onlineMoveLabel"),
    scoreP1: document.querySelector("#onlineScoreP1"),
    scoreP2: document.querySelector("#onlineScoreP2"),
    player1Card: document.querySelector("#onlinePlayer1Card"),
    player2Card: document.querySelector("#onlinePlayer2Card"),
    clockP1Wrap: document.querySelector("#onlineClockP1Wrap"),
    clockP2Wrap: document.querySelector("#onlineClockP2Wrap"),
    clockP1: document.querySelector("#onlineClockP1"),
    clockP2: document.querySelector("#onlineClockP2"),
    turnClockWrap: document.querySelector("#onlineTurnClockWrap"),
    turnClock: document.querySelector("#onlineTurnClock"),
    secretColor: document.querySelector("#onlineSecretColor"),
    forfeitRound: document.querySelector("#forfeitRoundButton"),
    forfeitSeries: document.querySelector("#forfeitSeriesButton"),
    resultOverlay: document.querySelector("#onlineResultOverlay"),
    resultKicker: document.querySelector("#onlineResultKicker"),
    resultTitle: document.querySelector("#onlineResultTitle"),
    resultReason: document.querySelector("#onlineResultReason"),
    resultScore: document.querySelector("#onlineResultScore"),
    revealedColors: document.querySelector("#onlineRevealedColors"),
    nextCountdown: document.querySelector("#onlineNextCountdown"),
    nextCountdownValue: document.querySelector("#onlineNextCountdownValue"),
    nextReadyStatus: document.querySelector("#onlineNextReadyStatus"),
    nextReady: document.querySelector("#onlineNextReadyButton"),
    returnButton: document.querySelector("#onlineReturnButton")
  };

  let client = null;
  let currentUser = null;
  let currentRoom = null;
  let currentSeat = null;
  let members = new Map();
  let channel = null;
  let heartbeatId = null;
  let clockId = null;
  let countdownStartedAt = null;
  let startRequestKey = null;
  let gamePayload = null;
  let gameRefreshPromise = null;
  let serverOffsetMs = 0;
  let selectedAction = "place";
  let selectedTileType = "rb";
  let selectedFace = 0;
  let moveSource = null;
  let movePending = false;
  let nextStartRequestKey = null;
  let opponentPresent = false;

  function configured() {
    return Boolean(config.supabaseUrl && config.supabasePublishableKey && supabaseFactory?.createClient);
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
    if (ui.gameConnectionBadge) {
      ui.gameConnectionBadge.textContent = state === "error" ? "Synchronisation instable" : "Synchronisé";
      ui.gameConnectionBadge.className = `connection-badge${state ? ` ${state}` : ""}`;
    }
  }

  function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId: room.id, code: room.code, seat: currentSeat }));
  }

  function clearRoomStorage() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function serverNow() {
    return Date.now() + serverOffsetMs;
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
      setMessage(friendlyError(error), "error");
      setFormsDisabled(false);
    }
  }

  async function openRoom(roomId) {
    await closeRoomSubscription();
    const { data: room, error } = await client.from("online_rooms").select(ROOM_COLUMNS).eq("id", roomId).single();
    if (error) throw error;
    currentRoom = room;
    saveRoomStorage(room);
    history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(room.code)}`);
    ui.roomPanel.classList.remove("online-hidden");
    ui.roomCode.textContent = room.code;
    setFormsDisabled(true);
    await refreshMembers();
    subscribeRoom();
    startHeartbeat();
    startClock();
    syncRoomState();
  }

  async function refreshRoom() {
    if (!currentRoom) return;
    const { data, error } = await client.from("online_rooms").select(ROOM_COLUMNS).eq("id", currentRoom.id).single();
    if (!error && data) currentRoom = data;
  }

  async function refreshMembers() {
    if (!currentRoom) return;
    const { data, error } = await client.from("online_room_players")
      .select("seat, user_id, ready, last_seen").eq("room_id", currentRoom.id).order("seat", { ascending: true });
    if (error) throw error;
    members = new Map((data || []).map(player => [Number(player.seat), player]));
    const now = Date.now();
    ui.roomMembers.innerHTML = [1, 2].map(seat => {
      const player = members.get(seat);
      const local = player?.user_id === currentUser.id;
      const connected = player && (now - new Date(player.last_seen).getTime()) <= RECONNECT_SECONDS * 1000;
      const name = seat === 1 ? "Joueur 1 · Créateur" : "Joueur 2 · Invité";
      const status = !player ? "En attente…" : `${local ? "Vous · " : ""}${player.ready ? "Prêt" : "Pas encore prêt"}${connected ? " · connecté" : " · reconnexion"}`;
      return `<div class="room-member"><strong><span class="player-dot p${seat}"></span>${name}</strong><small>${status}</small></div>`;
    }).join("");
    const own = members.get(Number(currentSeat));
    ui.ready.textContent = own?.ready ? "Je ne suis plus prêt" : "Je suis prêt";
    await refreshRoom();
    syncRoomState();
  }

  function subscribeRoom() {
    if (!currentRoom) return;
    channel = client.channel(`online-room-${currentRoom.id}`, { config: { presence: { key: currentUser.id } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "online_rooms", filter: `id=eq.${currentRoom.id}` }, refreshMembers)
      .on("postgres_changes", { event: "*", schema: "public", table: "online_room_players", filter: `room_id=eq.${currentRoom.id}` }, refreshMembers)
      .on("postgres_changes", { event: "*", schema: "public", table: "online_games", filter: `room_id=eq.${currentRoom.id}` }, refreshGame)
      .on("presence", { event: "sync" }, updatePresence)
      .on("presence", { event: "join" }, updatePresence)
      .on("presence", { event: "leave" }, handlePresenceLeave)
      .subscribe(async status => {
        if (status === "SUBSCRIBED") {
          setConnection("Connecté au salon", "connected");
          await channel.track({ user_id: currentUser.id, seat: currentSeat, room_id: currentRoom.id, online_at: new Date().toISOString() });
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("Connexion instable", "error");
          cancelCountdownBecauseConnection();
        }
      });
  }

  function updatePresence() {
    if (!channel || !currentUser) return;
    const presences = Object.values(channel.presenceState()).flat();
    opponentPresent = presences.some(presence => presence.user_id && presence.user_id !== currentUser.id);
    renderOpponentConnection();
  }

  async function handlePresenceLeave() {
    updatePresence();
    if (!currentRoom || opponentPresent) return;
    if (currentRoom.status === "ready") {
      await cancelLobbyCountdown("Le décompte est annulé : l’autre joueur s’est déconnecté.");
    }
    const game = gamePayload?.game;
    if (game?.phase === "next_countdown") {
      await setNextReady(false, "Le décompte est annulé : l’autre joueur s’est déconnecté.");
    }
  }

  async function cancelCountdownBecauseConnection() {
    if (currentRoom?.status === "ready") {
      await cancelLobbyCountdown("Le décompte est annulé : connexion au salon interrompue.");
    }
  }

  async function cancelLobbyCountdown(message) {
    if (!client || !currentRoom) return;
    const { error } = await client.rpc("cancel_online_countdown", { p_room_id: currentRoom.id });
    if (!error) {
      stopLobbyCountdown();
      setMessage(message, "error");
      await refreshMembers();
    }
  }

  async function closeRoomSubscription() {
    if (channel && client) await client.removeChannel(channel);
    channel = null;
    opponentPresent = false;
    stopHeartbeat();
    stopClock();
    stopLobbyCountdown();
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
    if (!error && gamePayload) refreshGame();
  }

  function startClock() {
    stopClock();
    clockId = window.setInterval(tickClocks, CLOCK_TICK_MS);
  }

  function stopClock() {
    if (clockId !== null) window.clearInterval(clockId);
    clockId = null;
  }

  function stopLobbyCountdown() {
    countdownStartedAt = null;
    startRequestKey = null;
    ui.countdown.classList.add("online-hidden");
    ui.countdownValue.textContent = "5";
  }

  function syncRoomState() {
    if (!currentRoom) return;
    if (currentRoom.status === "active" || currentRoom.status === "finished") {
      enterGameScreen();
      return;
    }
    const wasRunning = countdownStartedAt !== null;
    if (currentRoom.status === "ready" && currentRoom.countdown_started_at) {
      countdownStartedAt = currentRoom.countdown_started_at;
      ui.countdown.classList.remove("online-hidden");
      if (!wasRunning) setMessage("Les deux joueurs sont prêts. La partie va commencer.", "success");
      return;
    }
    stopLobbyCountdown();
    if (wasRunning) setMessage("Le décompte est annulé. Les deux joueurs doivent être prêts.");
  }

  async function requestRoomStart(startedAt) {
    if (!client || !currentRoom || currentRoom.status !== "ready" || currentRoom.countdown_started_at !== startedAt || startRequestKey === startedAt) return;
    startRequestKey = startedAt;
    const { error } = await client.rpc("start_online_room_after_countdown", { p_room_id: currentRoom.id });
    if (error) {
      console.warn("Démarrage du salon :", error.message);
      startRequestKey = null;
    }
    await refreshMembers();
  }

  function tickLobbyCountdown() {
    if (!countdownStartedAt || currentRoom?.status !== "ready") return;
    const remainingMs = new Date(countdownStartedAt).getTime() + COUNTDOWN_DURATION_MS - Date.now();
    ui.countdownValue.textContent = String(Math.max(0, Math.ceil(remainingMs / 1000)));
    if (remainingMs <= 0) requestRoomStart(countdownStartedAt);
  }

  async function toggleReady() {
    if (!client || !currentRoom) return;
    ui.ready.disabled = true;
    try {
      const own = members.get(Number(currentSeat));
      const { error } = await client.rpc("set_online_ready", { p_room_id: currentRoom.id, p_ready: !own?.ready });
      if (error) throw error;
      await refreshMembers();
    } catch (error) {
      setMessage(friendlyError(error), "error");
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

  function enterGameScreen() {
    if (!currentRoom) return;
    stopLobbyCountdown();
    ui.ready.disabled = true;
    ui.lobby.classList.add("online-hidden");
    ui.gameScreen.classList.remove("online-hidden");
    ui.gameRoomCode.textContent = currentRoom.code;
    ui.gamePlayerSeat.textContent = `Vous êtes le joueur ${currentSeat} (${currentSeat === 1 ? "pastille blanche" : "pastille noire"}).`;
    ui.gameSeriesLength.textContent = Number(currentRoom.series_length) === 1 ? "1 manche" : `BO${currentRoom.series_length}`;
    ui.gameTimersEnabled.textContent = currentRoom.timers_enabled ? "Activés" : "Désactivés";
    ui.player1Card.classList.toggle("you", Number(currentSeat) === 1);
    ui.player2Card.classList.toggle("you", Number(currentSeat) === 2);
    document.title = `Partie ${currentRoom.code} · Bingo réversible Online`;
    refreshGame();
  }

  async function refreshGame() {
    if (!client || !currentRoom || !["active", "finished"].includes(currentRoom.status)) return;
    if (gameRefreshPromise) return gameRefreshPromise;
    gameRefreshPromise = (async () => {
      const { data, error } = await client.rpc("get_online_game", { p_room_id: currentRoom.id });
      if (error) {
        if (/GAME_NOT_READY/.test(error.message || "")) {
          await client.rpc("start_online_room_after_countdown", { p_room_id: currentRoom.id });
          window.setTimeout(refreshGame, 350);
          return;
        }
        setGameHint(friendlyError(error), true);
        return;
      }
      gamePayload = data;
      currentSeat = Number(data.seat) || currentSeat;
      if (data.server_now) serverOffsetMs = new Date(data.server_now).getTime() - Date.now();
      renderGame();
    })().finally(() => { gameRefreshPromise = null; });
    return gameRefreshPromise;
  }

  function game() {
    return gamePayload?.game || null;
  }

  function isMyTurn() {
    const state = game();
    return Boolean(state && state.phase === "playing" && Number(state.current_seat) === Number(currentSeat) && !movePending);
  }

  function emptyCells() {
    const board = game()?.board || [];
    return board.reduce((indices, tile, index) => {
      if (!tile) indices.push(index);
      return indices;
    }, []);
  }

  function adjacentEmptyCells(index) {
    const board = game()?.board || [];
    const row = Math.floor(index / 4);
    const col = index % 4;
    return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]
      .filter(([r, c]) => r >= 0 && r < 4 && c >= 0 && c < 4)
      .map(([r, c]) => r * 4 + c)
      .filter(i => !board[i]);
  }

  function renderGame() {
    const state = game();
    if (!state) return;
    const scores = state.scores || [0, 0];
    ui.scoreP1.textContent = scores[0] ?? 0;
    ui.scoreP2.textContent = scores[1] ?? 0;
    ui.roundLabel.textContent = `Manche ${state.round_number}`;
    ui.moveLabel.textContent = `Coup ${Math.min(50, Number(state.move_number) + 1)} / 50`;
    ui.secretColor.textContent = COLORS[gamePayload.secret_color]?.label || "—";
    ui.secretColor.className = `online-secret-color ${COLORS[gamePayload.secret_color]?.css || ""}`;
    ui.player1Card.classList.toggle("active", state.phase === "playing" && Number(state.current_seat) === 1);
    ui.player2Card.classList.toggle("active", state.phase === "playing" && Number(state.current_seat) === 2);
    ui.forfeitRound.disabled = state.phase !== "playing";
    ui.forfeitSeries.disabled = state.phase === "match_finished";
    renderTurn();
    renderBoard();
    renderActions();
    renderReserve();
    renderTimers();
    renderOpponentConnection();
    renderResult();
  }

  function renderTurn() {
    const state = game();
    if (!state) return;
    if (state.phase !== "playing") {
      ui.turnText.textContent = state.phase === "match_finished" ? "BO terminé" : "Manche terminée";
      ui.phaseText.textContent = state.round_reason || "Résultat synchronisé";
      return;
    }
    const ownTurn = Number(state.current_seat) === Number(currentSeat);
    ui.turnText.textContent = ownTurn ? "À vous de jouer" : `Tour du joueur ${state.current_seat}`;
    ui.phaseText.textContent = emptyCells().length > 2 ? "Pose obligatoire" : "Poser, retourner ou déplacer";
  }

  function renderBoard() {
    const state = game();
    if (!state) return;
    const destinations = selectedAction === "move" && moveSource !== null ? adjacentEmptyCells(moveSource) : [];
    ui.board.innerHTML = "";
    (state.board || []).forEach((tile, index) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "board-cell";
      cell.dataset.index = String(index);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", cellAriaLabel(tile, index));
      if (tile) {
        const visual = document.createElement("span");
        visual.className = `tile-visual tile-${tile.type} face-${tile.face}`;
        cell.appendChild(visual);
      }
      if (index === Number(state.protected_index) && tile) cell.classList.add("protected", `last-owner-${Number(tile.owner) - 1}`);
      if (index === moveSource) cell.classList.add("selected-source");
      if (destinations.includes(index)) cell.classList.add("valid-destination");
      if ((state.winning_line || []).map(Number).includes(index)) cell.classList.add("winning");
      const interactive = isCellInteractive(index);
      cell.disabled = !interactive;
      if (interactive) cell.classList.add("interactive");
      if (movePending) cell.classList.add("pending");
      cell.addEventListener("click", () => handleBoardClick(index));
      ui.board.appendChild(cell);
    });
  }

  function cellAriaLabel(tile, index) {
    const row = Math.floor(index / 4) + 1;
    const col = (index % 4) + 1;
    if (!tile) return `Case vide, ligne ${row}, colonne ${col}`;
    const face = TILE_TYPES[tile.type]?.faces?.[Number(tile.face)];
    return `Tuile ${COLORS[face?.center]?.label || "inconnue"}, encadrée de ${COLORS[face?.border]?.label || "inconnue"}, posée par le joueur ${tile.owner}`;
  }

  function isCellInteractive(index) {
    if (!isMyTurn()) return false;
    const state = game();
    const tile = state.board[index];
    if (selectedAction === "place") return !tile;
    if (selectedAction === "flip") return Boolean(tile) && index !== Number(state.protected_index);
    if (selectedAction === "move") {
      if (moveSource === null) return Boolean(tile) && index !== Number(state.protected_index);
      return index === moveSource || adjacentEmptyCells(moveSource).includes(index);
    }
    return false;
  }

  function renderActions() {
    const state = game();
    if (!state) return;
    const special = emptyCells().length <= 2;
    if (!special && selectedAction !== "place") {
      selectedAction = "place";
      moveSource = null;
    }
    [...ui.actionButtons.querySelectorAll("button")].forEach(button => {
      const action = button.dataset.action;
      button.disabled = !isMyTurn() || (!special && action !== "place");
      button.classList.toggle("active", selectedAction === action);
    });
    const empty = emptyCells().length;
    ui.emptyCount.textContent = `${empty} case${empty > 1 ? "s" : ""} libre${empty > 1 ? "s" : ""}`;
    if (state.phase !== "playing") return setGameHint("La manche est terminée.");
    if (!isMyTurn()) return setGameHint("En attente du coup adverse…");
    if (selectedAction === "place") setGameHint("Choisissez une tuile, puis une case vide.");
    if (selectedAction === "flip") setGameHint("Touchez une tuile non protégée pour la retourner.");
    if (selectedAction === "move") setGameHint(moveSource === null
      ? "Choisissez une tuile non protégée à déplacer."
      : "Choisissez une case vide adjacente, ou retouchez la tuile pour annuler.");
  }

  function renderReserve() {
    const state = game();
    if (!state) return;
    const reserve = state.reserves?.[Number(currentSeat) - 1] || { rb: 0, yr: 0, by: 0 };
    ui.reserveOwner.textContent = `Joueur ${currentSeat}`;
    ui.reserveList.innerHTML = "";
    Object.entries(TILE_TYPES).forEach(([type, data]) => {
      const count = Number(reserve[type] || 0);
      const face = selectedTileType === type ? selectedFace : 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reserve-item";
      button.classList.toggle("selected", selectedTileType === type);
      button.disabled = count <= 0 || !isMyTurn() || selectedAction !== "place";
      button.innerHTML = `<span class="tile-visual tile-${type} face-${face}"></span><span><strong>${data.label}</strong><small>${COLORS[data.faces[face].center].label} visible</small></span><span class="reserve-count">${count}</span>`;
      button.addEventListener("click", () => selectReserveTile(type));
      ui.reserveList.appendChild(button);
    });
  }

  function selectReserveTile(type) {
    if (!isMyTurn()) return;
    if (selectedTileType === type) selectedFace = 1 - selectedFace;
    else {
      selectedTileType = type;
      selectedFace = 0;
    }
    renderReserve();
  }

  function chooseAction(action) {
    if (!isMyTurn()) return;
    if (emptyCells().length > 2 && action !== "place") return;
    selectedAction = action;
    moveSource = null;
    renderActions();
    renderBoard();
    renderReserve();
  }

  async function handleBoardClick(index) {
    if (!isMyTurn()) return;
    if (selectedAction === "place") {
      await playMove({ p_action: "place", p_index: index, p_tile_type: selectedTileType, p_face: selectedFace });
      return;
    }
    if (selectedAction === "flip") {
      await playMove({ p_action: "flip", p_index: index });
      return;
    }
    if (selectedAction === "move") {
      if (moveSource === null) {
        moveSource = index;
        renderBoard();
        renderActions();
        return;
      }
      if (index === moveSource) {
        moveSource = null;
        renderBoard();
        renderActions();
        return;
      }
      if (!adjacentEmptyCells(moveSource).includes(index)) return;
      await playMove({ p_action: "move", p_from: moveSource, p_to: index });
    }
  }

  async function playMove(move) {
    const state = game();
    if (!client || !currentRoom || !state || movePending) return;
    movePending = true;
    renderGame();
    const args = {
      p_room_id: currentRoom.id,
      p_expected_version: Number(state.version),
      p_action: move.p_action,
      p_index: move.p_index ?? null,
      p_from: move.p_from ?? null,
      p_to: move.p_to ?? null,
      p_tile_type: move.p_tile_type ?? null,
      p_face: move.p_face ?? null
    };
    const { error } = await client.rpc("play_online_move", args);
    movePending = false;
    moveSource = null;
    if (error) {
      setGameHint(friendlyError(error), true);
      await refreshGame();
      return;
    }
    selectedAction = "place";
    await refreshGame();
  }

  function setGameHint(message, error = false) {
    ui.boardHint.textContent = message;
    ui.boardHint.classList.toggle("error", error);
  }

  function renderTimers() {
    const enabled = Boolean(currentRoom?.timers_enabled);
    ui.clockP1Wrap.classList.toggle("online-hidden", !enabled);
    ui.clockP2Wrap.classList.toggle("online-hidden", !enabled);
    ui.turnClockWrap.classList.toggle("online-hidden", !enabled);
    if (enabled) updateTimerValues();
  }

  function updateTimerValues() {
    const state = game();
    if (!state || !currentRoom?.timers_enabled) return;
    const stored = (state.time_left_ms || [1800000, 1800000]).map(Number);
    let elapsed = 0;
    if (state.phase === "playing" && state.turn_started_at) elapsed = Math.max(0, serverNow() - new Date(state.turn_started_at).getTime());
    const current = Number(state.current_seat);
    const totals = stored.map((value, index) => Math.max(0, value - (current === index + 1 ? elapsed : 0)));
    ui.clockP1.textContent = formatTime(totals[0]);
    ui.clockP2.textContent = formatTime(totals[1]);
    const turnRemaining = state.phase === "playing" ? Math.max(0, Math.min(60000, stored[current - 1]) - elapsed) : 0;
    ui.turnClock.textContent = formatTime(turnRemaining);
    ui.turnClockWrap.classList.toggle("warning", turnRemaining > 0 && turnRemaining <= 15000);
    ui.turnClockWrap.classList.toggle("danger", turnRemaining > 0 && turnRemaining <= 5000);
  }

  function formatTime(milliseconds) {
    const total = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  }

  function renderOpponentConnection() {
    if (!ui.opponentConnection || !gamePayload) return;
    const lastSeen = gamePayload.opponent_last_seen ? new Date(gamePayload.opponent_last_seen).getTime() : 0;
    const elapsed = Math.max(0, serverNow() - lastSeen);
    const connected = opponentPresent || elapsed < HEARTBEAT_MS * 2.5;
    if (connected) {
      ui.opponentConnection.textContent = "Adversaire connecté";
      ui.opponentConnection.className = "connection-badge connected";
      return;
    }
    const remaining = Math.max(0, RECONNECT_SECONDS - Math.floor(elapsed / 1000));
    ui.opponentConnection.textContent = `Reconnexion adverse · ${remaining}s`;
    ui.opponentConnection.className = "connection-badge error";
  }

  function renderResult() {
    const state = game();
    if (!state || state.phase === "playing") {
      ui.resultOverlay.classList.add("online-hidden");
      nextStartRequestKey = null;
      return;
    }
    ui.resultOverlay.classList.remove("online-hidden");
    const matchFinished = state.phase === "match_finished";
    const winner = Number(state.round_winner) || null;
    ui.resultKicker.textContent = matchFinished ? "Fin du BO" : "Fin de la manche";
    if (state.round_result === "draw") ui.resultTitle.textContent = "Manche nulle";
    else if (matchFinished) ui.resultTitle.textContent = winner ? `Le joueur ${winner} gagne le BO !` : "BO terminé";
    else ui.resultTitle.textContent = winner ? `Le joueur ${winner} gagne la manche !` : "Manche terminée";
    ui.resultReason.textContent = state.round_reason || "Résultat enregistré par le serveur.";
    ui.resultScore.innerHTML = scoreMarkup(state.scores || [0, 0], matchFinished ? "Score final" : "Score du BO");
    const colors = state.revealed_colors || {};
    ui.revealedColors.innerHTML = [1, 2].map(seat => {
      const color = colors[String(seat)];
      return `<div class="color-chip"><span>Joueur ${seat}</span><strong class="color-name ${color || ""}">${COLORS[color]?.label || "—"}</strong></div>`;
    }).join("");
    ui.nextReady.classList.toggle("online-hidden", matchFinished);
    ui.returnButton.classList.toggle("online-hidden", !matchFinished);
    ui.forfeitRound.disabled = state.phase !== "playing";
    ui.forfeitSeries.disabled = matchFinished;
    if (!matchFinished) renderNextRoundState();
    else {
      ui.nextCountdown.classList.add("online-hidden");
      ui.nextReadyStatus.textContent = "La série est terminée.";
    }
  }

  function scoreMarkup(scores, title) {
    return `<p class="result-score-title">${title}</p><div class="result-score-row"><span class="result-score-player"><span class="player-dot p1"></span>Joueur 1</span><strong class="result-score-number">${scores[0] ?? 0}</strong><span class="result-score-separator">–</span><strong class="result-score-number">${scores[1] ?? 0}</strong><span class="result-score-player right">Joueur 2<span class="player-dot p2"></span></span></div>`;
  }

  function renderNextRoundState() {
    const state = game();
    const ready = (state.next_ready_seats || []).map(Number);
    const ownReady = ready.includes(Number(currentSeat));
    ui.nextReady.textContent = ownReady ? "Je ne suis plus prêt" : "Prêt pour la manche suivante";
    ui.nextReadyStatus.textContent = ready.length === 0
      ? "Les deux joueurs doivent confirmer."
      : ready.length === 1
        ? `Joueur ${ready[0]} prêt · en attente de l’autre joueur.`
        : "Les deux joueurs sont prêts.";
    if (state.phase === "next_countdown" && state.next_countdown_started_at) ui.nextCountdown.classList.remove("online-hidden");
    else {
      ui.nextCountdown.classList.add("online-hidden");
      ui.nextCountdownValue.textContent = "5";
      nextStartRequestKey = null;
    }
  }

  async function setNextReady(forceValue = null, cancellationMessage = "") {
    const state = game();
    if (!client || !currentRoom || !state || !["round_finished", "next_countdown"].includes(state.phase)) return;
    const ready = (state.next_ready_seats || []).map(Number);
    const ownReady = ready.includes(Number(currentSeat));
    const pReady = forceValue === null ? !ownReady : Boolean(forceValue);
    ui.nextReady.disabled = true;
    const { error } = await client.rpc("set_online_next_ready", { p_room_id: currentRoom.id, p_ready: pReady });
    ui.nextReady.disabled = false;
    if (error) setGameHint(friendlyError(error), true);
    else {
      if (cancellationMessage) ui.nextReadyStatus.textContent = cancellationMessage;
      await refreshGame();
    }
  }

  async function requestNextRound(startedAt) {
    const state = game();
    if (!client || !currentRoom || state?.phase !== "next_countdown" || state.next_countdown_started_at !== startedAt || nextStartRequestKey === startedAt) return;
    nextStartRequestKey = startedAt;
    const { error } = await client.rpc("start_online_next_round_after_countdown", { p_room_id: currentRoom.id });
    if (error) nextStartRequestKey = null;
    await refreshGame();
  }

  function tickNextCountdown() {
    const state = game();
    if (state?.phase !== "next_countdown" || !state.next_countdown_started_at) return;
    const remainingMs = new Date(state.next_countdown_started_at).getTime() + COUNTDOWN_DURATION_MS - serverNow();
    ui.nextCountdownValue.textContent = String(Math.max(0, Math.ceil(remainingMs / 1000)));
    if (remainingMs <= 0) requestNextRound(state.next_countdown_started_at);
  }

  async function forfeitRound() {
    if (!game() || game().phase !== "playing") return;
    if (!window.confirm("Abandonner cette manche ? L’adversaire gagnera un point, mais le BO pourra continuer.")) return;
    ui.forfeitRound.disabled = true;
    const { error } = await client.rpc("forfeit_online_round", { p_room_id: currentRoom.id });
    if (error) setGameHint(friendlyError(error), true);
    await refreshGame();
  }

  async function forfeitSeries() {
    if (!game() || game().phase === "match_finished") return;
    if (!window.confirm("Abandonner tout le BO ? L’adversaire gagnera immédiatement la série.")) return;
    ui.forfeitSeries.disabled = true;
    const { error } = await client.rpc("forfeit_online_series", { p_room_id: currentRoom.id });
    if (error) setGameHint(friendlyError(error), true);
    await refreshRoom();
    await refreshGame();
  }

  function returnToOnlineHome() {
    clearRoomStorage();
    history.replaceState(null, "", location.pathname);
    location.reload();
  }

  function tickClocks() {
    tickLobbyCountdown();
    updateTimerValues();
    renderOpponentConnection();
    tickNextCountdown();
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "Erreur inconnue");
    const translations = [
      ["ROOM_NOT_FOUND", "Salon introuvable."],
      ["ROOM_FULL", "Ce salon est déjà complet."],
      ["ROOM_ALREADY_STARTED", "Cette partie a déjà commencé."],
      ["NOT_YOUR_TURN", "Ce n’est pas votre tour."],
      ["STALE_GAME_STATE", "Le plateau a changé. Il vient d’être resynchronisé."],
      ["PLACE_REQUIRED", "La pose est encore obligatoire."],
      ["TILE_PROTECTED", "La tuile du coup précédent est protégée."],
      ["CELL_OCCUPIED", "Cette case est déjà occupée."],
      ["NO_TILE_LEFT", "Cette tuile n’est plus disponible dans votre réserve."],
      ["DESTINATION_NOT_ADJACENT", "Le déplacement doit viser une case vide adjacente."],
      ["ROUND_NOT_ACTIVE", "Cette manche n’est plus active."],
      ["TURN_TIME_EXPIRED", "Le temps de ce coup est écoulé."],
      ["NOT_A_ROOM_MEMBER", "Vous ne faites pas partie de ce salon."]
    ];
    return translations.find(([code]) => message.includes(code))?.[1] || message;
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
    ui.joinCode.addEventListener("input", () => { ui.joinCode.value = normalizeCode(ui.joinCode.value); });
    ui.createForm.addEventListener("submit", createRoom);
    ui.joinForm.addEventListener("submit", joinRoom);
    ui.copyInvite.addEventListener("click", copyInvite);
    ui.ready.addEventListener("click", toggleReady);
    ui.actionButtons.addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (button) chooseAction(button.dataset.action);
    });
    ui.nextReady.addEventListener("click", () => setNextReady());
    ui.returnButton.addEventListener("click", returnToOnlineHome);
    ui.forfeitRound.addEventListener("click", forfeitRound);
    ui.forfeitSeries.addEventListener("click", forfeitSeries);
    window.addEventListener("beforeunload", () => {
      stopHeartbeat();
      stopClock();
    });

    if (!configured()) {
      setFormsDisabled(true);
      setConnection("Configuration requise");
      setMessage("Ajoutez la Project URL et la clé publishable Supabase dans js/online-config.js.");
      return;
    }

    try {
      setConnection("Connexion à Supabase…");
      ui.connectionDetail.textContent = "Authentification anonyme en cours. Aucun compte ni e-mail n’est demandé aux joueurs.";
      client = supabaseFactory.createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
      currentUser = await ensureAnonymousSession();
      setConnection("Service en ligne", "connected");
      ui.connectionDetail.textContent = "Identité anonyme créée. Vous pouvez créer ou rejoindre un salon privé.";
      setFormsDisabled(false);
      await resumeFromUrlOrStorage();
    } catch (error) {
      console.error(error);
      setConnection("Connexion impossible", "error");
      setMessage(friendlyError(error), "error");
      setFormsDisabled(true);
    }
  }

  initialize();
})();
