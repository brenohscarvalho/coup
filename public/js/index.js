const socket = io();

const nameInput = document.getElementById('playerName');
const codeInput = document.getElementById('roomCode');
const errorMsg = document.getElementById('errorMsg');

function showError(msg) { errorMsg.textContent = msg; }

document.getElementById('btnCreate').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) return showError('Digite seu nome');
  sessionStorage.setItem('playerName', name);
  socket.emit('room:create', { playerName: name });
});

document.getElementById('btnJoin').addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) return showError('Digite seu nome');
  if (!code) return showError('Digite o código da sala');
  sessionStorage.setItem('playerName', name);
  sessionStorage.setItem('roomCode', code);
  sessionStorage.setItem('isHost', '0');
  socket.emit('room:join', { roomCode: code, playerName: name });
});

socket.on('room:created', ({ roomCode }) => {
  sessionStorage.setItem('roomCode', roomCode);
  sessionStorage.setItem('isHost', '1');
  window.location.href = '/lobby.html';
});

socket.on('lobby:update', () => {
  window.location.href = '/lobby.html';
});

socket.on('game:state', () => {
  window.location.href = '/game.html';
});

socket.on('game:error', ({ message }) => showError(message));
