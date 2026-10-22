import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedback, supportAddress, FEEDBACK_MAX_MESSAGE } from '../lib/feedback.ts';
import { verifyTurnstile } from '../lib/turnstile.ts';

const ok = { kind: 'issue', message: 'The chart does not load on my phone.', contactEmail: ' Me@Example.com ', page: '/zakat?x=1#y', platform: 'web', appVersion: '1.2.0' };

test('parseFeedback cleans a valid submission', () => {
  const r = parseFeedback(ok);
  assert.equal(typeof r, 'object');
  assert.equal(r.contactEmail, 'me@example.com');
  assert.equal(r.page, '/zakat');
  assert.equal(r.platform, 'web');
});

test('parseFeedback rejects bad kind, short or long text and bad email', () => {
  assert.equal(typeof parseFeedback({ ...ok, kind: 'spam' }), 'string');
  assert.equal(typeof parseFeedback({ ...ok, message: 'hi' }), 'string');
  assert.equal(typeof parseFeedback({ ...ok, message: 'x'.repeat(FEEDBACK_MAX_MESSAGE + 1) }), 'string');
  assert.equal(typeof parseFeedback({ ...ok, contactEmail: 'nope' }), 'string');
  assert.equal(typeof parseFeedback(null), 'string');
});

test('an empty reply address is allowed and unknown platforms fall back to web', () => {
  const r = parseFeedback({ ...ok, contactEmail: '', platform: 'toaster', appVersion: 'a b' });
  assert.equal(r.contactEmail, null);
  assert.equal(r.platform, 'web');
  assert.equal(r.appVersion, null);
});

test('supportAddress only accepts a plain address', () => {
  assert.equal(supportAddress(' Help@Sipwise.trade '), 'help@sipwise.trade');
  assert.equal(supportAddress(''), null);
  assert.equal(supportAddress('javascript:alert(1)'), null);
  assert.equal(supportAddress(undefined), null);
});

test('verifyTurnstile fails closed', async () => {
  const pass = async () => Response.json({ success: true });
  const fail = async () => Response.json({ success: false });
  assert.equal(await verifyTurnstile(undefined, 'tok', null, pass), false);
  assert.equal(await verifyTurnstile('s', '', null, pass), false);
  assert.equal(await verifyTurnstile('s', 'tok', null, fail), false);
  assert.equal(await verifyTurnstile('s', 'tok', null, async () => { throw new Error('down'); }), false);
  assert.equal(await verifyTurnstile('s', 'tok', '1.2.3.4', pass), true);
});
