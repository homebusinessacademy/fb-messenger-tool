import React, { useState } from 'react'

function Login({ onLoginSuccess }) {
  const [isLoading, setIsLoading] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState('')
  const [showVerifyButton, setShowVerifyButton] = useState(false)

  const handleLogin = async () => {
    setIsLoading(true)
    setError('')
    setShowVerifyButton(false)

    try {
      const result = await window.api.login()
      if (result.success) {
        onLoginSuccess()
      } else {
        setError(result.error || 'Login failed. Please try again.')
        // Show verify button if it looks like a timeout or detection issue
        if (result.error?.includes('timeout') || result.error?.includes('Verify')) {
          setShowVerifyButton(true)
        }
      }
    } catch (err) {
      setError('An error occurred during login.')
      setShowVerifyButton(true)
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerify = async () => {
    setIsVerifying(true)
    setError('')

    try {
      const result = await window.api.verifyLogin()
      if (result.authenticated) {
        onLoginSuccess()
      } else {
        setError('Could not verify login. Please try connecting again.')
        setShowVerifyButton(false)
      }
    } catch (err) {
      setError('Verification failed. Please try connecting again.')
      setShowVerifyButton(false)
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-[#0f0f1a] p-8">
      {/* Title bar drag region */}
      <div className="fixed top-0 left-0 right-0 h-8 drag-region" />

      <div className="max-w-md w-full text-center">
        <h1 className="text-3xl font-bold text-white mb-2">
          FB Messenger Tool
        </h1>
        <p className="text-gray-400 mb-8">
          Automate personalized messages to your Facebook friends
        </p>

        <div className="bg-[#1a1a2e] rounded-xl p-8 shadow-lg">
          <div className="mb-6">
            <div className="w-20 h-20 mx-auto bg-blue-600 rounded-full flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.885 1.417 5.467 3.656 7.162V22l3.34-1.845c.89.246 1.834.378 2.804.378 5.522 0 10-4.145 10-9.29S17.522 2 12 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Connect Your Account
            </h2>
            <p className="text-gray-400 text-sm">
              A browser window will open for you to log into Facebook securely.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoading || isVerifying}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Waiting for login...</span>
              </>
            ) : (
              <>
                <span>Connect to Facebook</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </>
            )}
          </button>

          {/* Verify Login Button - shows after timeout or error */}
          {showVerifyButton && (
            <div className="mt-4">
              <p className="text-gray-400 text-sm mb-3">
                Already logged in via the browser? Click below to verify:
              </p>
              <button
                onClick={handleVerify}
                disabled={isVerifying || isLoading}
                className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isVerifying ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Verify Login</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-700/30 rounded-lg">
          <p className="text-yellow-500 text-xs">
            <strong>Note:</strong> This tool uses browser automation to interact with Facebook.
            Use responsibly and in accordance with Facebook's Terms of Service.
          </p>
        </div>

        {/* Tips for login issues */}
        <div className="mt-4 text-left">
          <details className="text-gray-500 text-xs">
            <summary className="cursor-pointer hover:text-gray-400">
              Having trouble logging in?
            </summary>
            <ul className="mt-2 ml-4 space-y-1 text-gray-500">
              <li>• Complete any 2FA or security verification in the browser</li>
              <li>• Make sure you reach the Facebook home page</li>
              <li>• If the browser closed, click "Connect" again</li>
              <li>• After logging in, click "Verify Login" if prompted</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  )
}

export default Login
