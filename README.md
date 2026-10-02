# Cert Engine

Cert Engine is a microservice for blockchain-based certification of production data. It takes batches of data, anchors a cryptographic fingerprint (a Merkle root) of them onto an Ethereum-compatible blockchain through a single transaction, and later lets anyone prove that a given piece of data was certified — without revealing the data itself and without trusting the issuer's word.

It is designed to be integrated into an existing application, not used directly by end users. A company runs its own backend however it likes (with or without Docker, in any language) and calls Cert Engine over HTTP as an internal certification module: the backend submits data to be certified, starts the on-chain certification, downloads the proofs, and uses them for later verification. Cert Engine handles everything blockchain-related — Merkle tree construction, gas estimation, nonce management, transaction signing and broadcasting, proof generation and verification — so the host application does not have to.

Because each on-chain certification spends real gas from a configured wallet, Cert Engine is meant to live on an internal network, reachable only by the backend that integrates it, and is protected by a shared API key.
Cert Engine is an HTTP service that certifies batches of records on Ethereum.

The caller sends the records. The service hashes each record, builds a Merkle tree, and anchors the root on-chain. The original records are not stored: the caller keeps them and later proves them with the Merkle proof returned by the service.

Four anchor modes are available:

| `anchorMode` | What is written on-chain |
|---|---|
| `raw` | The Merkle root is the payload of a plain transaction. |
| `erc1155` | A fungible token family is minted. `quantity` is required. |
| `erc721` | A non-fungible token is minted. |
| `sbt` | A soulbound (non-transferable) token is issued. |

The service also estimates gas, reports ticket status, returns the proofs, checks a proof against the chain, and exposes usage statistics.

Default listen address: `http://127.0.0.1:5001`.

## Requirements

- Docker, with the Compose plugin
- Node.js 20, used on the host to start the stack and to deploy the contracts
- A funded Ethereum account when running against a public network

From the repository root, install the host dependencies once:

```bash
npm install
```

## Configuration files

None of these files is committed. Create them from the examples before the first start. Do not put a `.env` in the repository root: the process would read it and ignore values from the file selected below.

`docker/.env` is always required. It is an environment file read by Compose, not by the application. The application reads a different environment file depending on the mode, and the two stay separate:

| Mode | Command | Environment file | Copied from |
|---|---|---|---|
| Local (Anvil) | `npm run service:local` | `src/.env.local` | `src/env.local.example` |
| Remote (public network) | `npm run service` | `src/.env` | `src/env.remote.example` |

The names are exact. `npm run service:local` opens only `src/.env.local`. `npm run service` opens only `src/.env`. A file with another name is ignored.

`USE_VAULT` stays `"false"`. Secrets are read from that environment file. The service refuses to start if `SERVICE_API_KEY` is empty.

From the repository root:

```bash
cp docker/docker.env.example docker/.env
cp src/env.local.example src/.env.local
cp src/env.remote.example src/.env
```

On PowerShell:

```powershell
Copy-Item docker\docker.env.example docker\.env
Copy-Item src\env.local.example src\.env.local
Copy-Item src\env.remote.example src\.env
```

Copy only the file for the mode you are about to start. `src/.env.local` is not copied over `src/.env`.

### Docker passwords

In `docker/.env` set:

- `MONGO_ROOT_USER`, default `certengine`
- `MONGO_ROOT_PASSWORD`
- `REDIS_PASSWORD`

The environment file in use must use the same credentials. `MONGO_DATABASE_CONNECTION_STRING` is `mongodb://<MONGO_ROOT_USER>:<MONGO_ROOT_PASSWORD>@mongo_certengine:27017/certengine?authSource=admin`. `REDIS_HOST` is `redis_certengine` and `REDIS_PASSWORD` is the same value as in `docker/.env`. The hostnames are the container names on the Docker network, not `127.0.0.1`.

Both examples already use user `certengine`, Mongo password `mls15-mongo-local`, and Redis password `mls15-redis-local`. Put those two passwords in `docker/.env`, or change them in `docker/.env` and in the environment file together.

Local and remote share the same MongoDB and Redis containers, so both `src/.env.local` and `src/.env` must match the one `docker/.env`. If those volumes already exist from an earlier run, the passwords in the files must be the ones the volumes were created with. Editing the files later does not change a volume that is already initialized.

`CERTENGINE_BIND` can stay unset. The API is then published only on `127.0.0.1:5001`.

### Environment file `src/.env.local`

This is the environment file for the local start. The command looks for this path and this name. `src/env.local.example` is already filled for Anvil. After the copy, check:

- `CHAIN_ID` is `31337`.
- `BLOCKCHAIN_URL` is `http://anvil.local:8545`. That name is reachable from inside the application container.
- `MLS15_RPC_URL` is `http://127.0.0.1:8545`. The deploy step and the measurement program run on the host and use this URL.
- `MLS15_API_URL` is `http://127.0.0.1:5001`.
- `SERVICE_API_KEY` is already set. Callers, including the measurement program, must send that same value. Change it if you want; keep the file and the caller in agreement.
- `SENDER_ADDR`, `SENDER_PRIVKEY`, and `RECEIVER_ADDR` are the default Anvil test account. Do not reuse that key on a public network.
- `ERC1155_ADDR`, `ERC721_ADDR`, and `ERC721_SBT_ADDR` stay empty (`""`).

`ETHERSCAN_KEY` and `OWLRACLE_KEY` stay empty on Anvil.

### Environment file `src/.env`

This is the environment file for the remote start. The command looks for this path and this name, not for `src/.env.local` and not for `src/env.remote.example`. `src/env.remote.example` is only the template, and it targets Ethereum Sepolia. Before `npm run service`, fill `src/.env`:

- `SERVICE_API_KEY`. Generate one with `openssl rand -hex 32`.
- MongoDB and Redis, with the same rule as above. The example connection string still contains `mls15-mongo-local` and `mls15-redis-local`: either those are the passwords in `docker/.env`, or you replace them in this file.
- `SENDER_ADDR` and `SENDER_PRIVKEY` of an account that can pay gas.
- `RECEIVER_ADDR`, the account that receives raw transfers and minted tokens. It may be the same address as the sender.
- `BLOCKCHAIN_URL` and `MLS15_RPC_URL`, both set to the same public RPC URL.
- `OWLRACLE_KEY` when `BLOCKCHAIN_NAME` is `Ethereum-Sepolia`.
- `ETHERSCAN_KEY` instead, and `CHAIN_ID` `1`, when `BLOCKCHAIN_NAME` is `Ethereum Mainnet`.

Leave `ERC1155_ADDR`, `ERC721_ADDR`, and `ERC721_SBT_ADDR` empty on the first start.

### Contract addresses

Whichever file the start command reads, an empty contract address makes that command deploy `CertEngine1155`, `CertEngine721`, and `CertEngineSBT721` and write the three addresses back into that same file. A later start skips the deploy when all three are set. The deployer is `SENDER_ADDR`, which becomes the owner of the contracts.

## Start locally

Local mode runs MongoDB, Redis, and an Anvil node (chain id `31337`) in Docker, then the application. It reads `src/.env.local` and does not open `src/.env`. The API is published on `127.0.0.1:5001`. The Anvil RPC is published on `127.0.0.1:8545`.

`docker/.env` and `src/.env.local` must already exist, with matching MongoDB and Redis passwords. If `src/.env.local` is missing, the command stops before starting containers.

```bash
npm run service:local
```

The process is ready when the ping returns `PONG`:

```bash
curl "http://127.0.0.1:5001/api/ping?message=PING"
```

## Start on a remote network

Remote mode runs MongoDB and Redis in Docker and talks to the RPC URL in `src/.env`. It does not start Anvil. It reads `src/.env` and does not open `src/.env.local`.

`docker/.env` and `src/.env` must already exist. The sender account must be funded. The example chain is Sepolia (`11155111`).

```bash
npm run service
```

The same ping confirms that the API is up.

## Stop

On Windows:

```bash
npm run shutdown
```

From any shell, in `docker/`:

```bash
docker compose --env-file .env -f docker-compose.yaml -f docker-compose.mls15.yaml down
```

Named volumes for MongoDB, Redis, and Anvil state are kept.

## Scenario simulation

This program is not part of Cert Engine. It does not start the service, it does not sign transactions, and it never reads `SENDER_PRIVKEY`. Cert Engine does not depend on it.

The service must already be running. The program then calls the HTTP API and the RPC endpoint, runs the scenarios listed in `tools/mls15/scenarios.json` (only those with `"enabled": true`), and records gas, cost in ETH and EUR, and duration. For each certification it follows `requestCert`, `certify`, download, `verify`, `ackDownload`, and a second `verify`. A serialization scenario mints a family first, then calls `serializeErc1155`. On the local chain the gas price sent to the API is the one in `tools/mls15/local.json`. On a public network the program reads the price from `GET /api/getGasPrice`.

Python 3 is required. The only extra package is matplotlib:

```bash
py -3 -m pip install -r tools/mls15/requirements.txt
```

`local` reads `src/.env.local` and stops unless the chain id is `31337`. `remote` reads `src/.env` and stops if that file, or the node, reports chain id `31337` or `1`.

Interactive menu, after the matching service is up:

```bash
npm run py:gas:local
npm run py:gas
```

The menu is:

1. Run one scenario.
2. Run every enabled scenario.
3. Run the benchmark scenarios.
4. Print the path of the last report written in this session.
5. Exit.

The same run without the menu, every enabled scenario including the benchmark entries:

```bash
py -3 tools/mls15/certengine_sim.py local batch
py -3 tools/mls15/certengine_sim.py remote batch
```

While it runs, the terminal prints each scenario id and, when the receipt succeeds, `gasUsed` and the elapsed milliseconds. At the end it prints three tables: the run (`Corsa`), gas for the same mint (`Stessa mint — gas`), and time until the receipt (`Stessa mint — durata fino alla receipt`). Charts open on screen, except when a single scenario is started from menu entry 1.

Files are written under `tools/mls15/reports/local/` when the chain id is `31337`, and under `tools/mls15/reports/remote/` otherwise. One run produces:

- `gas-report-<chainId>-<timestamp>.json`, with one row per scenario (gas, wei, ETH, EUR, phase durations) plus aggregates
- `traces-<chainId>-<timestamp>.json`, the calls made during the run
- PNG charts in the same folder: gas, EUR, and ETH per scenario, totals by domain and by method, duration, and cumulative spend

After a successful write, older `.json`, `.png`, and `.svg` files in that same folder are deleted. Only the files of the latest run remain. A local run does not touch `reports/remote/`, and a remote run does not touch `reports/local/`.

## Calling the API

Base path: `/api`.

Every route except `GET /api/ping` and `GET /api/metrics` requires:

```http
X-API-Key: <SERVICE_API_KEY>
```

A missing or wrong key returns `401`. If the key is not configured, the service returns `503`.

Success:

```json
{
  "success": true,
  "data": {
    "message": "Operation completed successfully",
    "result": {}
  }
}
```

Error:

```json
{
  "success": false,
  "error": "message"
}
```

Unknown fields are rejected. Fees in `gasPrice` are decimal numbers in Gwei, greater than or equal to zero. `certify` and `serializeErc1155` convert them to Wei.

### Health

```bash
curl "http://127.0.0.1:5001/api/ping?message=PING"
```

`message` must be exactly `PING`. The result is `"PONG"`.

`GET /api/metrics` returns Prometheus metrics and does not require the API key.

### Open a certification

`POST /api/requestCert`

```bash
curl -X POST "http://127.0.0.1:5001/api/requestCert" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SERVICE_API_KEY" \
  -d '{
    "owner": "acme",
    "user": "operator-1",
    "hashAlgorithm": "sha256",
    "anchorMode": "raw",
    "data": [
      {
        "id": "lot-1001",
        "toBeCertified": [{ "sku": "A-1", "qty": 10 }]
      }
    ]
  }'
```

- `owner` and `user` are required strings.
- `data` is a non-empty list in practice: each item needs a string `id` and a `toBeCertified` array of objects.
- `anchorMode` is optional. Allowed values: `raw` (default), `erc1155`, `erc721`, `sbt`.
- `hashAlgorithm` is optional. For `raw` the default is `sha256`, and the allowed values are `sha256`, `sha384`, `sha512`, `sha224`, `sha3-256`, `sha3-512`. For the three token modes the default is `sha3-256`, and only `sha256` and `sha3-256` are allowed.
- `quantity` is required only for `erc1155`, as a positive integer string (`"1"`, `"20"`). It must be omitted for the other modes.

The result is the ticket id (a MongoDB ObjectId). Keep the original `toBeCertified` objects: they are required again at verification time.

For an ERC-1155 batch:

```json
{
  "owner": "acme",
  "user": "operator-1",
  "anchorMode": "erc1155",
  "quantity": "10",
  "hashAlgorithm": "sha3-256",
  "data": [
    { "id": "lot-1001", "toBeCertified": [{ "sku": "A-1" }] }
  ]
}
```

### Remove one record before certification

`DELETE /api/abortCert`

Allowed only while the ticket is still open.

```bash
curl -X DELETE "http://127.0.0.1:5001/api/abortCert?owner=acme&ticket=TICKET_ID&id=lot-1001" \
  -H "X-API-Key: $SERVICE_API_KEY"
```

`200` removes that id. `404` means the ticket does not exist. `400` means certification has already started.

### Read the suggested gas price

`GET /api/getGasPrice`

```bash
curl "http://127.0.0.1:5001/api/getGasPrice" \
  -H "X-API-Key: $SERVICE_API_KEY"
```

The result contains `baseFee`, `maxPriorityFeePerGas`, `maxFeePerGas` (Gwei), `minPriceEUR`, `maxPriceEUR`, and `estimatedTime`. Pass those three fee fields back to `certify` or `serializeErc1155`.

On Sepolia the value comes from Owlracle. On Ethereum Mainnet it comes from Etherscan. The price is cached in Redis, so a cold start can return `500` until the first successful oracle read.

### Certify the ticket

`POST /api/certify`

```bash
curl -X POST "http://127.0.0.1:5001/api/certify" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SERVICE_API_KEY" \
  -d '{
    "owner": "acme",
    "user": "operator-1",
    "ticket": "TICKET_ID",
    "gasPrice": {
      "baseFee": 1,
      "maxPriorityFeePerGas": 1,
      "maxFeePerGas": 2
    }
  }'
```

The call locks the queue, builds the Merkle tree, and submits the transaction for the mode chosen in `requestCert`.

| Status | Meaning |
|---|---|
| `200` | Transaction submitted. `result` includes `transactionHash` and, for token modes, contract and token fields. |
| `409` | Ticket missing, or certification already in progress. Also returned when the token was already minted. |
| `404` | The queue has no records left. |
| `400` | Gas is not accepted, or the ticket parameters do not match the mode. |

### Ticket status

`GET /api/getTicketStatus?owner=acme&ticket=TICKET_ID`

| `result.status` | Meaning |
|---|---|
| `Open` | Records can still be added or removed. |
| `Transacting` | Locked, transaction hash not stored yet. |
| `To be downloaded` | Certified. The proof can be downloaded. |

`404` if the ticket does not exist.

### Download the proof

`GET /api/downloadCert?owner=acme&ticket=TICKET_ID`

`200` returns:

```json
{
  "proofs": [{ "id": "lot-1001", "proof": [{ "right": "..." }] }],
  "hashAlgorithm": "sha256",
  "blockchainName": "Ethereum-Sepolia",
  "blockchainURL": "https://...",
  "transactionHash": "0x...",
  "transactionTimestamp": "2026-01-01T00:00:00.000Z"
}
```

Token certifications also return the fields that were stored, among `anchorMode`, `contractAddress`, `familyId`, `owner`, `receiver`, `tokenId`, and `quantity`.

`409` if the ticket is not certified yet. `404` if it is missing. A successful download marks the ticket as ready to be deleted.

### Drop the temporary data

`DELETE /api/ackDownload?owner=acme&ticket=TICKET_ID`

Deletes the queue and the Merkle tree after a successful download. `409` if the proof has not been downloaded. `404` if the ticket is already gone.

The on-chain record is not removed. The caller must keep the proof and the original records.

### Verify

`POST /api/verify`

`data` is the original `toBeCertified` array of one record. `proof` is the matching object from `downloadCert`. `blockchainURL` must be the same RPC endpoint configured on the service (scheme, host, and port).

Raw certification:

```bash
curl -X POST "http://127.0.0.1:5001/api/verify" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SERVICE_API_KEY" \
  -d '{
    "anchorMode": "raw",
    "hashAlgorithm": "sha256",
    "transactionHash": "0xTRANSACTION",
    "blockchainURL": "http://127.0.0.1:8545",
    "proof": [{ "right": "abcdef..." }],
    "data": [{ "sku": "A-1", "qty": 10 }]
  }'
```

For `erc1155`, `erc721`, and `sbt`, `hashAlgorithm` is required. Send also the identifiers returned by the download: `contractAddress`, and where applicable `familyId`, `progressive`, or `tokenId`.

`200` result:

```json
{
  "valid": true,
  "verified": true,
  "integrity": { "passed": true, "reason": "OK" },
  "authenticity": { "passed": true, "reason": "OK" },
  "assetConsistency": { "passed": true, "reason": "OK" }
}
```

`valid` and `verified` are true only when integrity, authenticity, and asset consistency all pass. A wrong RPC URL or a chain id that does not match the service configuration returns `400`.

### Serialize an ERC-1155 family

`POST /api/serializeErc1155`

Turns selected units of an already minted family into individual serialized tokens. `familyId` is `0x` plus 64 hex characters. `progressives` is a list of unique positive integer strings. The batch size cannot exceed `MAX_SERIALIZE_BATCH` configured at deploy time.

```bash
curl -X POST "http://127.0.0.1:5001/api/serializeErc1155" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SERVICE_API_KEY" \
  -d '{
    "owner": "acme",
    "familyId": "0xFAMILY_ID_64_HEX",
    "progressives": ["1", "2"],
    "gasPrice": {
      "baseFee": 1,
      "maxPriorityFeePerGas": 1,
      "maxFeePerGas": 2
    }
  }'
```

### Statistics

All of these require the API key.

| Method and path | Query | Result |
|---|---|---|
| `GET /api/getTransactions` | optional `owner`, `page` (default 1), `elemsPerPage` (default 5) | `{ "docs": [], "count": 0 }`, newest first |
| `GET /api/getCertificationStats` | optional `owner` | certification counts and EUR spent, grouped by year and month |
| `GET /api/getExpenses` | optional `owner` | all history entries grouped by year and month |
| `GET /api/getUsageStats` | none | totals, types, months, chains, and the top owners |

## Usual sequence

1. `POST /api/requestCert` and store the ticket id together with the original records.
2. `GET /api/getGasPrice`.
3. `POST /api/certify` with that ticket and the returned fees.
4. `GET /api/getTicketStatus` until the status is `To be downloaded`.
5. `GET /api/downloadCert` and store `proofs`, `transactionHash`, `blockchainURL`, and the token fields.
6. `POST /api/verify` with one original record and its proof.
7. `DELETE /api/ackDownload` to drop the temporary queue and tree.
