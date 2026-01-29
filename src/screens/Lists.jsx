import React, { useState, useEffect } from 'react'
import Modal from '../components/Modal'

function Lists() {
  const [lists, setLists] = useState([])
  const [selectedList, setSelectedList] = useState(null)
  const [listFriends, setListFriends] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [listToDelete, setListToDelete] = useState(null)

  useEffect(() => {
    loadLists()
  }, [])

  const loadLists = async () => {
    setIsLoading(true)
    try {
      const result = await window.api.getLists()
      if (result.success) {
        setLists(result.lists)
      }
    } catch (err) {
      console.error('Failed to load lists:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const viewList = async (list) => {
    setSelectedList(list)
    try {
      const result = await window.api.getList(list.id)
      if (result.success) {
        setListFriends(result.friends)
      }
    } catch (err) {
      console.error('Failed to load list details:', err)
    }
  }

  const confirmDelete = (list) => {
    setListToDelete(list)
    setShowDeleteModal(true)
  }

  const handleDelete = async () => {
    if (!listToDelete) return

    try {
      const result = await window.api.deleteList(listToDelete.id)
      if (result.success) {
        setLists(lists.filter(l => l.id !== listToDelete.id))
        if (selectedList?.id === listToDelete.id) {
          setSelectedList(null)
          setListFriends([])
        }
      }
    } catch (err) {
      console.error('Failed to delete list:', err)
    } finally {
      setShowDeleteModal(false)
      setListToDelete(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Lists</h1>
        <p className="text-gray-400 text-sm mt-1">
          Manage your saved friend lists
        </p>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-400">Loading lists...</div>
        </div>
      ) : lists.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="mb-2">No lists created yet</p>
          <p className="text-sm">Go to Friends to select and create a list</p>
        </div>
      ) : (
        <div className="flex-1 flex gap-6 overflow-hidden">
          {/* Lists panel */}
          <div className="w-80 flex flex-col">
            <div className="flex-1 overflow-auto space-y-2">
              {lists.map(list => (
                <div
                  key={list.id}
                  onClick={() => viewList(list)}
                  className={`p-4 rounded-lg cursor-pointer transition-colors ${
                    selectedList?.id === list.id
                      ? 'bg-blue-600/20 border border-blue-500'
                      : 'bg-[#1a1a2e] hover:bg-[#2a2a4a] border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-white font-medium">{list.name}</h3>
                      <p className="text-gray-400 text-sm">
                        {list.friend_count} {list.friend_count === 1 ? 'friend' : 'friends'}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        confirmDelete(list)
                      }}
                      className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* List details panel */}
          <div className="flex-1 bg-[#1a1a2e] rounded-xl p-6 overflow-hidden flex flex-col">
            {selectedList ? (
              <>
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-white">{selectedList.name}</h2>
                  <p className="text-gray-400 text-sm">
                    {listFriends.length} friends in this list
                  </p>
                </div>
                <div className="flex-1 overflow-auto">
                  <div className="space-y-2">
                    {listFriends.map(friend => (
                      <div
                        key={friend.id}
                        className="flex items-center gap-3 p-3 bg-[#0f0f1a] rounded-lg"
                      >
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
                        <span className="text-white">{friend.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                Select a list to view its members
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
        <h2 className="text-xl font-semibold text-white mb-4">Delete List</h2>
        <p className="text-gray-400 mb-6">
          Are you sure you want to delete "{listToDelete?.name}"? This action cannot be undone.
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

export default Lists
