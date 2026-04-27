/* ── game.js ─────────────────────────────────────────────── */

const socket   = io();
const myName   = sessionStorage.getItem('playerName');
let gameState  = null;
let pendingAction = null;
let exchangeSelected = [];

/* ── Character / action data ──────────────────────────────── */

const CHARS = {
  duke:       { name:'Duque',      abbr:'D',  color:'#28066e', accent:'#7c3aed' },
  assassin:   { name:'Assassino',  abbr:'A',  color:'#6b0f0f', accent:'#dc2626' },
  captain:    { name:'Capitão',    abbr:'Ca', color:'#0c2a5c', accent:'#2563eb' },
  inquisitor: { name:'Inquisidor', abbr:'In', color:'#0f3a28', accent:'#059669' },
  countess:   { name:'Condessa',   abbr:'Co', color:'#5c0f3a', accent:'#db2777' },
  ambassador: { name:'Embaixador', abbr:'Em', color:'#3a3a0f', accent:'#ca8a04' },
};

const ACTION_NAMES = {
  income:'Renda', foreign_aid:'Ajuda Externa', coup:'Golpe de Estado',
  tax:'Taxar', assassinate:'Assassinar', extort:'Extorquir',
  exchange:'Trocar Cartas', investigate:'Investigar',
};

const ACTION_DESCS = {
  income:'Pegue 1 moeda do tesouro.',
  foreign_aid:'Pegue 2 moedas do tesouro.',
  coup:'Elimine uma carta (−7 moedas).',
  tax:'Duque: pegue 3 moedas.',
  assassinate:'Assassino: elimine uma carta (−3 moedas).',
  extort:'Capitão: roube 2 moedas de alguém.',
  exchange:'Troque suas cartas com o baralho.',
  investigate:'Veja e possivelmente troque a carta de alguém.',
};

const ACTION_CHAR = {
  tax:'duke', assassinate:'assassin', extort:'captain', investigate:'inquisitor',
};

const BLOCKABLE   = ['foreign_aid','assassinate','extort'];
const CHALLENGEABLE = ['tax','assassinate','extort','exchange','investigate'];

const CHARACTER_BLOCKS = {
  foreign_aid: ['duke'],
  assassinate: ['countess'],
  extort:      ['captain','ambassador','inquisitor'],
};

const PLAYER_COLORS = ['#8b2020','#1a5c3a','#1a3a7a','#6b1a6b','#7a4a0a','#2a5c5c','#5c2a5c','#5c5c2a'];

/* ── Table geometry ───────────────────────────────────────── */

const TABLE_WW = 380, TABLE_WH = 520;
const cx = TABLE_WW / 2, cy = TABLE_WH / 2;
const rx = 148, ry = 212;

/* ── HTML helpers ─────────────────────────────────────────── */

function coinHTML(size) {
  return `<span class="coin" style="width:${size}px;height:${size}px;font-size:${Math.round(size*.38)}px;">◉</span>`;
}

function coinsLabelHTML(count, size = 17) {
  return `<span class="coins-label">${coinHTML(size)}<span class="coins-count" style="font-size:${Math.round(size*.78)}px;">${count}</span></span>`;
}

function cardBackHTML(size) {
  const dims = { xs:[28,38], sm:[42,58], md:[80,110], lg:[100,138] };
  const [w, h] = dims[size] || dims.sm;
  const r = size === 'xs' ? 4 : size === 'sm' ? 6 : 9;
  return `<div class="card-back ${size}" style="width:${w}px;height:${h}px;">
    <span class="card-back-gem" style="font-size:${Math.round(h*.2)}px;">✦</span>
  </div>`;
}

function charCardHTML(character, size = 'md', eliminated = false) {
  const ch = CHARS[character];
  if (!ch) return cardBackHTML(size);
  const dims = { xs:[28,38], sm:[42,58], md:[80,110], lg:[100,138] };
  const [w, h] = dims[size] || dims.md;
  const artH  = Math.floor(h * .63);
  const nameH = h - artH;
  const abbFz = { xs:9, sm:13, md:22, lg:28 }[size] || 22;
  const maxByWidth = Math.floor((w - 8) / (ch.name.length * 0.58));
  const nameFz = Math.max(7, Math.min(Math.floor(nameH * .34), maxByWidth));
  const op    = eliminated ? 'opacity:.3;filter:grayscale(.9);' : '';
  const shadow = eliminated
    ? '0 2px 6px rgba(0,0,0,.4)'
    : `0 6px 18px rgba(0,0,0,.5),0 0 0 1px ${ch.accent}22`;
  return `<div class="char-card ${size}" style="width:${w}px;height:${h}px;border:1.5px solid ${ch.accent}55;box-shadow:${shadow};${op}">
    <div class="char-card-art" style="height:${artH}px;background:linear-gradient(148deg,${ch.color},${ch.accent}cc);">
      <div class="char-card-art-inner"></div>
      <span class="char-card-abbr" style="font-size:${abbFz}px;text-shadow:0 2px 10px rgba(0,0,0,.55),0 0 28px ${ch.accent}88;">${ch.abbr}</span>
      ${eliminated ? '<div class="char-card-elim">✕</div>' : ''}
    </div>
    <div class="char-card-name" style="height:${nameH}px;">
      <span style="font-size:${nameFz}px;color:${ch.color};">${ch.name}</span>
    </div>
  </div>`;
}

/* ── Scale ────────────────────────────────────────────────── */

function computeScale() {
  const topH    = 52;
  const botH    = document.getElementById('my-area').offsetHeight || 120;
  const availW  = window.innerWidth;
  const availH  = Math.max(window.innerHeight - topH - botH, 120);
  return Math.min(availW / TABLE_WW, availH / TABLE_WH, 1.1);
}

function applyScale() {
  document.getElementById('table-wrapper').style.transform = `scale(${computeScale()})`;
}

window.addEventListener('resize', applyScale);
applyScale();

/* ── Helpers ──────────────────────────────────────────────── */

function me()       { return gameState?.players.find(p => p.name === myName) }
function isMyTurn() { const s = me(); return s && gameState?.currentPlayer === s.id }

function showModal(id)  { document.getElementById(id).classList.remove('hidden') }
function hideModal(id)  { document.getElementById(id).classList.add('hidden') }
function hideAll(...ids){ ids.forEach(id => hideModal(id)) }

/* ── Socket events ────────────────────────────────────────── */

socket.on('connect', () => {
  const roomCode   = sessionStorage.getItem('roomCode');
  const playerName = sessionStorage.getItem('playerName');
  if (roomCode && playerName) socket.emit('room:join', { roomCode, playerName });
});

socket.on('game:state', state => {
  gameState = state;
  render();
});

socket.on('game:prompt', prompt => {
  if (prompt.type === 'lose_influence')          showLoseInfluence();
  if (prompt.type === 'exchange_cards')          showExchange(prompt.options);
  if (prompt.type === 'choose_investigate_card') showChooseInvestigateCard();
  if (prompt.type === 'investigate')             showInvestigate(prompt);
});

socket.on('game:error', ({ message }) => alert(message));

function restartGame() {
  socket.emit('room:restart');
}

socket.on('room:restarted', ({ roomCode, isHost }) => {
  sessionStorage.setItem('roomCode', roomCode);
  sessionStorage.setItem('isHost', isHost ? '1' : '0');
  window.location.href = '/lobby.html';
});

/* ── Main render ──────────────────────────────────────────── */

function render() {
  if (!gameState) return;
  const self = me();
  if (!self) return;

  applyScale();
  renderTopBar(self);
  renderTable();
  renderMyArea(self);

  if (gameState.phase === 'GAME_OVER') {
    showGameOver();
    return;
  }

  if (['WAITING_REACTIONS','WAITING_BLOCK_CHALLENGE'].includes(gameState.phase)) {
    renderReaction();
  } else {
    hideModal('modal-reaction');
  }
}

/* ── Top bar ──────────────────────────────────────────────── */

function renderTopBar(self) {
  const treasury = gameState.treasury;

  document.getElementById('treasury-top-coin').innerHTML  = coinHTML(17);
  document.getElementById('treasury-top-count').textContent = treasury;

  const pill = document.getElementById('turn-pill');
  if (isMyTurn() && gameState.phase === 'WAITING_ACTION') {
    pill.textContent = 'Sua Vez!';
    pill.className   = 'my-turn';
  } else {
    const cur = gameState.players.find(p => p.id === gameState.currentPlayer);
    pill.textContent = cur ? `Vez de ${cur.name}` : 'Aguardando';
    pill.className   = 'waiting';
  }
}

/* ── Oval table ───────────────────────────────────────────── */

function renderTable() {
  const { players, treasury, log } = gameState;
  const others   = players.filter(p => p.name !== myName);
  const total    = others.length + 1;
  const compact  = total >= 7;
  const step     = (2 * Math.PI) / total;
  const myAngle  = -Math.PI / 2;

  /* treasury + log inside felt */
  document.getElementById('treasury-felt-coin').innerHTML    = coinHTML(14);
  document.getElementById('treasury-felt-count').textContent = treasury;

  const logEl = document.getElementById('game-log-container');
  logEl.innerHTML = log.slice(-12).map((e, i, arr) => {
    const isLast = i === arr.length - 1;
    const col    = isLast ? '#2d7a4a' : i >= arr.length - 3 ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.15)';
    return `<div style="font-size:9.5px;line-height:1.5;text-align:center;color:${col};font-weight:${isLast?700:400};">${e}</div>`;
  }).join('');
  logEl.scrollTop = logEl.scrollHeight;

  /* seats */
  const seats = document.getElementById('player-seats');
  seats.innerHTML = others.map((p, i) => {
    const angle = myAngle + (i + 1) * step;
    const x     = cx + rx * Math.cos(angle);
    const y     = cy - ry * Math.sin(angle);
    const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
    return buildSeat(p, color, x, y, compact);
  }).join('');
}

function buildSeat(p, color, x, y, compact) {
  const avatarSz = compact ? 34 : 50;
  const panelW   = compact ? 68 : 92;
  const nameFz   = compact ? 9  : 11;
  const coinSz   = compact ? 12 : 15;
  const cardSz   = compact ? 'xs' : 'sm';
  const alive    = p.cards ? p.cards.some(c => !c.revealed) : (p.cardCount > 0);
  const active   = p.id === gameState.currentPlayer && !p.eliminated;
  const cardCount= p.cardCount ?? (p.cards?.filter(c=>!c.revealed).length ?? 0);

  const borderActive = active ? `var(--gold)` : `rgba(201,146,42,.25)`;
  const panelBorder  = active ? 'var(--gold)' : 'rgba(92,61,30,.22)';

  const badge = active ? `<div class="seat-badge">JOGANDO</div>` : '';
  const avatarPulse = active ? 'animation:pulse 2.2s infinite;' : '';

  let cardsHtml = '';
  if (!alive) {
    const elimBack = `<div class="card-back ${cardSz}" style="width:${cardSz==='xs'?28:42}px;height:${cardSz==='xs'?38:58}px;opacity:.15;"></div>`;
    cardsHtml = elimBack + elimBack;
  } else {
    cardsHtml = Array.from({ length: Math.max(cardCount, 0) }).map(() => cardBackHTML(cardSz)).join('');
  }

  const coinsOrElim = alive
    ? coinsLabelHTML(p.coins, coinSz)
    : `<span class="seat-elim">ELIM.</span>`;

  return `<div class="player-seat" style="left:${x}px;top:${y}px;">
    ${badge}
    <div class="seat-avatar" style="width:${avatarSz}px;height:${avatarSz}px;
      background:radial-gradient(circle at 38% 38%,${color}ee,${color}88);
      font-size:${compact?11:16}px;
      border:${active?`${compact?2:3}px solid var(--gold)`:`${compact?1:2}px solid rgba(201,146,42,.25)`};
      box-shadow:${active?'0 0 0 3px rgba(201,146,42,.2)':'0 3px 10px rgba(0,0,0,.4)'};
      opacity:${alive?1:.3};${avatarPulse}">
      ${p.name.slice(0,2).toUpperCase()}
    </div>
    <div class="seat-panel ${compact?'compact':''}" style="min-width:${panelW}px;
      border:${compact?'1px':'1.5px'} solid ${panelBorder};
      box-shadow:${active?'0 0 14px rgba(201,146,42,.25)':'0 3px 10px rgba(0,0,0,.3)'};">
      <span class="seat-name ${compact?'compact':''}">${p.name}</span>
      ${coinsOrElim}
      <div class="seat-cards-row">${cardsHtml}</div>
    </div>
  </div>`;
}

/* ── My area ──────────────────────────────────────────────── */

function renderMyArea(self) {
  const turn = isMyTurn() && gameState.phase === 'WAITING_ACTION';

  const avatar = document.getElementById('my-avatar');
  avatar.textContent = myName.slice(0, 2).toUpperCase();
  avatar.className   = turn ? 'my-turn' : '';

  document.getElementById('my-name-text').textContent     = myName;
  document.getElementById('my-coins-label').innerHTML     = coinsLabelHTML(self.coins, 17);

  document.getElementById('my-cards-row').innerHTML = self.cards.map(c =>
    c.revealed ? charCardHTML(c.character, 'lg', true) : charCardHTML(c.character, 'lg')
  ).join('');

  const btnAgir = document.getElementById('btn-agir');
  if (turn) btnAgir.classList.remove('hidden');
  else      btnAgir.classList.add('hidden');
}

/* ── Actions modal ────────────────────────────────────────── */

document.getElementById('btn-agir').addEventListener('click', () => {
  renderActionsModal();
  showModal('modal-actions');
});

document.getElementById('modal-actions').addEventListener('click', () => hideModal('modal-actions'));

function renderActionsModal() {
  const self = me();
  if (!self) return;

  document.getElementById('actions-coins').innerHTML = coinsLabelHTML(self.coins, 16);

  const myChars = self.cards.filter(c => !c.revealed).map(c => c.character);
  const forced  = self.coins >= 10;

  const exchChar = gameState.variant === 'inquisitor' ? 'inquisitor' : 'ambassador';
  const allCardActions = [
    { type:'tax',         char:'duke',    cost:0,  gain:3,  needsTarget:false },
    { type:'extort',      char:'captain', cost:0,  gain:2,  needsTarget:true  },
    { type:'assassinate', char:'assassin',cost:3,  gain:0,  needsTarget:true  },
    { type:'exchange',    char:exchChar,  cost:0,  gain:0,  needsTarget:false },
    ...(gameState.variant === 'inquisitor'
      ? [{ type:'investigate', char:'inquisitor', cost:0, gain:0, needsTarget:true }]
      : []),
  ];

  const myCardActions    = allCardActions.filter(a => myChars.includes(a.char));
  const bluffActions     = allCardActions.filter(a => !myChars.includes(a.char));

  let html = '';

  if (!forced) {
    html += `<div class="modal-section-label">Ações Gerais</div>`;
    html += actionBtn('income',      0, 1,  false, 'solid', null);
    html += actionBtn('foreign_aid', 0, 2,  false, 'solid', null);
  }

  if (!forced && myCardActions.length) {
    html += `<div class="modal-section-label">Suas Cartas</div>`;
    myCardActions.forEach(a => {
      html += actionBtn(a.type, a.cost, a.gain, a.needsTarget, 'solid', CHARS[a.char], self.coins);
    });
  }

  if (!forced) {
    html += `<div class="modal-section-label">Blefar Como...</div>`;
    bluffActions.forEach(a => {
      html += actionBtn(a.type, a.cost, a.gain, a.needsTarget, 'dashed', CHARS[a.char], self.coins);
    });
  }

  const canCoup = self.coins >= 7;
  html += `<button class="action-btn-golpe ${canCoup?'can':'cant'}" onclick="startAction('coup',true)"
    ${canCoup?'':'disabled'}>Golpe de Estado 🪙7</button>`;

  document.getElementById('actions-container').innerHTML = html;
}

function actionBtn(type, cost, gain, needsTarget, style, charObj, coins = 99) {
  const ok  = cost === 0 || coins >= cost;
  const pre = charObj ? `${charObj.name} — ` : '';
  const suf = gain ? ` (+${gain} 🪙)` : cost ? ` (−${cost} 🪙)` : '';
  const cls = `action-btn action-btn-${style}`;
  const nt  = needsTarget ? 'true' : 'false';
  return `<button class="${cls}" ${ok?'':'disabled'} onclick="startAction('${type}',${nt})">${pre}${ACTION_NAMES[type]}${suf}</button>`;
}

window.startAction = function(type, needsTarget) {
  hideModal('modal-actions');
  if (needsTarget) { showTargetPicker(type); return; }
  socket.emit('player:action', { type });
};

/* ── Target picker ────────────────────────────────────────── */

function showTargetPicker(type) {
  pendingAction = type;
  const titles = { coup:'Escolha o alvo do Golpe', extort:'Escolha o alvo da Extorsão', assassinate:'Escolha o alvo do Assassinato', investigate:'Escolha quem investigar' };
  document.getElementById('target-title').textContent = titles[type] || 'Escolha o alvo';

  const targets = gameState.players.filter(p => p.name !== myName && p.cards && p.cards.some(c => !c.revealed));
  document.getElementById('target-options').innerHTML = targets.map(p =>
    `<button class="action-btn action-btn-solid" onclick="chooseTarget('${p.id}')">${p.name}</button>`
  ).join('');
  showModal('modal-target');
}

window.chooseTarget = function(targetId) {
  hideModal('modal-target');
  socket.emit('player:action', { type: pendingAction, target: targetId });
};

document.getElementById('btn-cancel-target').addEventListener('click', () => hideModal('modal-target'));

/* ── Reaction / challenge modal ───────────────────────────── */

function renderReaction() {
  const pa   = gameState.pendingAction;
  if (!pa) return;
  const self = me();
  if (!self || self.cards.every(c => c.revealed)) return;

  if (gameState.phase === 'WAITING_REACTIONS') {
    if (self.id === pa.actor) return;
    if (['assassinate','extort','investigate'].includes(pa.type) && self.id !== pa.target) return;
  }
  if (gameState.phase === 'WAITING_BLOCK_CHALLENGE') {
    if (self.id === pa.blockBy) return;
    if (pa.type === 'assassinate' && self.id !== pa.actor) return;
  }
  if (pa.respondedBy?.includes(self.id)) return;

  const actorName = gameState.players.find(p => p.id === pa.actor)?.name || '?';
  const blocker   = pa.blockBy ? gameState.players.find(p => p.id === pa.blockBy)?.name : null;

  document.getElementById('reaction-who').textContent =
    blocker ? `${blocker} está bloqueando` : `${actorName} está usando`;

  const charKey = gameState.phase === 'WAITING_BLOCK_CHALLENGE' ? pa.blockCharacter : ACTION_CHAR[pa.type];
  const ch      = charKey ? CHARS[charKey] : null;
  const iconEl  = document.getElementById('reaction-char-icon');
  if (ch) {
    iconEl.className = 'char-icon';
    iconEl.style.cssText = `background:linear-gradient(148deg,${ch.color},${ch.accent}cc);box-shadow:0 8px 28px ${ch.accent}44;border:1.5px solid ${ch.accent}44;`;
    iconEl.textContent = ch.abbr;
  } else {
    iconEl.className = 'hidden';
  }

  const actionName = gameState.phase === 'WAITING_BLOCK_CHALLENGE'
    ? `Bloquear (${ch?.name || '?'})` : ACTION_NAMES[pa.type] || pa.type;
  document.getElementById('reaction-action-name').textContent = actionName;
  document.getElementById('reaction-action-desc').textContent = ACTION_DESCS[pa.type] || '';

  let btns = `<button class="react-btn react-btn-pass" onclick="react('pass')">✓ PASSAR</button>`;

  if (gameState.phase === 'WAITING_REACTIONS' && BLOCKABLE.includes(pa.type) && self.id !== pa.actor) {
    (CHARACTER_BLOCKS[pa.type] || []).forEach(blockChar => {
      btns += `<button class="react-btn react-btn-block" onclick="react('block','${blockChar}')">⊘ Bloquear (${CHARS[blockChar]?.name})</button>`;
    });
  }

  const challengeable = CHALLENGEABLE.includes(pa.type) || gameState.phase === 'WAITING_BLOCK_CHALLENGE';
  if (challengeable) {
    btns += `<button class="react-btn react-btn-challenge" onclick="react('challenge')">✕ CONTESTAR</button>`;
  }

  document.getElementById('reaction-btns').innerHTML = btns;
  showModal('modal-reaction');
}

window.react = function(response, character = null) {
  hideModal('modal-reaction');
  socket.emit('player:react', { response, character });
};

/* ── Lose influence ───────────────────────────────────────── */

function showLoseInfluence() {
  const self = me();
  if (!self) return;
  document.getElementById('lose-cards').innerHTML = self.cards.map((c, i) =>
    c.revealed ? '' : `<div onclick="loseCard(${i})" style="cursor:pointer">${charCardHTML(c.character,'md',false)}</div>`
  ).join('');
  showModal('modal-lose');
}

window.loseCard = function(index) {
  hideModal('modal-lose');
  socket.emit('player:lose-influence', { cardIndex: index });
};

/* ── Exchange ─────────────────────────────────────────────── */

function showExchange(options) {
  exchangeSelected = [];
  const self      = me();
  const keepCount = self?.cards.filter(c => !c.revealed).length || 0;
  document.getElementById('exchange-subtitle').textContent = `Escolha ${keepCount} carta(s) para manter`;

  document.getElementById('exchange-options').innerHTML = (options || []).map((c, i) => {
    const ch = CHARS[c.character];
    return `<button class="action-btn action-btn-dashed" id="exOpt${i}" onclick="toggleExchange(${i})">
      ${ch ? ch.name : '?'}
    </button>`;
  }).join('');
  showModal('modal-exchange');
}

window.toggleExchange = function(i) {
  const btn = document.getElementById(`exOpt${i}`);
  const idx = exchangeSelected.indexOf(i);
  if (idx === -1) {
    const self = me();
    const activeCount = self?.cards.filter(c => !c.revealed).length || 0;
    while (exchangeSelected.length >= activeCount) {
      const removed = exchangeSelected.shift();
      document.getElementById(`exOpt${removed}`)?.classList.replace('action-btn-solid','action-btn-dashed');
    }
    exchangeSelected.push(i);
    btn.classList.replace('action-btn-dashed','action-btn-solid');
  } else {
    exchangeSelected.splice(idx, 1);
    btn.classList.replace('action-btn-solid','action-btn-dashed');
  }
};

document.getElementById('btn-confirm-exchange').addEventListener('click', () => {
  const self = me();
  const activeCount = self?.cards.filter(c => !c.revealed).length || 0;
  if (exchangeSelected.length !== activeCount) {
    alert(`Selecione exatamente ${activeCount} carta(s) para manter`);
    return;
  }
  hideModal('modal-exchange');
  socket.emit('player:exchange-choose', { keepIndexes: exchangeSelected });
});

/* ── Investigate: choose card to show ────────────────────── */

function showChooseInvestigateCard() {
  const self = me();
  if (!self) return;
  document.getElementById('investigate-choose-cards').innerHTML = self.cards.map((c, i) =>
    c.revealed ? '' : `<div onclick="revealToInquisitor(${i})" style="cursor:pointer">${charCardHTML(c.character,'md',false)}</div>`
  ).join('');
  showModal('modal-investigate-choose');
}

window.revealToInquisitor = function(index) {
  hideModal('modal-investigate-choose');
  socket.emit('player:investigate-show', { cardIndex: index });
};

document.getElementById('btn-contest-investigate').addEventListener('click', () => {
  hideModal('modal-investigate-choose');
  socket.emit('player:investigate-contest');
});

/* ── Investigate: view card ───────────────────────────────── */

function showInvestigate(prompt) {
  document.getElementById('investigate-title').textContent = `Carta de ${prompt.targetName}`;
  document.getElementById('investigate-card-display').innerHTML = charCardHTML(prompt.card?.character, 'md', false);
  showModal('modal-investigate-show');
}

document.getElementById('btn-force-swap').addEventListener('click', () => {
  hideModal('modal-investigate-show');
  socket.emit('player:investigate-decide', { forceSwap: true });
});

document.getElementById('btn-keep-card').addEventListener('click', () => {
  hideModal('modal-investigate-show');
  socket.emit('player:investigate-decide', { forceSwap: false });
});

/* ── Game over screen ─────────────────────────────────────── */

function showGameOver() {
  const winner = gameState.players.find(p => p.id === gameState.winner);
  const self   = me();
  const iWon   = winner?.name === myName;

  const screen = document.getElementById('screen-gameover');
  screen.className = 'show';

  if (iWon) {
    renderVictory(winner, self, gameState.players.filter(p => p.name !== myName));
  } else {
    renderDefeat(self, winner, gameState.players.filter(p => p.name !== myName));
  }
}

function renderVictory(winner, self, opponents) {
  const screen = document.getElementById('screen-gameover');
  screen.style.cssText = 'background:linear-gradient(160deg,#f5e6c8 0%,#e8d0a0 40%,#d4b870 100%);';

  const myCards = self?.cards.map(c => charCardHTML(c.character, 'lg', false)).join('') || '';
  const oppRows = opponents.map(p => {
    const color = PLAYER_COLORS[opponents.indexOf(p) % PLAYER_COLORS.length];
    const revCards = (p.cards || []).map(c => charCardHTML(c.character,'sm',true)).join('');
    return `<div class="opp-row">
      <div class="opp-avatar" style="background:radial-gradient(circle at 38% 38%,${color}cc,${color}66);border:1.5px solid rgba(92,61,30,.2);opacity:.7;">${p.name.slice(0,2).toUpperCase()}</div>
      <span style="font-size:11px;font-weight:600;color:var(--brown-light);min-width:50px;">${p.name}</span>
      <div style="display:flex;gap:6px;flex:1;justify-content:flex-end;">${revCards}</div>
    </div>`;
  }).join('');

  screen.innerHTML = `<div class="gameover-inner">
    <div class="gameover-ornament">✦ ✦ ✦</div>
    <div class="gameover-icon" style="background:linear-gradient(135deg,#c9922a,#f6d860);box-shadow:0 8px 32px rgba(201,146,42,.5),0 0 0 4px rgba(201,146,42,.2);border:2px solid rgba(255,255,255,.4);">♛</div>
    <div class="gameover-title" style="color:var(--brown);">VITÓRIA!</div>
    <div class="gameover-sub" style="color:var(--brown-light);">Você conquistou a Cidade-Estado Italiana</div>
    <div class="gameover-divider">
      <div class="gameover-divider-line" style="background:linear-gradient(90deg,transparent,rgba(92,61,30,.3));"></div>
      <span class="gameover-divider-dot" style="color:rgba(92,61,30,.4);">✦</span>
      <div class="gameover-divider-line" style="background:linear-gradient(90deg,rgba(92,61,30,.3),transparent);"></div>
    </div>
    <div class="cards-panel" style="background:rgba(255,255,255,.45);border:1.5px solid rgba(201,146,42,.35);box-shadow:0 4px 20px rgba(92,61,30,.12);">
      <div class="cards-panel-label" style="color:var(--brown-light);">Suas Cartas Vencedoras</div>
      <div style="display:flex;justify-content:center;gap:16px;margin-bottom:14px;">${myCards}</div>
      <div style="display:flex;justify-content:center;">${coinsLabelHTML(self?.coins ?? 0, 17)}</div>
    </div>
    ${oppRows ? `<div class="cards-panel" style="background:rgba(92,61,30,.06);border:1px solid rgba(92,61,30,.15);">
      <div class="cards-panel-label" style="color:var(--brown-light);">Cartas dos Derrotados</div>
      ${oppRows}
    </div>` : ''}
    <button class="replay-btn" style="background:linear-gradient(135deg,#3a2010,var(--brown));color:var(--cream);" onclick="restartGame()">JOGAR NOVAMENTE</button>
  </div>`;
}

function renderDefeat(self, winner, opponents) {
  const screen = document.getElementById('screen-gameover');
  screen.style.cssText = 'background:linear-gradient(160deg,#2a1608 0%,#3d2210 50%,#2a1608 100%);';

  const myCards = self?.cards.map(c => charCardHTML(c.character,'lg',true)).join('') || '';
  const winColor = PLAYER_COLORS[0];
  const winCards = (winner?.cards || []).map(c => charCardHTML(c.character,'sm',false)).join('');
  const oppRows  = opponents.filter(p => p.name !== winner?.name).map((p,i) => {
    const color = PLAYER_COLORS[(i+1) % PLAYER_COLORS.length];
    const revCards = (p.cards||[]).map(c => charCardHTML(c.character,'sm',true)).join('');
    return `<div class="opp-row">
      <div class="opp-avatar" style="background:radial-gradient(circle at 38% 38%,${color}99,${color}44);border:1px solid rgba(245,230,200,.06);opacity:.6;">${p.name.slice(0,2).toUpperCase()}</div>
      <span style="font-size:11px;color:rgba(245,230,200,.3);min-width:50px;">${p.name}</span>
      <div style="display:flex;gap:5px;flex:1;justify-content:flex-end;">${revCards}</div>
    </div>`;
  }).join('');

  screen.innerHTML = `<div class="gameover-inner">
    <div class="gameover-ornament" style="color:rgba(245,230,200,.2);">✦ ✦ ✦</div>
    <div class="gameover-icon" style="background:linear-gradient(135deg,#4a2010,#2a1008);box-shadow:0 8px 30px rgba(0,0,0,.6);border:2px solid rgba(245,230,200,.08);">✕</div>
    <div class="gameover-title" style="color:var(--cream);opacity:.9;">DERROTA</div>
    <div class="gameover-sub" style="color:rgba(245,230,200,.45);">Você foi eliminado da partida</div>
    <div class="gameover-divider">
      <div class="gameover-divider-line" style="background:linear-gradient(90deg,transparent,rgba(245,230,200,.1));"></div>
      <span class="gameover-divider-dot" style="color:rgba(245,230,200,.15);">✦</span>
      <div class="gameover-divider-line" style="background:linear-gradient(90deg,rgba(245,230,200,.1),transparent);"></div>
    </div>
    <div class="cards-panel" style="background:rgba(0,0,0,.3);border:1px solid rgba(245,230,200,.08);">
      <div class="cards-panel-label" style="color:rgba(245,230,200,.3);">Suas Cartas</div>
      <div style="display:flex;justify-content:center;gap:16px;">${myCards}</div>
    </div>
    ${winner ? `<div class="cards-panel" style="background:rgba(201,146,42,.08);border:1.5px solid rgba(201,146,42,.25);">
      <div class="cards-panel-label" style="color:rgba(201,146,42,.5);">Vencedor</div>
      <div style="display:flex;align-items:center;gap:12px;justify-content:center;margin-bottom:12px;">
        <div class="opp-avatar" style="width:46px;height:46px;background:radial-gradient(circle at 38% 38%,${winColor}ee,${winColor}88);border:2px solid rgba(201,146,42,.5);box-shadow:0 0 20px rgba(201,146,42,.3);">${winner.name.slice(0,2).toUpperCase()}</div>
        <div style="text-align:left;">
          <div style="font-size:15px;font-weight:700;color:var(--cream);font-family:'Cinzel',serif;">${winner.name}</div>
          ${coinsLabelHTML(winner.coins ?? 0, 15)}
        </div>
      </div>
      <div style="display:flex;justify-content:center;gap:10px;">${winCards}</div>
    </div>` : ''}
    ${oppRows ? `<div class="cards-panel" style="background:rgba(0,0,0,.2);border:1px solid rgba(245,230,200,.05);">
      <div class="cards-panel-label" style="color:rgba(245,230,200,.2);">Outros Jogadores</div>
      ${oppRows}
    </div>` : ''}
    <button class="replay-btn" style="background:rgba(245,230,200,.08);border:1.5px solid rgba(245,230,200,.15);color:rgba(245,230,200,.7);" onclick="restartGame()"
      onmouseover="this.style.background='rgba(245,230,200,.13)'" onmouseout="this.style.background='rgba(245,230,200,.08)'">JOGAR NOVAMENTE</button>
  </div>`;
}
