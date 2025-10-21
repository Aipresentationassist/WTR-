class TorrentStreamApp {
  constructor() {
    this.updateQueue = new Set()
    this.updateScheduled = false
    this.lastUpdateTime = 0
    this.updateDebounceMs = 300
    this.cardUpdateCache = new Map()
    this.torrents = new Map()
    this.expandedFileLists = new Set()
    this.ws = null
    this.wsReconnectAttempts = 0
    this.wsMaxReconnectAttempts = 10
    this.wsReconnectDelay = 2000
    this.isConnected = false
  }

  init() {
    this.torrentsContainer = document.getElementById("torrents-container")
    this.noTorrents = document.getElementById("no-torrents")
    this.magnetInput = document.getElementById("magnet-input")
    this.startDownloadBtn = document.getElementById("start-download-btn")
    this.refreshBtn = document.getElementById("refresh-btn")
    this.clearLogsBtn = document.getElementById("clear-logs-btn")
    this.toggleLogsBtn = document.getElementById("toggle-logs-btn")
    this.logsContainer = document.getElementById("logs-container")
    this.formattedLogs = document.getElementById("formatted-logs")
    this.statusIndicator = document.getElementById("status-indicator")
    this.statusText = document.getElementById("status-text")
    this.totalDownloadSpeed = document.getElementById("total-download-speed")
    this.totalUploadSpeed = document.getElementById("total-upload-speed")

    if (!this.torrentsContainer) {
      console.error("[v0] torrents-container not found!")
      return
    }

    // Event listeners
    this.startDownloadBtn.addEventListener("click", () => this.addTorrent())
    this.magnetInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.addTorrent()
    })
    this.refreshBtn.addEventListener("click", () => this.refreshTorrents())
    this.clearLogsBtn.addEventListener("click", () => this.clearLogs())
    this.toggleLogsBtn.addEventListener("click", () => this.toggleLogs())

    this.addLogEntry("TorrentStream initialized", "info")
    this.connectWebSocket()
  }

  connectWebSocket() {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const wsUrl = `${protocol}//${window.location.host}`

      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log("[v0] WebSocket connected")
        this.isConnected = true
        this.wsReconnectAttempts = 0
        this.updateConnectionStatus(true)
        this.addLogEntry("Connected to server", "success")
        this.refreshTorrents()
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log("[v0] Message received:", data.type)
          this.handleServerMessage(data)
        } catch (error) {
          console.error("[v0] Error parsing message:", error)
        }
      }

      this.ws.onerror = (error) => {
        console.error("[v0] WebSocket error:", error)
        this.isConnected = false
        this.updateConnectionStatus(false)
        this.addLogEntry("Connection error", "error")
      }

      this.ws.onclose = () => {
        console.log("[v0] WebSocket closed")
        this.isConnected = false
        this.updateConnectionStatus(false)
        this.addLogEntry("Disconnected from server", "warning")
        this.attemptReconnect()
      }
    } catch (error) {
      console.error("[v0] Failed to create WebSocket:", error)
      this.addLogEntry("Failed to connect to server", "error")
      this.attemptReconnect()
    }
  }

  attemptReconnect() {
    if (this.wsReconnectAttempts < this.wsMaxReconnectAttempts) {
      this.wsReconnectAttempts++
      const delay = this.wsReconnectDelay * Math.pow(1.5, this.wsReconnectAttempts - 1)
      console.log(`[v0] Reconnecting in ${delay}ms (attempt ${this.wsReconnectAttempts})`)
      setTimeout(() => this.connectWebSocket(), delay)
    } else {
      this.addLogEntry("Failed to reconnect after multiple attempts", "error")
    }
  }

  updateConnectionStatus(connected) {
    if (!this.statusIndicator || !this.statusText) return

    if (connected) {
      this.statusIndicator.classList.remove("disconnected")
      this.statusIndicator.classList.add("connected")
      this.statusText.textContent = "Connected"
    } else {
      this.statusIndicator.classList.remove("connected")
      this.statusIndicator.classList.add("disconnected")
      this.statusText.textContent = "Disconnected"
    }
  }

  handleServerMessage(data) {
    if (!data) return

    if (data.type === "torrent-update") {
      this.handleTorrentUpdate(data)
    } else if (data.type === "torrents-list" || data.type === "initial-torrents") {
      // Handle both torrents-list and initial-torrents message types
      this.handleTorrentsList(data)
    } else if (data.type === "stats") {
      this.handleStats(data)
    } else if (data.type === "log") {
      this.addLogEntry(data.message, data.level || "info")
    } else {
      console.log("[v0] Received message of type:", data.type)
    }
  }

  handleTorrentUpdate(data) {
    // Check both data.torrent (old format) and data.data (new format)
    const torrent = data.torrent || data.data

    if (!torrent || !torrent.torrentId) {
      console.error("[v0] Invalid torrent update received:", data)
      return
    }

    console.log("[v0] Torrent update received:", torrent.torrentId)
    this.torrents.set(torrent.torrentId, torrent)

    if (this.noTorrents) {
      this.noTorrents.style.display = "none"
    }

    this.updateTorrentCard(torrent, false)
  }

  handleTorrentsList(data) {
    // Check both data.torrents (old format) and data.data (new format)
    const torrents = data.torrents || data.data || []

    console.log("[v0] Torrents list received:", torrents.length)
    this.torrents.clear()

    torrents.forEach((torrent) => {
      if (torrent && torrent.torrentId) {
        this.torrents.set(torrent.torrentId, torrent)
      }
    })

    if (this.noTorrents) {
      this.noTorrents.style.display = this.torrents.size === 0 ? "flex" : "none"
    }

    this.renderTorrentList()
  }

  handleStats(data) {
    if (data.downloadSpeed !== undefined && this.totalDownloadSpeed) {
      this.totalDownloadSpeed.textContent = this.formatSpeed(data.downloadSpeed)
    }
    if (data.uploadSpeed !== undefined && this.totalUploadSpeed) {
      this.totalUploadSpeed.textContent = this.formatSpeed(data.uploadSpeed)
    }
  }

  sendMessage(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("[v0] Sending message:", data.type)
      this.ws.send(JSON.stringify(data))
    } else {
      console.warn("[v0] WebSocket not connected")
      this.addLogEntry("Cannot send message: not connected", "warning")
    }
  }

  addTorrent() {
    const magnetLink = this.magnetInput.value.trim()
    if (!magnetLink) {
      this.addLogEntry("Please enter a magnet link", "warning")
      return
    }

    this.sendMessage({
      type: "add-torrent",
      magnetLink: magnetLink,
    })

    this.magnetInput.value = ""
    this.addLogEntry(`Adding torrent: ${magnetLink.substring(0, 50)}...`, "info")
  }

  startTorrent(torrentId) {
    this.sendMessage({
      type: "start-torrent",
      torrentId: torrentId,
    })
    this.addLogEntry(`Starting torrent: ${torrentId}`, "info")
  }

  stopTorrent(torrentId) {
    this.sendMessage({
      type: "stop-torrent",
      torrentId: torrentId,
    })
    this.addLogEntry(`Stopping torrent: ${torrentId}`, "info")
  }

  removeTorrent(torrentId, deleteFiles = false) {
    this.sendMessage({
      type: "remove-torrent",
      torrentId: torrentId,
      deleteFiles: deleteFiles,
    })
    this.addLogEntry(`Removing torrent: ${torrentId}`, "info")

    // Remove from local state
    this.torrents.delete(torrentId)
    this.expandedFileLists.delete(torrentId)

    // Remove card from DOM with animation
    const cardId = `torrent-${torrentId}`
    const card = document.getElementById(cardId)
    if (card) {
      card.classList.add("removing")
      setTimeout(() => {
        if (card.parentNode) {
          card.parentNode.removeChild(card)
        }
        // Show no-torrents message if needed
        if (this.torrents.size === 0 && this.noTorrents) {
          this.noTorrents.style.display = "flex"
        }
      }, 300)
    }
  }

  refreshTorrents() {
    this.sendMessage({
      type: "get-torrents",
    })
  }

  scheduleUpdate(torrentId) {
    this.updateQueue.add(torrentId)

    if (!this.updateScheduled) {
      this.updateScheduled = true
      requestAnimationFrame(() => {
        const now = Date.now()
        const timeSinceLastUpdate = now - this.lastUpdateTime

        if (timeSinceLastUpdate < this.updateDebounceMs) {
          setTimeout(() => this.processUpdateQueue(), this.updateDebounceMs - timeSinceLastUpdate)
        } else {
          this.processUpdateQueue()
        }
      })
    }
  }

  processUpdateQueue() {
    if (this.updateQueue.size === 0) {
      this.updateScheduled = false
      return
    }

    const torrentIds = Array.from(this.updateQueue)
    this.updateQueue.clear()
    this.updateScheduled = false
    this.lastUpdateTime = Date.now()

    torrentIds.forEach((torrentId) => {
      const torrent = this.torrents.get(torrentId)
      if (torrent) {
        this.updateTorrentCard(torrent, false)
      }
    })
  }

  renderTorrentList() {
    if (!this.torrentsContainer) return

    if (this.noTorrents) {
      this.noTorrents.style.display = this.torrents.size === 0 ? "flex" : "none"
    }

    if (this.torrents.size === 0) return

    const statusPriority = {
      downloading: 0,
      verifying: 1,
      seeding: 2,
      completed: 3,
      stopped: 4,
      error: 5,
      unknown: 6,
    }

    const sortedTorrents = Array.from(this.torrents.values()).sort((a, b) => {
      const statusA = a.status || "unknown"
      const statusB = b.status || "unknown"

      const statusDiff = (statusPriority[statusA] || 6) - (statusPriority[statusB] || 6)
      if (statusDiff !== 0) return statusDiff

      const nameA = a.fileName || a.torrentId || ""
      const nameB = b.fileName || b.torrentId || ""
      return nameA.localeCompare(nameB)
    })

    const currentCardIds = new Set()
    this.torrentsContainer.querySelectorAll(".torrent-card").forEach((card) => {
      currentCardIds.add(card.id)
    })

    sortedTorrents.forEach((torrent) => {
      const cardId = `torrent-${torrent.torrentId}`
      currentCardIds.delete(cardId)
      this.updateTorrentCard(torrent, false)
    })

    currentCardIds.forEach((cardId) => {
      const card = document.getElementById(cardId)
      if (card) {
        card.classList.add("removing")
        setTimeout(() => {
          if (card.parentNode) {
            card.parentNode.removeChild(card)
          }
        }, 500)
      }
    })
  }

  getTorrentName(torrent) {
    if (!torrent) return "Unknown"

    // Try primary sources first
    if (torrent.name && torrent.name.trim()) {
      console.log("[v0] Using torrent.name:", torrent.name)
      return torrent.name
    }

    if (torrent.fileName && torrent.fileName.trim()) {
      console.log("[v0] Using torrent.fileName:", torrent.fileName)
      return torrent.fileName
    }

    // Try to extract from first file if available
    if (torrent.files && torrent.files.length > 0) {
      const firstName = torrent.files[0].name || torrent.files[0].path
      if (firstName && firstName.trim()) {
        // Extract just the filename without path
        const cleanName = firstName.split("/").pop()
        console.log("[v0] Using first file name:", cleanName)
        return cleanName
      }
    }

    // Try to extract from torrentId if it looks like a name (not just a hash)
    if (torrent.torrentId) {
      // If torrentId contains non-hex characters or is reasonably short, it might be a name
      if (torrent.torrentId.length < 50 && !/^[a-f0-9]{40,}$/.test(torrent.torrentId)) {
        console.log("[v0] Using torrentId as name:", torrent.torrentId)
        return torrent.torrentId
      }
      // Otherwise use shortened hash
      console.log("[v0] Using shortened torrentId:", torrent.torrentId.substring(0, 12))
      return torrent.torrentId.substring(0, 12) + "..."
    }

    return "Unknown"
  }

  updateTorrentCard(torrent, forceRedraw = false) {
    try {
      if (!torrent || !torrent.torrentId) {
        return
      }

      const torrentId = torrent.torrentId
      const cardId = `torrent-${torrentId}`
      let card = document.getElementById(cardId)
      const isNewCard = !card

      let wasExpanded = false
      if (card && !isNewCard) {
        const fileList = card.querySelector(".file-list")
        wasExpanded = fileList && fileList.style && fileList.style.display !== "none"
        if (wasExpanded) {
          this.expandedFileLists.add(torrentId)
        }
      }

      if (isNewCard || forceRedraw) {
        if (card && forceRedraw) {
          card.remove()
        }
        card = document.createElement("div")
        card.id = cardId
        card.className = "torrent-card"

        const fileCount = torrent.files ? torrent.files.length : 0
        const torrentName = this.getTorrentName(torrent)

        card.innerHTML = `
          <div class="torrent-thumbnail">
            <i class="fas fa-download"></i>
          </div>
          <div class="torrent-content">
            <div class="torrent-header">
              <div class="torrent-title-section">
                <h3 class="torrent-title" title="${this.escapeHTML(torrentName)}">${this.escapeHTML(torrentName)}</h3>
                <span class="status-badge"></span>
              </div>
              <div class="torrent-actions">
                <button class="btn btn-sm btn-primary start-btn"><i class="fas fa-play"></i> Start</button>
                <button class="btn btn-sm btn-warning stop-btn"><i class="fas fa-stop"></i> Stop</button>
                <button class="btn btn-sm btn-danger remove-btn"><i class="fas fa-trash"></i> Remove</button>
                <button class="btn btn-sm btn-danger delete-btn"><i class="fas fa-trash-alt"></i> Delete</button>
              </div>
            </div>
            <div class="torrent-details">
              <div class="progress-container">
                <div class="progress-bar" style="width: 0%;"></div>
              </div>
              <div class="torrent-stats">
                <div class="stat-item"><span class="stat-label">Downloaded:</span> <span class="stat-value">0 B</span></div>
                <div class="stat-item"><span class="stat-label">Size:</span> <span class="stat-value">0 B</span></div>
                <div class="stat-item"><span class="stat-label">Speed:</span> <span class="stat-value">0 B/s</span></div>
                <div class="stat-item"><span class="stat-label">Peers:</span> <span class="stat-value">0</span></div>
                <div class="stat-item"><span class="stat-label">ETA:</span> <span class="stat-value">--:--:--</span></div>
              </div>
            </div>
            <div class="torrent-files-container">
              <div class="torrent-files-header">
                <span class="files-count-text">${fileCount > 0 ? fileCount : "Loading"} File${fileCount !== 1 ? "s" : ""}</span>
                <button class="btn btn-sm toggle-files-btn"><i class="fas fa-chevron-down"></i> ${fileCount > 0 ? "Show Files" : "Loading..."}</button>
              </div>
              <ul class="file-list" style="display: none;"></ul>
            </div>
          </div>
        `

        card.querySelector(".start-btn").addEventListener("click", () => this.startTorrent(torrentId))
        card.querySelector(".stop-btn").addEventListener("click", () => this.stopTorrent(torrentId))
        card.querySelector(".remove-btn").addEventListener("click", () => this.removeTorrent(torrentId, false))
        card.querySelector(".delete-btn").addEventListener("click", () => this.removeTorrent(torrentId, true))

        const toggleFilesHeader = card.querySelector(".torrent-files-header")
        const toggleHandler = (e) => {
          e.stopPropagation()
          const button = card.querySelector(".toggle-files-btn")
          const fileList = card.querySelector(".file-list")

          if (!fileList || !fileList.style || !button) {
            console.warn("Toggle elements not found")
            return
          }

          const isHidden = fileList.style.display === "none" || fileList.style.display === ""

          fileList.style.display = isHidden ? "block" : "none"
          fileList.style.maxHeight = isHidden ? "none" : "0"
          button.innerHTML = isHidden
            ? '<i class="fas fa-chevron-up"></i> Hide Files'
            : '<i class="fas fa-chevron-down"></i> Show Files'

          if (isHidden) {
            this.expandedFileLists.add(torrentId)
          } else {
            this.expandedFileLists.delete(torrentId)
          }
        }

        if (toggleFilesHeader) {
          toggleFilesHeader.addEventListener("click", toggleHandler)
        }
        const toggleBtn = card.querySelector(".toggle-files-btn")
        if (toggleBtn) {
          toggleBtn.addEventListener("click", toggleHandler)
        }

        if (this.expandedFileLists.has(torrentId) || wasExpanded) {
          const fileList = card.querySelector(".file-list")
          const toggleBtn = card.querySelector(".toggle-files-btn")
          if (fileList && fileList.style && toggleBtn) {
            fileList.style.display = "block"
            fileList.style.maxHeight = "none"
            toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Files'
          }
        }

        if (this.torrentsContainer) {
          this.torrentsContainer.appendChild(card)
          console.log("[v0] Card created and appended:", cardId)
        } else {
          console.error("[v0] torrentsContainer not found!")
          return
        }
      }

      const status = torrent.status || "unknown"
      card.className = `torrent-card status-${status} fade-in`

      const thumbnail = card.querySelector(".torrent-thumbnail i")
      if (thumbnail) {
        const iconMap = {
          downloading: "fas fa-download",
          seeding: "fas fa-upload",
          verifying: "fas fa-check-circle",
          completed: "fas fa-check",
          stopped: "fas fa-stop",
          stopping: "fas fa-spinner fa-spin",
          error: "fas fa-exclamation-triangle",
          unknown: "fas fa-download",
        }
        const newClass = iconMap[status] || iconMap.unknown
        if (thumbnail.className !== newClass) {
          thumbnail.className = newClass
        }
      }

      const statusBadge = card.querySelector(".status-badge")
      if (statusBadge) {
        const newBadgeClass = `status-badge status-${status}`
        if (statusBadge.className !== newBadgeClass) {
          statusBadge.className = newBadgeClass
          statusBadge.innerHTML = `${this.getStatusIcon(status)} ${this.capitalizeFirstLetter(status)}`
        }
      }

      const progressBar = card.querySelector(".progress-bar")
      if (progressBar) {
        const progress = Math.min(100, Math.max(0, torrent.progress || 0))
        const newWidth = `${progress}%`
        if (progressBar.style.width !== newWidth) {
          progressBar.style.width = newWidth
        }
      }

      const updateStat = (selector, value) => {
        const element = card.querySelector(selector)
        if (element && element.textContent !== value) {
          element.textContent = value
        }
      }

      updateStat(".stat-item:nth-child(1) .stat-value", this.formatBytes(torrent.downloaded || 0))
      updateStat(".stat-item:nth-child(2) .stat-value", this.formatBytes(torrent.length || 0))
      updateStat(".stat-item:nth-child(3) .stat-value", this.formatSpeed(torrent.downloadSpeed || 0))
      updateStat(".stat-item:nth-child(4) .stat-value", torrent.peers || 0)
      updateStat(".stat-item:nth-child(5) .stat-value", this.formatTimeRemaining(torrent.timeRemaining))

      const startBtn = card.querySelector(".start-btn")
      const stopBtn = card.querySelector(".stop-btn")
      if (startBtn) {
        const shouldDisableStart = ["downloading", "seeding", "verifying", "stopping"].includes(status)
        startBtn.disabled = shouldDisableStart
        startBtn.style.opacity = shouldDisableStart ? "0.5" : "1"
      }
      if (stopBtn) {
        const shouldDisableStop = ["stopped", "stopping", "error"].includes(status)
        stopBtn.disabled = shouldDisableStop
        stopBtn.style.opacity = shouldDisableStop ? "0.5" : "1"
      }

      const filesCountText = card.querySelector(".files-count-text")
      const toggleFilesBtn = card.querySelector(".toggle-files-btn")
      if (filesCountText && torrent.files && torrent.files.length > 0) {
        const fileCount = torrent.files.length
        const newCountText = `${fileCount} File${fileCount !== 1 ? "s" : ""}`
        if (filesCountText.textContent !== newCountText) {
          filesCountText.textContent = newCountText
        }
        if (toggleFilesBtn && toggleFilesBtn.textContent && toggleFilesBtn.textContent.includes("Loading")) {
          toggleFilesBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Show Files'
        }
      }

      const fileList = card.querySelector(".file-list")
      if (!fileList) {
        return
      }

      if (!torrent.files || torrent.files.length === 0) {
        return
      }

      const currentFileCount = fileList.children ? fileList.children.length : 0
      const newFileCount = torrent.files.length

      if (currentFileCount !== newFileCount) {
        const wasExpanded = fileList.style && fileList.style.display === "block"

        fileList.innerHTML = ""

        torrent.files.forEach((file, index) => {
          const fileItem = document.createElement("li")
          fileItem.className = "file-item"

          const isVideo = file.isVideo || this.isVideoFile(file.name)
          const streamUrl = this.generateStreamUrl(torrent.torrentId, index)
          const downloadUrl = this.generateDownloadUrl(torrent.torrentId, index)

          fileItem.innerHTML = `
            <div class="file-info">
              ${isVideo ? '<i class="fas fa-video file-icon"></i>' : '<i class="fas fa-file file-icon"></i>'}
              <span class="file-name" title="${this.escapeHTML(file.path || file.name)}">${this.escapeHTML(file.name)}</span>
              <span class="file-size">${this.formatBytes(file.length)}</span>
            </div>
            <div class="file-actions">
              ${
                isVideo
                  ? `
                  <button class="btn btn-sm btn-success btn-stream" data-torrent-id="${torrent.torrentId}" data-file-index="${index}">
                    <i class="fas fa-play"></i> Play
                  </button>
                  <button class="btn btn-sm btn-info copy-stream-btn" data-torrent-id="${torrent.torrentId}" data-file-index="${index}">
                    <i class="fas fa-link"></i> Copy URL
                  </button>
                `
                  : ""
              }
              <a href="${downloadUrl}" download class="btn btn-sm btn-info">
                <i class="fas fa-download"></i> Download
              </a>
            </div>
          `

          fileList.appendChild(fileItem)

          if (isVideo) {
            const playBtn = fileItem.querySelector(".btn-stream")
            const copyBtn = fileItem.querySelector(".copy-stream-btn")

            if (playBtn) {
              playBtn.addEventListener("click", (e) => {
                e.preventDefault()
                const torrentId = playBtn.getAttribute("data-torrent-id")
                const fileIndex = playBtn.getAttribute("data-file-index")
                this.openStreamUrl(torrentId, fileIndex)
              })
            }

            if (copyBtn) {
              copyBtn.addEventListener("click", (e) => {
                e.preventDefault()
                const torrentId = copyBtn.getAttribute("data-torrent-id")
                const fileIndex = copyBtn.getAttribute("data-file-index")
                this.copyStreamUrl(torrentId, fileIndex)
              })
            }
          }
        })
      }
    } catch (error) {
      console.error("[v0] Error updating torrent card:", error)
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
  }

  formatSpeed(bytesPerSecond) {
    return this.formatBytes(bytesPerSecond) + "/s"
  }

  formatTimeRemaining(seconds) {
    if (!seconds || seconds < 0) return "--:--:--"
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  escapeHTML(text) {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }

  getStatusIcon(status) {
    const icons = {
      downloading: "⬇",
      seeding: "⬆",
      verifying: "✓",
      completed: "✓",
      stopped: "⏹",
      error: "⚠",
      unknown: "?",
    }
    return icons[status] || "?"
  }

  isVideoFile(filename) {
    const videoExtensions = [".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv", ".webm", ".m3u8"]
    return videoExtensions.some((ext) => filename.toLowerCase().endsWith(ext))
  }

  generateStreamUrl(torrentId, fileIndex) {
    return `/stream/${torrentId}/${fileIndex}`
  }

  generateDownloadUrl(torrentId, fileIndex) {
    return `/api/download/${torrentId}/${fileIndex}`
  }

  addLogEntry(message, level = "info") {
    if (!this.formattedLogs) return

    const timestamp = new Date().toLocaleTimeString()
    const logEntry = document.createElement("div")
    logEntry.className = `log-entry ${level}`
    logEntry.innerHTML = `
      <span class="log-time">${timestamp}</span>
      <span class="log-level">${level.toUpperCase()}</span>
      <span class="log-message">${this.escapeHTML(message)}</span>
    `

    this.formattedLogs.appendChild(logEntry)
    this.logsContainer.scrollTop = this.logsContainer.scrollHeight
  }

  async openStreamUrl(torrentId, fileIndex) {
    try {
      // First get the stream URL info from the API
      const response = await fetch(`/api/torrents/${torrentId}/files/${fileIndex}/stream-url`)

      if (response.ok) {
        const data = await response.json()
        console.log("[v0] Stream URL API response:", data)

        if (data && data.streamUrl) {
          window.open(data.streamUrl, "_blank")
          this.addLogEntry(`Opening stream for ${data.fileName || "video"}`, "success")
          return
        }
      }

      // If we get here, either the response wasn't ok or data.streamUrl wasn't available
      throw new Error("Failed to get valid stream URL from API")
    } catch (error) {
      console.error("[v0] Stream URL error:", error)
      // Fallback to direct URL
      const directUrl = window.location.origin + this.generateStreamUrl(torrentId, fileIndex)
      window.open(directUrl, "_blank")
      this.addLogEntry(`Using direct stream URL: ${error.message}`, "warning")
    }
  }

  async copyStreamUrl(torrentId, fileIndex) {
    try {
      // First try to get the stream URL from the API
      const response = await fetch(`/api/torrents/${torrentId}/files/${fileIndex}/stream-url`)

      if (response.ok) {
        const data = await response.json()
        console.log("[v0] Copy URL API response:", data)

        if (data && data.streamUrl) {
          await navigator.clipboard.writeText(data.streamUrl)
          this.addLogEntry("Stream URL copied to clipboard", "success")
          return
        }
      }

      // If we get here, either the response wasn't ok or data.streamUrl wasn't available
      throw new Error("Failed to get valid stream URL from API")
    } catch (error) {
      console.error("[v0] Copy URL error:", error)
      // Fallback to direct URL
      const directUrl = window.location.origin + this.generateStreamUrl(torrentId, fileIndex)
      try {
        await navigator.clipboard.writeText(directUrl)
        this.addLogEntry("Direct stream URL copied to clipboard (fallback)", "warning")
      } catch (clipboardError) {
        this.addLogEntry(`Error copying URL: ${clipboardError.message}`, "error")
      }
    }
  }

  clearLogs() {
    if (this.formattedLogs) {
      this.formattedLogs.innerHTML = ""
      this.addLogEntry("Logs cleared", "info")
    }
  }

  toggleLogs() {
    if (!this.logsContainer) return
    const isHidden = this.logsContainer.style.display === "none"
    this.logsContainer.style.display = isHidden ? "block" : "none"
    this.toggleLogsBtn.innerHTML = isHidden
      ? '<i class="fas fa-chevron-down"></i> Hide'
      : '<i class="fas fa-chevron-up"></i> Show'
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new TorrentStreamApp()
  app.init()
})
