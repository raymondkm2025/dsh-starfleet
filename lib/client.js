// dsh-starfleet client half
// Three.js 3D starfield with ship models, UI overlay, and game controls.

window.__ModuleLoader__.load({
  id: 'dsh-starfleet',
  factory: function (require) {
    'use strict'
    
    const React = require('react')
    const el = React.createElement
    
    // ── Constants ────────────────────────────────────────────────────────────
    const BOARD_W = 20, BOARD_H = 15
    const CELL_SIZE = 1.0
    const SHIP_TYPES = {
      fighter:    { label: 'Fighter',    color: 0x88ccff, scale: [0.3,0.15,0.3] },
      destroyer:  { label: 'Destroyer',  color: 0x88ffcc, scale: [0.5,0.2,0.5] },
      cruiser:    { label: 'Cruiser',    color: 0xffcc88, scale: [0.7,0.25,0.7] },
      battleship: { label: 'Battleship', color: 0xff8888, scale: [1.0,0.3,1.0] },
      carrier:    { label: 'Carrier',    color: 0xcc88ff, scale: [0.9,0.2,1.2] },
      flagship:   { label: '★ Flagship', color: 0xffdd44, scale: [1.2,0.4,1.2] }
    }
    const FORMATIONS = ['line', 'wedge', 'circle', 'diamond', 'cluster']
    
    // ── Three.js scene ───────────────────────────────────────────────────────
    let scene, camera, renderer, clock
    let shipMeshes = {}
    let selectedMesh = null
    let moveIndicators = []
    let attackIndicators = []
    let starField = null
    let gameOver = false
    let winnerSide = null
    
    function initThree() {
      const canvas = document.getElementById('starfleet-canvas')
      scene = new THREE.Scene()
      scene.background = new THREE.Color(0x020208)
      scene.fog = new THREE.FogExp2(0x020208, 0.015)
      
      camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 200)
      camera.position.set(BOARD_W/2, 18, BOARD_H/2 + 10)
      camera.lookAt(BOARD_W/2, 0, BOARD_H/2)
      
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      renderer.setSize(window.innerWidth, window.innerHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      
      // Lights
      scene.add(new THREE.AmbientLight(0x334466, 0.6))
      const dir = new THREE.DirectionalLight(0xffffff, 0.8)
      dir.position.set(10, 20, 10)
      scene.add(dir)
      const rim = new THREE.PointLight(0x4488ff, 0.4, 50)
      rim.position.set(-5, 10, -5)
      scene.add(rim)
      
      // Star field
      const starGeo = new THREE.BufferGeometry()
      const starPos = []
      for (let i = 0; i < 2000; i++) {
        starPos.push((Math.random()-0.5)*200, (Math.random()-0.5)*100+50, (Math.random()-0.5)*200)
      }
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
      const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.8 })
      starField = new THREE.Points(starGeo, starMat)
      scene.add(starField)
      
      // Grid
      const gridHelper = new THREE.GridHelper(Math.max(BOARD_W, BOARD_H), Math.max(BOARD_W, BOARD_H), 0x223344, 0x112233)
      gridHelper.position.set(BOARD_W/2 - 0.5, 0, BOARD_H/2 - 0.5)
      scene.add(gridHelper)
      
      // Board boundaries
      const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BOARD_W, 0.1, BOARD_H))
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x4488aa })
      const edgeMesh = new THREE.LineSegments(edgeGeo, edgeMat)
      edgeMesh.position.set(BOARD_W/2 - 0.5, 0, BOARD_H/2 - 0.5)
      scene.add(edgeMesh)
      
      clock = new THREE.Clock()
      window.addEventListener('resize', onResize)
      canvas.addEventListener('click', onCanvasClick)
      canvas.addEventListener('mousemove', onCanvasMouseMove)
    }
    
    function onResize() {
      if (!camera || !renderer) return
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    
    // ── Ship rendering ───────────────────────────────────────────────────────
    function updateShipMesh(ship, scene) {
      // Remove old mesh
      if (shipMeshes[ship.id]) {
        scene.remove(shipMeshes[ship.id])
        delete shipMeshes[ship.id]
      }
      
      if (!ship || ship.alive === false) return
      
      const def = SHIP_TYPES[ship.type]
      if (!def) return
      
      // Create ship mesh based on type
      let geo
      switch (ship.type) {
        case 'fighter':
          geo = new THREE.ConeGeometry(0.15, 0.4, 4)
          break
        case 'destroyer':
          geo = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 6)
          break
        case 'cruiser':
          geo = new THREE.BoxGeometry(0.6, 0.15, 0.3)
          break
        case 'battleship':
          geo = new THREE.BoxGeometry(0.9, 0.25, 0.4)
          break
        case 'carrier':
          geo = new THREE.BoxGeometry(1.0, 0.15, 0.6)
          break
        case 'flagship':
          geo = new THREE.OctahedronGeometry(0.5, 0)
          break
        default:
          geo = new THREE.SphereGeometry(0.2, 8, 8)
      }
      
      const mat = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: ship.side === 0 ? 0x2244aa : 0xaa2222,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        metalness: 0.7
      })
      
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(ship.x, 0.3, ship.y)
      mesh.userData = { shipId: ship.id }
      
      // Selection ring
      if (ship.id === window._selectedShipId) {
        const ringGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 16)
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff00 })
        const ring = new THREE.Mesh(ringGeo, ringMat)
        ring.rotation.x = Math.PI / 2
        ring.position.set(ship.x, 0.05, ship.y)
        scene.add(ring)
        window._selectionRing = ring
      }
      
      // HP bar
      const hpBarGeo = new THREE.PlaneGeometry(0.6, 0.06)
      const hpPct = ship.hp / ship.maxHp
      const hpColor = hpPct > 0.5 ? 0x44ff44 : hpPct > 0.25 ? 0xffaa00 : 0xff4444
      const hpBarMat = new THREE.MeshBasicMaterial({ color: hpColor })
      const hpBar = new THREE.Mesh(hpBarGeo, hpBarMat)
      hpBar.position.set(ship.x, 0.55, ship.y)
      scene.add(hpBar)
      ship._hpBar = hpBar
      
      // HP bar background
      const hpBgGeo = new THREE.PlaneGeometry(0.62, 0.08)
      const hpBgMat = new THREE.MeshBasicMaterial({ color: 0x333333 })
      const hpBg = new THREE.Mesh(hpBgGeo, hpBgMat)
      hpBg.position.set(ship.x, 0.55, ship.y - 0.01)
      scene.add(hpBg)
      ship._hpBg = hpBg
      
      scene.add(mesh)
      shipMeshes[ship.id] = mesh
      
      // Label for flagship
      if (ship.type === 'flagship') {
        const labelGeo = new THREE.SphereGeometry(0.08, 8, 8)
        const labelMat = new THREE.MeshBasicMaterial({ color: 0xffdd00 })
        const label = new THREE.Mesh(labelGeo, labelMat)
        label.position.set(ship.x, 0.7, ship.y)
        scene.add(label)
        ship._glow = label
      }
    }
    
    function clearIndicators(scene) {
      moveIndicators.forEach(m => scene.remove(m))
      attackIndicators.forEach(m => scene.remove(m))
      moveIndicators = []
      attackIndicators = []
    }
    
    function showMoveIndicators(moves, scene) {
      clearIndicators(scene)
      for (const m of moves) {
        const geo = new THREE.BoxGeometry(0.8, 0.05, 0.8)
        const mat = new THREE.MeshBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.4 })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(m.x, 0.025, m.y)
        scene.add(mesh)
        moveIndicators.push(mesh)
      }
    }
    
    function showAttackIndicators(targets, scene) {
      clearIndicators(scene)
      for (const t of targets) {
        const geo = new THREE.BoxGeometry(0.8, 0.05, 0.8)
        const mat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.5 })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(t.x, 0.025, t.y)
        scene.add(mesh)
        attackIndicators.push(mesh)
      }
    }
    
    // ── Raycasting ───────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    
    function onCanvasClick(e) {
      if (gameOver || window._phase === 'enemy_turn' || window._aiThinking) return
      
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
      
      raycaster.setFromCamera(mouse, camera)
      const intersects = raycaster.intersectObjects(Object.values(shipMeshes))
      
      if (intersects.length > 0) {
        const shipId = intersects[0].object.userData.shipId
        handleShipClick(shipId)
      } else {
        // Click on board - try to move selected ship
        handleBoardClick(e)
      }
    }
    
    function onCanvasMouseMove(e) {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
    }
    
    function handleShipClick(shipId) {
      const ship = window._ships?.find(s => s.id === shipId)
      if (!ship) return
      
      // If clicking own ship, select it
      if (ship.side === window._playerSide) {
        window._selectedShipId = shipId
        window._selectedShip = ship
        showMoveIndicators(getValidMoves(ship), renderer?.scene)
        updateUI()
      } 
      // If clicking enemy ship and we have a selected ship that can attack
      else if (window._selectedShip && !window._selectedShip.hasAttacked) {
        const dist = Math.abs(window._selectedShip.x - ship.x) + Math.abs(window._selectedShip.y - ship.y)
        if (dist <= window._selectedShip.range) {
          attackShip(window._selectedShip.id, shipId)
        }
      }
    }
    
    function handleBoardClick(e) {
      if (!window._selectedShip || window._selectedShip.hasMoved) return
      
      // Convert screen to board coords
      raycaster.setFromCamera(mouse, camera)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const intersection = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, intersection)
      
      if (intersection) {
        const x = Math.round(intersection.x)
        const y = Math.round(intersection.z)
        moveShip(window._selectedShip.id, x, y)
      }
    }
    
    // ── Animation loop ───────────────────────────────────────────────────────
    function animate() {
      requestAnimationFrame(animate)
      const dt = clock.getDelta()
      
      // Rotate ship meshes slightly
      for (const id in shipMeshes) {
        const mesh = shipMeshes[id]
        mesh.rotation.y += dt * 0.5
        
        // Bobbing effect
        const ship = window._ships?.find(s => s.id === id)
        if (ship) {
          mesh.position.y = 0.3 + Math.sin(Date.now() * 0.002 + parseInt(id, 36)) * 0.05
          if (ship._hpBar) {
            ship._hpBar.position.y = mesh.position.y + 0.25
            ship._hpBg.position.y = mesh.position.y + 0.25
          }
          if (ship._glow) {
            ship._glow.position.y = mesh.position.y + 0.5
          }
        }
      }
      
      // Rotate selection ring
      if (window._selectionRing) {
        window._selectionRing.rotation.z += dt * 2
      }
      
      // Rotate star field slowly
      if (starField) {
        starField.rotation.y += dt * 0.02
      }
      
      renderer.render(scene, camera)
    }
    
    // ── Expose to global ─────────────────────────────────────────────────────
    window.__starfleetInit = initThree
    window.__starfleetAnimate = animate
    window.__updateShipMesh = updateShipMesh
    window.__clearIndicators = clearIndicators
    window.__showMoveIndicators = showMoveIndicators
    window.__showAttackIndicators = showAttackIndicators
    window.__gameOver = () => gameOver
    window.__setGameOver = (v) => { gameOver = v }
    window.__winnerSide = () => winnerSide
    window.__setWinnerSide = (v) => { winnerSide = v }
  }
})
