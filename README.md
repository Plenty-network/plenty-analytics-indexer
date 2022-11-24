# Plenty Analytics Indexer

A microservices based indexer to provide analytics across Plenty's AMM.

## Steps to run

### Sample .env file

```
POSTGRES_PASSWORD=123456
POSTGRES_USER=master
POSTGRES_DB=plenty
POSTGRES_HOST=db
TZKT_URL=https://api.ghostnet.tzkt.io/v1
CONFIG_URL=<Config_Url>
TEZ_CTEZ_POOL=KT18n2zSM4zb7RYnTXq2LRzRuAAtP9E5pk11
INDEXING_START=1532402
TEZOS_RPC_URL=https://ghostnet.smartpy.io
PG_VOLUME_DIR=./postgres-data
```

### Run command

```shell
docker-compose up --build -d
```
