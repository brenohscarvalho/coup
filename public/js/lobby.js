const socket = io();
const isHost = sessionStorage.getItem('isHost') === '1';
const playerName = sessionStorage.getItem('playerName');
const roomCode = sessionStorage.getItem('roomCode');
let selectedVariant = 'ambassador';

document.getElementById('roomTitle').textContent = `Sala ${roomCode}`;
document.getElementById(isHost ? 'hostControls' : 'guestWait').style.display = '';

// Re-register with server — page navigation creates a new socket ID
socket.emit('room:join', { roomCode, playerName });

if (isHost) {
  document.getElementById('btnStart').addEventListener('click', () => {
    socket.emit('room:start', { variant: selectedVariant });
  });
}

window.setVariant = function(v) {
  selectedVariant = v;
  document.getElementById('btnAmbassador').classList.toggle('active', v === 'ambassador');
  document.getElementById('btnInquisitor').classList.toggle('active', v === 'inquisitor');
};

socket.on('lobby:update', ({ players }) => {
  document.getElementById('playerCount').textContent = `${players.length}/10 jogadores`;
  const list = document.getElementById('playerList');
  list.innerHTML = players.map((p, i) =>
    `<div class="player-row">
      <span>${p.name}${i === 0 ? ' 👑' : ''}</span>
      <span style="color:var(--green);font-size:12px;">✓</span>
    </div>`
  ).join('');
});

socket.on('game:state', () => {
  window.location.href = '/game.html';
});

socket.on('game:error', ({ message }) => {
  document.getElementById('errorMsg').textContent = message;
});
