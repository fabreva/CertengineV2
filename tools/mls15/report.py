import json
from datetime import datetime, timezone
from pathlib import Path

import charts

REPORT_DIR = Path(__file__).resolve().parent / "reports"


def reports_folder(chain_id):
    side = "local" if str(chain_id) == "31337" else "remote"
    return REPORT_DIR / side


def row_ok(scenario, run_id, outcome, user):
    row = {
        "id": scenario["id"],
        "title": scenario["title"],
        "business": scenario["business"],
        "domain": scenario["domain"],
        "mode": scenario["mode"],
        "action": scenario["action"],
        "enabled": True,
        "leaves": scenario["leaves"],
        "runId": run_id,
        "owner": outcome["owner"],
        "user": user,
        "documentIds": outcome["documentIds"],
        "ticket": outcome["ticket"],
        "familyId": outcome.get("familyId"),
        "quantity": outcome.get("quantity"),
        "progressives": outcome.get("progressives") or scenario.get("progressives"),
        "tokenId": outcome["token"]["tokenId"],
        "balance": outcome["token"]["balance"],
        "verifyBeforeAck": outcome["verifyBeforeAck"],
        "verifyAfterAck": outcome["verifyAfterAck"],
        "setup": outcome.get("setup"),
        "durationsMs": outcome.get("durationsMs") or {},
        "deltaGasUsed": None,
        "deltaWei": None,
        "deltaEur": None,
        "deltaDurationMs": None,
        "error": "",
    }
    row.update(outcome["measured"])
    row["benchmark"] = scenario.get("benchmark") or ""
    return row


def row_error(scenario, run_id, message):
    return {
        "id": scenario["id"],
        "title": scenario["title"],
        "business": scenario["business"],
        "domain": scenario["domain"],
        "mode": scenario["mode"],
        "action": scenario["action"],
        "enabled": True,
        "leaves": scenario["leaves"],
        "runId": run_id,
        "benchmark": scenario.get("benchmark") or "",
        "error": message,
        "gasUsed": None,
        "wei": None,
        "eth": None,
        "eur": None,
        "durationsMs": {},
    }


def build(config, flight, run_id, rows):
    _apply_deltas(rows)
    chain = str(flight["chainId"])
    return {
        "chainId": chain,
        "runId": run_id,
        "local": chain == "31337",
        "network": charts.network_name(chain),
        "sender": config["sender"],
        "receiver": config["receiver"],
        "contractGasCap": config["gas_cap"],
        "contracts": {"erc1155": config["erc1155"], "erc721": config["erc721"], "sbt": config["sbt"]},
        "baselineScenario": charts.BASELINE_SCENARIO,
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "scenarios": rows,
        "aggregates": {
            "spend": _spend(rows),
            "time": _time(rows),
        },
    }


def write(report):
    folder = reports_folder(report["chainId"])
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = folder / f"gas-report-{report['chainId']}-{stamp}.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path, stamp


def _number(value):
    if value is None or value == "":
        return None
    return float(value)


def _duration(row):
    return (row.get("durationsMs") or {}).get("total")


def _unit_divisor(row):
    if row.get("action") == "serialize":
        progressives = row.get("progressives")
        if isinstance(progressives, list):
            return len(progressives)
        if isinstance(progressives, int):
            return progressives
    quantity = row.get("quantity")
    if quantity not in (None, ""):
        return int(quantity)
    leaves = row.get("leaves") or 0
    return leaves if leaves > 0 else None


def _ok(rows):
    return [row for row in rows if not row.get("error") and row.get("gasUsed") is not None]


def _apply_deltas(rows):
    base = charts.baseline_row(rows)
    if not base:
        return
    base_eur = _number(base["eur"]) or 0
    base_ms = _duration(base) or 0
    for row in rows:
        if row.get("error") or row.get("gasUsed") is None:
            continue
        row["deltaGasUsed"] = row["gasUsed"] - base["gasUsed"]
        row["deltaWei"] = row["wei"] - base["wei"]
        row["deltaEur"] = (_number(row["eur"]) or 0) - base_eur
        if _duration(row) is not None:
            row["deltaDurationMs"] = _duration(row) - base_ms


def _spend(rows):
    ok = _ok(rows)
    total_wei = sum(row["wei"] for row in ok)
    total_gas = sum(row["gasUsed"] for row in ok)
    total_eur = sum(_number(row["eur"]) or 0 for row in ok)

    def bucket(key_fn):
        grouped = {}
        for row in ok:
            key = key_fn(row)
            slot = grouped.setdefault(key, {"wei": 0, "eth": 0, "eur": 0, "gasUsed": 0, "scenarios": 0})
            slot["wei"] += row["wei"]
            slot["eth"] += row["eth"]
            slot["eur"] += _number(row["eur"]) or 0
            slot["gasUsed"] += row["gasUsed"]
            slot["scenarios"] += 1
        return grouped

    shares = []
    cumulative = []
    units = []
    cumulative_eur = 0
    cumulative_gas = 0
    for row in ok:
        eur = _number(row["eur"]) or 0
        cumulative_eur += eur
        cumulative_gas += row["gasUsed"]
        shares.append({
            "id": row["id"],
            "eurShare": (eur / total_eur * 100) if total_eur else 0,
            "gasShare": (row["gasUsed"] / total_gas * 100) if total_gas else 0,
        })
        cumulative.append({"id": row["id"], "eur": cumulative_eur, "gasUsed": cumulative_gas})
        divisor = _unit_divisor(row)
        units.append({
            "id": row["id"],
            "divisor": divisor,
            "gasPerUnit": (row["gasUsed"] / divisor) if divisor else None,
            "eurPerUnit": (eur / divisor) if divisor else None,
        })
    return {
        "totals": {"wei": total_wei, "eth": total_wei / 1e18, "eur": total_eur, "gasUsed": total_gas},
        "byMode": bucket(charts.chart_label),
        "byAction": bucket(lambda row: row["action"]),
        "byDomain": bucket(lambda row: row["domain"]),
        "shares": shares,
        "cumulative": cumulative,
        "unitCost": units,
    }


def _stats(values):
    if not values:
        return {"sum": 0, "mean": 0, "min": 0, "max": 0}
    return {
        "sum": sum(values),
        "mean": sum(values) / len(values),
        "min": min(values),
        "max": max(values),
    }


def _time(rows):
    ok = [row for row in _ok(rows) if _duration(row) is not None]
    values = [_duration(row) for row in ok]

    def bucket(key_fn):
        grouped = {}
        for row in ok:
            grouped.setdefault(key_fn(row), []).append(_duration(row))
        return {key: _stats(items) for key, items in grouped.items()}

    phases = {}
    for row in ok:
        for name, spent in (row.get("durationsMs") or {}).items():
            if name == "total" or spent is None:
                continue
            phases.setdefault(name, []).append(spent)
    cumulative = []
    running = 0
    for row in ok:
        running += _duration(row)
        cumulative.append({"id": row["id"], "durationMs": running})
    return {
        "total": _stats(values),
        "byMode": bucket(charts.chart_label),
        "byAction": bucket(lambda row: row["action"]),
        "byDomain": bucket(lambda row: row["domain"]),
        "phases": {name: {"sum": sum(items), "mean": sum(items) / len(items)} for name, items in phases.items()},
        "cumulative": cumulative,
    }


_PHASES = (
    ("requestCert", "requestCert", False),
    ("certify", "certify", True),
    ("serialize", "serialize", True),
    ("receipt", "receipt", False),
    ("download", "download", False),
    ("verify", "verify", False),
    ("ack", "ack", False),
    ("verifyAgain", "verify 2", False),
)


def format_tables(report):
    return "\n".join([
        _render("Corsa", ("id", "fase", "gas", "ms", "esito"), _run_rows(report)),
        "",
        _render("Stessa mint — gas", ("metodo", "gas", "%"), _mint_rows(report, "gas")),
        "",
        _render(
            "Stessa mint — durata fino alla receipt",
            ("metodo", "ms", "%"),
            _mint_rows(report, "time"),
        ),
    ])


def _method(row):
    return charts.chart_label(row)


def _succeeded(row):
    return not row.get("error") and row.get("gasUsed") is not None


def _run_rows(report):
    body = []
    for row in report["scenarios"]:
        if not _succeeded(row):
            body.append((row["id"], "", "", "", _one_line(row.get("error") or "errore")))
            continue
        phases = row.get("durationsMs") or {}
        gas = str(row["gasUsed"])
        written = False
        for key, label, carries_gas in _PHASES:
            spent = phases.get(key)
            if spent is None:
                continue
            body.append((
                row["id"] if not written else "",
                label,
                gas if carries_gas else "",
                str(spent),
                "ok" if not written else "",
            ))
            written = True
        if not written:
            body.append((row["id"], "", gas, "", "ok"))
    return body


def _mint_rows(report, kind):
    chosen = [row for row in report["scenarios"] if row.get("benchmark") == "same-mint"]
    ready = []
    for row in chosen:
        if not _succeeded(row):
            continue
        if kind == "gas":
            ready.append(row)
        elif (row.get("durationsMs") or {}).get("total") is not None:
            ready.append(row)
    if kind == "gas":
        total = sum(row["gasUsed"] for row in ready)
    else:
        total = sum((row.get("durationsMs") or {})["total"] for row in ready)
    body = []
    for row in chosen:
        label = _method(row)
        if row not in ready:
            body.append((label, "", ""))
            continue
        if kind == "gas":
            value = row["gasUsed"]
        else:
            value = (row.get("durationsMs") or {})["total"]
        share = (value / total * 100) if total else 0
        body.append((label, str(value), f"{share:.1f}"))
    body.append(("somma", str(total), "100.0" if total else ""))
    return body


def _one_line(message):
    return " ".join(str(message).split())


def _render(title, headers, rows):
    widths = [len(cell) for cell in headers]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def line(cells):
        return "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(cells))

    bar = "  ".join("-" * width for width in widths)
    return "\n".join([title, line(headers), bar, *[line(row) for row in rows]])
