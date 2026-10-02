EXPECTED_EVENTS = {
    "raw": (),
    "erc721": ("CertifiedTokenMinted",),
    "sbt": ("Locked", "SoulboundIssued"),
    "erc1155": ("FamilyMinted",),
    "serialize": ("FamilySerialized",),
}

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import scenarios

LOCAL_CHAIN_ID = 31337
RECEIPT_WAIT_S = 120
RECEIPT_POLL_S = 2
LOCAL_PATH = Path(__file__).resolve().parent / "local.json"

TOPIC = {
    "FamilyMinted": "0x6391308dc8b8d4ed1b28334af66b3a5245a94c8b70f500996874a0245af30ab9",
    "FamilySerialized": "0xb35af2a99f944a1ed9d15299432aa475850135fbc29098c6d7e18fef37ef22bc",
    "CertifiedTokenMinted": "0x5b412d194ec488258a88a04f8e7775b681322ed42cb5044076aca85d8ac3ad2d",
    "Locked": "0x032bc66be43dbccb7487781d168eb7bda224628a3b2c3388bdf69b532a3a1611",
    "SoulboundIssued": "0xccdf6acd3b42ca6da092aa4401551ca2b523d01bbe83afac2617f7e3df482a0c",
}
SEL_OWNER = "0x8da5cb5b"
SEL_MAX_BATCH = "0x2b6cca2a"
SEL_BALANCE = "0x00fdd58e"
SEL_OWNER_OF = "0x6352211e"


class HttpFailure(Exception):
    def __init__(self, status, body, milliseconds):
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body
        self.milliseconds = milliseconds


class ScenarioFailure(Exception):
    pass


class Call:
    def __init__(self, status, body, milliseconds):
        self.status = status
        self.body = body
        self.milliseconds = milliseconds


def _ms(started):
    return int((time.perf_counter() - started) * 1000)


def hex_int(value):
    if isinstance(value, int):
        return value
    if value is None:
        return 0
    return int(value, 16)


def same_addr(left, right):
    return (left or "").lower().removeprefix("0x")[-40:] == (right or "").lower().removeprefix("0x")[-40:]


def pad_word(number):
    return f"{int(number):064x}"


def local_gas_price(chain_id):
    if int(chain_id) != LOCAL_CHAIN_ID:
        raise ScenarioFailure("gasPrice di local.json vale solo per la chain 31337")
    payload = json.loads(LOCAL_PATH.read_text(encoding="utf-8"))
    price = payload.get("gasPrice")
    if not isinstance(price, dict):
        raise ScenarioFailure("local.json senza gasPrice")
    for key in ("baseFee", "maxPriorityFeePerGas", "maxFeePerGas"):
        if key not in price:
            raise ScenarioFailure(f"local.json senza {key}")
    return price


class CertClient:
    def __init__(self, config):
        self.config = config
        self.traces = []

    def ping(self):
        started = time.perf_counter()
        url = self.config["api"] + "/api/ping?message=PING"
        with urllib.request.urlopen(urllib.request.Request(url), timeout=15) as response:
            body = json.loads(response.read().decode("utf-8"))
        if _result(body) != "PONG":
            raise ScenarioFailure("ping senza PONG")
        return Call(200, body, _ms(started))

    def preflight(self):
        chain = hex_int(self._rpc("eth_chainId", []))
        if chain == 1:
            raise SystemExit("chain ID 1: il client non parte")
        expected = int(self.config["chain_id"])
        if chain != expected:
            raise ScenarioFailure(f"chain ID {chain}, atteso {expected}")
        contracts = {
            "erc1155": self.config["erc1155"],
            "erc721": self.config["erc721"],
            "sbt": self.config["sbt"],
        }
        for name, address in contracts.items():
            if not address.startswith("0x"):
                raise ScenarioFailure(f"{name} assente in src/.env")
            code = self._rpc("eth_getCode", [address, "latest"])
            if code in (None, "0x", "0x0"):
                raise ScenarioFailure(f"bytecode assente su {name}")
            owner = self._owner(address)
            if not same_addr(owner, self.config["sender"]):
                raise ScenarioFailure(f"owner di {name} è {owner}")
        self.ping()
        return {"chainId": str(chain), "maxBatch": self._max_batch()}

    def request_cert(self, scenario, run_id, leaves, quantity=None):
        body = {
            "owner": scenarios.owner_for(scenario, run_id),
            "user": scenario["user"],
            "data": scenarios.documents(scenario, run_id, leaves),
            "hashAlgorithm": scenario["hashAlgorithm"],
            "anchorMode": scenario["mode"],
        }
        if quantity is not None:
            body["quantity"] = quantity
        call = self._http("POST", "/api/requestCert", body)
        ticket = _result(call.body)
        if not isinstance(ticket, str):
            raise ScenarioFailure(f"ticket non valido: {ticket!r}")
        call.body = {"ticket": ticket, "owner": body["owner"], "data": body["data"]}
        return call

    def gas_price(self):
        if int(self.config["chain_id"]) == LOCAL_CHAIN_ID:
            return local_gas_price(self.config["chain_id"])
        call = self._http("GET", "/api/getGasPrice")
        price = _result(call.body)
        if not isinstance(price, dict):
            raise ScenarioFailure("getGasPrice senza fee")
        body = {}
        for key in ("baseFee", "maxPriorityFeePerGas", "maxFeePerGas"):
            if key not in price:
                raise ScenarioFailure(f"getGasPrice senza {key}")
            body[key] = price[key]
        return body

    def certify(self, owner, ticket, user):
        return self._http("POST", "/api/certify", {
            "owner": owner,
            "user": user,
            "ticket": ticket,
            "gasPrice": self.gas_price(),
        })

    def serialize_erc1155(self, owner, family_id, progressives):
        return self._http("POST", "/api/serializeErc1155", {
            "owner": owner,
            "familyId": family_id,
            "progressives": progressives,
            "gasPrice": self.gas_price(),
        })

    def receipt(self, tx_hash, price_eur):
        started = time.perf_counter()
        deadline = time.monotonic() + RECEIPT_WAIT_S
        raw = self._rpc("eth_getTransactionReceipt", [tx_hash])
        while not raw:
            if time.monotonic() >= deadline:
                raise ScenarioFailure(f"receipt assente per {tx_hash}")
            time.sleep(RECEIPT_POLL_S)
            raw = self._rpc("eth_getTransactionReceipt", [tx_hash])
        if hex_int(raw.get("status")) != 1:
            raise ScenarioFailure(f"receipt non riuscita per {tx_hash}")
        transaction = self._rpc("eth_getTransactionByHash", [tx_hash])
        gas_used = hex_int(raw.get("gasUsed"))
        gas_limit = hex_int(transaction.get("gas"))
        if gas_used > gas_limit:
            raise ScenarioFailure(f"gasUsed {gas_used} sopra il gas limit {gas_limit}")
        price = hex_int(raw.get("effectiveGasPrice"))
        calldata = transaction.get("input") or "0x"
        body = {
            "transactionHash": tx_hash,
            "blockNumber": hex_int(raw.get("blockNumber")),
            "status": "success",
            "from": transaction.get("from"),
            "to": transaction.get("to"),
            "gasUsed": gas_used,
            "gasLimit": gas_limit,
            "effectiveGasPrice": price,
            "wei": gas_used * price,
            "eth": (gas_used * price) / 1e18,
            "eur": price_eur,
            "calldataBytes": max((len(calldata) - 2) // 2, 0),
            "selector": calldata[:10],
            "logs": len(raw.get("logs") or []),
            "events": _logs_named(raw),
            "receipt": raw,
        }
        return Call(200, body, _ms(started))

    def download_cert(self, owner, ticket):
        call = self._http("GET", "/api/downloadCert", query={"owner": owner, "ticket": ticket})
        call.body = _result(call.body)
        return call

    def verify(self, payload):
        call = self._http("POST", "/api/verify", payload)
        outcome = _result(call.body)
        call.body = outcome
        return call

    def ack_download(self, owner, ticket):
        return self._http("DELETE", "/api/ackDownload", query={"owner": owner, "ticket": ticket})

    def run_certify(self, scenario, run_id, quantity=None):
        phases = {}
        opened = time.perf_counter()
        requested = self.request_cert(scenario, run_id, scenario["leaves"], quantity)
        phases["requestCert"] = requested.milliseconds
        ticket = requested.body["ticket"]
        owner = requested.body["owner"]
        docs = requested.body["data"]
        certified_call = self.certify(owner, ticket, scenario["user"])
        phases["certify"] = certified_call.milliseconds
        certified = _result(certified_call.body)
        tx_hash = certified.get("transactionHash")
        if not tx_hash:
            raise ScenarioFailure("certify senza transactionHash")
        measured_call = self.receipt(tx_hash, certified.get("priceEUR"))
        phases["receipt"] = measured_call.milliseconds
        phases["total"] = _ms(opened)
        token = self._assert_token(scenario, measured_call.body, certified)
        downloaded, before, after, close_phases = self._close_ticket(owner, ticket, docs)
        phases.update(close_phases)
        return _outcome(measured_call.body, token, ticket, owner, docs, certified, before, after, None, phases, quantity)

    def run_serialize(self, scenario, run_id, count):
        setup = {
            "id": scenario["id"] + "-setup",
            "mode": "erc1155",
            "action": "mint",
            "leaves": 1,
            "quantity": str(count),
            "domain": scenario.get("domain"),
            "title": scenario.get("title"),
            "business": scenario.get("business"),
            "user": scenario["user"],
            "owner": scenario["owner"],
            "hashAlgorithm": scenario["hashAlgorithm"],
        }
        requested = self.request_cert(setup, run_id, 1, str(count))
        ticket = requested.body["ticket"]
        owner = requested.body["owner"]
        docs = requested.body["data"]
        certified = _result(self.certify(owner, ticket, scenario["user"]).body)
        setup_hash = certified.get("transactionHash")
        if not setup_hash:
            raise ScenarioFailure("mint di setup senza transactionHash")
        setup_measured = self.receipt(setup_hash, certified.get("priceEUR")).body
        self._assert_token(setup, setup_measured, certified)
        _downloaded, before, after, _phases = self._close_ticket(owner, ticket, docs)
        family_id = certified.get("familyId")
        if not family_id:
            raise ScenarioFailure("mint di setup senza familyId")
        progressives = [str(index) for index in range(1, count + 1)]
        opened = time.perf_counter()
        serialized_call = self.serialize_erc1155(owner, family_id, progressives)
        serialized = _result(serialized_call.body)
        tx_hash = serialized.get("transactionHash")
        if not tx_hash:
            raise ScenarioFailure("serialize senza transactionHash")
        measured_call = self.receipt(tx_hash, serialized.get("priceEUR"))
        phases = {
            "serialize": serialized_call.milliseconds,
            "receipt": measured_call.milliseconds,
            "total": _ms(opened),
        }
        token = self._assert_token(scenario, measured_call.body, serialized)
        outcome = _outcome(
            measured_call.body, token, None, owner, docs, serialized,
            [], [], progressives, phases, str(count),
        )
        outcome["familyId"] = family_id
        outcome["setup"] = {
            "transactionHash": setup_hash,
            "familyId": family_id,
            "gasUsed": setup_measured["gasUsed"],
            "verifyBeforeAck": _verify_summary(before),
            "verifyAfterAck": _verify_summary(after),
        }
        return outcome

    def _close_ticket(self, owner, ticket, docs):
        downloaded_call = self.download_cert(owner, ticket)
        downloaded = downloaded_call.body
        payloads = _verify_payloads(downloaded, docs)
        before, verify_ms = self._check_verify(payloads, "prima dell'ack")
        ack_call = self.ack_download(owner, ticket)
        after, again_ms = self._check_verify(payloads, "dopo l'ack")
        return downloaded, before, after, {
            "download": downloaded_call.milliseconds,
            "verify": verify_ms,
            "ack": ack_call.milliseconds,
            "verifyAgain": again_ms,
        }

    def _check_verify(self, payloads, when):
        outcomes = []
        spent = 0
        for payload in payloads:
            call = self.verify(payload)
            spent += call.milliseconds
            outcomes.append(call.body)
            if not call.body.get("valid"):
                raise ScenarioFailure(f"verify {when} non valida: {json.dumps(call.body)}")
        return outcomes, spent

    def _assert_token(self, scenario, measured, certified):
        mode = scenario["mode"]
        receiver = self.config["receiver"]
        receipt = measured["receipt"]
        _require_events(scenario, receipt)
        if mode == "raw":
            if not same_addr(measured["to"], receiver):
                raise ScenarioFailure(f"to raw {measured['to']} diverso da {receiver}")
            return {"balance": None, "tokenId": None}
        expected = {"erc721": self.config["erc721"], "sbt": self.config["sbt"], "erc1155": self.config["erc1155"]}[mode]
        if not same_addr(measured["to"], expected):
            raise ScenarioFailure(f"to {measured['to']} diverso dal contratto atteso")
        if mode == "erc721":
            events = _logs_with(receipt, "CertifiedTokenMinted")
            _holder(events[0], receiver)
            token_id = int(events[0]["topics"][3], 16)
            if not same_addr(self._token_owner(measured["to"], token_id), receiver):
                raise ScenarioFailure("ownerOf non è RECEIVER_ADDR")
            return {"balance": 1, "tokenId": str(token_id)}
        if mode == "sbt":
            issued = _logs_with(receipt, "SoulboundIssued")[0]
            _holder(issued, receiver)
            token_id = int(issued["topics"][3], 16)
            if not same_addr(self._token_owner(measured["to"], token_id), receiver):
                raise ScenarioFailure("ownerOf SBT non è RECEIVER_ADDR")
            return {"balance": 1, "tokenId": str(token_id)}
        if scenario["action"] == "serialize":
            events = _logs_with(receipt, "FamilySerialized")
            _holder(events[0], receiver)
            _progressives, token_ids = _decode_two_uint_arrays(events[0].get("data") or "0x")
            for token_id in token_ids:
                if self._balance(receiver, token_id) < 1:
                    raise ScenarioFailure(f"saldo nullo per il token {token_id}")
            return {"balance": 1, "tokenId": [str(item) for item in token_ids]}
        events = _logs_with(receipt, "FamilyMinted")
        _holder(events[0], receiver)
        token_id = int(events[0]["topics"][3], 16)
        balance = self._balance(receiver, token_id)
        expected_qty = int(scenario.get("quantity") or certified.get("quantity") or "0")
        if balance < expected_qty:
            raise ScenarioFailure(f"balanceOf {balance} sotto la quantity {expected_qty}")
        return {"balance": balance, "tokenId": str(token_id)}

    def _http(self, method, path, body=None, query=None):
        started = time.perf_counter()
        url = self.config["api"] + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"X-API-Key": self.config["api_key"], "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                raw = response.read().decode("utf-8")
                status = response.status
        except urllib.error.HTTPError as error:
            raw_error = error.read().decode("utf-8", errors="replace")
            self.traces.append({
                "method": method,
                "url": url,
                "request": body if body is not None else query,
                "status": error.code,
                "response": raw_error,
            })
            raise HttpFailure(error.code, raw_error, _ms(started)) from error
        except urllib.error.URLError as error:
            raise ScenarioFailure(f"API non raggiungibile: {error.reason}") from error
        parsed = json.loads(raw) if raw else {}
        self.traces.append({
            "method": method,
            "url": url,
            "request": body if body is not None else query,
            "status": status,
            "response": parsed,
        })
        if status != 200:
            raise HttpFailure(status, raw, _ms(started))
        return Call(status, parsed, _ms(started))

    def _rpc(self, method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode("utf-8")
        request = urllib.request.Request(
            self.config["rpc"],
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "certengine"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            parsed = json.loads(response.read().decode("utf-8"))
        if parsed.get("error"):
            raise ScenarioFailure(json.dumps(parsed["error"]))
        return parsed.get("result")

    def _owner(self, contract):
        return "0x" + self._view(contract, SEL_OWNER)[-40:]

    def _max_batch(self):
        return int(self._view(self.config["erc1155"], SEL_MAX_BATCH), 16)

    def _balance(self, holder, token_id):
        data = SEL_BALANCE + pad_word(int(holder, 16)) + pad_word(token_id)
        return int(self._view(self.config["erc1155"], data), 16)

    def _token_owner(self, contract, token_id):
        return "0x" + self._view(contract, SEL_OWNER_OF + pad_word(token_id))[-40:]

    def _view(self, contract, data):
        result = self._rpc("eth_call", [{"to": contract, "data": data}, "latest"])
        if not isinstance(result, str) or result in ("0x", "0x0"):
            raise ScenarioFailure(f"eth_call vuota su {contract}")
        return result


def _result(payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or "result" not in data:
        raise ScenarioFailure("risposta senza data.result")
    return data["result"]


def _verify_payloads(downloaded, docs):
    proofs = downloaded.get("proofs") or []
    if not proofs:
        raise ScenarioFailure("download senza proof")
    by_id = {item["id"]: item["toBeCertified"] for item in docs}
    payloads = []
    for leaf in proofs:
        if leaf["id"] not in by_id:
            raise ScenarioFailure(f"proof id {leaf['id']} assente nei dati inviati")
        body = {
            "proof": leaf["proof"],
            "transactionHash": downloaded["transactionHash"],
            "data": by_id[leaf["id"]],
            "blockchainURL": downloaded["blockchainURL"],
            "hashAlgorithm": downloaded["hashAlgorithm"],
        }
        for key in ("anchorMode", "contractAddress", "familyId", "tokenId"):
            if downloaded.get(key) not in (None, ""):
                body[key] = str(downloaded[key]) if key == "tokenId" else downloaded[key]
        payloads.append(body)
    return payloads


def _logs_named(receipt):
    found = []
    for entry in receipt.get("logs") or []:
        topic = ((entry.get("topics") or [""])[0]).lower()
        for name, value in TOPIC.items():
            if topic == value.lower():
                found.append(name)
    return found


def _logs_with(receipt, name):
    topic = TOPIC[name].lower()
    return [entry for entry in receipt.get("logs") or [] if (entry.get("topics") or [""])[0].lower() == topic]


def _require_events(scenario, receipt):
    key = "serialize" if scenario.get("action") == "serialize" else scenario["mode"]
    expected = EXPECTED_EVENTS[key]
    found = set(_logs_named(receipt))
    missing = [name for name in expected if name not in found]
    if missing:
        raise ScenarioFailure("mancano gli eventi " + ", ".join(missing))


def _holder(entry, receiver):
    topics = entry.get("topics") or []
    if len(topics) < 2 or not same_addr(topics[1], receiver):
        raise ScenarioFailure("l'evento non ha il destinatario RECEIVER_ADDR")


def _decode_two_uint_arrays(data_hex):
    raw = data_hex[2:] if str(data_hex).startswith("0x") else data_hex
    words = [raw[i:i + 64] for i in range(0, len(raw), 64)]

    def read_array(offset_bytes):
        index = offset_bytes // 32
        count = int(words[index], 16)
        return [int(words[index + 1 + i], 16) for i in range(count)]

    return read_array(int(words[0], 16)), read_array(int(words[1], 16))


def _verify_summary(outcomes):
    if not outcomes:
        return {"valid": None, "reason": ""}
    first = outcomes[0]
    return {
        "valid": all(item.get("valid") for item in outcomes),
        "leavesChecked": len(outcomes),
        "reason": (first.get("integrity") or {}).get("reason", ""),
    }


def _outcome(measured, token, ticket, owner, docs, certified, before, after, progressives, phases, quantity):
    public = dict(measured)
    public.pop("receipt", None)
    return {
        "measured": public,
        "token": token,
        "ticket": ticket,
        "owner": owner,
        "documentIds": [item["id"] for item in docs],
        "familyId": certified.get("familyId"),
        "quantity": certified.get("quantity") or quantity,
        "progressives": progressives,
        "verifyBeforeAck": _verify_summary(before),
        "verifyAfterAck": _verify_summary(after),
        "setup": None,
        "durationsMs": phases,
    }
