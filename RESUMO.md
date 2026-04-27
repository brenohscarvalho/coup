# Coup — Resumo do Projeto

Jogo de cartas Coup para rede local. Host roda `node server.js` no PC; jogadores acessam via browser no celular usando o IP exibido no terminal. 2 a 10 jogadores.

**Stack:** Node.js + Express + Socket.IO  
**Frontend:** HTML/CSS/JS puro, mobile-first  

---

## Estrutura

```
coup/
├── server.js              — Express + Socket.IO, eventos e orquestração
├── game/
│   ├── constants.js       — Personagens, ações, fases, bloqueios
│   ├── GameState.js       — Criação e filtragem do estado
│   ├── GameEngine.js      — Regras, validações, transições de fase
│   ├── Deck.js            — Baralho, embaralhamento, distribuição
│   └── Room.js            — Sala, jogadores, reconexão, timers
└── public/
    ├── index.html/js      — Entrada: nome + código da sala
    ├── lobby.html/js      — Sala de espera + configuração
    └── game.html/js       — Tela principal do jogo
```

---

## Variantes

| Variante | Diferença |
|----------|-----------|
| **Embaixador** | Troca 2 cartas com o baralho |
| **Inquisidor** | Substitui o Embaixador. Troca 1 carta com o baralho e pode investigar |

---

## Personagens e Ações

### Duque
- **Taxar:** +3 moedas do tesouro
- **Bloqueia:** Ajuda Externa

### Assassino
- **Assassinar:** Paga 3 moedas; alvo perde uma influência
- Bloqueável pela Condessa

### Capitão
- **Extorquir:** Rouba até 2 moedas de um jogador
- Bloqueável pelo Embaixador, Inquisidor ou outro Capitão

### Embaixador *(variante Embaixador)*
- **Trocar:** Compra 2 cartas do baralho, devolve 2
- Bloqueia Extorsão

### Inquisidor *(variante Inquisidor)*
- **Trocar:** Compra 1 carta do baralho, devolve 1
- **Investigar:** Obriga o alvo a mostrar uma carta; pode forçar troca
- Bloqueia Extorsão

### Condessa
- Sem ação ativa
- **Bloqueia:** Assassinato

---

## Ações Gerais (sempre disponíveis)

| Ação | Efeito | Pode ser bloqueada | Pode ser contestada |
|------|--------|--------------------|---------------------|
| Renda | +1 moeda | Não | Não |
| Ajuda Externa | +2 moedas | Sim (Duque) | Não |
| Golpe de Estado | Paga 7 moedas; alvo perde influência | Não | Não |

---

## Interações entre Cartas

### Assassinato × Condessa
- Assassino declara assassinar o alvo (paga 3 moedas imediatamente)
- **Somente o alvo** pode reagir: bloquear (Condessa) ou contestar
- Se o alvo **bloqueia com Condessa:**
  - Somente o **Assassino** pode contestar o bloqueio
  - Se o Assassino contesta e a Condessa é real → Assassino perde influência, ação falha
  - Se o Assassino contesta e é blefe → alvo (bloqueador) perde influência, assassinato ocorre
  - Se o Assassino passa → bloqueio aceito, ação falha (3 moedas perdidas mesmo assim)
- Se o alvo **contesta** o Assassino:
  - Assassino tem a carta → alvo perde influência pela contestação **e** depois perde outra pelo assassinato (dupla morte)
  - Assassino não tem a carta → Assassino perde influência, ação falha

### Extorsão × Embaixador / Inquisidor / Capitão
- Capitão declara extorquir o alvo
- **Somente o alvo** pode reagir: bloquear ou contestar
- Qualquer um dos três (Embaixador, Inquisidor ou Capitão) bloqueia a extorsão
- Se o alvo **bloqueia:** qualquer jogador pode contestar o bloqueio
- Se o alvo **contesta** o Capitão:
  - Capitão tem a carta → alvo perde influência, extorsão ocorre
  - Capitão não tem → Capitão perde influência, ação falha

### Investigação (Inquisidor) × Alvo
- Inquisidor declara investigar o alvo
- **Somente o alvo** recebe o overlay imediatamente
- O alvo escolhe **qual carta mostrar** ao Inquisidor (ou contesta)
- Se o alvo **contesta:**
  - Inquisidor tem a carta → alvo perde influência, investigação prossegue (alvo ainda mostra uma carta)
  - Inquisidor não tem → Inquisidor perde influência, ação falha
- Se o alvo **mostra uma carta:** Inquisidor vê a carta e decide:
  - **Forçar troca:** alvo troca aquela carta por uma do baralho
  - **Manter:** carta volta para o alvo sem troca

### Ajuda Externa × Duque
- Qualquer jogador pode bloquear com Duque (não só o alvo)
- O bloqueio pode ser contestado por qualquer jogador

### Taxar × Contestação
- Qualquer jogador pode contestar a declaração de Tax do Duque
- Se o Duque for provado → contestador perde influência, Tax ocorre e Duque troca a carta
- Se for blefe → declarante perde influência

---

## Fases do Turno

| Fase | Descrição |
|------|-----------|
| `WAITING_ACTION` | Jogador ativo escolhe ação |
| `WAITING_REACTIONS` | Outros jogadores podem bloquear ou contestar |
| `WAITING_BLOCK_CHALLENGE` | Contestação de um bloqueio declarado |
| `CHOOSE_INVESTIGATE_CARD` | Alvo da investigação escolhe qual carta mostrar |
| `LOSE_INFLUENCE` | Jogador designado escolhe qual carta revelar |
| `EXCHANGE_CARDS` | Embaixador/Inquisidor escolhe cartas para ficar |
| `INVESTIGATE` | Inquisidor decide trocar ou manter carta vista |
| `GAME_OVER` | Fim de partida |

---

## Regras Especiais

- **Golpe obrigatório:** Com 10+ moedas, apenas Golpe de Estado pode ser realizado
- **Dupla morte:** Se o alvo contesta o Assassino e perde, perde uma influência pelo contestação e outra pelo assassinato
- **Troca de carta ao provar:** Quando um jogador prova ter um personagem em desafio, a carta vai para o baralho e ele compra uma nova
- **Reconexão:** 60 segundos para reconectar; após isso o jogador é eliminado
- **Privacidade:** Cartas ocultas dos adversários nunca chegam ao cliente