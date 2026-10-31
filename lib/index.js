// dsh-starfleet host half
// Manages game state, turn logic, and AI decisions.
// Exposes HTTP API for the client to query state and issue commands.

export default function register(ctx) {
  const http = ctx.get('httpServer')
  if (!http) return

  // Game state (mutable during play)
  const state = {
    board: null,       // 20x15 grid
    ships: [],         // all ships on board
    turn: 0,           // current turn number
    phase: 'setup',    // setup | player_turn | enemy_turn | game_over
    playerSide: 0,     // 0 = blue (left), 1 = red (right)
    winner: null,
    selectedShip: null,
    aiThinking: false
  }

  // Ship type definitions
  const SHIP_TYPES = {
    fighter:    { hp: 20, atk: 15, spd: 5, range: 2, icon: 'f', color: 0x88ccff },
    destroyer:  { hp: 50, atk: 30, spd: 3, range: 3, icon: 'd', color: 0x88ffcc },
    cruiser:    { hp: 100, atk: 50, spd: 2, range: 4, icon: 'c', color: 0xffcc88 },
    battleship: { hp: 200, atk: 80, spd: 1, range: 5, icon: 'b', color: 0xff8888 },
    carrier:    { hp: 80, atk: 20, spd: 2, range: 3, icon: 'a', color: 0xcc88ff },
    flagship:   { hp: 500, atk: 100, spd: 1, range: 6, icon: '★', color: 0xffdd44 }
  }

  // Formation definitions
  const FORMATIONS = {
    line:   [{x:0,y:-2},{x:0,y:-1},{x:0,y:0},{x:0,y:1},{x:0,y:2}],
    wedge:  [{x:-2,y:0},{x:-1,y:-1},{x:-1,y:1},{x:0,y:-2},{x:0,y:0},{x:0,y:2},{x:1,y:-1},{x:1,y:1},{x:2,y:0}],
    circle: [{x:0,y:-2},{x:1,y:-1},{x:1,y:1},{x:0,y:2},{x:-1,y:1},{x:-1,y:-1}],
    diamond:[{x:0,y:-3},{x:-1,y:-1},{x:1,y:-1},{x:0,y:1},{x:-1,y:3},{x:1,y:3}],
    cluster:[{x:0,y:0},{x:-1,y:0},{x:1,y:0},{x:0,y:-1},{x:0,y:1}]
  }

  // Initialize new game
  function newGame(side = 0) {
    state.board = createEmptyBoard()
    state.ships = []
    state.turn = 1
    state.phase = 'setup'
    state.playerSide = side
    state.winner = null
    state.selectedShip = null
    state.aiThinking = false
    return { side, board: state.board, ships: [], phase: 'setup' }
  }

  function createEmptyBoard() {
    const b = []
    for (let y = 0; y < 15; y++) {
      b[y] = []
      for (let x = 0; x < 20; x++) {
        b[y][x] = null
      }
    }
    return b
  }

  // Place fleet in formation
  function placeFleet(side, formationName, anchorX, anchorY) {
    const formation = FORMATIONS[formationName]
    if (!formation) return { error: 'Invalid formation' }

    const fleet = []
    const types = ['carrier','battleship','cruiser','cruiser','destroyer','destroyer','destroyer','fighter','fighter','fighter','fighter']
    
    formation.forEach((offset, i) => {
      if (i >= types.length) return
      const type = types[i]
      const def = SHIP_TYPES[type]
      const ship = {
        id: `${side}-${fleet.length}`,
        type,
        side,
        hp: def.hp,
        maxHp: def.hp,
        atk: def.atk,
        spd: def.spd,
        range: def.range,
        x: anchorX + offset.x,
        y: anchorY + offset.y,
        hasMoved: false,
        hasAttacked: false
      }
      if (ship.x >= 0 && ship.x < 20 && ship.y >= 0 && ship.y < 15) {
        state.board[ship.y][ship.x] = ship
        fleet.push(ship)
        state.ships.push(ship)
      }
    })
    return { fleet, count: fleet.length }
  }

  // Move ship
  function moveShip(shipId, newX, newY) {
    const ship = state.ships.find(s => s.id === shipId)
    if (!ship || ship.side !== state.playerSide) return { error: 'Invalid ship' }
    if (ship.hasMoved) return { error: 'Already moved this turn' }
    if (newX < 0 || newX >= 20 || newY < 0 || newY >= 15) return { error: 'Out of bounds' }
    if (state.board[newY][newX]) return { error: 'Space occupied' }
    
    // Check movement range
    const dist = Math.abs(newX - ship.x) + Math.abs(newY - ship.y)
    if (dist > ship.spd) return { error: 'Too far' }

    state.board[ship.y][ship.x] = null
    ship.x = newX
    ship.y = newY
    state.board[newY][newX] = ship
    ship.hasMoved = true
    return { ok: true, x: newX, y: newY }
  }

  // Attack enemy ship
  function attackShip(attackerId, targetId) {
    const attacker = state.ships.find(s => s.id === attackerId)
    const target = state.ships.find(s => s.id === targetId)
    if (!attacker || !target) return { error: 'Ship not found' }
    if (attacker.side === target.side) return { error: 'Cannot attack friendly' }
    if (!attacker.hasAttacked) return { error: 'Already attacked' }

    // Check range
    const dist = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y)
    if (dist > attacker.range) return { error: 'Target out of range' }

    // Calculate damage (with some randomness)
    const baseDmg = attacker.atk
    const variance = Math.floor(Math.random() * 10) - 5
    const damage = Math.max(5, baseDmg + variance)
    target.hp -= damage

    // Check if destroyed
    let destroyed = false
    if (target.hp <= 0) {
      state.board[target.y][target.x] = null
      target.alive = false
      destroyed = true
      // Check win condition
      if (target.type === 'flagship') {
        state.winner = attacker.side
        state.phase = 'game_over'
      }
    }

    attacker.hasAttacked = true
    return { damage, destroyed, targetHp: target.hp, gameOver: !!state.winner }
  }

  // End turn - trigger AI
  async function endTurn() {
    state.phase = 'enemy_turn'
    state.aiThinking = true
    
    // Process player ships
    for (const ship of state.ships) {
      if (ship.side === state.playerSide && !ship.hasMoved) {
        ship.hasMoved = true
        ship.hasAttacked = true
      }
    }

    // Small delay for AI turn
    await new Promise(r => setTimeout(r, 500))
    
    // Run AI
    await runAI()
    
    // Start new turn
    state.turn++
    state.phase = 'player_turn'
    state.aiThinking = false
    
    // Reset moves for player ships
    for (const ship of state.ships) {
      if (ship.side === state.playerSide) {
        ship.hasMoved = false
        ship.hasAttacked = false
      }
    }
    
    // Check if any player ships remain
    const playerShips = state.ships.filter(s => s.side === state.playerSide && s.alive !== false)
    if (playerShips.length === 0) {
      state.winner = 1
      state.phase = 'game_over'
    }
    
    return getState()
  }

  // ── AI System ────────────────────────────────────────────────────────────
  
  async function runAI() {
    const enemyShips = state.ships.filter(s => s.side === 1 - state.playerSide && s.alive !== false)
    const playerShips = state.ships.filter(s => s.side === state.playerSide && s.alive !== false)
    
    // Process each enemy ship
    for (const ship of enemyShips) {
      if (!state.ships.includes(ship)) continue // ship was destroyed
      
      // Evaluate all possible moves
      const moves = getValidMoves(ship)
      let bestMove = null
      let bestScore = -Infinity
      
      for (const move of moves) {
        const score = evaluatePosition(ship, move.x, move.y)
        if (score > bestScore) {
          bestScore = score
          bestMove = move
        }
      }
      
      // Execute move
      if (bestMove) {
        state.board[ship.y][ship.x] = null
        ship.x = bestMove.x
        ship.y = bestMove.y
        state.board[bestMove.y][bestMove.x] = ship
        ship.hasMoved = true
      }
      
      // Find best target to attack
      const attackTarget = findBestTarget(ship, playerShips)
      if (attackTarget && !ship.hasAttacked) {
        attackShip(ship.id, attackTarget.id)
      }
      
      // Yield to allow UI updates
      await new Promise(r => setTimeout(r, 100))
    }
  }

  function getValidMoves(ship) {
    const moves = []
    const maxDist = ship.spd
    
    for (let dy = -maxDist; dy <= maxDist; dy++) {
      for (let dx = -maxDist; dx <= maxDist; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > maxDist) continue
        const nx = ship.x + dx
        const ny = ship.y + dy
        if (nx >= 0 && nx < 20 && ny >= 0 && ny < 15 && !state.board[ny][nx]) {
          moves.push({ x: nx, y: ny })
        }
      }
    }
    return moves
  }

  // Enhanced evaluation function
  function evaluatePosition(ship, x, y) {
    let score = 0
    
    // Distance to enemy flagship (closer is better)
    const enemyFlagship = state.ships.find(s => s.side === 1 - state.playerSide && s.type === 'flagship' && s.alive !== false)
    if (enemyFlagship) {
      const distToFlagship = Math.abs(x - enemyFlagship.x) + Math.abs(y - enemyFlagship.y)
      score += (20 - distToFlagship) * 10
    }
    
    // Distance to friendly flagship (protect it)
    const friendlyFlagship = state.ships.find(s => s.side === ship.side && s.type === 'flagship' && s.alive !== false)
    if (friendlyFlagship) {
      const distToFriendly = Math.abs(x - friendlyFlagship.x) + Math.abs(y - friendlyFlagship.y)
      if (distToFriendly < 5) {
        score += (5 - distToFriendly) * 20 // Stay close to protect
      }
    }
    
    // Check for kill opportunities
    const enemies = state.ships.filter(s => s.side === 1 - state.playerSide && s.alive !== false)
    for (const enemy of enemies) {
      const dist = Math.abs(x - enemy.x) + Math.abs(y - enemy.y)
      if (dist <= ship.range) {
        // Can attack! Bonus for killing
        if (enemy.hp <= ship.atk) {
          score += 5000 // Priority kill
          // Bonus for killing high-value targets
          if (enemy.type === 'flagship') score += 10000
          else if (enemy.type === 'battleship') score += 3000
          else if (enemy.type === 'carrier') score += 2000
        } else {
          score += (ship.atk - enemy.hp) * 2 // Damage bonus
        }
      }
    }
    
    // Formation bonus
    const friendlyShips = state.ships.filter(s => s.side === ship.side && s.alive !== false)
    let formationBonus = 0
    for (const friend of friendlyShips) {
      if (friend.id === ship.id) continue
      const dist = Math.abs(x - friend.x) + Math.abs(y - friend.y)
      if (dist <= 3) formationBonus += 10
      if (dist > 6) formationBonus -= 20 // Isolation penalty
    }
    score += formationBonus
    
    // Edge avoidance (don't get trapped)
    if (x === 0 || x === 19 || y === 0 || y === 14) {
      score -= 30 // Slight penalty for edges
    }
    
    // Low HP retreat
    const enemyInRange = enemies.some(e => {
      const dist = Math.abs(x - e.x) + Math.abs(y - e.y)
      return dist <= e.range
    })
    if (ship.hp < ship.maxHp * 0.3 && enemyInRange) {
      score -= 200 // Retreat penalty if staying
      // Prefer moving away
      const enemy = enemies.find(e => Math.abs(x - e.x) + Math.abs(y - e.y) <= e.range)
      if (enemy) {
        score += (Math.abs(x - enemy.x) + Math.abs(y - enemy.y)) * 15
      }
    }
    
    // Center preference (control the middle)
    score += (10 - Math.abs(x - 10)) * 2
    score += (7 - Math.abs(y - 7)) * 2
    
    return score
  }

  function findBestTarget(ship, targets) {
    let bestTarget = null
    let bestScore = -Infinity
    
    for (const target of targets) {
      const dist = Math.abs(ship.x - target.x) + Math.abs(ship.y - target.y)
      if (dist > ship.range) continue
      
      let score = 0
      
      // Value based on target type
      const typeValues = { flagship: 10000, battleship: 500, carrier: 300, cruiser: 200, destroyer: 100, fighter: 50 }
      score += typeValues[target.type] || 0
      
      // Lower HP = easier kill = higher priority
      score += (1 - target.hp / target.maxHp) * 200
      
      // Closer = better
      score += (ship.range - dist) * 10
      
      // Can one-shot?
      if (target.hp <= ship.atk) {
        score += 5000
      }
      
      if (score > bestScore) {
        bestScore = score
        bestTarget = target
      }
    }
    
    return bestTarget
  }

  function getState() {
    return {
      board: state.board,
      ships: state.ships.filter(s => s.alive !== false),
      turn: state.turn,
      phase: state.phase,
      playerSide: state.playerSide,
      winner: state.winner,
      selectedShip: state.selectedShip,
      aiThinking: state.aiThinking
    }
  }

  // HTTP routes
  http.onRequest((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const path = url.pathname
    
    if (path === '/dsh-starfleet/game' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(getState()))
    }
    else if (path === '/dsh-starfleet/new' && req.method === 'POST') {
      const body = JSON.parse(req.body || '{}')
      const result = newGame(body.side || 0)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    }
    else if (path === '/dsh-starfleet/place' && req.method === 'POST') {
      const body = JSON.parse(req.body || '{}')
      const result = placeFleet(body.side, body.formation, body.x, body.y)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    }
    else if (path === '/dsh-starfleet/move' && req.method === 'POST') {
      const body = JSON.parse(req.body || '{}')
      const result = moveShip(body.shipId, body.x, body.y)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    }
    else if (path === '/dsh-starfleet/attack' && req.method === 'POST') {
      const body = JSON.parse(req.body || '{}')
      const result = attackShip(body.attackerId, body.targetId)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    }
    else if (path === '/dsh-starfleet/endturn' && req.method === 'POST') {
      endTurn().then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      })
    }
    else {
      res.writeHead(404).end()
    }
  })

  // Export for client
  ctx.systemPrompt.context({
    name: 'starfleet-status',
    order: 900,
    text: () => ''
  })

  return { getState, newGame, placeFleet }
}
