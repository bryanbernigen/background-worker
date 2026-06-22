import { describe, it, expect } from 'vitest';
import { extractSessionExpiry } from './parse';

// Mirrors the real markup: sessionExpiresAt lives in HTML-escaped JSON inside
// the SessionExpirationBanner element's data-props.
const escaped =
  '<div id="SessionExpirationBanner-hybrid-root" ' +
  'data-props="{&quot;isLoggedIn&quot;:true,&quot;sessionExpiresAt&quot;:1782366605000}"></div>';

describe('extractSessionExpiry', () => {
  it('reads sessionExpiresAt from HTML-escaped data-props', () => {
    expect(extractSessionExpiry(escaped)).toBe(1782366605000);
  });

  it('reads sessionExpiresAt from unescaped JSON too', () => {
    expect(extractSessionExpiry('{"sessionExpiresAt":1782366605000}')).toBe(1782366605000);
  });

  it('tolerates whitespace around the colon', () => {
    expect(extractSessionExpiry('"sessionExpiresAt" : 123')).toBe(123);
  });

  it('returns null when the field is absent', () => {
    expect(extractSessionExpiry('<html>no banner here</html>')).toBeNull();
  });

  it('returns null when the value is not a positive number', () => {
    expect(extractSessionExpiry('"sessionExpiresAt":abc')).toBeNull();
  });
});
