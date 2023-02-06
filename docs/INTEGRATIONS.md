# API for Token Trackers

Base URL: https://api.analytics.plenty.network

## Endpoints and Response Types

### Coingecko / CMC

- `GET` **/integrations/v1/pairs**

```typescript
Array<{
  tickerId: string;
  base: string;
  target: string;
  poolId: string;
}>;
```

- `GET` **/integrations/v1/tickers**

```typescript
Array<{
  tickerId: string;
  baseCurrency: string;
  targetCurrency: string;
  lastPrice: string;
  baseVolume: string;
  targetVolume: string;
  poolId: string;
}>;
```

### Nomic

- `GET` **/integrations/v2/tickers**

```typescript
Array<{
  market: string;
  base: string;
  quote: string;
  price_quote: string;
  volume_base: string;
}>;
```
