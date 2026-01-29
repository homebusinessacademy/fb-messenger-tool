const cron = require('node-cron')
const { v4: uuidv4 } = require('uuid')
const { getDb } = require('./database')

class Scheduler {
  constructor(facebookController, mainWindow) {
    this.facebookController = facebookController
    this.mainWindow = mainWindow
    this.currentCampaign = null
    this.scheduledTasks = []
    this.isPaused = false
    this.dailyJob = null
    this.isSending = false  // Lock to prevent multiple simultaneous sends
    this.MAX_MESSAGES_PER_DAY = 10
    this.START_HOUR = 9  // 9 AM
    this.END_HOUR = 20   // 8 PM
    this.TEST_MODE = true  // Set to true for immediate sending with human-like delays
    this.TEST_DELAY_MIN = 30000  // 30 seconds minimum between messages
    this.TEST_DELAY_MAX = 60000  // 60 seconds maximum between messages

    // Set up daily job to schedule messages (only if not in test mode)
    if (!this.TEST_MODE) {
      this.setupDailyScheduler()
    }
  }

  setupDailyScheduler() {
    // Run every day at START_HOUR to schedule the day's messages
    this.dailyJob = cron.schedule(`0 ${this.START_HOUR} * * *`, () => {
      this.scheduleDailyMessages()
    })
  }

  generateRandomTimes(count) {
    const times = []
    const windowMinutes = (this.END_HOUR - this.START_HOUR) * 60

    for (let i = 0; i < count; i++) {
      // Generate random minute within the window
      const randomMinute = Math.floor(Math.random() * windowMinutes)
      const hour = this.START_HOUR + Math.floor(randomMinute / 60)
      const minute = randomMinute % 60

      // Add some variance to seconds too
      const second = Math.floor(Math.random() * 60)

      times.push({ hour, minute, second })
    }

    // Sort times chronologically
    times.sort((a, b) => {
      if (a.hour !== b.hour) return a.hour - b.hour
      if (a.minute !== b.minute) return a.minute - b.minute
      return a.second - b.second
    })

    return times
  }

  async startCampaign(listId, messageId) {
    // Check if there's already an active campaign
    if (this.currentCampaign) {
      return { success: false, error: 'A campaign is already active. Please complete or cancel it first.' }
    }

    // Get list friends
    const friends = getDb().prepare(`
      SELECT f.* FROM friends f
      JOIN list_friends lf ON f.id = lf.friend_id
      WHERE lf.list_id = ?
    `).all(listId)

    if (friends.length === 0) {
      return { success: false, error: 'The selected list has no friends.' }
    }

    // Get message
    const message = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(messageId)
    if (!message) {
      return { success: false, error: 'Message not found.' }
    }

    // Create campaign
    const campaignId = uuidv4()
    const now = new Date().toISOString()

    getDb().prepare(`
      INSERT INTO campaigns (id, list_id, message_id, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(campaignId, listId, messageId, now)

    // Create send records for each friend
    const insertRecord = getDb().prepare(`
      INSERT INTO send_records (id, campaign_id, friend_id, status)
      VALUES (?, ?, ?, 'pending')
    `)

    for (const friend of friends) {
      insertRecord.run(uuidv4(), campaignId, friend.id)
    }

    this.currentCampaign = {
      id: campaignId,
      listId,
      messageId,
      messageBody: message.body,
      totalFriends: friends.length
    }

    // Schedule today's messages
    await this.scheduleDailyMessages()

    this.notifyUpdate()

    return { success: true, campaignId }
  }

  async scheduleDailyMessages() {
    if (!this.currentCampaign || this.isPaused) return

    // Clear any existing scheduled tasks
    this.clearScheduledTasks()

    // Get pending send records
    const pendingRecords = getDb().prepare(`
      SELECT sr.*, f.name, f.first_name, f.id as friend_id
      FROM send_records sr
      JOIN friends f ON sr.friend_id = f.id
      WHERE sr.campaign_id = ? AND sr.status = 'pending'
      LIMIT ?
    `).all(this.currentCampaign.id, this.MAX_MESSAGES_PER_DAY)

    if (pendingRecords.length === 0) {
      // Campaign complete
      this.completeCampaign()
      return
    }

    // TEST MODE: Send immediately with human-like delays
    if (this.TEST_MODE) {
      console.log(`[Scheduler] TEST MODE: Queuing ${pendingRecords.length} messages with 30-60s delays`)

      // Process messages one at a time with delays
      this.processTestQueue(pendingRecords, 0)
      return
    }

    // PRODUCTION MODE: Generate random times throughout the day
    const now = new Date()
    const times = this.generateRandomTimes(pendingRecords.length)

    for (let i = 0; i < pendingRecords.length; i++) {
      const record = pendingRecords[i]
      const time = times[i]

      // Create scheduled time
      const scheduledTime = new Date()
      scheduledTime.setHours(time.hour, time.minute, time.second, 0)

      // If time has passed today, add to queue for immediate processing
      if (scheduledTime <= now) {
        // Process immediately with slight delay
        setTimeout(() => {
          this.sendScheduledMessage(record)
        }, (i + 1) * 5000) // 5 second delay between immediate sends
      } else {
        // Schedule for later
        const cronExpression = `${time.second} ${time.minute} ${time.hour} * * *`

        const task = cron.schedule(cronExpression, () => {
          this.sendScheduledMessage(record)
        }, {
          scheduled: true,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })

        this.scheduledTasks.push(task)
      }

      // Update record with scheduled time
      getDb().prepare(`
        UPDATE send_records SET scheduled_at = ? WHERE id = ?
      `).run(scheduledTime.toISOString(), record.id)
    }

    this.notifyUpdate()
  }

  async processTestQueue(records, index) {
    if (this.isPaused || !this.currentCampaign || index >= records.length) {
      return
    }

    const record = records[index]

    // Update scheduled time to now
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE send_records SET scheduled_at = ? WHERE id = ?
    `).run(now, record.id)

    this.notifyUpdate()

    // Send this message
    console.log(`[Scheduler] TEST MODE: Sending message ${index + 1}/${records.length} to ${record.name}`)
    await this.sendScheduledMessage(record)

    // Schedule next message with random delay (30-60 seconds)
    if (index + 1 < records.length && !this.isPaused && this.currentCampaign) {
      const delay = this.TEST_DELAY_MIN + Math.random() * (this.TEST_DELAY_MAX - this.TEST_DELAY_MIN)
      console.log(`[Scheduler] TEST MODE: Next message in ${Math.round(delay/1000)} seconds`)

      setTimeout(() => {
        this.processTestQueue(records, index + 1)
      }, delay)
    }
  }

  async sendScheduledMessage(record) {
    if (this.isPaused || !this.currentCampaign) return

    // Check if already sending - skip if so (will be rescheduled)
    if (this.isSending) {
      console.log('[Scheduler] Already sending a message, skipping scheduled send')
      return
    }

    this.isSending = true

    try {
      // Personalize message
      const personalizedMessage = this.currentCampaign.messageBody
        .replace(/\{\{first_name\}\}/gi, record.first_name)

      // Send via Facebook
      const result = await this.facebookController.sendMessage(
        record.friend_id,
        record.name,
        personalizedMessage
      )

      // Update record
      const now = new Date().toISOString()

      if (result.success) {
        getDb().prepare(`
          UPDATE send_records SET status = 'sent', sent_at = ? WHERE id = ?
        `).run(now, record.id)
      } else {
        getDb().prepare(`
          UPDATE send_records SET status = 'failed', error = ? WHERE id = ?
        `).run(result.error || 'Unknown error', record.id)
      }

      this.notifyUpdate()

      // Check if campaign is complete
      const remaining = getDb().prepare(`
        SELECT COUNT(*) as count FROM send_records
        WHERE campaign_id = ? AND status = 'pending'
      `).get(this.currentCampaign.id)

      if (remaining.count === 0) {
        this.completeCampaign()
      }
    } catch (error) {
      console.error('Failed to send scheduled message:', error)

      getDb().prepare(`
        UPDATE send_records SET status = 'failed', error = ? WHERE id = ?
      `).run(error.message, record.id)

      this.notifyUpdate()
    } finally {
      this.isSending = false
    }
  }

  completeCampaign() {
    if (!this.currentCampaign) return

    getDb().prepare(`
      UPDATE campaigns SET status = 'completed' WHERE id = ?
    `).run(this.currentCampaign.id)

    this.clearScheduledTasks()
    this.currentCampaign = null
    this.isPaused = false

    this.notifyUpdate()
  }

  pauseCampaign() {
    if (!this.currentCampaign) return

    this.isPaused = true
    this.clearScheduledTasks()

    getDb().prepare(`
      UPDATE campaigns SET status = 'paused' WHERE id = ?
    `).run(this.currentCampaign.id)

    this.notifyUpdate()
  }

  resumeCampaign() {
    if (!this.currentCampaign || !this.isPaused) return

    this.isPaused = false

    getDb().prepare(`
      UPDATE campaigns SET status = 'active' WHERE id = ?
    `).run(this.currentCampaign.id)

    // Reschedule messages
    this.scheduleDailyMessages()

    this.notifyUpdate()
  }

  cancelCampaign() {
    if (!this.currentCampaign) return

    getDb().prepare(`
      UPDATE campaigns SET status = 'cancelled' WHERE id = ?
    `).run(this.currentCampaign.id)

    this.clearScheduledTasks()
    this.currentCampaign = null
    this.isPaused = false

    this.notifyUpdate()
  }

  clearScheduledTasks() {
    for (const task of this.scheduledTasks) {
      task.stop()
    }
    this.scheduledTasks = []
  }

  getCampaignStatus() {
    if (!this.currentCampaign) {
      return { active: false }
    }

    const stats = getDb().prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM send_records
      WHERE campaign_id = ?
    `).get(this.currentCampaign.id)

    // Get next scheduled time
    const nextScheduled = getDb().prepare(`
      SELECT scheduled_at FROM send_records
      WHERE campaign_id = ? AND status = 'pending' AND scheduled_at IS NOT NULL
      ORDER BY scheduled_at ASC
      LIMIT 1
    `).get(this.currentCampaign.id)

    return {
      active: true,
      campaignId: this.currentCampaign.id,
      isPaused: this.isPaused,
      total: stats.total,
      sent: stats.sent,
      pending: stats.pending,
      failed: stats.failed,
      nextScheduledAt: nextScheduled?.scheduled_at || null
    }
  }

  processPendingQueue() {
    // Check for any active campaign that may have missed sends
    const activeCampaign = getDb().prepare(`
      SELECT * FROM campaigns WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
    `).get()

    if (activeCampaign) {
      const message = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(activeCampaign.message_id)

      this.currentCampaign = {
        id: activeCampaign.id,
        listId: activeCampaign.list_id,
        messageId: activeCampaign.message_id,
        messageBody: message?.body || ''
      }

      // Reschedule remaining messages
      this.scheduleDailyMessages()
    }
  }

  async sendNow(recordId) {
    if (!this.currentCampaign) {
      return { success: false, error: 'No active campaign' }
    }

    // Check if already sending
    if (this.isSending) {
      return { success: false, error: 'Already sending a message. Please wait.' }
    }

    this.isSending = true

    // Get the record with friend info
    const record = getDb().prepare(`
      SELECT sr.*, f.name, f.first_name, f.id as friend_id
      FROM send_records sr
      JOIN friends f ON sr.friend_id = f.id
      WHERE sr.id = ? AND sr.status = 'pending'
    `).get(recordId)

    if (!record) {
      return { success: false, error: 'Record not found or already sent' }
    }

    try {
      // Personalize message
      const personalizedMessage = this.currentCampaign.messageBody
        .replace(/\{\{first_name\}\}/gi, record.first_name)

      // Send via Facebook
      const result = await this.facebookController.sendMessage(
        record.friend_id,
        record.name,
        personalizedMessage
      )

      // Update record
      const now = new Date().toISOString()

      if (result.success) {
        getDb().prepare(`
          UPDATE send_records SET status = 'sent', sent_at = ? WHERE id = ?
        `).run(now, record.id)
      } else {
        getDb().prepare(`
          UPDATE send_records SET status = 'failed', error = ? WHERE id = ?
        `).run(result.error || 'Unknown error', record.id)
      }

      this.notifyUpdate()

      // Check if campaign is complete
      const remaining = getDb().prepare(`
        SELECT COUNT(*) as count FROM send_records
        WHERE campaign_id = ? AND status = 'pending'
      `).get(this.currentCampaign.id)

      if (remaining.count === 0) {
        this.completeCampaign()
      }

      return result
    } catch (error) {
      console.error('Failed to send message immediately:', error)

      if (record) {
        getDb().prepare(`
          UPDATE send_records SET status = 'failed', error = ? WHERE id = ?
        `).run(error.message, record.id)
      }

      this.notifyUpdate()

      return { success: false, error: error.message }
    } finally {
      this.isSending = false
    }
  }

  notifyUpdate() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('campaign:update', this.getCampaignStatus())
    }
  }
}

module.exports = { Scheduler }
