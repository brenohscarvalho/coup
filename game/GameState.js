// game/GameState.js
const { createDeck, shuffle, dealCards } = require('./Deck');
const { PHASES } = require('./constants');

function createGameState(roomCode, players, variant) {
  const deck = shuffle(createDeck(players.length, variant));
  const startCoins = players.length === 2 ? 1 : 2;
  const totalCoins = 50;

  const statePlayers = players.map(p => ({
    id: p.id,
    name: p.name,
    coins: startCoins,
    cards: dealCards(deck, 2).map(c => ({ ...c, revealed: false })),
    connected: true,
  }));

  return {
    roomCode,
    variant,
    phase: PHASES.WAITING_ACTION,
    currentPlayer: players[0].id,
    players: statePlayers,
    deck,
    treasury: totalCoins - players.length * startCoins,
    pendingAction: null,
    log: [],
    winner: null,
    losingInfluenceQueue: [],
  };
}

function filterStateForPlayer(state, playerId) {
  return {
    roomCode: state.roomCode,
    variant: state.variant,
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    treasury: state.treasury,
    pendingAction: state.pendingAction,
    log: state.log,
    winner: state.winner,
    players: state.players.map(p => ({
      id: p.id,
      name: p.name,
      coins: p.coins,
      connected: p.connected,
      cards: p.cards.map(c =>
        p.id === playerId || c.revealed
          ? c
          : { revealed: false }
      ),
    })),
  };
}

module.exports = { createGameState, filterStateForPlayer };
