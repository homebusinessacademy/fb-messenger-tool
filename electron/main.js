const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { initDatabase, getDb } = require('./database')
const { FacebookController } = require('./facebook')
const { Scheduler } = require('./scheduler')

let mainWindow
let facebookController
let scheduler

const isDev = !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e'
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  // Initialize database
  initDatabase()

  // Initialize Facebook controller
  facebookController = new FacebookController()

  // Create the window first
  createWindow()

  // Initialize scheduler with the window reference
  scheduler = new Scheduler(facebookController, mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Check for pending messages when app wakes (after short delay to ensure everything is ready)
  setTimeout(() => {
    try {
      scheduler.processPendingQueue()
    } catch (error) {
      console.error('Failed to process pending queue:', error)
    }
  }, 1000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ============ IPC Handlers ============

// Auth handlers
ipcMain.handle('fb:login', async () => {
  try {
    await facebookController.login()
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fb:logout', async () => {
  try {
    await facebookController.logout()
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('fb:checkAuth', async () => {
  try {
    const isAuthenticated = await facebookController.checkSession()
    return { authenticated: isAuthenticated }
  } catch (error) {
    return { authenticated: false, error: error.message }
  }
})

ipcMain.handle('fb:verifyLogin', async () => {
  try {
    const isValid = await facebookController.verifyAndSaveSession()
    return { success: isValid, authenticated: isValid }
  } catch (error) {
    return { success: false, authenticated: false, error: error.message }
  }
})

// Friends handlers
ipcMain.handle('friends:getAll', () => {
  try {
    const friends = getDb().prepare('SELECT * FROM friends ORDER BY name').all()
    return { success: true, friends }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('friends:refresh', async () => {
  console.log('[MAIN] friends:refresh IPC called!')
  const fs = require('fs')
  fs.writeFileSync('/tmp/fb-ipc-debug.txt', 'IPC friends:refresh at ' + new Date().toISOString())
  try {
    console.log('[MAIN] Calling facebookController.getFriends()...')
    const friends = await facebookController.getFriends()

    // Clear existing friends and insert new ones
    getDb().prepare('DELETE FROM friends').run()

    const insert = getDb().prepare(`
      INSERT INTO friends (id, name, first_name, profile_photo_url)
      VALUES (?, ?, ?, ?)
    `)

    for (const friend of friends) {
      insert.run(friend.id, friend.name, friend.firstName, friend.profilePhotoUrl)
    }

    return { success: true, friends }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Lists handlers
ipcMain.handle('lists:getAll', () => {
  try {
    const lists = getDb().prepare(`
      SELECT l.*, COUNT(lf.friend_id) as friend_count
      FROM lists l
      LEFT JOIN list_friends lf ON l.id = lf.list_id
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `).all()
    return { success: true, lists }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('lists:getOne', (event, listId) => {
  try {
    const list = getDb().prepare('SELECT * FROM lists WHERE id = ?').get(listId)
    const friends = getDb().prepare(`
      SELECT f.* FROM friends f
      JOIN list_friends lf ON f.id = lf.friend_id
      WHERE lf.list_id = ?
    `).all(listId)
    return { success: true, list, friends }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('lists:create', (event, name, friendIds) => {
  try {
    const { v4: uuidv4 } = require('uuid')
    const id = uuidv4()
    const now = new Date().toISOString()

    getDb().prepare(`
      INSERT INTO lists (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, now, now)

    const insertFriend = getDb().prepare(`
      INSERT INTO list_friends (list_id, friend_id)
      VALUES (?, ?)
    `)

    for (const friendId of friendIds) {
      insertFriend.run(id, friendId)
    }

    return { success: true, id }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('lists:update', (event, id, name, friendIds) => {
  try {
    const now = new Date().toISOString()

    getDb().prepare(`
      UPDATE lists SET name = ?, updated_at = ? WHERE id = ?
    `).run(name, now, id)

    // Remove existing friends and add new ones
    getDb().prepare('DELETE FROM list_friends WHERE list_id = ?').run(id)

    const insertFriend = getDb().prepare(`
      INSERT INTO list_friends (list_id, friend_id)
      VALUES (?, ?)
    `)

    for (const friendId of friendIds) {
      insertFriend.run(id, friendId)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('lists:delete', (event, id) => {
  try {
    getDb().prepare('DELETE FROM list_friends WHERE list_id = ?').run(id)
    getDb().prepare('DELETE FROM lists WHERE id = ?').run(id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('lists:checkFriendMessageHistory', (event, friendIds) => {
  try {
    const placeholders = friendIds.map(() => '?').join(',')
    const sentFriends = getDb().prepare(`
      SELECT DISTINCT friend_id FROM send_records
      WHERE friend_id IN (${placeholders}) AND status = 'sent'
    `).all(...friendIds)
    return { success: true, sentFriendIds: sentFriends.map(f => f.friend_id) }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Messages handlers
ipcMain.handle('messages:getAll', () => {
  try {
    const messages = getDb().prepare('SELECT * FROM messages ORDER BY created_at DESC').all()
    return { success: true, messages }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('messages:save', (event, name, body) => {
  try {
    const { v4: uuidv4 } = require('uuid')
    const id = uuidv4()
    const now = new Date().toISOString()

    getDb().prepare(`
      INSERT INTO messages (id, name, body, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name, body, now)

    return { success: true, id }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('messages:update', (event, id, name, body) => {
  try {
    getDb().prepare(`
      UPDATE messages SET name = ?, body = ? WHERE id = ?
    `).run(name, body, id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('messages:delete', (event, id) => {
  try {
    console.log('[DB] Deleting message:', id)

    // Get all campaign IDs that use this message
    const campaigns = getDb().prepare('SELECT id FROM campaigns WHERE message_id = ?').all(id)
    console.log('[DB] Found campaigns using this message:', campaigns.length)

    // Delete send_records for each campaign
    for (const campaign of campaigns) {
      console.log('[DB] Deleting send_records for campaign:', campaign.id)
      getDb().prepare('DELETE FROM send_records WHERE campaign_id = ?').run(campaign.id)
    }

    // Delete the campaigns
    console.log('[DB] Deleting campaigns')
    getDb().prepare('DELETE FROM campaigns WHERE message_id = ?').run(id)

    // Also clear scheduler's current campaign if it matches
    if (scheduler && scheduler.currentCampaign) {
      const matchingCampaign = campaigns.find(c => c.id === scheduler.currentCampaign.id)
      if (matchingCampaign) {
        console.log('[DB] Clearing scheduler current campaign')
        scheduler.currentCampaign = null
        scheduler.clearScheduledTasks()
      }
    }

    // Finally delete the message
    console.log('[DB] Deleting message')
    getDb().prepare('DELETE FROM messages WHERE id = ?').run(id)

    console.log('[DB] Message deleted successfully')
    return { success: true }
  } catch (error) {
    console.error('[DB] Failed to delete message:', error)
    return { success: false, error: error.message }
  }
})

// Campaign handlers
ipcMain.handle('campaign:start', async (event, listId, messageId) => {
  try {
    const result = await scheduler.startCampaign(listId, messageId)
    return result
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('campaign:pause', () => {
  try {
    scheduler.pauseCampaign()
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('campaign:resume', () => {
  try {
    scheduler.resumeCampaign()
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('campaign:cancel', () => {
  try {
    scheduler.cancelCampaign()
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('campaign:getStatus', () => {
  try {
    const status = scheduler.getCampaignStatus()
    return { success: true, ...status }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('campaign:getRecords', (event, campaignId) => {
  try {
    const records = getDb().prepare(`
      SELECT sr.*, f.name, f.first_name, f.profile_photo_url
      FROM send_records sr
      JOIN friends f ON sr.friend_id = f.id
      WHERE sr.campaign_id = ?
      ORDER BY sr.sent_at DESC NULLS LAST
    `).all(campaignId)
    return { success: true, records }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('campaign:sendNow', async (event, recordId) => {
  try {
    const result = await scheduler.sendNow(recordId)
    return result
  } catch (error) {
    return { success: false, error: error.message }
  }
})
