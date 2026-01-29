import React, { useState, useEffect } from 'react'
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import Login from './screens/Login'
import Friends from './screens/Friends'
import Lists from './screens/Lists'
import Compose from './screens/Compose'
import Campaign from './screens/Campaign'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [campaignStatus, setCampaignStatus] = useState({ active: false })
  const navigate = useNavigate()

  useEffect(() => {
    checkAuth()
    loadCampaignStatus()

    // Subscribe to campaign updates
    const unsubscribe = window.api.onCampaignUpdate((status) => {
      setCampaignStatus(status)
    })

    return () => unsubscribe()
  }, [])

  const loadCampaignStatus = async () => {
    try {
      const result = await window.api.getCampaignStatus()
      if (result.success) {
        setCampaignStatus(result)
      }
    } catch (error) {
      console.error('Failed to load campaign status:', error)
    }
  }

  const toggleAutomation = async () => {
    try {
      if (campaignStatus.isPaused) {
        await window.api.resumeCampaign()
      } else {
        await window.api.pauseCampaign()
      }
      loadCampaignStatus()
    } catch (error) {
      console.error('Failed to toggle automation:', error)
    }
  }

  const checkAuth = async () => {
    setIsLoading(true)
    try {
      const result = await window.api.checkAuth()
      setIsAuthenticated(result.authenticated)
      if (!result.authenticated) {
        navigate('/')
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      setIsAuthenticated(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    await window.api.logout()
    setIsAuthenticated(false)
    navigate('/')
  }

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0f0f1a]">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Login onLoginSuccess={() => { setIsAuthenticated(true); navigate('/friends') }} />
  }

  return (
    <div className="h-screen flex flex-col bg-[#0f0f1a]">
      {/* Title bar drag region */}
      <div className="h-8 drag-region bg-[#1a1a2e] flex items-center justify-end px-4">
        <button
          onClick={handleLogout}
          className="no-drag text-xs text-gray-400 hover:text-white transition-colors"
        >
          Logout
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-56 bg-[#1a1a2e] p-4 flex flex-col">
          <div className="flex flex-col gap-2 flex-1">
            <NavItem to="/friends" icon="👥">Friends</NavItem>
            <NavItem to="/lists" icon="📋">Lists</NavItem>
            <NavItem to="/compose" icon="✉️">Compose</NavItem>
            <NavItem to="/campaign" icon="🚀">Campaign</NavItem>
          </div>

          {/* Global Automation Control */}
          {campaignStatus.active && (
            <div className="mt-4 pt-4 border-t border-gray-700">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                Automation
              </div>
              <button
                onClick={toggleAutomation}
                className={`w-full py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                  campaignStatus.isPaused
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                }`}
              >
                {campaignStatus.isPaused ? (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                    <span>Pause</span>
                  </>
                )}
              </button>
              <div className={`mt-2 text-center text-xs ${
                campaignStatus.isPaused ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {campaignStatus.isPaused ? (
                  <span className="flex items-center justify-center gap-1">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                    Paused - Safe to browse FB
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-1">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    Active - {campaignStatus.sent}/{campaignStatus.total} sent
                  </span>
                )}
              </div>
            </div>
          )}
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<Friends />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/lists" element={<Lists />} />
            <Route path="/compose" element={<Compose />} />
            <Route path="/campaign" element={<Campaign />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function NavItem({ to, icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
          isActive
            ? 'bg-blue-600 text-white'
            : 'text-gray-400 hover:bg-[#2a2a4a] hover:text-white'
        }`
      }
    >
      <span>{icon}</span>
      <span className="text-sm font-medium">{children}</span>
    </NavLink>
  )
}

export default App
