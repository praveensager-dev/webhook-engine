import dns from 'node:dns';
import net from 'node:net';
import { env, isProd } from '../config/env.js';
import { AppError } from './AppError.js';

/**
 * SSRF protection. A webhook provider makes outbound requests to URLs that customers control,
 * so we must never let those requests reach loopback, link-local (cloud metadata), or private ranges.
 * Two layers: (1) static checks on the URL, (2) a DNS-level guard applied at connect time,
 * which also defeats DNS-rebinding because the check runs on the exact address being connected to.
 */
const blocklist = new net.BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([network, prefix]) => blocklist.addSubnet(network, prefix, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
].forEach(([network, prefix]) => blocklist.addSubnet(network, prefix, 'ipv6'));

export function isPrivateAddress(address) {
  const family = net.isIPv6(address) ? 'ipv6' : 'ipv4';
  return blocklist.check(address, family); // IPv4-mapped IPv6 addresses are matched against IPv4 rules
}

/** Validates a destination URL. Throws AppError(400) when it is not an acceptable target. */
export function assertSafeTarget(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw AppError.badRequest('URL is not valid', 'INVALID_URL');
  }

  const allowedProtocols = isProd ? ['https:'] : ['http:', 'https:'];
  if (!allowedProtocols.includes(url.protocol)) {
    throw AppError.badRequest(`Only ${allowedProtocols.join(' and ')} URLs are allowed`, 'INVALID_URL');
  }
  if (url.username || url.password) {
    throw AppError.badRequest('URLs with embedded credentials are not allowed', 'INVALID_URL');
  }

  if (!env.ALLOW_PRIVATE_TARGETS) {
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const internalName =
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal');
    if (internalName || (net.isIP(host) && isPrivateAddress(host))) {
      throw AppError.badRequest('URL points to a private or internal address', 'UNSAFE_TARGET');
    }
  }
  return url;
}

/** `dns.lookup` replacement used by the HTTP agent: rejects resolved addresses in blocked ranges. */
export function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    if (!env.ALLOW_PRIVATE_TARGETS) {
      const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address];
      const blocked = addresses.find(isPrivateAddress);
      if (blocked) return callback(new Error(`Blocked connection to private address ${blocked}`));
    }
    return callback(null, address, family);
  });
}
