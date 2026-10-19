# Fetch and cache rates for all supported currencies

Every refresh fetches rates for all Supported currencies, not just My currencies, and caches all of them. This lets a user add a currency while offline and convert with it straight away. It also keeps the rate cache independent of what the user has chosen. The cost is a slightly larger response (about 1 KB), which is negligible.

## Considered Options

- **Fetch only My currencies**: a smaller request, but adding a currency would need a connection and a new fetch. Until then the converter would have no rate for it, which breaks the offline-first promise.
