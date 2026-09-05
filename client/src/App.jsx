import { useState } from 'react'
import './App.css'

function App() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(true)

  const handleAuth = () => {
    setIsLoggedIn(true)
    setIsMenuOpen(true)
  }

  return (
    <main className={`app-shell${isDarkMode ? '' : ' light-mode'}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Nashville Incident Explorer home">
          <span className="brand-mark">N</span>
          <span>Nashville Incident Explorer</span>
        </a>

        <div className="topbar-actions">
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
            aria-pressed={!isDarkMode}
            onClick={() => setIsDarkMode((darkMode) => !darkMode)}
          >
            <span className="theme-icon" aria-hidden="true">{isDarkMode ? '☾' : '☀'}</span>
            <span className="theme-label">{isDarkMode ? 'Dark' : 'Light'}</span>
            <span className="theme-switch" aria-hidden="true"><span /></span>
          </button>

          <div className="account-wrap">
          <button
            className={`account-button${isLoggedIn ? ' signed-in' : ''}`}
            type="button"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            aria-label="Open account menu"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5.5 20c.7-3.4 3-5.3 6.5-5.3s5.8 1.9 6.5 5.3" />
            </svg>
            <span className="account-label">{isLoggedIn ? 'My account' : 'Account'}</span>
            <span className="chevron" aria-hidden="true">⌄</span>
          </button>

          {isMenuOpen && (
            <div className="account-menu" role="menu">
              {isLoggedIn ? (
                <>
                  <div className="menu-heading">Signed in</div>
                  <button type="button" role="menuitem" onClick={() => setIsMenuOpen(false)}>
                    <span className="menu-icon">⚙</span>
                    Settings
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setIsLoggedIn(false); setIsMenuOpen(false) }}>
                    <span className="menu-icon">↪</span>
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <div className="menu-heading">Welcome</div>
                  <p>Save searches and personalize your map.</p>
                  <button className="menu-primary" type="button" role="menuitem" onClick={handleAuth}>Sign in</button>
                  <button className="menu-secondary" type="button" role="menuitem" onClick={handleAuth}>Create an account</button>
                </>
              )}
            </div>
          )}
          </div>
        </div>
      </header>

      <section className="content">
        <div className="intro">
          <div>
            <p className="eyebrow">Metro Nashville · Public safety data</p>
            <h1>Explore incidents across Nashville.</h1>
            <p className="intro-copy">A clearer view of what is happening in your community.</p>
          </div>
          <span className="status"><span className="status-dot" />Map ready</span>
        </div>

        <div className="map-frame" aria-label="Map area coming soon">
          <div className="map-grid" />
          <div className="map-crosshair" aria-hidden="true">+</div>
          <div className="map-message">
            <div className="map-pin">⌖</div>
            <h2>Your map will live here</h2>
            <p>Incident locations and neighborhood context will appear in this space.</p>
          </div>
          <div className="map-scale">NASHVILLE, MN <span>·</span> MAP VIEW</div>
        </div>
      </section>
    </main>
  )
}

export default App
