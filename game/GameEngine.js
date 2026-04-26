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

  afterLoseInfluence(state);
}

function hasCharacter(player, character) {
  return player.cards.some(c => c.character === character && !c.revealed);
}

function resolveAction(state) {
  const { type, actor, target } = state.pendingAction;
  const actorPlayer = state.players.find(p => p.id === actor);

  if (type === ACTIONS.FOREIGN_AID) {
    actorPlayer.coins += 2;
    state.treasury -= 2;
    state.log.push(`${actorPlayer.name} recebeu Ajuda Externa (+2)`);
    nextPlayer(state);
    return;
  }

  if (type === ACTIONS.TAX) {
    actorPlayer.coins += 3;
    state.treasury -= 3;
    state.log.push(`${actorPlayer.name} Taxou (+3)`);
    nextPlayer(state);
    return;
  }

  if (type === ACTIONS.ASSASSINATE) {
    state.phase = PHASES.LOSE_INFLUENCE;
    state.pendingAction.target = target;
    return;
  }

  if (type === ACTIONS.EXTORT) {
    const targetPlayer = state.players.find(p => p.id === target);
    const stolen = Math.min(2, targetPlayer.coins);
    targetPlayer.coins -= stolen;
    actorPlayer.coins += stolen;
    state.log.push(`${actorPlayer.name} extorquiu ${stolen} moedas de ${targetPlayer.name}`);
    nextPlayer(state);
    return;
  }

  if (type === ACTIONS.EXCHANGE) {
    const count = state.variant === 'inquisitor' ? 1 : 2;
    const { dealCards } = require('./Deck');
    const extras = dealCards(state.deck, count);
    actorPlayer._exchangeOptions = [...actorPlayer.cards.filter(c => !c.revealed), ...extras];
    state.phase = PHASES.EXCHANGE_CARDS;
    return;
  }

  if (type === ACTIONS.INVESTIGATE) {
    const targetPlayer = state.players.find(p => p.id === target);
    const hiddenCards = targetPlayer.cards.filter(c => !c.revealed);
    state.pendingAction.investigatedCard = hiddenCards[0];
    state.phase = PHASES.INVESTIGATE;
    return;
  }

  nextPlayer(state);
}

function afterLoseInfluence(state) {
  const pa = state.pendingAction;
  if (!pa) return nextPlayer(state);
  if (pa._afterChallengeLoss === 'action_resolves') {
    pa._afterChallengeLoss = null;
    resolveAction(state);
  } else if (pa._afterChallengeLoss === 'block_upheld') {
    pa._afterChallengeLoss = null;
    nextPlayer(state);
  } else {
    nextPlayer(state);
  }
}

function applyReaction(state, playerId, reaction) {
  if (![PHASES.WAITING_REACTIONS, PHASES.WAITING_BLOCK_CHALLENGE].includes(state.phase)) {
    throw new Error('Fase incorreta para reagir');
  }

  const pa = state.pendingAction;

  // ---- WAITING_BLOCK_CHALLENGE: only pass or challenge the block ----
  if (state.phase === PHASES.WAITING_BLOCK_CHALLENGE) {
    if (reaction.response === 'pass') {
      if (!pa.respondedBy.includes(playerId)) pa.respondedBy.push(playerId);
      const othersThanBlocker = state.players.filter(
        p => p.id !== pa.blockBy && p.id !== pa.actor && p.cards.some(c => !c.revealed)
      );
      if (othersThanBlocker.every(p => pa.respondedBy.includes(p.id))) {
        state.log.push('Bloqueio aceito. Ação falhou.');
        nextPlayer(state);
      }
      return;
    }

    if (reaction.response === 'challenge') {
      const blocker = state.players.find(p => p.id === pa.blockBy);
      if (hasCharacter(blocker, pa.blockCharacter)) {
        // Block is real: challenger loses influence, action still fails
        pa.challengeBy = playerId;
        pa._afterChallengeLoss = 'block_upheld';
        state.pendingAction.target = playerId;
        state.phase = PHASES.LOSE_INFLUENCE;
        state.log.push(`${pa.blockCharacter} confirmado. ${state.players.find(p => p.id === playerId).name} perde influência.`);
        // Blocker exchanges confirmed card
        const idx = blocker.cards.findIndex(c => c.character === pa.blockCharacter && !c.revealed);
        const { dealCards, shuffle } = require('./Deck');
        state.deck.push(blocker.cards[idx]);
        const [newCard] = dealCards(state.deck, 1);
        blocker.cards[idx] = { ...newCard, revealed: false };
        shuffle(state.deck);
      } else {
        // Block was a bluff: blocker loses influence, action resolves
        pa.challengeBy = playerId;
        pa._afterChallengeLoss = 'action_resolves';
        state.pendingAction.target = pa.blockBy;
        state.phase = PHASES.LOSE_INFLUENCE;
        state.log.push(`Blefe exposto. ${blocker.name} perde influência.`);
      }
      return;
    }
  }

  // ---- WAITING_REACTIONS ----
  if (reaction.response === 'pass') {
    if (!pa.respondedBy.includes(playerId)) pa.respondedBy.push(playerId);
    const othersExcludingActor = state.players.filter(
      p => p.id !== pa.actor && p.cards.some(c => !c.revealed)
    );
    if (othersExcludingActor.every(p => pa.respondedBy.includes(p.id))) {
      resolveAction(state);
    }
    return;
  }

  if (reaction.response === 'block') {
    if (!BLOCKERS[pa.type]) throw new Error('Ação não pode ser bloqueada');
    if (!BLOCKERS[pa.type].includes(reaction.character)) throw new Error('Personagem não bloqueia esta ação');
    pa.blockBy = playerId;
    pa.blockCharacter = reaction.character;
    pa.respondedBy = [];
    state.phase = PHASES.WAITING_BLOCK_CHALLENGE;
    state.log.push(`${state.players.find(p => p.id === playerId).name} bloqueia com ${reaction.character}`);
    return;
  }

  if (reaction.response === 'challenge') {
    const requiredChar = ACTION_CHARACTER[pa.type];
    const actorPlayer = state.players.find(p => p.id === pa.actor);
    const required = Array.isArray(requiredChar) ? requiredChar : [requiredChar];
    const actorHas = required.some(c => hasCharacter(actorPlayer, c));

    if (actorHas) {
      // Challenger loses, action continues
      pa.challengeBy = playerId;
      pa._afterChallengeLoss = 'action_resolves';
      state.pendingAction.target = playerId;
      state.phase = PHASES.LOSE_INFLUENCE;
      state.log.push(`${actorPlayer.name} prova ${required[0]}. ${state.players.find(p => p.id === playerId).name} perde influência.`);
      // Actor exchanges the confirmed card
      const matchChar = required.find(c => hasCharacter(actorPlayer, c));
      const idx = actorPlayer.cards.findIndex(c => c.character === matchChar && !c.revealed);
      const { dealCards, shuffle } = require('./Deck');
      state.deck.push(actorPlayer.cards[idx]);
      const [newCard] = dealCards(state.deck, 1);
      actorPlayer.cards[idx] = { ...newCard, revealed: false };
      shuffle(state.deck);
    } else {
      // Actor was bluffing: actor loses influence, action fails
      pa.challengeBy = playerId;
      pa._afterChallengeLoss = 'action_fails';
      state.pendingAction.target = pa.actor;
      state.phase = PHASES.LOSE_INFLUENCE;
      state.log.push(`${actorPlayer.name} não tem ${required[0]}. Perde influência.`);
    }
  }
}

module.exports = { applyAction, applyReaction, afterLoseInfluence, loseInfluence, getValidActions, getActivePlayers, nextPlayer };
