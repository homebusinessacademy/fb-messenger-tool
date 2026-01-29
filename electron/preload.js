const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Auth
  login: () => ipcRenderer.invoke('fb:login'),
  logout: () => ipcRenderer.invoke('fb:logout'),
  checkAuth: () => ipcRenderer.invoke('fb:checkAuth'),
  verifyLogin: () => ipcRenderer.invoke('fb:verifyLogin'),

  // Friends
  getFriends: () => ipcRenderer.invoke('friends:getAll'),
  refreshFriends: () => ipcRenderer.invoke('friends:refresh'),

  // Lists
  getLists: () => ipcRenderer.invoke('lists:getAll'),
  getList: (listId) => ipcRenderer.invoke('lists:getOne', listId),
  createList: (name, friendIds) => ipcRenderer.invoke('lists:create', name, friendIds),
  updateList: (id, name, friendIds) => ipcRenderer.invoke('lists:update', id, name, friendIds),
  deleteList: (id) => ipcRenderer.invoke('lists:delete', id),
  checkFriendMessageHistory: (friendIds) => ipcRenderer.invoke('lists:checkFriendMessageHistory', friendIds),

  // Messages
  getMessages: () => ipcRenderer.invoke('messages:getAll'),
  saveMessage: (name, body) => ipcRenderer.invoke('messages:save', name, body),
  updateMessage: (id, name, body) => ipcRenderer.invoke('messages:update', id, name, body),
  deleteMessage: (id) => ipcRenderer.invoke('messages:delete', id),

  // Campaigns
  startCampaign: (listId, messageId) => ipcRenderer.invoke('campaign:start', listId, messageId),
  pauseCampaign: () => ipcRenderer.invoke('campaign:pause'),
  resumeCampaign: () => ipcRenderer.invoke('campaign:resume'),
  cancelCampaign: () => ipcRenderer.invoke('campaign:cancel'),
  getCampaignStatus: () => ipcRenderer.invoke('campaign:getStatus'),
  getCampaignRecords: (campaignId) => ipcRenderer.invoke('campaign:getRecords', campaignId),
  sendNow: (recordId) => ipcRenderer.invoke('campaign:sendNow', recordId),

  // Events
  onCampaignUpdate: (callback) => {
    ipcRenderer.on('campaign:update', (event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('campaign:update')
  }
})
