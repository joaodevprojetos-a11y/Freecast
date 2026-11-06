const crypto = require('node:crypto');
const { promisify } = require('node:util');

const pbkdf2 = promisify(crypto.pbkdf2);
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'rrpg_session';
const DUMMY_PASSWORD_HASH = `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${Buffer.alloc(PASSWORD_SALT_BYTES).toString('base64url')}$${Buffer.alloc(PASSWORD_BYTES).toString('base64url')}`;

async function hashPassword(password) {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES);
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS, PASSWORD_BYTES, 'sha256');
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function verifyPassword(password, encodedHash = DUMMY_PASSWORD_HASH) {
  const [algorithm, iterationsText, saltText, hashText] = encodedHash.split('$');
  if (algorithm !== 'pbkdf2-sha256' || !/^\d+$/.test(iterationsText)) return false;
  const iterations = Number(iterationsText);
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 1000000 || salt.length !== PASSWORD_SALT_BYTES || expected.length !== PASSWORD_BYTES) return false;
  const actual = await pbkdf2(password, salt, iterations, expected.length, 'sha256');
  return crypto.timingSafeEqual(actual, expected);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header = '') {
  const cookies = new Map();
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      continue;
    }
  }
  return cookies;
}

function readSessionToken(request) {
  return parseCookies(request.headers.cookie).get(SESSION_COOKIE) || null;
}

function sessionCookie(token, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}

function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function newSessionRecord(userId, now = new Date()) {
  const token = createSessionToken();
  return {
    token,
    tokenHash: hashSessionToken(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  };
}

module.exports = {
  clearSessionCookie,
  hashPassword,
  hashSessionToken,
  newSessionRecord,
  readSessionToken,
  sessionCookie,
  verifyPassword
};
