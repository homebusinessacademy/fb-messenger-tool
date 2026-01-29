import React, { useState, useEffect } from 'react'
import Modal from '../components/Modal'

function Campaign() {
  const [lists, setLists] = useState([])
  const [messages, setMessages] = useState([])
  const [selectedListId, setSelectedListId] = useState('')
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [campaignStatus, setCampaignStatus] = useState({ active: false })
  const [sendRecords, setSendRecords] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isStarting, setIsStarting] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [error, setError] = useState('')
  const [sendingRecordId, setSendingRecordId] = useState(null)

  useEffect(() => {
    loadData()

    // Subscribe to campaign updates
    const unsubscribe = window.api.onCampaignUpdate((status) => {
      setCampaignStatus(status)
      if (status.campaignId) {
        loadSendRecords(status.campaignId)
      }
    })

    return () => unsubscribe()
  }, [])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [listsResult, messagesResult, statusResult] = await Promise.all([
        window.api.getLists(),
        window.api.getMessages(),
        window.api.getCampaignStatus()
      ])

      if (listsResult.success) setLists(listsResult.lists)
      if (messagesResult.success) setMessages(messagesResult.messages)
      if (statusResult.success) {
        setCampaignStatus(statusResult)
        if (statusResult.campaignId) {
          loadSendRecords(statusResult.campaignId)
        }
      }
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadSendRecords = async (campaignId) => {
    try {
      const result = await window.api.getCampaignRecords(campaignId)
      if (result.success) {
        setSendRecords(result.records)
      }
    } catch (err) {
      console.error('Failed to load send records:', err)
    }
  }

  const startCampaign = async () => {
    if (!selectedListId || !selectedMessageId) return

    setIsStarting(true)
    setError('')

    try {
      const result = await window.api.startCampaign(selectedListId, selectedMessageId)
      if (result.success) {
        const statusResult = await window.api.getCampaignStatus()
        if (statusResult.success) {
          setCampaignStatus(statusResult)
          if (statusResult.campaignId) {
            loadSendRecords(statusResult.campaignId)
          }
        }
      } else {
        setError(result.error || 'Failed to start campaign')
      }
    } catch (err) {
      setError('Failed to start campaign')
    } finally {
      setIsStarting(false)
    }
  }

  const pauseCampaign = async () => {
    try {
      await window.api.pauseCampaign()
      const statusResult = await window.api.getCampaignStatus()
      if (statusResult.success) {
        setCampaignStatus(statusResult)
      }
    } catch (err) {
      console.error('Failed to pause campaign:', err)
    }
  }

  const resumeCampaign = async () => {
    try {
      await window.api.resumeCampaign()
      const statusResult = await window.api.getCampaignStatus()
      if (statusResult.success) {
        setCampaignStatus(statusResult)
      }
    } catch (err) {
      console.error('Failed to resume campaign:', err)
    }
  }

  const cancelCampaign = async () => {
    try {
      await window.api.cancelCampaign()
      setCampaignStatus({ active: false })
      setSendRecords([])
      setShowCancelModal(false)
    } catch (err) {
      console.error('Failed to cancel campaign:', err)
    }
  }

  const sendNow = async (recordId) => {
    setSendingRecordId(recordId)
    try {
      const result = await window.api.sendNow(recordId)
      if (!result.success) {
        console.error('Failed to send message:', result.error)
      }
      // Reload records after send
      if (campaignStatus.campaignId) {
        await loadSendRecords(campaignStatus.campaignId)
      }
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setSendingRecordId(null)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  // Active campaign view
  if (campaignStatus.active) {
    const progressPercent = campaignStatus.total > 0
      ? Math.round((campaignStatus.sent / campaignStatus.total) * 100)
      : 0

    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Active Campaign</h1>
            <p className="text-gray-400 text-sm mt-1">
              {campaignStatus.isPaused ? 'Campaign paused' : 'Campaign in progress'}
            </p>
          </div>
          <div className="flex gap-3">
            {campaignStatus.isPaused ? (
              <button
                onClick={resumeCampaign}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Resume
              </button>
            ) : (
              <button
                onClick={pauseCampaign}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                Pause
              </button>
            )}
            <button
              onClick={() => setShowCancelModal(true)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Cancel Campaign
            </button>
          </div>
        </div>

        {/* Progress card */}
        <div className="bg-[#1a1a2e] rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Progress</h2>
              <p className="text-gray-400 text-sm">
                {campaignStatus.sent} of {campaignStatus.total} messages sent
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-white">{progressPercent}%</div>
              {campaignStatus.nextScheduledAt && !campaignStatus.isPaused && (
                <p className="text-gray-400 text-sm">
                  Next send: {formatDate(campaignStatus.nextScheduledAt)}
                </p>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-3 bg-[#0f0f1a] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mt-6">
            <StatCard label="Total" value={campaignStatus.total} color="gray" />
            <StatCard label="Sent" value={campaignStatus.sent} color="green" />
            <StatCard label="Pending" value={campaignStatus.pending} color="blue" />
            <StatCard label="Failed" value={campaignStatus.failed} color="red" />
          </div>
        </div>

        {/* Send records table */}
        <div className="flex-1 bg-[#1a1a2e] rounded-xl p-6 overflow-hidden flex flex-col">
          <h2 className="text-lg font-semibold text-white mb-4">Message Log</h2>
          <div className="flex-1 overflow-auto">
            <table className="w-full">
              <thead className="text-left text-gray-400 text-sm">
                <tr>
                  <th className="pb-3 font-medium">Friend</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Scheduled</th>
                  <th className="pb-3 font-medium">Sent</th>
                  <th className="pb-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="text-white">
                {sendRecords.map(record => (
                  <tr key={record.id} className="border-t border-gray-800">
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        {record.profile_photo_url ? (
                          <img
                            src={record.profile_photo_url}
                            alt={record.name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 text-sm">
                            {record.first_name?.[0] || '?'}
                          </div>
                        )}
                        <span>{record.name}</span>
                      </div>
                    </td>
                    <td className="py-3">
                      <StatusBadge status={record.status} />
                    </td>
                    <td className="py-3 text-gray-400">
                      {formatDate(record.scheduled_at)}
                    </td>
                    <td className="py-3 text-gray-400">
                      {formatDate(record.sent_at)}
                    </td>
                    <td className="py-3">
                      {record.status === 'pending' && (
                        <button
                          onClick={() => sendNow(record.id)}
                          disabled={sendingRecordId === record.id}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-xs font-medium rounded transition-colors flex items-center gap-1"
                        >
                          {sendingRecordId === record.id ? (
                            <>
                              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Sending...
                            </>
                          ) : (
                            'Send Now'
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cancel Modal */}
        <Modal isOpen={showCancelModal} onClose={() => setShowCancelModal(false)}>
          <h2 className="text-xl font-semibold text-white mb-4">Cancel Campaign</h2>
          <p className="text-gray-400 mb-6">
            Are you sure you want to cancel this campaign? Pending messages will not be sent.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowCancelModal(false)}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Keep Running
            </button>
            <button
              onClick={cancelCampaign}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Cancel Campaign
            </button>
          </div>
        </Modal>
      </div>
    )
  }

  // Start new campaign view
  return (
    <div className="h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Start Campaign</h1>
        <p className="text-gray-400 text-sm mt-1">
          Select a list and message to start sending
        </p>
      </div>

      <div className="max-w-xl">
        <div className="bg-[#1a1a2e] rounded-xl p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* List selection */}
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">Select List</label>
            {lists.length === 0 ? (
              <p className="text-gray-500 text-sm">
                No lists available. Create a list in the Friends tab first.
              </p>
            ) : (
              <select
                value={selectedListId}
                onChange={(e) => setSelectedListId(e.target.value)}
                className="w-full px-4 py-3 bg-[#0f0f1a] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Choose a list...</option>
                {lists.map(list => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list.friend_count} friends)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Message selection */}
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">Select Message</label>
            {messages.length === 0 ? (
              <p className="text-gray-500 text-sm">
                No messages available. Create a message in the Compose tab first.
              </p>
            ) : (
              <select
                value={selectedMessageId}
                onChange={(e) => setSelectedMessageId(e.target.value)}
                className="w-full px-4 py-3 bg-[#0f0f1a] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Choose a message...</option>
                {messages.map(message => (
                  <option key={message.id} value={message.id}>
                    {message.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Info box */}
          <div className="mb-6 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
            <h3 className="text-blue-400 font-medium mb-2">How it works</h3>
            <ul className="text-gray-400 text-sm space-y-1">
              <li>• Maximum 10 messages sent per day</li>
              <li>• Messages sent randomly between 9 AM - 8 PM</li>
              <li>• Campaign continues daily until complete</li>
              <li>• You can pause or cancel anytime</li>
            </ul>
          </div>

          <button
            onClick={startCampaign}
            disabled={!selectedListId || !selectedMessageId || isStarting}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isStarting ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Starting Campaign...</span>
              </>
            ) : (
              <>
                <span>Start Campaign</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  const colors = {
    gray: 'text-gray-400',
    green: 'text-green-400',
    blue: 'text-blue-400',
    red: 'text-red-400'
  }

  return (
    <div className="bg-[#0f0f1a] rounded-lg p-4 text-center">
      <div className={`text-2xl font-bold ${colors[color]}`}>{value}</div>
      <div className="text-gray-500 text-sm">{label}</div>
    </div>
  )
}

function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-gray-700 text-gray-300',
    sent: 'bg-green-900/50 text-green-400',
    failed: 'bg-red-900/50 text-red-400'
  }

  const labels = {
    pending: 'Pending',
    sent: 'Sent',
    failed: 'Failed'
  }

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

export default Campaign
