import assert from 'node:assert/strict';
import test from 'node:test';
import { UserError, publicError } from '../lib/user-error.ts';

test('user errors keep their message and default to 400', () => {
  assert.deepEqual(publicError(new UserError('Choose a valid month.')), {
    message: 'Choose a valid month.',
    status: 400,
  });
});

test('user errors carry their own status, and an explicit status wins', () => {
  assert.equal(publicError(new UserError('Sign in.', 401)).status, 401);
  assert.equal(publicError(new UserError('Stale.'), 409).status, 409);
});

test('unexpected errors are hidden behind a generic 500', () => {
  const hidden = publicError(Error('D1_ERROR: no such column payload_v2 at offset 12'));
  assert.equal(hidden.status, 500);
  assert.equal(hidden.message, 'Something went wrong. Try again.');
  assert.equal(publicError('boom').status, 500);
});

test('malformed JSON bodies get a generic 400', () => {
  let syntax;
  try {
    JSON.parse('{');
  } catch (error) {
    syntax = error;
  }
  assert.deepEqual(publicError(syntax), { message: 'Invalid request body.', status: 400 });
});
