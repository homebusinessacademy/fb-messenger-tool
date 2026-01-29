const { chromium } = require('playwright')
const path = require('path')
const { app } = require('electron')
const fs = require('fs')

class FacebookController {
  constructor() {
    this.browser = null
    this.context = null
    this.page = null
    this.sessionPath = path.join(app.getPath('userData'), 'fb-session.json')
    this.isBusy = false  // Lock to prevent multiple operations
  }

  async initBrowser(headless = false) {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless,
        args: ['--disable-blink-features=AutomationControlled']
      })
    }

    // Try to load existing session
    if (fs.existsSync(this.sessionPath)) {
      try {
        const sessionData = JSON.parse(fs.readFileSync(this.sessionPath, 'utf-8'))
        this.context = await this.browser.newContext({
          storageState: sessionData,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
      } catch (error) {
        console.error('Failed to load session:', error)
        this.context = await this.browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
      }
    } else {
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      })
    }

    this.page = await this.context.newPage()
  }

  async saveSession() {
    if (this.context) {
      const storage = await this.context.storageState()
      fs.writeFileSync(this.sessionPath, JSON.stringify(storage, null, 2))
    }
  }

  async login() {
    // Launch visible browser for user to log in
    await this.initBrowser(false)

    // First check if already logged in by going to main FB page
    await this.page.goto('https://www.facebook.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    })
    await this.page.waitForTimeout(3000)

    // Check if we're already logged in
    const alreadyLoggedIn = await this.page.evaluate(() => {
      const loginButton = document.querySelector('[data-testid="royal_login_button"]')
      const loginForm = document.querySelector('form[data-testid="royal_login_form"]')
      const emailInput = document.querySelector('input[name="email"]')
      // If we DON'T see login elements, we're logged in
      return !(loginButton || loginForm || emailInput)
    })

    if (alreadyLoggedIn) {
      console.log('[FB] Already logged in!')
      await this.saveSession()
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
      return true
    }

    // Not logged in, go to login page
    await this.page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' })

    // Wait for user to complete login - check for logged-in state more robustly
    // This checks every 2 seconds for up to 10 minutes
    const maxWaitTime = 600000 // 10 minutes
    const checkInterval = 2000
    let elapsed = 0

    while (elapsed < maxWaitTime) {
      try {
        // Check if we're on the main Facebook page (logged in)
        const isLoggedIn = await this.page.evaluate(() => {
          const url = window.location.href

          // Still on login page
          if (url.includes('/login')) return false

          // Check for logged-in indicators
          const hasNavBar = document.querySelector('[role="navigation"]') !== null
          const hasProfileLink = document.querySelector('[aria-label="Your profile"]') !== null ||
                                document.querySelector('[aria-label="Account"]') !== null ||
                                document.querySelector('svg[aria-label]') !== null
          const hasFeed = document.querySelector('[role="feed"]') !== null
          const hasMessenger = document.querySelector('[aria-label="Messenger"]') !== null

          // On Facebook main page with nav elements = logged in
          if (url.includes('facebook.com') && !url.includes('/login') &&
              (hasNavBar || hasProfileLink || hasFeed || hasMessenger)) {
            return true
          }

          // Still on checkpoint/verification - wait more
          if (url.includes('/checkpoint') || url.includes('/two_factor')) {
            return false
          }

          // Redirected away from login to main FB = likely logged in
          if (url === 'https://www.facebook.com/' || url === 'https://www.facebook.com') {
            return true
          }

          return false
        })

        if (isLoggedIn) {
          // Add delay to ensure cookies are fully set
          await this.page.waitForTimeout(2000)

          // Save session
          await this.saveSession()

          // Close browser window
          await this.browser.close()
          this.browser = null
          this.context = null
          this.page = null

          return true
        }
      } catch (e) {
        // Page might be navigating, continue waiting
      }

      await this.page.waitForTimeout(checkInterval)
      elapsed += checkInterval
    }

    // Timeout - but let's try to save session anyway in case user is logged in
    try {
      await this.saveSession()
      await this.browser.close()
    } catch (e) {
      // Ignore cleanup errors
    }

    this.browser = null
    this.context = null
    this.page = null

    throw new Error('Login timeout. If you completed login, click "Verify Login" to check.')
  }

  async verifyAndSaveSession() {
    // Manual verification - check if we have a valid session
    const isValid = await this.checkSession()
    return isValid
  }

  async logout() {
    // Delete session file
    if (fs.existsSync(this.sessionPath)) {
      fs.unlinkSync(this.sessionPath)
    }

    // Close browser if open
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
    }
  }

  async checkSession() {
    if (!fs.existsSync(this.sessionPath)) {
      return false
    }

    try {
      await this.initBrowser(true)
      await this.page.goto('https://www.facebook.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      })

      // Wait a bit for page to render
      await this.page.waitForTimeout(2000)

      // Check if we're logged in by looking for login button absence
      const isLoggedIn = await this.page.evaluate(() => {
        const loginButton = document.querySelector('[data-testid="royal_login_button"]')
        const loginForm = document.querySelector('form[data-testid="royal_login_form"]')
        const emailInput = document.querySelector('input[name="email"]')
        // If we see login elements, we're not logged in
        if (loginButton || loginForm || emailInput) return false
        // Otherwise assume logged in
        return true
      })

      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null

      return isLoggedIn
    } catch (error) {
      console.error('Session check failed:', error)
      // Clean up on error
      try {
        if (this.browser) await this.browser.close()
      } catch (e) {}
      this.browser = null
      this.context = null
      this.page = null
      return false
    }
  }

  async getFriends() {
    // Debug: Write to file to confirm function is called
    const debugFile = '/tmp/fb-debug.txt'
    fs.writeFileSync(debugFile, 'getFriends called at ' + new Date().toISOString() + '\n')
    console.log('[FB] Starting getFriends...')
    // Use visible browser so Facebook doesn't block us
    await this.initBrowser(false)

    const friends = []

    try {
      // Navigate to friends page with longer timeout
      console.log('[FB] Navigating to friends list...')
      await this.page.goto('https://www.facebook.com/friends/list', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      })

      // Wait for page to fully load
      console.log('[FB] Waiting for page to load...')
      await this.page.waitForTimeout(5000)

      // Get current URL
      const currentUrl = this.page.url()
      console.log('[FB] Current URL:', currentUrl)

      // Take screenshot
      const screenshotPath = path.join(app.getPath('temp'), 'fb-friends-debug.png')
      await this.page.screenshot({ path: screenshotPath, fullPage: false })
      console.log('[FB] Screenshot saved to:', screenshotPath)

      // Get viewport size
      const viewport = this.page.viewportSize()
      console.log('[FB] Viewport:', viewport)

      // Count initial elements
      let prevCount = await this.page.evaluate(() => document.querySelectorAll('a').length)
      console.log('[FB] Initial <a> count:', prevCount)

      // MANUAL SCROLL MODE: User scrolls, we capture
      console.log('[FB] Manual scroll mode - waiting for user to scroll...')

      // Inject a floating status indicator into the page
      await this.page.evaluate(() => {
        const statusDiv = document.createElement('div')
        statusDiv.id = 'fb-capture-status'
        statusDiv.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: #4CAF50;
          color: white;
          padding: 15px 20px;
          border-radius: 8px;
          font-family: Arial, sans-serif;
          font-size: 14px;
          z-index: 999999;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `
        statusDiv.innerHTML = '📋 Capturing friends: <span id="capture-count">0</span><br><small>Scroll down slowly to load all friends.<br>Close this window when done.</small>'
        document.body.appendChild(statusDiv)
      })

      // Collect friends while user scrolls - poll every 500ms
      const friendsMap = new Map()

      const captureVisibleFriends = async () => {
        const visible = await this.page.evaluate(() => {
          const found = []

          // Method 1: Find friend cards by data attribute (this worked before for avatars)
          document.querySelectorAll('[data-visualcompletion="ignore-dynamic"]').forEach(card => {
            const profileLink = card.querySelector('a[href*="facebook.com/"]')
            if (!profileLink) return

            const href = profileLink.getAttribute('href') || ''
            const match = href.match(/facebook\.com\/([a-zA-Z0-9.]+)/)
            if (!match) return

            const userId = match[1]
            const skip = ['friends', 'watch', 'marketplace', 'groups', 'gaming', 'events', 'pages', 'messages', 'notifications', 'login', 'help']
            if (skip.includes(userId.toLowerCase())) return

            // Get name from spans in the card
            let name = null
            card.querySelectorAll('span').forEach(span => {
              const text = span.textContent?.trim()
              if (text && text.length >= 3 && text.length <= 50 && /^[A-Z]/.test(text) && text.includes(' ')) {
                if (!name) name = text
              }
            })

            if (!name) return

            // Get avatar - look for image or img in the card
            const svgImage = card.querySelector('image')
            const imgTag = card.querySelector('img[src*="fbcdn"]')
            const avatarUrl = svgImage?.getAttribute('xlink:href') || imgTag?.getAttribute('src') || ''

            found.push({ id: userId, name: name, avatar: avatarUrl })
          })

          // Method 2: Fallback to link-based search if Method 1 found nothing
          if (found.length < 5) {
            document.querySelectorAll('a[href*="facebook.com"]').forEach(link => {
              const href = link.getAttribute('href') || ''
              const match = href.match(/facebook\.com\/([a-zA-Z0-9.]+)/)
              if (!match) return
              const userId = match[1]
              const skip = ['friends', 'watch', 'marketplace', 'groups', 'gaming', 'events', 'pages', 'messages', 'notifications', 'login', 'help']
              if (skip.includes(userId.toLowerCase())) return
              const text = link.textContent?.trim()
              if (text && text.length > 2 && text.length < 60 && /^[A-Z]/.test(text)) {
                found.push({ id: userId, name: text, avatar: '' })
              }
            })
          }

          return found
        })
        for (const f of visible) {
          if (!friendsMap.has(f.id)) {
            friendsMap.set(f.id, f)
          } else if (f.avatar && !friendsMap.get(f.id).avatar) {
            // Update with avatar if we didn't have one before
            friendsMap.get(f.id).avatar = f.avatar
          }
        }
        // Update the status indicator
        await this.page.evaluate((count) => {
          const el = document.getElementById('capture-count')
          if (el) el.textContent = count
        }, friendsMap.size)
      }

      // Capture initial friends
      await captureVisibleFriends()
      console.log('[FB] Initial capture:', friendsMap.size)

      // Poll for new friends while browser is open (max 5 minutes)
      const maxWaitTime = 300000 // 5 minutes
      const startTime = Date.now()
      let lastSize = 0

      while (Date.now() - startTime < maxWaitTime) {
        try {
          await captureVisibleFriends()

          if (friendsMap.size !== lastSize) {
            console.log('[FB] Captured:', friendsMap.size, 'friends')
            lastSize = friendsMap.size
          }

          // Check if browser is still open
          if (!this.page || this.page.isClosed()) {
            console.log('[FB] Browser closed by user')
            break
          }

          await this.page.waitForTimeout(500)
        } catch (e) {
          // Browser was closed
          console.log('[FB] Browser closed')
          break
        }
      }

      const allFriendsFound = Array.from(friendsMap.values())
      console.log('[FB] Final capture:', allFriendsFound.length, 'unique friends')

      // Use the friends we collected while scrolling
      if (allFriendsFound.length > 0) {
        console.log('[FB] Using friends collected during scroll')
        for (const friend of allFriendsFound) {
          // Clean the name
          let name = friend.name
            .replace(/\d+\s*mutual\s*friends?/gi, '')
            .replace(/\d+\s*friends?/gi, '')
            .replace(/mutual.*$/i, '')
            .replace(/\s+/g, ' ')
            .trim()

          if (name && name.includes(' ') && name.length >= 3) {
            friends.push({
              id: friend.id,
              name: name,
              firstName: name.split(' ')[0],
              profilePhotoUrl: friend.avatar || ''
            })
          }
        }
        console.log('[FB] Processed', friends.length, 'friends from scroll collection')
      } else {
        console.log('[FB] Falling back to extraction...')

      // Simpler extraction - find friend cards and get names
      const friendsData = await this.page.evaluate(() => {
        const results = []
        const seenNames = new Set()

        // Helper to clean name text
        function cleanName(text) {
          if (!text) return null

          // Clean up the name - remove mutual friends count, etc.
          let name = text
            .replace(/\d+\s*mutual\s*friends?/gi, '')
            .replace(/\d+\s*friends?/gi, '')
            .replace(/mutual.*$/i, '')
            .replace(/\d+\s*m$/i, '') // truncated "mutual"
            .replace(/\s+/g, ' ')
            .trim()

          // Remove trailing numbers
          name = name.replace(/\s*\d+\s*$/, '').trim()

          return name.length >= 2 ? name : null
        }

        // Find all the friend card containers on the friends list page
        // Facebook typically uses specific data attributes for friend entries
        const friendCards = document.querySelectorAll('[data-visualcompletion="ignore-dynamic"]')

        console.log('Found', friendCards.length, 'potential friend cards')

        friendCards.forEach(card => {
          // Look for a profile link in this card
          const profileLink = card.querySelector('a[href*="facebook.com/"], a[href^="/"]')
          if (!profileLink) return

          const href = profileLink.getAttribute('href') || ''

          // Extract user ID/username from the link
          let userId = null
          const match = href.match(/facebook\.com\/([a-zA-Z0-9.]+)/) ||
                       href.match(/^\/([a-zA-Z0-9.]+)(?:\?|$)/)
          if (match) {
            userId = match[1]
          }

          // Skip non-profile links
          const skipIds = ['friends', 'watch', 'marketplace', 'groups', 'gaming', 'events',
                         'pages', 'bookmarks', 'memories', 'saved', 'notifications']
          if (!userId || skipIds.includes(userId.toLowerCase())) return

          // Get name - look for span elements within the card
          let name = null
          const spans = card.querySelectorAll('span')

          for (const span of spans) {
            const text = span.textContent?.trim()
            // Name should start with capital, have reasonable length, and look like a name
            if (text && text.length >= 3 && text.length <= 50 && /^[A-Z]/.test(text)) {
              const cleaned = cleanName(text)
              if (cleaned && cleaned.includes(' ') && !seenNames.has(cleaned)) {
                name = cleaned
                break
              }
            }
          }

          if (!name) return
          if (seenNames.has(name)) return

          // Skip obvious non-names
          const skipPhrases = ['see all', 'mark as', 'unread', 'message', 'add friend',
                             'friend request', 'suggested', 'people you may']
          if (skipPhrases.some(p => name.toLowerCase().includes(p))) return

          seenNames.add(name)

          // Get profile photo
          const img = card.querySelector('image, img[src*="fbcdn"]')
          const photoUrl = img?.getAttribute('xlink:href') || img?.getAttribute('src') || ''

          results.push({
            id: userId,
            name: name,
            firstName: name.split(' ')[0],
            profilePhotoUrl: photoUrl
          })
        })

        // If we didn't find many, try an alternative approach
        if (results.length < 50) {
          console.log('Trying alternative extraction method...')

          // Look for any links that look like profile links
          document.querySelectorAll('a[role="link"]').forEach(link => {
            const href = link.getAttribute('href') || ''
            const match = href.match(/facebook\.com\/([a-zA-Z0-9.]+)/) ||
                         href.match(/^\/([a-zA-Z0-9.]+)(?:\?|$)/)
            if (!match) return

            const userId = match[1]
            const skipIds = ['friends', 'watch', 'marketplace', 'groups', 'gaming', 'events',
                           'pages', 'bookmarks', 'memories', 'saved', 'notifications', 'messages']
            if (skipIds.includes(userId.toLowerCase())) return

            const text = link.textContent?.trim()
            const cleaned = cleanName(text)

            if (cleaned && cleaned.includes(' ') && /^[A-Z]/.test(cleaned) && !seenNames.has(cleaned)) {
              const skipPhrases = ['see all', 'mark as', 'unread', 'message', 'add friend']
              if (skipPhrases.some(p => cleaned.toLowerCase().includes(p))) return

              seenNames.add(cleaned)
              const parent = link.closest('div')
              const img = parent?.querySelector('image, img')

              results.push({
                id: userId,
                name: cleaned,
                firstName: cleaned.split(' ')[0],
                profilePhotoUrl: img?.getAttribute('xlink:href') || img?.getAttribute('src') || ''
              })
            }
          })
        }

        return results
      })

      console.log('[FB] Raw extraction found:', friendsData.length, 'potential friends')

      // Deduplicate and validate
      const seenIds = new Set()
      const seenNames = new Set()

      for (const friend of friendsData) {
        // Skip if we've seen this ID or name
        if (seenIds.has(friend.id) || seenNames.has(friend.name)) continue

        // Skip invalid entries
        if (!friend.name || !friend.id) continue
        if (friend.name.length < 3) continue

        seenIds.add(friend.id)
        seenNames.add(friend.name)
        friends.push(friend)
      }

      console.log('[FB] After deduplication:', friends.length, 'friends')
      } // end else (fallback extraction)

    } catch (error) {
      console.error('[FB] Failed to get friends:', error)
    } finally {
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
    }

    console.log('[FB] Returning', friends.length, 'friends')
    return friends
  }

  async sendMessage(friendId, friendName, message) {
    // Check if already busy
    if (this.isBusy) {
      console.log('[FB] Already busy, cannot send message now')
      return { success: false, error: 'Facebook controller is busy. Please wait.' }
    }

    this.isBusy = true
    console.log(`[FB] Sending message to ${friendName} (${friendId})...`)

    // Use visible browser so user can see progress and handle any captchas
    await this.initBrowser(false)

    try {
      // Navigate to messenger
      console.log('[FB] Navigating to messenger...')
      await this.page.goto(`https://www.facebook.com/messages/t/${friendId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      })

      // Add a status indicator to the page
      await this.page.evaluate(() => {
        const statusDiv = document.createElement('div')
        statusDiv.id = 'send-status'
        statusDiv.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: #2196F3;
          color: white;
          padding: 15px 20px;
          border-radius: 8px;
          font-family: Arial, sans-serif;
          font-size: 14px;
          z-index: 999999;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `
        statusDiv.innerHTML = '📨 Waiting for messenger to load...<br><small>If you see a PIN prompt, enter it now.</small>'
        document.body.appendChild(statusDiv)
      })

      // Wait longer for PIN entry and page to settle
      console.log('[FB] Waiting for page to load (and any PIN entry)...')

      // Poll for message input for up to 2 minutes (gives time for PIN entry)
      let messageInput = null
      const maxWait = 120000 // 2 minutes
      const checkInterval = 3000
      let elapsed = 0

      // Multiple possible selectors for Facebook Messenger input
      const inputSelectors = [
        '[aria-label="Message"]',
        '[aria-label="Aa"]',
        '[contenteditable="true"][role="textbox"]',
        'div[role="textbox"][contenteditable="true"]',
        '[data-lexical-editor="true"]',
        'p.xat24cr',
        'div.notranslate[contenteditable="true"]'
      ]

      while (!messageInput && elapsed < maxWait) {
        // Try each selector
        for (const selector of inputSelectors) {
          try {
            messageInput = await this.page.waitForSelector(selector, { timeout: 500 })
            if (messageInput) {
              console.log(`[FB] Found message input with selector: ${selector}`)
              break
            }
          } catch (e) {
            // Try next selector
          }
        }

        if (!messageInput) {
          // Update status
          await this.page.evaluate((remaining) => {
            const status = document.getElementById('send-status')
            if (status) {
              status.innerHTML = `📨 Waiting for message input...<br><small>Time remaining: ${Math.ceil(remaining/1000)}s<br>Enter PIN if prompted.</small>`
            }
          }, maxWait - elapsed)

          await this.page.waitForTimeout(checkInterval)
          elapsed += checkInterval
        }
      }

      if (!messageInput) {
        // Take a screenshot for debugging
        const screenshotPath = '/tmp/fb-messenger-debug.png'
        await this.page.screenshot({ path: screenshotPath })
        console.log(`[FB] Screenshot saved to ${screenshotPath}`)

        // Log what elements are on the page
        const pageInfo = await this.page.evaluate(() => {
          const textboxes = document.querySelectorAll('[role="textbox"]')
          const contenteditables = document.querySelectorAll('[contenteditable="true"]')
          return {
            url: window.location.href,
            textboxCount: textboxes.length,
            contenteditableCount: contenteditables.length,
            textboxInfo: Array.from(textboxes).slice(0, 5).map(el => ({
              tag: el.tagName,
              ariaLabel: el.getAttribute('aria-label'),
              className: el.className?.substring(0, 50)
            }))
          }
        })
        console.log('[FB] Page info:', JSON.stringify(pageInfo, null, 2))

        throw new Error('Could not find message input after waiting 2 minutes. Check /tmp/fb-messenger-debug.png')
      }

      // Update status
      await this.page.evaluate((name) => {
        const status = document.getElementById('send-status')
        if (status) {
          status.style.background = '#4CAF50'
          status.innerHTML = `✍️ Typing message to ${name}...`
        }
      }, friendName)

      console.log('[FB] Found message input, typing message...')

      // Type message with human-like delays
      await messageInput.click()
      await this.page.waitForTimeout(500)

      // Type character by character with random delays
      for (const char of message) {
        await messageInput.type(char, { delay: Math.random() * 100 + 30 })
      }

      await this.page.waitForTimeout(1000)

      // Find and click send button
      console.log('[FB] Looking for send button...')
      const sendButton = await this.page.$('[aria-label="Press Enter to send"]') ||
                        await this.page.$('[aria-label="Send"]') ||
                        await this.page.$('div[role="button"]:has-text("Send")')

      if (sendButton) {
        console.log('[FB] Clicking send button...')
        await sendButton.click()
      } else {
        // Try pressing Enter
        console.log('[FB] No send button found, pressing Enter...')
        await this.page.keyboard.press('Enter')
      }

      await this.page.waitForTimeout(2000)

      // Update status
      await this.page.evaluate((name) => {
        const status = document.getElementById('send-status')
        if (status) {
          status.innerHTML = `✅ Message sent to ${name}!<br><small>Window will close in 3 seconds...</small>`
        }
      }, friendName)

      await this.page.waitForTimeout(3000)

      console.log(`[FB] Message sent successfully to ${friendName}!`)
      return { success: true }
    } catch (error) {
      console.error('[FB] Failed to send message:', error)

      // Show error on page before closing
      try {
        await this.page.evaluate((errMsg) => {
          const status = document.getElementById('send-status')
          if (status) {
            status.style.background = '#f44336'
            status.innerHTML = `❌ Failed: ${errMsg}<br><small>Window will close in 5 seconds...</small>`
          }
        }, error.message)
        await this.page.waitForTimeout(5000)
      } catch (e) {
        // Page might already be closed
      }

      return { success: false, error: error.message }
    } finally {
      if (this.browser) {
        await this.browser.close()
        this.browser = null
        this.context = null
        this.page = null
      }
      this.isBusy = false
    }
  }
}

module.exports = { FacebookController }
