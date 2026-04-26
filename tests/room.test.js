const Room = require('../game/Room');

describe('Room', () => {
  test('cria sala com código no formato COUP-XX', () => {
    const room = new Room('p1', 'Alessandro');
    expect(room.code).toMatch(/^COUP-\d+$/);
    expect(room.hostId).toBe('p1');
  });

  test('rejeita nome duplicado', () => {
    const room = new Room('p1', 'Ana');
    expect(() => room.addPlayer('p2', 'Ana')).toThrow('Nome já em uso');
  });

  test('rejeita mais de 10 jogadores', () => {
    const room = new Room('p1', 'P1');
    for (let i = 2; i <= 10; i++) room.addPlayer(`p${i}`, `P${i}`);
    expect(() => room.addPlayer('p11', 'P11')).toThrow('Sala cheia');
  });

  test('reconecta jogador pelo nome', () => {
    const room = new Room('p1', 'Ana');
    room.addPlayer('p2', 'Bruno');
    room.handleDisconnect('p2');
    const reconnected = room.reconnect('p3', 'Bruno');
    expect(reconnected).toBe(true);
    expect(room.players.find(p => p.name === 'Bruno').id).toBe('p3');
  });

  test('reconnect retorna false para jogador desconhecido', () => {
    const room = new Room('p1', 'Ana');
    const result = room.reconnect('p99', 'Carlos');
    expect(result).toBe(false);
  });
});
