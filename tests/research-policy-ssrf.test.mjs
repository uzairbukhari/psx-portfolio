import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateOrLocalHost } from '../lib/research-policy.mjs';

/** Hostname as the proxy route sees it, after WHATWG URL normalization. */
const host = (url) => new URL(url).hostname;

test('blocks loopback, private and link-local IPv4 ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '0.0.0.0', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1'])
    assert.equal(isPrivateOrLocalHost(ip), true, ip);
});

test('blocks carrier-grade NAT, benchmarking, multicast, reserved and broadcast IPv4', () => {
  for (const ip of ['100.64.0.1', '100.127.255.254', '198.18.0.1', '198.19.255.255', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255'])
    assert.equal(isPrivateOrLocalHost(ip), true, ip);
});

test('allows public IPv4 next to the blocked ranges', () => {
  for (const ip of ['100.63.255.255', '100.128.0.1', '198.17.0.1', '198.20.0.1', '172.32.0.1', '8.8.8.8', '223.255.255.255'])
    assert.equal(isPrivateOrLocalHost(ip), false, ip);
});

test('blocks IPv4 written in alternate forms once the URL parser normalizes it', () => {
  assert.equal(isPrivateOrLocalHost(host('http://2130706433/')), true);
  assert.equal(isPrivateOrLocalHost(host('http://0x7f.1/')), true);
});

test('blocks IPv4-mapped and other special IPv6 literals', () => {
  assert.equal(isPrivateOrLocalHost('[::ffff:7f00:1]'), true);
  assert.equal(isPrivateOrLocalHost(host('http://[::ffff:127.0.0.1]/')), true);
  assert.equal(isPrivateOrLocalHost(host('http://[::ffff:8.8.8.8]/')), true);
  for (const ip of ['[::1]', '[::]', '[fe80::1]', '[fc00::1]', '[fd12:3456::1]', '[ff02::1]'])
    assert.equal(isPrivateOrLocalHost(ip), true, ip);
});

test('allows public IPv6 literals', () => {
  assert.equal(isPrivateOrLocalHost('[2606:4700:4700::1111]'), false);
});

test('fc/fd prefix applies only to IPv6 literals, not domain names', () => {
  assert.equal(isPrivateOrLocalHost('fdc.com.pk'), false);
  assert.equal(isPrivateOrLocalHost('fccl.com.pk'), false);
  assert.equal(isPrivateOrLocalHost('localhost'), true);
  assert.equal(isPrivateOrLocalHost('api.localhost'), true);
});
