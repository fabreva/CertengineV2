from pathlib import Path

import matplotlib.pyplot as plt

CHART_LABELS = {
    "raw": "raw",
    "erc721": "erc-721",
    "sbt": "sbt",
    "erc1155": "mint erc-1155",
    "serialize": "serialize erc-1155",
}

BASELINE_SCENARIO = "fattura-singola"

REPORT_DIR = Path(__file__).resolve().parent / "reports"


def reports_folder(chain_id):
    side = "local" if str(chain_id) == "31337" else "remote"
    return REPORT_DIR / side


def network_name(chain_id):
    chain = str(chain_id)
    if chain == "31337":
        return "Locale"
    if chain == "11155111":
        return "Sepolia"
    if chain == "1":
        return "Ethereum"
    return chain


def _with_network(title, network):
    return title + " - " + network


def write_charts(report, stamp):
    chain = report["chainId"]
    network = network_name(chain)

    def titled(text):
        return _with_network(text, network)
    folder = reports_folder(chain)
    folder.mkdir(parents=True, exist_ok=True)
    rows = [row for row in report["scenarios"] if not row.get("error") and row.get("gasUsed") is not None]
    labels = [row["title"] for row in rows]
    spend = report["aggregates"]["spend"]
    timing = report["aggregates"]["time"]
    paths = []

    def path_for(name):
        return folder / f"{name}-{chain}-{stamp}.png"

    paths.append(gas_by_scenario(
        path_for("gas-used"),
        labels,
        [row["gasUsed"] for row in rows],
        [_number(row["eur"]) or 0 for row in rows],
        [row["eth"] for row in rows],
        titled("Gas, euro ed ETH per scenario"),
    ))
    paths.append(eur_by_scenario(path_for("cost-eur"), labels, [_number(row["eur"]) or 0 for row in rows], titled("Spesa in euro per scenario")))
    paths.append(_barh(path_for("cost-eth"), titled("Spesa in ETH per scenario"), labels, [row["eth"] for row in rows], "ETH"))

    domains = spend["byDomain"]
    domain_names = list(domains)
    paths.append(_barh(path_for("gas-by-domain"), titled("Gas sommato per ambito"), domain_names, [domains[name]["gasUsed"] for name in domain_names], "gas"))
    paths.append(_barh(path_for("cost-eur-by-domain"), titled("Euro per ambito"), domain_names, [domains[name]["eur"] for name in domain_names], "EUR"))

    modes = spend["byMode"]
    mode_names = list(modes)
    paths.append(_barh(path_for("gas-by-mode"), titled("Gas per metodo"), mode_names, [modes[name]["gasUsed"] for name in mode_names], "gas"))
    paths.append(_barh(path_for("cost-eur-by-mode"), titled("Euro per metodo"), mode_names, [modes[name]["eur"] for name in mode_names], "EUR"))
    _maybe_pie(paths, path_for("gas-by-mode-pie"), titled("Quota di gas per metodo"), mode_names, [modes[name]["gasUsed"] for name in mode_names])
    _maybe_pie(paths, path_for("cost-eur-by-mode-pie"), titled("Quota di euro per metodo"), mode_names, [modes[name]["eur"] for name in mode_names])

    serialized = [row for row in rows if row.get("action") == "serialize"]
    _maybe_pie(
        paths,
        path_for("serialize-gas-pie"),
        titled("Costi per serializzazione su erc-1155"),
        [row["title"] for row in serialized],
        [row["gasUsed"] for row in serialized],
    )

    cumulative = spend["cumulative"]
    paths.append(_panels(
        path_for("cost-cumulative"),
        titled("Spesa cumulata: euro e gas su pannelli distinti"),
        [item["id"] for item in cumulative],
        [item["eur"] for item in cumulative],
        [item["gasUsed"] for item in cumulative],
        "EUR cumulati",
        "gas cumulato",
    ))

    paths.append(duration_by_scenario(
        path_for("duration-by-scenario"),
        labels,
        [(row.get("durationsMs") or {}).get("total") or 0 for row in rows],
        titled("Durata totale per scenario"),
    ))
    time_modes = timing["byMode"]
    time_names = list(time_modes)
    paths.append(duration_by_mode(
        path_for("duration-by-mode"),
        time_names,
        [time_modes[name]["mean"] for name in time_names],
        titled("Durata media per metodo"),
    ))
    time_cumulative = timing["cumulative"]
    paths.append(duration_cumulative(
        path_for("duration-cumulative"),
        [item["id"] for item in time_cumulative],
        [item["durationMs"] for item in time_cumulative],
        titled("Durata cumulata nell'ordine di esecuzione"),
    ))
    phases = timing["phases"]
    paths.append(duration_by_phase(
        path_for("duration-by-phase"),
        list(phases),
        [phases[name]["sum"] for name in phases],
        titled("Tempo sommato per fase"),
    ))

    mint = _same_mint(report)
    mint_labels = [chart_label(row) for row in mint]
    _maybe_pie(
        paths,
        path_for("gas-same-mint-pie"),
        titled("Quota di gas della stessa mint"),
        mint_labels,
        [row["gasUsed"] for row in mint],
    )
    _maybe_pie(
        paths,
        path_for("duration-same-mint-pie"),
        titled("Quota di durata della stessa mint"),
        mint_labels,
        [(row.get("durationsMs") or {}).get("total") or 0 for row in mint],
    )
    _charts_vs_baseline(paths, path_for, rows, titled)
    return paths


def show():
    plt.show()


def _same_mint(report):
    return [
        row for row in report["scenarios"]
        if row.get("benchmark") == "same-mint" and not row.get("error") and row.get("gasUsed") is not None
    ]


def baseline_row(rows):
    return next((
        row for row in rows
        if row.get("id") == BASELINE_SCENARIO
        and not row.get("error")
        and row.get("gasUsed") is not None
    ), None)


def _charts_vs_baseline(paths, path_for, rows, titled):
    if baseline_row(rows) is None:
        return
    compared = [row for row in rows if row.get("deltaGasUsed") is not None]
    if not compared:
        return
    paths.append(_panels(
        path_for("cost-delta-baseline"),
        titled("Scostamento dalla fattura singola: euro e gas su pannelli distinti"),
        [row["id"] for row in compared],
        [row["deltaEur"] for row in compared],
        [row["deltaGasUsed"] for row in compared],
        "EUR rispetto alla baseline",
        "gas rispetto alla baseline",
    ))


def chart_label(row):
    key = "serialize" if row.get("action") == "serialize" else row["mode"]
    return CHART_LABELS[key]


def gas_by_scenario(path, labels, gas, eur, eth, title):
    height = max(4.5, 0.32 * max(len(labels), 1) + 1.8)
    fig, axes = plt.subplots(1, 3, figsize=(16, height), sharey=True)
    names = list(reversed(labels))
    panels = (
        (list(reversed(gas)), "gas", "Gas"),
        (list(reversed(eur)), "EUR", "Euro"),
        (list(reversed(eth)), "ETH", "ETH"),
    )
    for ax, (values, xlabel, panel) in zip(axes, panels):
        ax.barh(names, values, color="#1d4ed8")
        ax.set_xlabel(xlabel)
        ax.set_title(panel)
    axes[0].set_ylabel("scenario")
    fig.suptitle(title)
    return _save(fig, path)


def eur_by_scenario(path, labels, values, title):
    return _barh(path, title, labels, values, "EUR")


def duration_by_scenario(path, labels, values, title):
    return _barh(path, title, labels, values, "millisecondi")


def duration_by_mode(path, labels, values, title):
    return _barh(path, title, labels, values, "millisecondi")


def duration_cumulative(path, labels, values, title):
    fig, ax = plt.subplots(figsize=(12, 5))
    ax.plot(range(len(labels)), values, marker="o", color="#0f766e")
    ax.set_ylabel("millisecondi cumulati")
    ax.set_xticks(list(range(len(labels))))
    ax.set_xticklabels(labels, rotation=70, ha="right")
    ax.set_title(title)
    return _save(fig, path)


def duration_by_phase(path, labels, values, title):
    return _barh(path, title, labels, values, "millisecondi")


def _barh(path, title, labels, values, xlabel):
    height = max(4.5, 0.38 * max(len(labels), 1) + 1.4)
    fig, ax = plt.subplots(figsize=(11, height))
    ax.barh(list(reversed(labels)), list(reversed(values)), color="#1d4ed8")
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    return _save(fig, path)


def _panels(path, title, labels, left, right, left_name, right_name):
    fig, axes = plt.subplots(2, 1, figsize=(12, 8), sharex=True)
    x = range(len(labels))
    axes[0].plot(x, left, marker="o", color="#b45309")
    axes[1].plot(x, right, marker="o", color="#1d4ed8")
    axes[0].set_ylabel(left_name)
    axes[1].set_ylabel(right_name)
    axes[1].set_xticks(list(x))
    axes[1].set_xticklabels(labels, rotation=70, ha="right")
    fig.suptitle(title)
    return _save(fig, path)


def _maybe_pie(paths, path, title, labels, values):
    usable = [(label, value) for label, value in zip(labels, values) if value and value > 0]
    if not (2 <= len(usable) <= 8):
        return
    fig, ax = plt.subplots(figsize=(8, 6))
    wedges, _texts, autotexts = ax.pie(
        [value for _label, value in usable],
        startangle=90,
        autopct="%1.1f%%",
    )
    ax.legend(wedges, [label for label, _value in usable], loc="center left", bbox_to_anchor=(1, 0.5))
    ax.set_title(title)
    for text in autotexts:
        text.set_fontsize(9)
    paths.append(_save(fig, path))


def _number(value):
    if value is None or value == "":
        return None
    return float(value)


def _save(fig, path):
    fig.tight_layout()
    fig.savefig(path, dpi=140, bbox_inches="tight")
    return path
