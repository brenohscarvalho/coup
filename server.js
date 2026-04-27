const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const Room = require('./game/Room');
const { createGameState, filterStateForPlayer } = require('./game/GameState');
const GameEngine = require('./game/GameEngine');
const { PHASES } = require('./game/constants');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── Card image config ────────────────────────────────────── */

const CHARACTERS = ['duke','assassin','captain','countess','ambassador','inquisitor'];
const CARD_IMAGES_PATH = path.join(__dirname, 'data', 'card-images.json');
const CARDS_DIR = path.join(__dirname, 'public', 'images', 'cards');

function loadCardImages() {
  try { return JSON.parse(fs.readFileSync(CARD_IMAGES_PATH, 'utf8')); } catch { return {}; }
}

function saveCardImages(data) {
  fs.writeFileSync(CARD_IMAGES_PATH, JSON.stringify(data, null, 2));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CARDS_DIR),
    filename: (req, file, cb) => {
      const { character, slot } = req.params;
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${character}_${slot}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.get('/admin/card-images', (req, res) => {
  const config = loadCardImages();
  const result = {};
  for (const char of CHARACTERS) {
    const cfg = config[char] || {};
    const slot1File = fs.readdirSync(CARDS_DIR).find(f => f.startsWith(`${char}_1.`));
    const slot2File = fs.readdirSync(CARDS_DIR).find(f => f.startsWith(`${char}_2.`));
    result[char] = {
      1: slot1File ? `/images/cards/${slot1File}` : null,
      2: slot2File ? `/images/cards/${slot2File}` : null,
      active: cfg.active ?? null,
    };
  }
  res.json(result);
});

app.post('/admin/upload/:character/:slot', upload.single('image'), (req, res) => {
  const { character, slot } = req.params;
  if (!CHARACTERS.includes(character) || !['1','2'].includes(slot)) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
  const finalName = `${character}_${slot}${ext}`;
  // Remove old file if extension changed
  for (const f of fs.readdirSync(CARDS_DIR)) {
    if (f.startsWith(`${character}_${slot}.`) && f !== finalName) fs.unlinkSync(path.join(CARDS_DIR, f));
  }
  const config = loadCardImages();
  if (!config[character]) config[character] = {};
  if (!config[character].active) config[character].active = parseInt(slot);
  saveCardImages(config);
  res.json({ url: `/images/cards/${req.file.filename}` });
});

app.post('/admin/set-active/:character/:slot', (req, res) => {
  const { character, slot } = req.params;
  if (!CHARACTERS.includes(character) || !['1','2','0'].includes(slot)) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const config = loadCardImages();
  if (!config[character]) config[character] = {};
  config[character].active = slot === '0' ? null : parseInt(slot);
  saveCardImages(config);
  res.json({ ok: true });
});

app.delete('/admin/card-image/:character/:slot', (req, res) => {
  const { character, slot } = req.params;
  if (!CHARACTERS.includes(character) || !['1','2'].includes(slot)) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const file = fs.readdirSync(CARDS_DIR).find(f => f.startsWith(`${character}_${slot}.`));
  if (file) fs.unlinkSync(path.join(CARDS_DIR, file));
  const config = loadCardImages();
  if (config[character]?.active === parseInt(slot)) config[character].active = null;
  saveCardImages(config);
  res.json({ ok: true });
});

const rooms = new Map(); // roomCode -> Room

function broadcast(room) {
  room.players.forEach(p => {
    const socket = io.sockets.sockets.get(p.id);
    if (socket && p.connected) {
      socket.emit('game:state', filterStateForPlayer(room.gameState, p.id));
    }
  });
}

function promptPlayer(room, playerId, prompt) {
  const socket = io.sockets.sockets.get(playerId);
  if (socket) socket.emit('game:prompt', prompt);
}


function findRoomByPlayer(playerId) {
  return [...rooms.values()].find(r => r.players.some(p => p.id === playerId));
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ playerName }) => {
    try {
      const room = new Room(socket.id, playerName);
      rooms.set(room.code, room);
      socket.join(room.code);
      socket.emit('room:created', { roomCode: room.code });
      room.on('player-eliminated', () => broadcast(room));
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('room:join', ({ roomCode, playerName }) => {
    try {
      const room = rooms.get(roomCode);
      if (!room) throw new Error('Sala não encontrada');
      if (room.gameState) {
        const ok = room.reconnect(socket.id, playerName);
        if (!ok) throw new Error('Jogo em andamento — nome não reconhecido');
        socket.join(roomCode);
        socket.emit('game:state', filterStateForPlayer(room.gameState, socket.id));
        return;
      }
      // Pre-game: player may already exist due to page navigation creating a new socket
      const existing = room.players.find(p => p.name === playerName);
      if (existing) {
        if (room.hostId === existing.id) room.hostId = socket.id;
        existing.id = socket.id;
        existing.connected = true;
        existing.inLobby = true;
        socket.join(roomCode);
        io.to(roomCode).emit('lobby:update', { players: room.players });
        return;
      }
      room.addPlayer(socket.id, playerName);
      room.players.find(p => p.id === socket.id).inLobby = true;
      socket.join(roomCode);
      io.to(roomCode).emit('lobby:update', { players: room.players });
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('room:start', ({ variant }) => {
    try {
      const room = [...rooms.values()].find(r => r.hostId === socket.id);
      if (!room) throw new Error('Não é o host');
      if (room.players.length < 2) throw new Error('Mínimo 2 jogadores');
      room.players.forEach(p => { p.inLobby = false; });
      room.gameState = createGameState(room.code, room.players, variant || 'ambassador');
      broadcast(room);
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('player:action', (action) => {
    const room = findRoomByPlayer(socket.id);
    if (!room?.gameState) return;
    try {
      GameEngine.applyAction(room.gameState, socket.id, action);
      broadcast(room);
      if (room.gameState.phase === PHASES.CHOOSE_INVESTIGATE_CARD) {
        promptPlayer(room, room.gameState.pendingAction.target, {
          type: 'choose_investigate_card',
          message: 'Escolha qual carta mostrar ao Inquisidor',
        });
      }
      if (room.gameState.phase === PHASES.LOSE_INFLUENCE) {
        promptPlayer(room, room.gameState.pendingAction.target, {
          type: 'lose_influence',
          message: 'Escolha qual carta revelar',
        });
      }
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('player:react', (reaction) => {
    const room = findRoomByPlayer(socket.id);
    if (!room?.gameState) return;
    try {
      GameEngine.applyReaction(room.gameState, socket.id, reaction);
      broadcast(room);
      if (room.gameState.phase === PHASES.LOSE_INFLUENCE) {
        promptPlayer(room, room.gameState.pendingAction.target, {
          type: 'lose_influence',
          message: 'Escolha qual carta revelar',
        });
      }
      if (room.gameState.phase === PHASES.EXCHANGE_CARDS) {
        const actor = room.gameState.pendingAction.actor;
        const opts = room.gameState.players.find(p => p.id === actor)?._exchangeOptions;
        promptPlayer(room, actor, { type: 'exchange_cards', options: opts });
      }
      if (room.gameState.phase === PHASES.CHOOSE_INVESTIGATE_CARD) {
        promptPlayer(room, room.gameState.pendingAction.target, {
          type: 'choose_investigate_card',
          message: 'Escolha qual carta mostrar ao Inquisidor',
        });
      }
      if (room.gameState.phase === PHASES.INVESTIGATE) {
        promptPlayer(room, room.gameState.pendingAction.actor, {
          type: 'investigate',
          card: room.gameState.pendingAction.investigatedCard,
          targetName: room.gameState.players.find(p => p.id === room.gameState.pendingAction.target)?.name,
        });
      }
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('player:investigate-contest', () => {
    const room = findRoomByPlayer(socket.id);
    if (!room?.gameState) return;
    try {
      GameEngine.applyInvestigateContest(room.gameState, socket.id);
      broadcast(room);
      if (room.gameState.phase === PHASES.LOSE_INFLUENCE) {
        promptPlayer(room, room.gameState.pendingAction.target, {
          type: 'lose_influence',
          message: 'Escolha qual carta revelar',
        });
      }
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('player:investigate-show', ({ cardIndex }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room?.gameState) return;
    try {
      GameEngine.applyInvestigateCardChoice(room.gameState, socket.id, cardIndex);
      broadcast(room);
      promptPlayer(room, room.gameState.pendingAction.actor, {
        type: 'investigate',
        card: room.gameState.pendingAction.investigatedCard,
        targetName: room.gameState.players.find(p => p.id === room.gameState.pendingAction.target)?.name,
      });
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('player:lose-influence', ({ cardIndex }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room?.gameState) return;
    try {
      GameEngine.loseInfluence(room.gameState, socket.id, cardIndex);
      broadcast(room);
      if (room.gameState.phase === PHASES.LOSE_INFLUENCE) {
        promptPlayer(room, room.gameState.pendingAction.target, {
          type: 'lose_influence',
          message: 'Escolha qual carta revelar',
        });
      }
      if (room.gameState.phase === PHASES.EXCHANGE_CARDS) {
        const actor = room.gameState.pendingAction.actor;
        const opts = room.gameState.players.find(p => p.id === actor)?._exchangeOptions;
        promptPlayer(room, actor, { type: 'exchange_cards', options: opts });
      }
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('player:exchange-choose', ({ keepIndexes }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room?.gameState) return;
    try {
      GameEngine.applyExchangeChoice(room.gameState, socket.id, keepIndexes);
      broadcast(room);
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('player:investigate-decide', ({ forceSwap }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room?.gameState) return;
    try {
      GameEngine.applyInvestigateDecision(room.gameState, socket.id, forceSwap);
      broadcast(room);
    } catch (e) {
      socket.emit('game:error', { message: e.message });
    }
  });

  socket.on('room:restart', () => {
    const room = findRoomByPlayer(socket.id);
    if (!room) return;
    // Clear game state if game is over so lobby works for returning players
    if (room.gameState && room.gameState.phase === 'GAME_OVER') {
      room.gameState = null;
    }
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.inLobby = true;
    socket.emit('room:restarted', {
      roomCode: room.code,
      isHost: socket.id === room.hostId,
    });
    // Broadcast updated player list to lobby viewers
    io.to(room.code).emit('lobby:update', { players: room.players });
  });

  socket.on('disconnect', () => {
    rooms.forEach(room => {
      if (room.players.some(p => p.id === socket.id)) {
        room.handleDisconnect(socket.id);
        if (room.gameState) broadcast(room);
      }
    });
  });
});

const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const allIps = Object.values(nets).flat().filter(n => n.family === 'IPv4' && !n.internal);
  const ip = allIps.find(n => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(n.address))?.address
    || allIps[0]?.address
    || 'localhost';
  console.log(`\n⚜  Coup rodando em http://${ip}:${PORT}\n`);
});
