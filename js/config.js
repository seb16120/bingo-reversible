"use strict";

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

const WIN_LINES = [
  [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
  [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
  [0, 5, 10, 15], [3, 6, 9, 12]
];

const els = {
  menuScreen: document.querySelector("#menuScreen"),
  gameScreen: document.querySelector("#gameScreen"),
  setupForm: document.querySelector("#setupForm"),
  timersEnabled: document.querySelector("#timersEnabled"),
  board: document.querySelector("#board"),
  boardHint: document.querySelector("#boardHint"),
  actionButtons: document.querySelector("#actionButtons"),
  reservePanel: document.querySelector("#reservePanel"),
  reserveList: document.querySelector("#reserveList"),
  reserveOwner: document.querySelector("#reserveOwner"),
  emptyCount: document.querySelector("#emptyCount"),
  turnText: document.querySelector("#turnText"),
  phaseText: document.querySelector("#phaseText"),
  seriesLabel: document.querySelector("#seriesLabel"),
  roundLabel: document.querySelector("#roundLabel"),
  moveLabel: document.querySelector("#moveLabel"),
  scoreP1: document.querySelector("#scoreP1"),
  scoreP2: document.querySelector("#scoreP2"),
  player1Name: document.querySelector("#player1Name"),
  player2Name: document.querySelector("#player2Name"),
  player1Card: document.querySelector("#player1Card"),
  player2Card: document.querySelector("#player2Card"),
  clockP1Wrap: document.querySelector("#clockP1Wrap"),
  clockP2Wrap: document.querySelector("#clockP2Wrap"),
  clockP1: document.querySelector("#clockP1"),
  clockP2: document.querySelector("#clockP2"),
  turnClockWrap: document.querySelector("#turnClockWrap"),
  turnClock: document.querySelector("#turnClock"),
  privacyOverlay: document.querySelector("#privacyOverlay"),
  privacyStep: document.querySelector("#privacyStep"),
  privacyTitle: document.querySelector("#privacyTitle"),
  privacyInstruction: document.querySelector("#privacyInstruction"),
  secretColorCard: document.querySelector("#secretColorCard"),
  secretColorName: document.querySelector("#secretColorName"),
  privacyButton: document.querySelector("#privacyButton"),
  resultOverlay: document.querySelector("#resultOverlay"),
  resultKicker: document.querySelector("#resultKicker"),
  resultTitle: document.querySelector("#resultTitle"),
  resultText: document.querySelector("#resultText"),
  revealedColors: document.querySelector("#revealedColors"),
  nextRoundBtn: document.querySelector("#nextRoundBtn"),
  backToMenuBtn: document.querySelector("#backToMenuBtn"),
  rulesOverlay: document.querySelector("#rulesOverlay"),
  rulesBtn: document.querySelector("#rulesBtn"),
  closeRulesBtn: document.querySelector("#closeRulesBtn"),
  quitBtn: document.querySelector("#quitBtn")
};

const initialState = () => ({
  mode: "local",
  seriesLength: 3,
  targetWins: 2,
  timersEnabled: false,
  scores: [0, 0],
  roundNumber: 0,
  roundStarter: 0,
  currentPlayer: 0,
  secretColors: ["red", "blue"],
  board: Array(16).fill(null),
  reserves: [freshReserve(), freshReserve()],
  protectedIndex: null,
  moveNumber: 0,
  action: "place",
  selectedTileType: "rb",
  selectedFace: 0,
  moveSource: null,
  positionCounts: new Map(),
  roundActive: false,
  revealPlayer: 0,
  revealStage: "concealed",
  totalTimes: [30 * 60, 30 * 60],
  turnTime: 60,
  lastTimerTick: null,
  timerId: null,
  winningLine: null,
  cpuThinking: false,
  cpuTimerId: null
});

let state = initialState();

function freshReserve() {
  return { rb: 3, yr: 3, by: 3 };
}

function playerName(player) {
  return state.mode === "cpu" && player === 1 ? "CPU" : `Joueur ${player + 1}`;
}

function isCpuPlayer(player = state.currentPlayer) {
  return state.mode === "cpu" && player === 1;
}

function isHumanTurn() {
  return state.roundActive && !isCpuPlayer() && !state.cpuThinking;
}
