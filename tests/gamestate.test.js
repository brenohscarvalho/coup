// tests/gamestate.test.js
const { createGameState, filterStateForPlayer } = require('../game/GameState');
const { PHASES } = require('../game/constants');

const mockPlayers = [
  { id: 'p1', name: 'Ana' },
  { id: 'p2', name: 'Bruno' },
  { id: 'p3', name: 'Carol' },
];

describe('createGameState', () => {
  test('cria estado inicial com fase WAITING_ACTION', () => {
    const state = createGameState('COUP-42', mockPlayers, 'ambassador');
    expect(state.phase).toBe(PHASES.WAITING_ACTION);
    expect(state.roomCode).toBe('COUP-42');
    expect(state.players).toHaveLength(3);
  });

  test('cada jogador começa com 2 moedas (3+ jogadores)', () => {
    const state = createGameState('COUP-42', mockPlayers, 'ambassador');
    state.players.forEach(p => expect(p.coins).toBe(2));
  });

  test('cada jogador começa com 2 cartas viradas para baixo', () => {
    const state = createGameState('COUP-42', mockPlayers, 'ambassador');
    state.players.forEach(p => {
      expect(p.cards).toHaveLength(2);
      p.cards.forEach(c => expect(c.revealed).toBe(false));
    });
  });

  test('tesouro tem 50 menos as moedas distribuídas (3 jogadores × 2 = 6)', () => {
    const state = createGameState('COUP-42', mockPlayers, 'ambassador');
    expect(state.treasury).toBe(50 - mockPlayers.length * 2);
  });
});

describe('filterStateForPlayer', () => {
  test('oculta cartas não reveladas dos outros jogadores', () => {
    const state = createGameState('COUP-42', mockPlayers, 'ambassador');
    const view = filterStateForPlayer(state, 'p1');
    const others = view.players.filter(p => p.id !== 'p1');
    others.forEach(p => {
      p.cards.forEach(c => expect(c.character).toBeUndefined());
    });
  });

  test('mostra próprias cartas ao jogador', () => {
    const state = createGameState('COUP-42', mockPlayers, 'ambassador');
    const view = filterStateForPlayer(state, 'p1');
    const self = view.players.find(p => p.id === 'p1');
    self.cards.forEach(c => expect(c.character).toBeDefined());
  });

  test('cartas reveladas dos outros ficam visíveis', () => {
    const state = createGameState('COUP-42', mockPlayers, 'ambassador');
    state.players[1].cards[0].revealed = true;
    const view = filterStateForPlayer(state, 'p1');
    const other = view.players.find(p => p.id === 'p2');
    expect(other.cards[0].character).toBeDefined();
  });

  test('deck não é enviado ao cliente', () => {
    const state = createGameState('COUP-42', mockPlayers, 'ambassador');
    const view = filterStateForPlayer(state, 'p1');
    expect(view.deck).toBeUndefined();
  });
});
