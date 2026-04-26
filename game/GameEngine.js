// game/GameEngine.js
const { PHASES, ACTIONS, BLOCKERS, ACTION_CHARACTER, CHARACTERS } = require('./constants');

function getActivePlayers(state) {
  return state.players.filter(p => p.cards.some(c => !c.revealed));
}

function nextPlayer(state) {
  const active = getActivePlayers(state);
  const idx = active.findIndex(p => p.id === state.currentPlayer);
  state.currentPlayer = active[(idx + 1) % active.length].id;
  state.phase = PHASES.WAITING_ACTION;
  state.pendingAction = null;
}

function getValidActions(state, playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (player.coins >= 10) return [ACTIONS.COUP];
  return Object.values(ACTIONS);
}

function applyAction(state, playerId, action) {
  if (state.phase !== PHASES.WAITING_ACTION) throw new Error('Não é a fase de ação');
  if (state.currentPlayer !== playerId) throw new Error('Não é sua vez');

  const player = state.players.find(p => p.id === playerId);

  if (action.type === ACTIONS.INCOME) {
    player.coins += 1;
    state.treasury -= 1;
    state.log.push(`${player.name} recebeu Renda (+1)`);
    nextPlayer(state);
    return;
  }

  if (action.type === ACTIONS.FOREIGN_AID) {
    state.pendingAction = {
      type: ACTIONS.FOREIGN_AID,
      actor: playerId,
      target: null,
      respondedBy: [],
      blockBy: null,
      blockCharacter: null,
      challengeBy: null,
    };
    state.phase = PHASES.WAITING_REACTIONS;
    state.log.push(`${player.name} tenta Ajuda Externa`);
    return;
  }

  if (action.type === ACTIONS.COUP) {
    if (player.coins < 7) throw new Error('Moedas insuficientes para Golpe');
    if (!action.target) throw new Error('Golpe requer alvo');
    player.coins -= 7;
    state.treasury += 7;
    const target = state.players.find(p => p.id === action.target);
    state.pendingAction = { type: ACTIONS.COUP, actor: playerId, target: action.target };
    state.phase = PHASES.LOSE_INFLUENCE;
    state.log.push(`${player.name} aplica Golpe em ${target.name}`);
    return;
  }

  // Character actions — go to WAITING_REACTIONS
  const needsTarget = [ACTIONS.ASSASSINATE, ACTIONS.EXTORT, ACTIONS.INVESTIGATE].includes(action.type);
  if (needsTarget && !action.target) throw new Error('Ação requer alvo');

  if (action.type === ACTIONS.ASSASSINATE) {
    if (player.coins < 3) throw new Error('Moedas insuficientes para Assassinar');
    player.coins -= 3;
    state.treasury += 3;
  }

  state.pendingAction = {
    type: action.type,
    actor: playerId,
    target: action.target || null,
    respondedBy: [],
    blockBy: null,
    blockCharacter: null,
    challengeBy: null,
  };
  state.phase = PHASES.WAITING_REACTIONS;
  const targetName = action.target ? state.players.find(p => p.id === action.target)?.name : null;
  state.log.push(`${player.name} declara ${action.type}${targetName ? ' em ' + targetName : ''}`);
}

function loseInfluence(state, playerId, cardIndex) {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.cards[cardIndex]?.revealed) throw new Error('Carta inválida');
  player.cards[cardIndex].revealed = true;
  state.log.push(`${player.name} revelou ${player.cards[cardIndex].character}`);

  const stillAlive = player.cards.some(c => !c.revealed);
  if (!stillAlive) {
    state.treasury += player.coins;
    player.coins = 0;
    state.log.push(`${player.name} foi eliminado`);
  }

  // Check for game over
  const active = getActivePlayers(state);
  if (active.length === 1) {
    state.phase = PHASES.GAME_OVER;
    state.winner = active[0].id;
    state.log.push(`${active[0].name} venceu a partida!`);
    return;
  }

  // Process losing influence queue (for chained double-murder)
  if (state.losingInfluenceQueue && state.losingInfluenceQueue.length > 0) {
    state.pendingAction = { ...state.pendingAction, target: state.losingInfluenceQueue.shift() };
    return;
  }

  nextPlayer(state);
}

module.exports = { applyAction, loseInfluence, getValidActions, getActivePlayers, nextPlayer };
