import { useCallback, useEffect, useState } from 'react'
import L from 'leaflet'
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

const NASHVILLE_CENTER = [36.1627, -86.7816]
const AUTH_STORAGE_KEY = 'nashville-incident-auth'

function ResetMapButton({ onReset }) {
  const map = useMap()

  return (
    <button
      className="reset-map-button"
      type="button"
      aria-label="Recenter map on Nashville"
      title="Recenter map on Nashville"
      onClick={() => {
        map.setView(NASHVILLE_CENTER, 11)
        onReset()
      }}
    >
      <span aria-hidden="true">⌖</span>
      <span>Reset view</span>
    </button>
  )
}

function MapClickHandler({ enabled, onSelect }) {
  useMapEvents({
    click: (event) => {
      if (enabled) onSelect([event.latlng.lat, event.latlng.lng])
    },
  })
  return null
}

function MapFocus({ incident }) {
  const map = useMap()

  useEffect(() => {
    if (incident?.latitude && incident?.longitude) {
      map.setView([Number(incident.latitude), Number(incident.longitude)], Math.max(map.getZoom(), 14), { animate: true })
    }
  }, [incident, map])

  return null
}

function escapeHtml(value) {
  return String(value ?? 'Unknown')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function incidentPopup(details) {
  return `<div class="incident-popup">
    <p class="popup-kicker">Incident #${escapeHtml(details.incident_id)}</p>
    <h2>${escapeHtml(details.offense_description || 'Incident')}</h2>
    <dl>
      <div><dt>Occurred</dt><dd>${escapeHtml(details.incident_occurred)}</dd></div>
      <div><dt>Location</dt><dd>${escapeHtml(details.incident_location)}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(details.incident_status)}</dd></div>
      <div><dt>Report</dt><dd>${escapeHtml(details.incident_number)}</dd></div>
    </dl>
    <button class="popup-details-button" type="button">View full details</button>
  </div>`
}

function IncidentLayer({ incidents, onIncidentSelected }) {
  const map = useMap()

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.5 })
    const layerGroup = L.layerGroup()

    incidents.forEach((incident) => {
      const marker = L.circleMarker(
        [Number(incident.latitude), Number(incident.longitude)],
        { renderer, radius: 4, color: '#ffffff', fillColor: '#e65345', fillOpacity: 0.9, weight: 1.2 },
      )

      marker.on('click', async () => {
        marker.bindPopup('Loading incident details...').openPopup()
        try {
          const response = await fetch(`/api/incidents/${incident.incident_id}`)
          if (!response.ok) throw new Error('Unable to load incident details.')
          const data = await response.json()
          marker.bindPopup(incidentPopup(data.incident)).openPopup()
          marker.getPopup().getElement()?.querySelector('.popup-details-button')?.addEventListener(
            'click',
            () => onIncidentSelected(data.incident),
            { once: true },
          )
        } catch (error) {
          marker.bindPopup(escapeHtml(error.message)).openPopup()
        }
      })
      layerGroup.addLayer(marker)
    })

    layerGroup.addTo(map)
    return () => layerGroup.removeFrom(map)
  }, [incidents, map, onIncidentSelected])

  return null
}

function App() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)) || null } catch { return null }
  })
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ login: '', username: '', email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [years, setYears] = useState([new Date().getFullYear()])
  const [incidents, setIncidents] = useState([])
  const [isLoadingIncidents, setIsLoadingIncidents] = useState(true)
  const [mapError, setMapError] = useState('')
  const [address, setAddress] = useState('')
  const [radiusInput, setRadiusInput] = useState('1')
  const [filterCenter, setFilterCenter] = useState(null)
  const [filterRadius, setFilterRadius] = useState(null)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [isDropPinMode, setIsDropPinMode] = useState(false)
  const [selectedIncident, setSelectedIncident] = useState(null)
  const [incidentNumber, setIncidentNumber] = useState('')
  const [isSearchingIncident, setIsSearchingIncident] = useState(false)
  const [comments, setComments] = useState([])
  const [commentsIncidentId, setCommentsIncidentId] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState('')

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    setAuthError('')
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register'
    const body = authMode === 'login'
      ? { login: authForm.login, password: authForm.password }
      : { username: authForm.username, email: authForm.email, password: authForm.password }
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to authenticate.')
      setAuth(data)
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data))
      setAuthForm({ login: '', username: '', email: '', password: '' })
    } catch (error) {
      setAuthError(error.message)
    }
  }

  const handleSignOut = () => {
    setAuth(null)
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setIsMenuOpen(false)
  }

  const updatePrivacy = async (isAnonymous) => {
    if (!auth?.token) return
    const response = await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ isAnonymous }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Unable to update privacy setting.')
    const nextAuth = { ...auth, user: data.user }
    setAuth(nextAuth)
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth))
  }

  const handleYearChange = (event) => {
    setIsLoadingIncidents(true)
    setMapError('')
    setSelectedYear(Number(event.target.value))
  }

  const applyLocationFilter = (center) => {
    const radius = Number(radiusInput)
    if (!Number.isFinite(radius) || radius <= 0 || radius > 100) {
      setMapError('Enter a radius between 0.1 and 100 miles.')
      return
    }
    setMapError('')
    setFilterCenter(center)
    setFilterRadius(radius)
    setIsLoadingIncidents(true)
  }

  const handleMapLocation = (center) => {
    setAddress('')
    setIsDropPinMode(false)
    applyLocationFilter(center)
  }

  const handleReset = () => {
    setAddress('')
    setIsDropPinMode(false)
    setFilterCenter(null)
    setFilterRadius(null)
    setMapError('')
    setIsLoadingIncidents(true)
  }

  const handleIncidentSelected = useCallback((incident) => {
    setSelectedIncident(incident)
    setCommentText('')
    setCommentError('')
  }, [])

  const submitComment = async (event) => {
    event.preventDefault()
    if (!auth?.token || !selectedIncident) return
    setCommentError('')
    try {
      const response = await fetch(`/api/incidents/${selectedIncident.incident_id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ commentText }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to add comment.')
      setComments((currentComments) => [...currentComments, data.comment])
      setCommentText('')
    } catch (error) {
      setCommentError(error.message)
    }
  }

  const handleAddressSubmit = async (event) => {
    event.preventDefault()
    if (address.trim().length < 3) {
      setMapError('Enter an address to search.')
      return
    }

    setIsGeocoding(true)
    setMapError('')
    try {
      const response = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to find that address.')
      applyLocationFilter([data.latitude, data.longitude])
    } catch (error) {
      setMapError(error.message)
    } finally {
      setIsGeocoding(false)
    }
  }

  const handleIncidentSearch = async (event) => {
    event.preventDefault()
    if (incidentNumber.trim().length < 2) {
      setMapError('Enter at least 2 characters of an incident number.')
      return
    }

    setIsSearchingIncident(true)
    setMapError('')
    try {
      const query = encodeURIComponent(incidentNumber.trim())
      const response = await fetch(`/api/incidents/search?incidentNumber=${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to search incidents.')
      if (data.incidents.length === 0) throw new Error(`No incident found matching “${incidentNumber.trim()}”.`)
      handleIncidentSelected(data.incidents[0])
      if (data.incidents.length > 1) setMapError(`${data.incidents.length} matches found. Showing the most recent.`)
    } catch (error) {
      setMapError(error.message)
    } finally {
      setIsSearchingIncident(false)
    }
  }

  useEffect(() => {
    fetch('/api/incidents/years')
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load available years.')
        return response.json()
      })
      .then(({ years: availableYears }) => {
        setYears([...new Set([new Date().getFullYear(), ...availableYears])].sort((a, b) => b - a))
      })
      .catch(() => setMapError('Connect the server to load incident years.'))
  }, [])

  useEffect(() => {
    let isCurrent = true

    const query = new URLSearchParams({ year: selectedYear })
    if (filterCenter && filterRadius) {
      query.set('latitude', filterCenter[0])
      query.set('longitude', filterCenter[1])
      query.set('radius', filterRadius)
    }

    fetch(`/api/incidents?${query}`)
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load incidents.')
        return response.json()
      })
      .then(({ incidents: markerData }) => {
        if (isCurrent) setIncidents(markerData)
      })
      .catch(() => {
        if (isCurrent) {
          setIncidents([])
          setMapError('Connect the server to load incidents.')
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoadingIncidents(false)
      })

    return () => { isCurrent = false }
  }, [selectedYear, filterCenter, filterRadius])

  useEffect(() => {
    if (!selectedIncident) return undefined
    let isCurrent = true
    fetch(`/api/incidents/${selectedIncident.incident_id}/comments`)
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load comments.')
        return response.json()
      })
      .then(({ comments: incidentComments }) => {
        if (isCurrent) {
          setComments(incidentComments)
          setCommentsIncidentId(selectedIncident.incident_id)
        }
      })
      .catch((error) => { if (isCurrent) setCommentError(error.message) })
    return () => { isCurrent = false }
  }, [selectedIncident])

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
            className={`account-button${auth ? ' signed-in' : ''}`}
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
            <span className="account-label">{auth ? 'My account' : 'Account'}</span>
            <span className="chevron" aria-hidden="true">⌄</span>
          </button>

          {isMenuOpen && (
            <div className="account-menu" role="menu">
              {auth ? (
                <>
                  <div className="menu-heading">Signed in as {auth.user.username}</div>
                  <label className="anonymous-setting">
                    <input
                      type="checkbox"
                      checked={Boolean(auth.user.is_anonymous)}
                      onChange={(event) => updatePrivacy(event.target.checked).catch((error) => setAuthError(error.message))}
                    />
                    Post comments anonymously
                  </label>
                  {authError && <p className="auth-error">{authError}</p>}
                  <button type="button" role="menuitem" onClick={() => setIsMenuOpen(false)}>
                    <span className="menu-icon">⚙</span>
                    Settings
                  </button>
                  <button type="button" role="menuitem" onClick={handleSignOut}>
                    <span className="menu-icon">↪</span>
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <div className="menu-heading">{authMode === 'login' ? 'Sign in to comment' : 'Create an account'}</div>
                  <form className="auth-form" onSubmit={handleAuthSubmit}>
                    {authMode === 'login' ? (
                      <input
                        value={authForm.login}
                        onChange={(event) => setAuthForm({ ...authForm, login: event.target.value })}
                        placeholder="Username or email"
                        autoComplete="username"
                        required
                      />
                    ) : (
                      <>
                        <input value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} placeholder="Username" autoComplete="username" required />
                        <input value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="Email" type="email" autoComplete="email" required />
                      </>
                    )}
                    <input value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="Password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required />
                    <button className="menu-primary" type="submit">{authMode === 'login' ? 'Sign in' : 'Create account'}</button>
                  </form>
                  {authError && <p className="auth-error">{authError}</p>}
                  <button className="auth-switch" type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>
                    {authMode === 'login' ? 'Need an account?' : 'Already have an account?'}
                  </button>
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
          <div className="map-tools">
            <label className="year-picker">
              <span>Year</span>
              <select value={selectedYear} onChange={handleYearChange}>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <form className="incident-search" onSubmit={handleIncidentSearch}>
              <label htmlFor="incident-number">Track an incident</label>
              <div>
                <input
                  id="incident-number"
                  type="search"
                  value={incidentNumber}
                  onChange={(event) => setIncidentNumber(event.target.value)}
                  placeholder="Incident number"
                />
                <button type="submit" disabled={isSearchingIncident}>{isSearchingIncident ? 'Searching...' : 'Search'}</button>
              </div>
            </form>
            <span className="status"><span className="status-dot" />{isLoadingIncidents ? 'Loading' : `${incidents.length} mapped`}</span>
          </div>
        </div>

        <div className="map-frame" aria-label="Interactive map centered on Nashville">
          <div className="location-filter" aria-label="Filter incidents by location">
            <form className="address-search" onSubmit={handleAddressSubmit}>
              <label htmlFor="address">Search an address</label>
              <div className="address-input-row">
                <input
                  id="address"
                  type="search"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="123 Main St"
                />
                <button type="submit" disabled={isGeocoding}>{isGeocoding ? 'Searching...' : 'Find'}</button>
              </div>
            </form>
            <div className="radius-control">
              <label htmlFor="radius">Radius</label>
              <div className="radius-input-row">
                <input
                  id="radius"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={radiusInput}
                  onChange={(event) => setRadiusInput(event.target.value)}
                />
                <span>miles</span>
                <button type="button" onClick={() => filterCenter && applyLocationFilter(filterCenter)} disabled={!filterCenter}>Apply</button>
              </div>
            </div>
            <button
              className={`drop-pin-button${isDropPinMode ? ' active' : ''}`}
              type="button"
              onClick={() => setIsDropPinMode((active) => !active)}
            >
              <span aria-hidden="true">⌖</span>
              {isDropPinMode ? 'Cancel drop pin' : 'Drop pin on map'}
            </button>
            <p className="location-hint">Map clicks only place a pin when this mode is active.</p>
          </div>
          <MapContainer
            center={NASHVILLE_CENTER}
            zoom={11}
            minZoom={9}
            maxZoom={18}
            zoomControlPosition="bottomright"
            preferCanvas
            scrollWheelZoom
            className="incident-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapFocus incident={selectedIncident} />
            <MapClickHandler enabled={isDropPinMode} onSelect={handleMapLocation} />
            <IncidentLayer incidents={incidents} onIncidentSelected={handleIncidentSelected} />
            {filterCenter && filterRadius && (
              <>
                <Circle
                  center={filterCenter}
                  radius={filterRadius * 1609.344}
                  pathOptions={{ color: '#66aa62', fillColor: '#66aa62', fillOpacity: 0.12, weight: 3 }}
                />
                <CircleMarker
                  center={filterCenter}
                  radius={8}
                  pathOptions={{ color: '#f5f6ef', fillColor: '#66aa62', fillOpacity: 1, weight: 3 }}
                />
              </>
            )}
            <ResetMapButton onReset={handleReset} />
          </MapContainer>
          {selectedIncident && (
            <div className="incident-workspace">
              <section className="comments-panel" aria-label="Incident discussion">
                <div className="comments-page-header">
                  <div>
                    <p className="popup-kicker">Incident #{selectedIncident.incident_id}</p>
                    <h2>Community discussion</h2>
                    <p>Share context and observations about this incident.</p>
                  </div>
                  <button
                    className="close-detail-button"
                    type="button"
                    aria-label="Close incident workspace"
                    onClick={() => setSelectedIncident(null)}
                  >
                    ×
                  </button>
                </div>
                <div className="discussion-rule" />
                <div className="comments-heading">
                  <div>
                    <h3>{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</h3>
                  </div>
                </div>
                {commentsIncidentId !== selectedIncident.incident_id && <p className="comments-muted">Loading comments...</p>}
                {commentsIncidentId === selectedIncident.incident_id && comments.length === 0 && <p className="comments-muted">No comments yet.</p>}
                <div className="comment-list">
                  {commentsIncidentId === selectedIncident.incident_id && comments.map((comment) => (
                    <article className="comment" key={comment.comment_id}>
                      <div className="comment-meta"><strong>{comment.username}</strong><time>{new Date(comment.created_at).toLocaleString()}</time></div>
                      <p>{comment.comment_text}</p>
                    </article>
                  ))}
                </div>
                {auth ? (
                  <form className="comment-form" onSubmit={submitComment}>
                    <textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength="2000" placeholder="Add a respectful comment..." required />
                    <button type="submit">Post comment</button>
                  </form>
                ) : (
                  <p className="comments-muted">Sign in from the account menu to join the discussion.</p>
                )}
                {commentError && <p className="auth-error">{commentError}</p>}
              </section>
              <aside className="incident-detail-panel" aria-label="Incident details">
                <div className="detail-panel-header">
                  <div>
                    <p className="popup-kicker">Incident details</p>
                    <h2>{selectedIncident.offense_description || 'Incident details'}</h2>
                  </div>
                  <span className="detail-incident-id">#{selectedIncident.incident_id}</span>
                </div>
                <dl className="detail-list">
                  <div><dt>Incident number</dt><dd>{selectedIncident.incident_number || 'Unknown'}</dd></div>
                  <div><dt>Occurred</dt><dd>{selectedIncident.incident_occurred || 'Unknown'}</dd></div>
                  <div><dt>Reported</dt><dd>{selectedIncident.incident_reported || 'Unknown'}</dd></div>
                  <div><dt>Location</dt><dd>{selectedIncident.incident_location || 'Unknown'}</dd></div>
                  <div><dt>Location type</dt><dd>{selectedIncident.location_description || 'Unknown'}</dd></div>
                  <div><dt>Report type</dt><dd>{selectedIncident.report_type_desc || 'Unknown'}</dd></div>
                  <div><dt>Incident status</dt><dd>{selectedIncident.incident_status || 'Unknown'}</dd></div>
                  <div><dt>Investigation</dt><dd>{selectedIncident.investigation_status || 'Unknown'}</dd></div>
                  <div><dt>Offense code</dt><dd>{selectedIncident.offense_nibrs || 'Unknown'}</dd></div>
                  <div><dt>Weapon</dt><dd>{selectedIncident.weapon_description || 'Unknown'}</dd></div>
                  <div><dt>Primary weapon</dt><dd>{selectedIncident.weapon_primary || 'Unknown'}</dd></div>
                  <div><dt>Domestic related</dt><dd>{selectedIncident.domestic_related || 'Unknown'}</dd></div>
                  <div><dt>Victim type</dt><dd>{selectedIncident.victim_type || 'Unknown'}</dd></div>
                  <div><dt>Victim description</dt><dd>{selectedIncident.victim_description || 'Unknown'}</dd></div>
                  <div><dt>ZIP code</dt><dd>{selectedIncident.zip_code || 'Unknown'}</dd></div>
                  <div><dt>Coordinates</dt><dd>{selectedIncident.latitude}, {selectedIncident.longitude}</dd></div>
                  <div><dt>Primary key</dt><dd>{selectedIncident.primary_key || 'Unknown'}</dd></div>
                  <div><dt>Object ID</dt><dd>{selectedIncident.object_id || 'Unknown'}</dd></div>
                </dl>
              </aside>
            </div>
          )}
          {mapError && <div className="map-error" role="status">{mapError}</div>}
          {!isLoadingIncidents && !mapError && incidents.length === 0 && (
            <div className="map-empty" role="status">No incidents found for {selectedYear}.</div>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
