const { createDeck, shuffle, dealCards } = require('../game/Deck');
const { CHARACTERS } = require('../game/constants');

describe('createDeck', () => {
  test('cria 15 cartas para 2-6 jogadores', () => {
    const deck = createDeck(4, 'ambassador');
    expect(deck).toHaveLength(15);
  });

  test('cria 20 cartas para 7-8 jogadores', () => {
    const deck = createDeck(7, 'ambassador');
    expect(deck).toHaveLength(20);
  });

  test('cria 25 cartas para 9-10 jogadores', () => {
    const deck = createDeck(9, 'ambassador');
    expect(deck).toHaveLength(25);
  });

  test('variante inquisitor substitui ambassador', () => {
    const deck = createDeck(4, 'inquisitor');
    const chars = deck.map(c => c.character);
    expect(chars).not.toContain(CHARACTERS.AMBASSADOR);
    expect(chars.filter(c => c === CHARACTERS.INQUISITOR)).toHaveLength(3);
  });
});

describe('shuffle', () => {
  test('retorna array com mesmo comprimento', () => {
    const deck = createDeck(4, 'ambassador');
    const shuffled = shuffle([...deck]);
    expect(shuffled).toHaveLength(deck.length);
  });
});

describe('dealCards', () => {
  test('remove n cartas do topo do baralho', () => {
    const deck = createDeck(4, 'ambassador');
    const original = deck.length;
    const hand = dealCards(deck, 2);
    expect(hand).toHaveLength(2);
    expect(deck).toHaveLength(original - 2);
  });
});
