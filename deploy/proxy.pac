function FindProxyForURL(url, host) {
  if (shExpMatch(host, "*.co.il") || shExpMatch(host, "*.gov.il")) {
    return "SOCKS5 host.docker.internal:1080";
  }
  return "DIRECT";
}
