import json
from datetime import datetime
from pathlib import Path

SCENARIO_PATH = Path(__file__).resolve().parent / "scenarios.json"


def load():
    payload = json.loads(SCENARIO_PATH.read_text(encoding="utf-8"))
    catalog = payload["scenarios"]
    enabled = [item for item in catalog if item.get("enabled")]
    return enabled, catalog


def run_id_now():
    return "mls15-" + datetime.now().strftime("%Y%m%d%H%M%S")


def documents(scenario, run_id, leaves):
    docs = []
    for index in range(1, leaves + 1):
        docs.append({
            "id": f"mls15-doc-{scenario['id']}-{index}-{run_id}",
            "toBeCertified": [{
                "campo": "mls15",
                "scenario": scenario["id"],
                "n": str(index),
                "runId": run_id,
            }],
        })
    return docs


def owner_for(scenario, run_id):
    return f"{scenario['owner']}-{run_id}"
