const { CHARACTERS } = require('./constants');

function createDeck(playerCount, variant) {
  let copiesPerChar;
  if (playerCount <= 6) copiesPerChar = 3;
  else if (playerCount <= 8) copiesPerChar = 4;
  else copiesPerChar = 5;

  const chars = [
    CHARACTERS.DUKE,
    CHARACTERS.ASSASSIN,
    CHARACTERS.CAPTAIN,
    variant === 'inquisitor' ? CHARACTERS.INQUISITOR : CHARACTERS.AMBASSADOR,
    CHARACTERS.COUNTESS,
  ];

  const deck = [];
  for (const char of chars) {
    for (let i = 0; i < copiesPerChar; i++) {
      deck.push({ character: char });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealCards(deck, n) {
  return deck.splice(0, n);
}

module.exports = { createDeck, shuffle, dealCards };
