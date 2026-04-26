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
