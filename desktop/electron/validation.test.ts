import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsp, mimeFor, normalizeBackendUrl, validateDisplayName } from './validation';

test('normalizeBackendUrl acepta http/https y quita la barra final', () => {
  assert.equal(normalizeBackendUrl('http://localhost:8080/'), 'http://localhost:8080');
  assert.equal(normalizeBackendUrl(' https://gs.example.com '), 'https://gs.example.com');
});

test('normalizeBackendUrl rechaza esquemas peligrosos, credenciales y rutas', () => {
  for (const bad of ['file:///c:/x', 'javascript:alert(1)', 'ftp://x', 'https://u:p@x.com',
    'https://x.com/api', 'https://x.com/?a=1', '', 'no es url', 42]) {
    assert.throws(() => normalizeBackendUrl(bad), Error, String(bad));
  }
});

test('validateDisplayName', () => {
  assert.equal(validateDisplayName('  Mau  '), 'Mau');
  assert.equal(validateDisplayName('Ñandú_01'), 'Ñandú_01');
  assert.throws(() => validateDisplayName('<script>'));
  assert.throws(() => validateDisplayName(''));
  assert.throws(() => validateDisplayName('x'.repeat(33)));
});

test('buildCsp limita connect-src al backend', () => {
  const csp = buildCsp('https://gs.example.com');
  assert.match(csp, /connect-src 'self' https:\/\/gs\.example\.com wss:\/\/gs\.example\.com;/);
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('mimeFor', () => {
  assert.equal(mimeFor('main-ABC.js'), 'text/javascript; charset=utf-8');
  assert.equal(mimeFor('index.html'), 'text/html; charset=utf-8');
  assert.equal(mimeFor('noext'), 'application/octet-stream');
});
