import React, { useState, useEffect } from 'react'
import Modal from '../components/Modal'

function Friends() {
  const [friends, setFriends] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [listName, setListName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    loadFriends()
  }, [])

  const loadFriends = async () => {
    setIsLoading(true)
    try {
      const result = await window.api.getFriends()
      if (result.success) {
        setFriends(result.friends)
      }
    } catch (err) {
      setError('Failed to load friends')
    } finally {
      setIsLoading(false)
    }
  }

  const refreshFriends = async () => {
    setIsRefreshing(true)
    setError('')
    try {
      const result = await window.api.refreshFriends()
      if (result.success) {
        setFriends(result.friends)
      } else {
        setError(result.error || 'Failed to refresh friends')
      }
    } catch (err) {
      setError('Failed to refresh friends')
    } finally {
      setIsRefreshing(false)
    }
  }

  const toggleSelect = (id) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const selectAll = () => {
    const filtered = filteredFriends.map(f => f.id)
    setSelectedIds(new Set(filtered))
  }

  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  const handleCreateList = async () => {
    if (!listName.trim()) return

    try {
      const result = await window.api.createList(listName.trim(), Array.from(selectedIds))
      if (result.success) {
        setShowModal(false)
        setListName('')
        setSelectedIds(new Set())
        // Show success message
        alert(`List "${listName}" created with ${selectedIds.size} friends!`)
      } else {
        setError(result.error || 'Failed to create list')
      }
    } catch (err) {
      setError('Failed to create list')
    }
  }

  const filteredFriends = friends.filter(friend =>
    friend.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Friends</h1>
          <p className="text-gray-400 text-sm mt-1">
            {friends.length} friends loaded • {selectedIds.size} selected
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={refreshFriends}
            disabled={isRefreshing}
            className="px-4 py-2 bg-[#2a2a4a] hover:bg-[#3a3a5a] disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {isRefreshing ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Refreshing...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh from Facebook</span>
              </>
            )}
          </button>
          <button
            onClick={() => setShowModal(true)}
            disabled={selectedIds.size === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            Create List ({selectedIds.size})
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Search and bulk actions */}
      <div className="flex gap-4 mb-4">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search friends..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[#1a1a2e] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={selectAll}
          className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Select All
        </button>
        <button
          onClick={deselectAll}
          className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Deselect All
        </button>
      </div>

      {/* Friends grid */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-400">Loading friends...</div>
        </div>
      ) : friends.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="mb-2">No friends loaded yet</p>
          <button
            onClick={refreshFriends}
            className="text-blue-400 hover:text-blue-300"
          >
            Click "Refresh from Facebook" to load your friends
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredFriends.map(friend => (
              <FriendCard
                key={friend.id}
                friend={friend}
                isSelected={selectedIds.has(friend.id)}
                onToggle={() => toggleSelect(friend.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Create List Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)}>
        <h2 className="text-xl font-semibold text-white mb-4">Create New List</h2>
        <p className="text-gray-400 text-sm mb-4">
          Creating a list with {selectedIds.size} selected friends
        </p>
        <input
          type="text"
          placeholder="Enter list name..."
          value={listName}
          onChange={(e) => setListName(e.target.value)}
          className="w-full px-4 py-2 bg-[#0f0f1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
          autoFocus
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setShowModal(false)}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateList}
            disabled={!listName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            Create List
          </button>
        </div>
      </Modal>
    </div>
  )
}

function FriendCard({ friend, isSelected, onToggle }) {
  return (
    <div
      onClick={onToggle}
      className={`p-4 rounded-lg cursor-pointer transition-all ${
        isSelected
          ? 'bg-blue-600/20 border-2 border-blue-500'
          : 'bg-[#1a1a2e] border-2 border-transparent hover:border-gray-600'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="relative">
          {friend.profile_photo_url ? (
            <img
              src={friend.profile_photo_url}
              alt={friend.name}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 text-sm font-medium">
              {friend.first_name?.[0] || '?'}
            </div>
          )}
          {isSelected && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{friend.name}</p>
        </div>
      </div>
    </div>
  )
}

export default Friends
