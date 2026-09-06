require('dotenv').config();

const cors = require('cors');
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const port = Number(process.env.PORT || 5000);
const pool = mysql.createPool({
	host: process.env.DB_HOST,
	port: Number(process.env.DB_PORT || 3306),
	database: process.env.DB_NAME,
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	waitForConnections: true,
	connectionLimit: 10,
});

app.use(cors());
app.use(express.json());

function parseYear(value) {
	const year = Number.parseInt(value, 10);
	if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
	return year;
}

app.get('/api/incidents/years', async (_request, response) => {
	try {
		const [rows] = await pool.query(`
			SELECT DISTINCT YEAR(incident_occurred) AS year
			FROM incidents
			WHERE incident_occurred IS NOT NULL
			ORDER BY year DESC
		`);
		response.json({ years: rows.map((row) => row.year).filter(Boolean) });
	} catch (error) {
		console.error('Failed to load incident years:', error);
		response.status(500).json({ error: 'Unable to load incident years.' });
	}
});

app.get('/api/incidents', async (request, response) => {
	const year = parseYear(request.query.year);
	if (!year) return response.status(400).json({ error: 'A valid year is required.' });
	const latitude = Number(request.query.latitude);
	const longitude = Number(request.query.longitude);
	const radiusMiles = Number(request.query.radius);
	const hasRadius = [latitude, longitude, radiusMiles].every(Number.isFinite)
		&& latitude >= -90 && latitude <= 90
		&& longitude >= -180 && longitude <= 180
		&& radiusMiles > 0 && radiusMiles <= 100;
	if ((request.query.latitude || request.query.longitude || request.query.radius) && !hasRadius) {
		return response.status(400).json({ error: 'Valid latitude, longitude, and radius are required.' });
	}

	try {
		const queryParameters = [`${year}-01-01 00:00:00`, `${year + 1}-01-01 00:00:00`];
		let locationFilter = '';
		if (hasRadius) {
			const latitudeDelta = radiusMiles / 69;
			const longitudeDelta = radiusMiles / (69 * Math.max(Math.cos(latitude * Math.PI / 180), 0.01));
			locationFilter = `
				AND latitude BETWEEN ? AND ?
				AND longitude BETWEEN ? AND ?
				AND 3959 * ACOS(LEAST(1, GREATEST(-1,
					SIN(RADIANS(?)) * SIN(RADIANS(latitude)) +
					COS(RADIANS(?)) * COS(RADIANS(latitude)) *
					COS(RADIANS(longitude) - RADIANS(?))
				))) <= ?
			`;
			queryParameters.push(
				latitude - latitudeDelta, latitude + latitudeDelta,
				longitude - longitudeDelta, longitude + longitudeDelta,
				latitude, latitude, longitude, radiusMiles,
			);
		}
		const [rows] = await pool.execute(`
			SELECT incident_id, latitude, longitude
			FROM incidents
			WHERE incident_occurred >= ? AND incident_occurred < ?
				AND latitude IS NOT NULL AND longitude IS NOT NULL
				${locationFilter}
		`, queryParameters);
		response.json({ year, incidents: rows });
	} catch (error) {
		console.error(`Failed to load incidents for ${year}:`, error);
		response.status(500).json({ error: 'Unable to load incidents.' });
	}
});

app.get('/api/geocode', async (request, response) => {
	const address = String(request.query.address || '').trim();
	if (address.length < 3 || address.length > 200) {
		return response.status(400).json({ error: 'Enter a valid address.' });
	}

	try {
		const url = new URL('https://nominatim.openstreetmap.org/search');
		url.searchParams.set('q', `${address}, Nashville, Tennessee`);
		url.searchParams.set('format', 'jsonv2');
		url.searchParams.set('limit', '1');
		const geocodeResponse = await fetch(url, {
			headers: { 'User-Agent': 'Nashville-Incident-Explorer/1.0' },
		});
		if (!geocodeResponse.ok) throw new Error(`Geocoder responded with ${geocodeResponse.status}`);
		const results = await geocodeResponse.json();
		if (results.length === 0) return response.status(404).json({ error: 'Address not found.' });
		response.json({ latitude: Number(results[0].lat), longitude: Number(results[0].lon), displayName: results[0].display_name });
	} catch (error) {
		console.error('Failed to geocode address:', error);
		response.status(502).json({ error: 'Unable to look up that address.' });
	}
});

app.get('/api/incidents/:incidentId', async (request, response) => {
	const incidentId = Number.parseInt(request.params.incidentId, 10);
	if (!Number.isInteger(incidentId) || incidentId < 1) {
		return response.status(400).json({ error: 'A valid incident ID is required.' });
	}

	try {
		const [rows] = await pool.execute(`
			SELECT incident_id, object_id, primary_key, incident_number,
				report_type_desc, incident_status, investigation_status,
				incident_location, latitude, longitude, zip_code, incident_occurred,
				offense_description, weapon_description, domestic_related
			FROM incidents
			WHERE incident_id = ?
			LIMIT 1
		`, [incidentId]);

		if (rows.length === 0) return response.status(404).json({ error: 'Incident not found.' });
		response.json({ incident: rows[0] });
	} catch (error) {
		console.error(`Failed to load incident ${incidentId}:`, error);
		response.status(500).json({ error: 'Unable to load incident.' });
	}
});

app.listen(port, () => {
	console.log(`Nashville incident API listening on port ${port}`);
});
