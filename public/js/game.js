const socket = io();
const myName = sessionStorage.getItem('playerName');
let gameState = null;
let myId = null;
let exchangeSelected = [];
let pendingAction = null;

function hideAll(...ids) { ids.forEach(id => document.getElementById(id).classList.add('hidden')); }
function show(id) { document.getElementById(id).classList.remove('hidden'); }

const CHARACTER_NAMES = {
  duke: 'Duque', assassin: 'Assassino', captain: 'Capitão',
  ambassador: 'Embaixador', countess: 'Condessa', inquisitor: 'Inquisidor',
};
const ACTION_LABELS = {
  tax: 'Taxar (+3)', assassinate: 'Assassinar (-3💰)',
  extort: 'Extorquir (+2)', exchange: 'Trocar Cartas', investigate: 'Investigar',
};
const BLOCKABLE = ['foreign_aid', 'assassinate', 'extort'];
const CHARACTER_BLOCKS = {
  foreign_aid: ['duke'],
  assassinate: ['countess'],
  extort: ['ambassador', 'inquisitor', 'captain'],
};

function me() { return gameState?.players.find(p => p.name === myName); }
function isMyTurn() {
  const self = me();
  return self && gameState?.currentPlayer === self.id;
}

socket.on('connect', () => {
  myId = socket.id;
  const roomCode = sessionStorage.getItem('roomCode');
  const playerName = sessionStorage.getItem('playerName');
  if (roomCode && playerName) socket.emit('room:join', { roomCode, playerName });
});

socket.on('game:state', (state) => {
  gameState = state;
  render();
});

socket.on('game:prompt', (prompt) => {
  if (prompt.type === 'lose_influence') showLoseInfluence();
  if (prompt.type === 'exchange_cards') showExchange(prompt.options);
  if (prompt.type === 'choose_investigate_card') showChooseInvestigateCard();
  if (prompt.type === 'investigate') showInvestigate(prompt);
});

socket.on('game:error', ({ message }) => alert(message));

function render() {
  if (!gameState) return;
  const self = me();
  if (!self) return;

  document.getElementById('treasury').textContent = gameState.treasury;
  const current = gameState.players.find(p => p.id === gameState.currentPlayer);
  document.getElementById('turnInfo').textContent = isMyTurn() ? 'Sua vez!' : `Vez de ${current?.name}`;

  const others = gameState.players.filter(p => p.name !== myName);
  document.getElementById('otherPlayers').innerHTML = others.map(p => {
    const alive = p.cards.some(c => !c.revealed);
    const cardsHtml = p.cards.map(c =>
      c.revealed
        ? `<div class="card-face revealed">${(CHARACTER_NAMES[c.character] || '?').slice(0,3)}</div>`
        : `<div class="card-face">?</div>`
    ).join('');
    return `<div class="player-row ${!alive ? 'eliminated' : ''} ${p.id === gameState.currentPlayer ? 'active' : ''}">
      <span>${p.name}${!p.connected ? ' 📵' : ''}</span>
      <span class="player-coins">💰${p.coins}</span>
      <span class="player-cards">${cardsHtml}</span>
    </div>`;
  }).join('');

  document.getElementById('myCards').innerHTML = self.cards.map(c =>
    `<div class="my-card ${c.revealed ? 'revealed' : ''}">${c.revealed ? (CHARACTER_NAMES[c.character] || '?') + ' ✕' : CHARACTER_NAMES[c.character] || '?'}</div>`
  ).join('');
  document.getElementById('myCoins').textContent = self.coins;

  renderActions(self);

  const log = document.getElementById('gameLog');
  log.innerHTML = [...gameState.log].reverse().slice(0, 20).map(l => `<p>${l}</p>`).join('');

  if (gameState.phase === 'GAME_OVER') {
    const winner = gameState.players.find(p => p.id === gameState.winner);
    document.getElementById('winnerName').textContent = `${winner?.name} venceu!`;
    show('gameOverOverlay');
  }

  if (['WAITING_REACTIONS', 'WAITING_BLOCK_CHALLENGE'].includes(gameState.phase)) {
    renderReaction();
  } else {
    hideAll('reactionOverlay');
  }
}

function renderActions(self) {
  const panel = document.getElementById('actionsPanel');
  if (!isMyTurn() || gameState.phase !== 'WAITING_ACTION') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';

  const forced = self.coins >= 10;
  const btnCoup = document.getElementById('btnCoup');
  btnCoup.style.display = '';
  btnCoup.disabled = self.coins < 7;

  if (forced) {
    document.getElementById('generalActionsButtons').innerHTML = '';
    document.getElementById('myCardActionsButtons').innerHTML = '';
    document.getElementById('bluffActionsButtons').innerHTML = '';
    return;
  }

  document.getElementById('generalActionsButtons').innerHTML = `
    <button class="btn btn-dark" onclick="doAction('income')">Renda (+1 💰)</button>
    <button class="btn btn-dark" onclick="doAction('foreign_aid')">Ajuda Externa (+2 💰)</button>
  `;

  const myChars = self.cards.filter(c => !c.revealed).map(c => c.character);
  const allActionChars = {
    tax: 'duke', assassinate: 'assassin', extort: 'captain',
    exchange: gameState.variant === 'inquisitor' ? 'inquisitor' : 'ambassador',
    ...(gameState.variant === 'inquisitor' ? { investigate: 'inquisitor' } : {}),
  };

  const myActions = Object.entries(allActionChars).filter(([, ch]) => myChars.includes(ch));
  const bluffActions = Object.entries(allActionChars).filter(([, ch]) => !myChars.includes(ch));

  document.getElementById('myCardActionsButtons').innerHTML = myActions.map(([action, ch]) => {
    const needsTarget = ['assassinate', 'extort', 'investigate'].includes(action);
    const disabled = action === 'assassinate' && self.coins < 3 ? 'disabled' : '';
    return `<button class="btn btn-dark" onclick="doAction('${action}',${needsTarget})" ${disabled}>${CHARACTER_NAMES[ch]} — ${ACTION_LABELS[action]}</button>`;
  }).join('');

  document.getElementById('bluffActionsButtons').innerHTML = bluffActions.map(([action, ch]) => {
    const needsTarget = ['assassinate', 'extort', 'investigate'].includes(action);
    const disabled = action === 'assassinate' && self.coins < 3 ? 'disabled' : '';
    return `<button class="btn btn-bluff" onclick="doAction('${action}',${needsTarget})" ${disabled}>${CHARACTER_NAMES[ch]} — ${ACTION_LABELS[action]}</button>`;
  }).join('');
}

function doAction(type, needsTarget = false) {
  if (needsTarget) { showTargetPicker(type); return; }
  socket.emit('player:action', { type });
}
window.doAction = doAction;

document.getElementById('btnCoup').addEventListener('click', () => showTargetPicker('coup'));

function showTargetPicker(actionType) {
  pendingAction = actionType;
  document.getElementById('targetTitle').textContent = actionType === 'coup' ? 'Escolha o alvo do Golpe' : 'Escolha o alvo';
  const targets = gameState.players.filter(p => p.name !== myName && p.cards.some(c => !c.revealed));
  document.getElementById('targetOptions').innerHTML = targets.map(p =>
    `<button class="btn btn-dark" onclick="chooseTarget('${p.id}')">${p.name}</button>`
  ).join('');
  show('targetOverlay');
}

window.chooseTarget = function(targetId) {
  hideAll('targetOverlay');
  socket.emit('player:action', { type: pendingAction, target: targetId });
};

document.getElementById('btnCancelTarget').addEventListener('click', () => hideAll('targetOverlay'));

function renderReaction() {
  const pa = gameState.pendingAction;
  if (!pa) return;
  const self = me();
  if (!self || self.cards.every(c => c.revealed)) return;
  if (gameState.phase === 'WAITING_REACTIONS' && self.id === pa.actor) return;
  if (gameState.phase === 'WAITING_REACTIONS' && ['assassinate','extort','investigate'].includes(pa.type) && self.id !== pa.target) return;
  if (gameState.phase === 'WAITING_BLOCK_CHALLENGE' && self.id === pa.blockBy) return;
  if (gameState.phase === 'WAITING_BLOCK_CHALLENGE' && pa.type === 'assassinate' && self.id !== pa.actor) return;
  if (pa.respondedBy?.includes(self.id)) return;

  const actorName = gameState.players.find(p => p.id === pa.actor)?.name;
  const actionLabels = {
    foreign_aid: 'Ajuda Externa', tax: 'Taxar', assassinate: 'Assassinar',
    extort: 'Extorquir', exchange: 'Trocar Cartas', investigate: 'Investigar',
  };
  document.getElementById('reactionTitle').textContent = `${actorName} está usando ${actionLabels[pa.type] || pa.type}`;
  document.getElementById('reactionSub').textContent = pa.blockBy
    ? `Bloqueado por ${gameState.players.find(p => p.id === pa.blockBy)?.name}` : '';

  const passed = pa.respondedBy?.map(id => gameState.players.find(p => p.id === id)?.name).filter(Boolean).join(', ');
  document.getElementById('reactionsPassed').textContent = passed ? `Passaram: ${passed}` : '';

  const hasChallengeable = ['tax','assassinate','extort','exchange','investigate'].includes(pa.type);
  const btnChallenge = document.getElementById('btnChallenge');
  btnChallenge.style.display = (hasChallengeable || gameState.phase === 'WAITING_BLOCK_CHALLENGE') ? '' : 'none';

  const blockOpts = document.getElementById('blockOptions');
  if (gameState.phase === 'WAITING_REACTIONS' && BLOCKABLE.includes(pa.type) && pa.actor !== self.id) {
    const blockers = CHARACTER_BLOCKS[pa.type] || [];
    blockOpts.innerHTML = blockers.map(ch =>
      `<button class="btn btn-outline" onclick="react('block','${ch}')">Bloquear (${CHARACTER_NAMES[ch]})</button>`
    ).join('');
  } else {
    blockOpts.innerHTML = '';
  }

  document.getElementById('btnPass').onclick = () => react('pass');
  document.getElementById('btnChallenge').onclick = () => react('challenge');
  show('reactionOverlay');
}

function react(response, character = null) {
  hideAll('reactionOverlay');
  socket.emit('player:react', { response, character });
}
window.react = react;

function showLoseInfluence() {
  const self = me();
  if (!self) return;
  document.getElementById('loseInfluenceOptions').innerHTML = self.cards.map((c, i) =>
    c.revealed ? '' : `<button class="btn btn-dark" onclick="loseCard(${i})">${CHARACTER_NAMES[c.character] || '?'}</button>`
  ).join('');
  show('loseInfluenceOverlay');
}

window.loseCard = function(index) {
  hideAll('loseInfluenceOverlay');
  socket.emit('player:lose-influence', { cardIndex: index });
};

function showExchange(options) {
  exchangeSelected = [];
  const self = me();
  const activeCards = self?.cards.filter(c => !c.revealed).length || 0;
  document.getElementById('exchangeSubtitle').textContent = `Escolha ${activeCards} carta(s) para manter`;
  document.getElementById('exchangeOptions').innerHTML = (options || []).map((c, i) =>
    `<button class="btn btn-outline" id="exOpt${i}" onclick="toggleExchange(${i})">${CHARACTER_NAMES[c.character] || '?'}</button>`
  ).join('');
  show('exchangeOverlay');
}

window.toggleExchange = function(i) {
  const btn = document.getElementById(`exOpt${i}`);
  const idx = exchangeSelected.indexOf(i);
  if (idx === -1) { exchangeSelected.push(i); btn.classList.replace('btn-outline', 'btn-dark'); }
  else { exchangeSelected.splice(idx, 1); btn.classList.replace('btn-dark', 'btn-outline'); }
};

document.getElementById('btnConfirmExchange').addEventListener('click', () => {
  hideAll('exchangeOverlay');
  socket.emit('player:exchange-choose', { keepIndexes: exchangeSelected });
});

function showChooseInvestigateCard() {
  const self = me();
  if (!self) return;
  document.getElementById('chooseInvestigateOptions').innerHTML = self.cards.map((c, i) =>
    c.revealed ? '' : `<button class="btn btn-dark" onclick="revealToInquisitor(${i})">${CHARACTER_NAMES[c.character] || '?'}</button>`
  ).join('');
  show('chooseInvestigateOverlay');
}

window.revealToInquisitor = function(index) {
  hideAll('chooseInvestigateOverlay');
  socket.emit('player:investigate-show', { cardIndex: index });
};

document.getElementById('btnContestInvestigate').addEventListener('click', () => {
  hideAll('chooseInvestigateOverlay');
  socket.emit('player:investigate-contest');
});

function showInvestigate(prompt) {
  document.getElementById('investigateTitle').textContent = `Carta de ${prompt.targetName}`;
  document.getElementById('investigatedCard').textContent = CHARACTER_NAMES[prompt.card?.character] || '?';
  document.getElementById('btnForceSwap').onclick = () => { hideAll('investigateOverlay'); socket.emit('player:investigate-decide', { forceSwap: true }); };
  document.getElementById('btnKeepCard').onclick = () => { hideAll('investigateOverlay'); socket.emit('player:investigate-decide', { forceSwap: false }); };
  show('investigateOverlay');
}
