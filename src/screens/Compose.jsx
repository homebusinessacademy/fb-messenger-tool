import React, { useState, useEffect } from 'react'
import Modal from '../components/Modal'

function Compose() {
  const [messages, setMessages] = useState([])
  const [messageName, setMessageName] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [messageToDelete, setMessageToDelete] = useState(null)

  useEffect(() => {
    loadMessages()
  }, [])

  const loadMessages = async () => {
    setIsLoading(true)
    try {
      const result = await window.api.getMessages()
      if (result.success) {
        setMessages(result.messages)
      }
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const insertFirstName = () => {
    const textarea = document.getElementById('message-body')
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newValue = messageBody.substring(0, start) + '{{first_name}}' + messageBody.substring(end)
    setMessageBody(newValue)
    // Reset cursor position after state update
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + 14, start + 14)
    }, 0)
  }

  const handleSave = async () => {
    if (!messageName.trim() || !messageBody.trim()) return

    try {
      let result
      if (editingId) {
        result = await window.api.updateMessage(editingId, messageName.trim(), messageBody.trim())
      } else {
        result = await window.api.saveMessage(messageName.trim(), messageBody.trim())
      }

      if (result.success) {
        await loadMessages()
        clearForm()
      }
    } catch (err) {
      console.error('Failed to save message:', err)
    }
  }

  const editMessage = (message) => {
    setEditingId(message.id)
    setMessageName(message.name)
    setMessageBody(message.body)
  }

  const clearForm = () => {
    setEditingId(null)
    setMessageName('')
    setMessageBody('')
  }

  const confirmDelete = (message) => {
    setMessageToDelete(message)
    setShowDeleteModal(true)
  }

  const handleDelete = async () => {
    if (!messageToDelete) return

    try {
      const result = await window.api.deleteMessage(messageToDelete.id)
      if (result.success) {
        // Reload messages from database to ensure UI is in sync
        await loadMessages()
        if (editingId === messageToDelete.id) {
          clearForm()
        }
      } else {
        console.error('Failed to delete message:', result.error)
      }
    } catch (err) {
      console.error('Failed to delete message:', err)
    } finally {
      setShowDeleteModal(false)
      setMessageToDelete(null)
    }
  }

  // Preview with sample name
  const previewMessage = messageBody.replace(/\{\{first_name\}\}/gi, 'Sarah')

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Compose</h1>
        <p className="text-gray-400 text-sm mt-1">
          Create and manage message templates
        </p>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Composer panel */}
        <div className="flex-1 flex flex-col">
          <div className="bg-[#1a1a2e] rounded-xl p-6 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? 'Edit Message' : 'New Message'}
              </h2>
              {editingId && (
                <button
                  onClick={clearForm}
                  className="text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Message Name</label>
              <input
                type="text"
                placeholder="e.g., Welcome Message, Follow Up..."
                value={messageName}
                onChange={(e) => setMessageName(e.target.value)}
                className="w-full px-4 py-2 bg-[#0f0f1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex-1 flex flex-col mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-400">Message Body</label>
                <button
                  onClick={insertFirstName}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                >
                  <span>+ Insert</span>
                  <code className="bg-blue-900/30 px-1 rounded">{'{{first_name}}'}</code>
                </button>
              </div>
              <textarea
                id="message-body"
                placeholder="Hey {{first_name}}! I wanted to reach out..."
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                className="flex-1 px-4 py-3 bg-[#0f0f1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>

            <button
              onClick={handleSave}
              disabled={!messageName.trim() || !messageBody.trim()}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {editingId ? 'Update Message' : 'Save Message'}
            </button>
          </div>

          {/* Preview */}
          {messageBody && (
            <div className="mt-4 bg-[#1a1a2e] rounded-xl p-6">
              <h3 className="text-sm font-medium text-gray-400 mb-3">Preview</h3>
              <div className="bg-[#0f0f1a] rounded-lg p-4">
                <p className="text-white whitespace-pre-wrap">{previewMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* Saved messages panel */}
        <div className="w-80 flex flex-col">
          <h3 className="text-lg font-semibold text-white mb-4">Saved Messages</h3>
          {isLoading ? (
            <div className="text-gray-400">Loading...</div>
          ) : messages.length === 0 ? (
            <div className="text-gray-400 text-sm">No saved messages yet</div>
          ) : (
            <div className="flex-1 overflow-auto space-y-2">
              {messages.map(message => (
                <div
                  key={message.id}
                  className={`p-4 rounded-lg bg-[#1a1a2e] border ${
                    editingId === message.id ? 'border-blue-500' : 'border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-white font-medium">{message.name}</h4>
                    <div className="flex gap-1">
                      <button
                        onClick={() => editMessage(message)}
                        className="p-1.5 text-gray-400 hover:text-white transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => confirmDelete(message)}
                        className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="text-gray-400 text-sm line-clamp-2">{message.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <h2 className="text-xl font-semibold text-white mb-4">Delete Message</h2>
        <p className="text-gray-400 mb-6">
          Are you sure you want to delete "{messageToDelete?.name}"? This action cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setShowDeleteModal(false)}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  )
}

export default Compose
