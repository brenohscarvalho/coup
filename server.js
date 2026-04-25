const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('conectado:', socket.id);
  socket.on('disconnect', () => console.log('desconectado:', socket.id));
});

const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ip = Object.values(nets).flat().find(n => n.family === 'IPv4' && !n.internal)?.address || 'localhost';
  console.log(`\n⚜  Coup rodando em http://${ip}:${PORT}\n`);
});
