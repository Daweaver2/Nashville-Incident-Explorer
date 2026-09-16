require('dotenv').config();

const crypto = require('node:crypto');
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
const authSecret = process.env.AUTH_SECRET || 'local-development-secret-change-me';

app.use(cors());
app.use(express.json());

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
	const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${passwordHash}`;
}

function verifyPassword(password, storedHash) {
	const [salt, expectedHash] = String(storedHash).split(':');
	if (!salt || !expectedHash) return false;
	const actualHash = crypto.scryptSync(password, salt, 64).toString('hex');
	return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function createToken(user) {
	const payload = Buffer.from(JSON.stringify({ userId: user.user_id, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
	const signature = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
	return `${payload}.${signature}`;
}

function getUserFromRequest(request) {
	const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
	if (!token) return null;
	const [payload, signature] = token.split('.');
	if (!payload || !signature) return null;
	const expectedSignature = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
	if (signature !== expectedSignature) return null;
	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
		return data.expiresAt > Date.now() ? data.userId : null;
	} catch {
		return null;
	}
}

async function requireUser(request, response, next) {
	const userId = getUserFromRequest(request);
	if (!userId) return response.status(401).json({ error: 'Sign in to continue.' });
	const [rows] = await pool.execute('SELECT user_id, username, email, is_anonymous FROM users WHERE user_id = ?', [userId]);
	if (rows.length === 0) return response.status(401).json({ error: 'Your account is no longer available.' });
	request.user = rows[0];
	next();
}

async function ensureColumn(table, column, definition) {
	const [rows] = await pool.execute(`
		SELECT COUNT(*) AS column_count
		FROM information_schema.columns
		WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
	`, [table, column]);
	if (rows[0].column_count === 0) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureDatabaseSchema() {
	const incidentColumns = [
		['incident_reported', 'DATETIME NULL'],
		['offense_nibrs', 'VARCHAR(255) NULL'],
		['weapon_primary', 'VARCHAR(255) NULL'],
		['location_description', 'VARCHAR(255) NULL'],
		['victim_type', 'VARCHAR(255) NULL'],
		['victim_description', 'VARCHAR(255) NULL'],
	];
	for (const [column, definition] of incidentColumns) await ensureColumn('incidents', column, definition);
	await ensureColumn('users', 'is_anonymous', 'BOOLEAN NOT NULL DEFAULT FALSE');
}

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

app.post('/api/auth/register', async (request, response) => {
	const username = String(request.body.username || '').trim();
	const email = String(request.body.email || '').trim().toLowerCase();
	const password = String(request.body.password || '');
	if (!/^[a-zA-Z0-9_]{3,50}$/.test(username)) {
		return response.status(400).json({ error: 'Username must be 3-50 letters, numbers, or underscores.' });
	}
	if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 100) {
		return response.status(400).json({ error: 'Enter a valid email address.' });
	}
	if (password.length < 8) return response.status(400).json({ error: 'Password must be at least 8 characters.' });

	try {
		const [result] = await pool.execute(
			'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
			[username, email, hashPassword(password)],
		);
		const user = { user_id: result.insertId, username, email, is_anonymous: false };
		response.status(201).json({ token: createToken(user), user });
	} catch (error) {
		if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'That username or email is already in use.' });
		console.error('Failed to register user:', error);
		response.status(500).json({ error: 'Unable to create account.' });
	}
});

app.post('/api/auth/login', async (request, response) => {
	const login = String(request.body.login || '').trim();
	const password = String(request.body.password || '');
	try {
		const [rows] = await pool.execute(
			'SELECT user_id, username, email, password_hash, is_anonymous FROM users WHERE username = ? OR email = ? LIMIT 1',
			[login, login.toLowerCase()],
		);
		if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
			return response.status(401).json({ error: 'Invalid username/email or password.' });
		}
		const user = rows[0];
		delete user.password_hash;
		response.json({ token: createToken(user), user });
	} catch (error) {
		console.error('Failed to sign in user:', error);
		response.status(500).json({ error: 'Unable to sign in.' });
	}
});

app.get('/api/auth/me', requireUser, (request, response) => response.json({ user: request.user }));

app.patch('/api/auth/me', requireUser, async (request, response) => {
	const isAnonymous = Boolean(request.body.isAnonymous);
	try {
		await pool.execute('UPDATE users SET is_anonymous = ? WHERE user_id = ?', [isAnonymous, request.user.user_id]);
		response.json({ user: { ...request.user, is_anonymous: isAnonymous } });
	} catch (error) {
		console.error('Failed to update privacy setting:', error);
		response.status(500).json({ error: 'Unable to update privacy setting.' });
	}
});

app.get('/api/incidents/search', async (request, response) => {
	const incidentNumber = String(request.query.incidentNumber || '').trim();
	if (incidentNumber.length < 2 || incidentNumber.length > 50) {
		return response.status(400).json({ error: 'Enter at least 2 characters of an incident number.' });
	}

	try {
		const [rows] = await pool.execute(`
			SELECT incident_id, object_id, primary_key, incident_number,
				report_type_desc, incident_status, investigation_status,
				incident_location, location_description, latitude, longitude, zip_code,
				incident_occurred, incident_reported, offense_description, offense_nibrs,
				weapon_description, weapon_primary, domestic_related, victim_type,
				victim_description
			FROM incidents
			WHERE CAST(incident_number AS CHAR) LIKE ?
			ORDER BY incident_occurred DESC
			LIMIT 10
		`, [`%${incidentNumber}%`]);
		response.json({ incidents: rows });
	} catch (error) {
		console.error(`Failed to search for incident ${incidentNumber}:`, error);
		response.status(500).json({ error: 'Unable to search incidents.' });
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
				incident_location, location_description, latitude, longitude, zip_code,
				incident_occurred, incident_reported, offense_description, offense_nibrs,
				weapon_description, weapon_primary, domestic_related, victim_type,
				victim_description
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

app.get('/api/incidents/:incidentId/comments', async (request, response) => {
	const incidentId = Number.parseInt(request.params.incidentId, 10);
	if (!Number.isInteger(incidentId) || incidentId < 1) {
		return response.status(400).json({ error: 'A valid incident ID is required.' });
	}
	try {
		const [rows] = await pool.execute(`
			SELECT comments.comment_id, comments.comment_text, comments.created_at,
				CASE WHEN users.is_anonymous THEN 'Anonymous' ELSE users.username END AS username
			FROM comments
			JOIN users ON users.user_id = comments.user_id
			WHERE comments.incident_id = ?
			ORDER BY comments.created_at ASC, comments.comment_id ASC
		`, [incidentId]);
		response.json({ comments: rows });
	} catch (error) {
		console.error(`Failed to load comments for incident ${incidentId}:`, error);
		response.status(500).json({ error: 'Unable to load comments.' });
	}
});

app.post('/api/incidents/:incidentId/comments', requireUser, async (request, response) => {
	const incidentId = Number.parseInt(request.params.incidentId, 10);
	const commentText = String(request.body.commentText || '').trim();
	if (!Number.isInteger(incidentId) || incidentId < 1) {
		return response.status(400).json({ error: 'A valid incident ID is required.' });
	}
	if (commentText.length < 1 || commentText.length > 2000) {
		return response.status(400).json({ error: 'Comments must be between 1 and 2,000 characters.' });
	}
	try {
		const [result] = await pool.execute(
			'INSERT INTO comments (incident_id, user_id, comment_text) SELECT ?, ?, ? FROM incidents WHERE incident_id = ?',
			[incidentId, request.user.user_id, commentText, incidentId],
		);
		if (result.affectedRows === 0) return response.status(404).json({ error: 'Incident not found.' });
		const [rows] = await pool.execute(`
			SELECT comments.comment_id, comments.comment_text, comments.created_at,
				CASE WHEN users.is_anonymous THEN 'Anonymous' ELSE users.username END AS username
			FROM comments JOIN users ON users.user_id = comments.user_id
			WHERE comments.comment_id = ?
		`, [result.insertId]);
		response.status(201).json({ comment: rows[0] });
	} catch (error) {
		console.error(`Failed to add comment to incident ${incidentId}:`, error);
		response.status(500).json({ error: 'Unable to add comment.' });
	}
});

ensureDatabaseSchema()
	.then(() => app.listen(port, () => console.log(`Nashville incident API listening on port ${port}`)))
	.catch((error) => {
		console.error('Failed to initialize the database schema:', error);
		process.exitCode = 1;
	});
