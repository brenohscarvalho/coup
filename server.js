const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const Room = require('./game/Room');
const { createGameState, filterStateForPlayer } = require('./game/GameState');
const GameEngine = require('./game/GameEngine');
const { PHASES } = require('./game/constants');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

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
        socket.join(roomCode);
        io.to(roomCode).emit('lobby:update', { players: room.players });
        return;
      }
      room.addPlayer(socket.id, playerName);
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
