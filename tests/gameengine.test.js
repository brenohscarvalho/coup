// tests/gameengine.test.js
const { createGameState } = require('../game/GameState');
const GameEngine = require('../game/GameEngine');
const { PHASES, ACTIONS } = require('../game/constants');

function makeState(playerCount = 3) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player${i + 1}`,
  }));
  return createGameState('TEST', players, 'ambassador');
}

describe('income', () => {
  test('adiciona 1 moeda ao jogador atual e avança turno', () => {
    const state = makeState();
    const first = state.currentPlayer;
    state.players.find(p => p.id === first).coins = 0;
    state.treasury = 50;
    GameEngine.applyAction(state, first, { type: ACTIONS.INCOME });
    expect(state.players.find(p => p.id === first).coins).toBe(1);
    expect(state.currentPlayer).not.toBe(first);
  });
});

describe('foreign_aid', () => {
  test('inicia fase WAITING_REACTIONS', () => {
    const state = makeState();
    const actor = state.currentPlayer;
    GameEngine.applyAction(state, actor, { type: ACTIONS.FOREIGN_AID });
    expect(state.phase).toBe(PHASES.WAITING_REACTIONS);
    expect(state.pendingAction.type).toBe(ACTIONS.FOREIGN_AID);
  });
});

describe('coup', () => {
  test('custa 7 moedas e inicia LOSE_INFLUENCE no alvo', () => {
    const state = makeState();
    const actor = state.currentPlayer;
    const target = state.players.find(p => p.id !== actor).id;
    state.players.find(p => p.id === actor).coins = 7;
    GameEngine.applyAction(state, actor, { type: ACTIONS.COUP, target });
    expect(state.players.find(p => p.id === actor).coins).toBe(0);
    expect(state.phase).toBe(PHASES.LOSE_INFLUENCE);
    expect(state.pendingAction.target).toBe(target);
  });

  test('rejeita coup sem 7 moedas', () => {
    const state = makeState();
    const actor = state.currentPlayer;
    const target = state.players.find(p => p.id !== actor).id;
    state.players.find(p => p.id === actor).coins = 6;
    expect(() =>
      GameEngine.applyAction(state, actor, { type: ACTIONS.COUP, target })
    ).toThrow();
  });

  test('obriga coup quando jogador tem 10+ moedas', () => {
    const state = makeState();
    const actor = state.currentPlayer;
    state.players.find(p => p.id === actor).coins = 10;
    const valid = GameEngine.getValidActions(state, actor);
    expect(valid).toEqual([ACTIONS.COUP]);
  });
});

describe('loseInfluence', () => {
  test('revela carta escolhida', () => {
    const state = makeState();
    const actor = state.currentPlayer;
    const target = state.players.find(p => p.id !== actor).id;
    state.players.find(p => p.id === actor).coins = 7;
    GameEngine.applyAction(state, actor, { type: ACTIONS.COUP, target });
    GameEngine.loseInfluence(state, target, 0);
    const card = state.players.find(p => p.id === target).cards[0];
    expect(card.revealed).toBe(true);
  });

  test('elimina jogador quando perde última carta', () => {
    const state = makeState();
    const target = state.players[1].id;
    state.players[1].cards[0].revealed = true;
    state.phase = PHASES.LOSE_INFLUENCE;
    state.pendingAction = { target, type: ACTIONS.COUP, actor: state.players[0].id };
    GameEngine.loseInfluence(state, target, 1);
    const eliminated = state.players.find(p => p.id === target);
    expect(eliminated.cards.every(c => c.revealed)).toBe(true);
  });
});

describe('react — pass', () => {
  test('quando todos passam, ajuda externa resolve (+2 moedas)', () => {
    const state = makeState(3);
    const actor = state.currentPlayer;
    state.players.find(p => p.id === actor).coins = 0;
    GameEngine.applyAction(state, actor, { type: ACTIONS.FOREIGN_AID });
    const others = state.players.filter(p => p.id !== actor);
    others.forEach(p => GameEngine.applyReaction(state, p.id, { response: 'pass' }));
    expect(state.players.find(p => p.id === actor).coins).toBe(2);
    expect(state.currentPlayer).not.toBe(actor);
  });
});

describe('react — block', () => {
  test('duque bloqueia ajuda externa', () => {
    const state = makeState(3);
    const actor = state.currentPlayer;
    GameEngine.applyAction(state, actor, { type: ACTIONS.FOREIGN_AID });
    const blocker = state.players.find(p => p.id !== actor);
    GameEngine.applyReaction(state, blocker.id, { response: 'block', character: 'duke' });
    expect(state.phase).toBe(PHASES.WAITING_BLOCK_CHALLENGE);
    expect(state.pendingAction.blockBy).toBe(blocker.id);
  });
});

describe('react — challenge on character action', () => {
  test('contestar tax com sucesso (ator não tem duque) ator perde influência', () => {
    const state = makeState(3);
    const actor = state.currentPlayer;
    // ensure actor does NOT have duke
    state.players.find(p => p.id === actor).cards = [
      { character: 'captain', revealed: false },
      { character: 'countess', revealed: false },
    ];
    GameEngine.applyAction(state, actor, { type: ACTIONS.TAX });
    const challenger = state.players.find(p => p.id !== actor);
    GameEngine.applyReaction(state, challenger.id, { response: 'challenge' });
    expect(state.phase).toBe(PHASES.LOSE_INFLUENCE);
    expect(state.pendingAction.target).toBe(actor);
  });

  test('contestar tax sem sucesso (ator tem duque) contestador perde influência, ação resolve após', () => {
    const state = makeState(3);
    const actor = state.currentPlayer;
    state.players.find(p => p.id === actor).cards = [
      { character: 'duke', revealed: false },
      { character: 'countess', revealed: false },
    ];
    GameEngine.applyAction(state, actor, { type: ACTIONS.TAX });
    const challenger = state.players.find(p => p.id !== actor);
    GameEngine.applyReaction(state, challenger.id, { response: 'challenge' });
    // challenger must lose influence
    expect(state.phase).toBe(PHASES.LOSE_INFLUENCE);
    expect(state.pendingAction.target).toBe(challenger.id);
    // after challenger reveals a card, tax resolves: actor gets +3 coins
    const initialCoins = state.players.find(p => p.id === actor).coins;
    GameEngine.loseInfluence(state, challenger.id, 0);
    expect(state.players.find(p => p.id === actor).coins).toBe(initialCoins + 3);
  });
});

describe('exchange (ambassador)', () => {
  test('inicia EXCHANGE_CARDS com opções após todos passarem', () => {
    const state = makeState(3);
    const actor = state.currentPlayer;
    state.players.find(p => p.id === actor).cards = [
      { character: 'ambassador', revealed: false },
      { character: 'captain', revealed: false },
    ];
    GameEngine.applyAction(state, actor, { type: ACTIONS.EXCHANGE });
    const others = state.players.filter(p => p.id !== actor);
    others.forEach(p => GameEngine.applyReaction(state, p.id, { response: 'pass' }));
    expect(state.phase).toBe(PHASES.EXCHANGE_CARDS);
    const actorState = state.players.find(p => p.id === actor);
    expect(actorState._exchangeOptions).toHaveLength(4); // 2 hand + 2 drawn
  });
});

describe('applyExchangeChoice', () => {
  test('jogador mantém 2 cartas e devolve o resto ao baralho', () => {
    const state = makeState(3);
    const actor = state.currentPlayer;
    state.players.find(p => p.id === actor)._exchangeOptions = [
      { character: 'duke', revealed: false },
      { character: 'captain', revealed: false },
      { character: 'countess', revealed: false },
      { character: 'assassin', revealed: false },
    ];
    state.phase = PHASES.EXCHANGE_CARDS;
    state.pendingAction = { actor, type: ACTIONS.EXCHANGE };
    const deckBefore = state.deck.length;
    GameEngine.applyExchangeChoice(state, actor, [0, 2]);
    expect(state.players.find(p => p.id === actor).cards).toHaveLength(2);
    expect(state.players.find(p => p.id === actor).cards[0].character).toBe('duke');
    expect(state.players.find(p => p.id === actor).cards[1].character).toBe('countess');
    expect(state.deck.length).toBe(deckBefore + 2);
  });
});

describe('assassinato duplo', () => {
  test('contestar assassino sem sucesso causa 2 perdas de influência', () => {
    const state = makeState(3);
    const actor = state.currentPlayer;
    const target = state.players.find(p => p.id !== actor).id;
    state.players.find(p => p.id === actor).cards = [
      { character: 'assassin', revealed: false },
      { character: 'duke', revealed: false },
    ];
    state.players.find(p => p.id === actor).coins = 3;
    GameEngine.applyAction(state, actor, { type: ACTIONS.ASSASSINATE, target });
    // target challenges and LOSES (actor has assassin)
    GameEngine.applyReaction(state, target, { response: 'challenge' });
    // target must lose one influence for failed challenge
    expect(state.phase).toBe(PHASES.LOSE_INFLUENCE);
    expect(state.pendingAction.target).toBe(target);
    GameEngine.loseInfluence(state, target, 0);
    // after losing from challenge, assassination still happens (second loss)
    expect(state.phase).toBe(PHASES.LOSE_INFLUENCE);
    expect(state.pendingAction.target).toBe(target);
  });
});
