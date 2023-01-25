# API for Token Trackers

Base URL: https://api.analytics.plenty.network

## Endpoints and Response Types

- `GET` **/tracker/tokens**

```typescript
Array<{
  name: string;
  symbol: string;
  contract?: string; // Does not show up for XTZ
  standard: string;
  tokenId?: number;
  price: {
    value: string;
    change24H: string;
  };
  volume: {
    value24H: string;
    change24H: string;
  };
  tvl: {
    value: string;
    change24H: string;
  };
  pairs: {
    symbol: string;
    contract: string;
    exchangeLink: string;
    price: {
      value: string;
      change24H: string;
    };
    volume: {
      value24H: string;
      change24H: string;
    };
    tvl: {
      value: string;
      change24H: string;
    };
  }[];
}>;
```

- `GET` **/tracker/tokens/<tokenSymbol>**

```typescript
{
  name: string;
  symbol: string;
  contract?: string; // Does not show up for XTZ
  standard: string;
  tokenId?: number;
  price: {
    value: string;
    change24H: string;
    history: { [dailyUTCTimestamp: string]: { o: string, h: string, l: string, c: string } }[];
  };
  volume: {
    value24H: string;
    change24H: string;
  };
  tvl: {
    value: string;
    change24H: string;
  };
  pairs: {
    symbol: string;
    contract: string;
    exchangeLink: string;
    price: {
      value: string;
      change24H: string;
    };
    volume: {
      value24H: string;
      change24H: string;
    };
    tvl: {
      value: string;
      change24H: string;
    };
  }[];
}
```
