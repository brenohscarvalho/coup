const { EventEmitter } = require('events');

class Room extends EventEmitter {
  constructor(hostId, hostName) {
    super();
    this.code = `COUP-${Math.floor(Math.random() * 90 + 10)}`;
    this.hostId = hostId;
    this.players = [{ id: hostId, name: hostName, connected: true }];
    this.gameState = null;
    this.reactionTimer = null;
    this.reconnectTimers = {};
  }

  addPlayer(id, name) {
    if (this.players.length >= 10) throw new Error('Sala cheia');
    if (this.players.find(p => p.name === name)) throw new Error('Nome já em uso');
    this.players.push({ id, name, connected: true });
  }

  removePlayer(id) {
    this.players = this.players.filter(p => p.id !== id);
  }

  handleDisconnect(id) {
    const p = this.players.find(p => p.id === id);
    if (!p) return;
    p.connected = false;
    if (this.gameState) {
      const gp = this.gameState.players.find(g => g.id === id);
      if (gp) gp.connected = false;
      this.reconnectTimers[id] = setTimeout(() => {
        this.eliminateDisconnected(id);
      }, 60000);
    }
  }

  reconnect(newId, name) {
    const p = this.players.find(p => p.name === name && !p.connected);
    if (!p) return false;
    const oldId = p.id;
    p.id = newId;
    p.connected = true;
    if (this.gameState) {
      const gp = this.gameState.players.find(g => g.id === oldId);
      if (gp) { gp.id = newId; gp.connected = true; }
    }
    clearTimeout(this.reconnectTimers[oldId]);
    delete this.reconnectTimers[oldId];
    return true;
  }

  eliminateDisconnected(id) {
    if (!this.gameState) return;
    const gp = this.gameState.players.find(p => p.id === id);
    if (!gp) return;
    gp.cards.forEach(c => { c.revealed = true; });
    this.emit('player-eliminated', id);
  }

  startReactionTimer(ms, callback) {
    this.clearReactionTimer();
    this.reactionTimer = setTimeout(callback, ms);
  }

  clearReactionTimer() {
    if (this.reactionTimer) {
      clearTimeout(this.reactionTimer);
      this.reactionTimer = null;
    }
  }
}

module.exports = Room;
