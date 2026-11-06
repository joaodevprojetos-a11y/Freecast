const test = require('node:test');
const assert = require('node:assert/strict');
const { getPostgresSslConfig } = require('./postgres-store');

const certificate = '-----BEGIN CERTIFICATE-----\npublic-test-certificate\n-----END CERTIFICATE-----';

test('requires the Supabase CA certificate while keeping TLS verification enabled', () => {
  assert.throws(
    () => getPostgresSslConfig('postgresql://user:pass@db.example.supabase.co/postgres', ''),
    error => error.code === 'SUPABASE_CA_CERT_REQUIRED'
  );
  assert.deepEqual(
    getPostgresSslConfig('postgresql://user:pass@db.example.supabase.co/postgres', certificate),
    { rejectUnauthorized: true, ca: certificate }
  );
  assert.deepEqual(
    getPostgresSslConfig('postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com/postgres', certificate),
    { rejectUnauthorized: true, ca: certificate }
  );
});

test('does not impose Supabase TLS settings on other PostgreSQL hosts', () => {
  assert.equal(getPostgresSslConfig('postgresql://user:pass@db.example.com/postgres', ''), undefined);
});
