// Device-local switch for exposing the read-only portfolio tool to browser assistants (WebMCP). Off by default:
// decrypted holdings only leave the page for an assistant the person turned on, on this device.
const KEY = 'sipwise.webmcp';

export function webMcpEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setWebMcpEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked; the tool simply stays off.
  }
}
