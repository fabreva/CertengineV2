import json
import os
import sys
from pathlib import Path

import charts
import client
import report
import scenarios

ROOT = Path(__file__).resolve().parents[2]


def load_env(path):
    values = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.endswith("PRIVKEY"):
            continue
        value = value.strip()
        if " #" in value:
            value = value.split(" #", 1)[0].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def load_config(profile):
    name = ".env.local" if profile == "local" else ".env"
    chosen = ROOT / "src" / name
    file_env = load_env(chosen)

    def setting(key, default=""):
        if key.endswith("PRIVKEY"):
            return ""
        if os.environ.get(key):
            return os.environ[key]
        return file_env.get(key, default)

    api = setting("MLS15_API_URL")
    rpc_url = setting("MLS15_RPC_URL")
    chain_id = setting("CHAIN_ID")
    if not api or not rpc_url or not chain_id:
        raise client.ScenarioFailure(f"MLS15_API_URL, MLS15_RPC_URL e CHAIN_ID devono stare in {chosen.name}")
    local_chain = str(client.LOCAL_CHAIN_ID)
    if profile == "local" and chain_id != local_chain:
        raise client.ScenarioFailure(f"{name}: chain ID {chain_id}, atteso {local_chain}")
    if profile == "remote" and chain_id == local_chain:
        raise client.ScenarioFailure(f"{name}: chain ID {chain_id} è la rete locale")
    return {
        "api": api.rstrip("/"),
        "rpc": rpc_url.rstrip("/"),
        "chain_id": chain_id,
        "api_key": setting("SERVICE_API_KEY"),
        "sender": setting("SENDER_ADDR"),
        "receiver": setting("RECEIVER_ADDR"),
        "erc1155": setting("ERC1155_ADDR"),
        "erc721": setting("ERC721_ADDR"),
        "sbt": setting("ERC721_SBT_ADDR"),
        "gas_cap": setting("CONTRACT_GAS_CAP"),
    }


def execute_many(api, chosen, run_id, flight):
    rows = []
    for scenario in chosen:
        print(f"\n--- {scenario['id']} ---", flush=True)
        try:
            if scenario["action"] == "serialize":
                count = _progressive_count(scenario, flight["maxBatch"])
                outcome = api.run_serialize(scenario, run_id, count)
            else:
                outcome = api.run_certify(scenario, run_id, scenario.get("quantity"))
            row = report.row_ok(scenario, run_id, outcome, scenario["user"])
            print(f"{row['id']} receipt ok gasUsed={row['gasUsed']} ms={row['durationsMs'].get('total')}")
        except client.HttpFailure as error:
            print(error.body)
            row = report.row_error(scenario, run_id, str(error))
            print(row["error"])
        except client.ScenarioFailure as error:
            row = report.row_error(scenario, run_id, str(error))
            print(row["error"])
        rows.append(row)
    return report.build(api.config, flight, run_id, rows)


def finish(built, traces=None, show_charts=True):
    path, stamp = report.write(built)
    drawn = charts.write_charts(built, stamp)
    trace_path = None
    if traces is not None:
        trace_path = path.with_name(path.name.replace("gas-report-", "traces-"))
        trace_path.write_text(json.dumps(traces, indent=2) + "\n", encoding="utf-8")
    _purge_previous(path.parent, [path, *drawn] + ([trace_path] if trace_path else []))
    print(f"\nReport: {path}")
    for chart in drawn:
        print(chart)
    print()
    print(report.format_tables(built))
    if show_charts:
        charts.show()
    return path, drawn


def main(argv):
    if not argv or argv[0] not in ("local", "remote"):
        print("Uso: py -3 tools/mls15/certengine_sim.py local|remote [batch]", file=sys.stderr)
        return 1
    profile = argv[0]
    batch = len(argv) == 2 and argv[1] == "batch"
    if len(argv) > 2 or (len(argv) == 2 and not batch):
        print("Uso: py -3 tools/mls15/certengine_sim.py local|remote [batch]", file=sys.stderr)
        return 1
    try:
        config = load_config(profile)
    except client.ScenarioFailure as error:
        print(error, file=sys.stderr)
        return 1
    if not config["api_key"]:
        print("SERVICE_API_KEY assente", file=sys.stderr)
        return 1
    enabled, _catalog = scenarios.load()
    run_id = scenarios.run_id_now()
    api = client.CertClient(config)
    if not batch:
        return _menu(api, enabled, run_id)
    try:
        flight = api.preflight()
    except client.ScenarioFailure as error:
        print(error, file=sys.stderr)
        return 1
    except SystemExit as error:
        print(error, file=sys.stderr)
        return 1
    built = execute_many(api, enabled, run_id, flight)
    finish(built, api.traces)
    failed = [row["id"] for row in built["scenarios"] if row.get("error")]
    return 1 if failed else 0


def _menu(api, enabled, run_id):
    flight = {"chainId": "?", "maxBatch": 0, "error": ""}
    last_report = None
    try:
        flight.update(api.preflight())
    except client.ScenarioFailure as error:
        flight["error"] = str(error)
    except SystemExit as error:
        print(error)
        return 1
    while True:
        print(f"\nchainId {flight['chainId']}  runId {run_id}")
        print(f"preflight: {flight['error'] or 'ping, bytecode e owner ok'}")
        print("1 Eseguire uno scenario")
        print("2 Eseguire tutti gli scenari abilitati")
        print("3 Esegui benchmark")
        print("4 Stampare il percorso dell'ultimo report")
        print("5 Uscire")
        choice = input("> ").strip()
        if choice == "1":
            for scenario in enabled:
                print(f"  {scenario['id']}  {scenario['title']}")
            scenario_id = input("Id scenario: ").strip()
            scenario = next((item for item in enabled if item["id"] == scenario_id), None)
            if scenario is None:
                print("Scenario sconosciuto")
                continue
            if flight.get("error"):
                print(flight["error"])
                continue
            built = execute_many(api, [scenario], scenarios.run_id_now(), flight)
            last_report, _charts = finish(built, api.traces, show_charts=False)
        elif choice == "2":
            if flight.get("error"):
                print(flight["error"])
                continue
            built = execute_many(api, enabled, run_id, flight)
            last_report, _charts = finish(built, api.traces)
        elif choice == "3":
            if flight.get("error"):
                print(flight["error"])
                continue
            chosen = _with_benchmark(enabled)
            if not chosen:
                print("Nessuno scenario di benchmark")
                continue
            built = execute_many(api, chosen, scenarios.run_id_now(), flight)
            last_report, _charts = finish(built, api.traces)
        elif choice == "4":
            print(last_report or "Nessun report in questa sessione")
        elif choice == "5":
            return 0
        else:
            print("Voce non valida")


def _with_benchmark(enabled):
    return [item for item in enabled if item.get("benchmark")]


def _progressive_count(scenario, max_batch):
    raw = scenario.get("progressives")
    if raw == "max":
        return max_batch
    if isinstance(raw, int):
        return raw
    return int(raw)


def _purge_previous(folder, keep):
    if not folder.is_dir():
        return
    kept = {path.resolve() for path in keep}
    for path in folder.iterdir():
        if path.resolve() in kept:
            continue
        if path.suffix.lower() in {".png", ".svg", ".json"}:
            path.unlink()
