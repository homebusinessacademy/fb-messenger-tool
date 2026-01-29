import React from 'react'

function Modal({ isOpen, onClose, children }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative bg-[#1a1a2e] rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
        {children}
      </div>
    </div>
  )
}

export default Modal
