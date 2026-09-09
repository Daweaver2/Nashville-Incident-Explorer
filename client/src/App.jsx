import { useCallback, useEffect, useState } from 'react'
import L from 'leaflet'
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

const NASHVILLE_CENTER = [36.1627, -86.7816]

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
  const [isLoggedIn, setIsLoggedIn] = useState(false)
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

  const handleAuth = () => {
    setIsLoggedIn(true)
    setIsMenuOpen(true)
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
  }, [])

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
          <div className="map-tools">
            <label className="year-picker">
              <span>Year</span>
              <select value={selectedYear} onChange={handleYearChange}>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
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
            <aside className="incident-detail-panel" aria-label="Incident details">
              <div className="detail-panel-header">
                <div>
                  <p className="popup-kicker">Incident #{selectedIncident.incident_id}</p>
                  <h2>{selectedIncident.offense_description || 'Incident details'}</h2>
                </div>
                <button
                  className="close-detail-button"
                  type="button"
                  aria-label="Close incident details"
                  onClick={() => setSelectedIncident(null)}
                >
                  ×
                </button>
              </div>
              <dl className="detail-list">
                <div><dt>Incident number</dt><dd>{selectedIncident.incident_number || 'Unknown'}</dd></div>
                <div><dt>Occurred</dt><dd>{selectedIncident.incident_occurred || 'Unknown'}</dd></div>
                <div><dt>Location</dt><dd>{selectedIncident.incident_location || 'Unknown'}</dd></div>
                <div><dt>Report type</dt><dd>{selectedIncident.report_type_desc || 'Unknown'}</dd></div>
                <div><dt>Incident status</dt><dd>{selectedIncident.incident_status || 'Unknown'}</dd></div>
                <div><dt>Investigation</dt><dd>{selectedIncident.investigation_status || 'Unknown'}</dd></div>
                <div><dt>Weapon</dt><dd>{selectedIncident.weapon_description || 'Unknown'}</dd></div>
                <div><dt>Domestic related</dt><dd>{selectedIncident.domestic_related || 'Unknown'}</dd></div>
                <div><dt>ZIP code</dt><dd>{selectedIncident.zip_code || 'Unknown'}</dd></div>
                <div><dt>Coordinates</dt><dd>{selectedIncident.latitude}, {selectedIncident.longitude}</dd></div>
                <div><dt>Primary key</dt><dd>{selectedIncident.primary_key || 'Unknown'}</dd></div>
                <div><dt>Object ID</dt><dd>{selectedIncident.object_id || 'Unknown'}</dd></div>
              </dl>
            </aside>
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
