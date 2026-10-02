"use strict";

const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");
const axios = require("axios");

const root = path.join(__dirname, "..");
const dockerDir = path.join(root, "docker");
const ADDRESS_KEYS = [
    ["ERC1155_ADDR", "erc1155"],
    ["ERC721_ADDR", "erc721"],
    ["ERC721_SBT_ADDR", "sbt"],
];

const PROFILES = {
    local: {
        file: path.join(root, "src", ".env.local"),
        composeEnv: "../src/.env.local",
        services: ["mongo_certengine", "redis_certengine", "anvil_certengine"],
        network: "mls15",
    },
    remote: {
        file: path.join(root, "src", ".env"),
        composeEnv: "../src/.env",
        services: ["mongo_certengine", "redis_certengine"],
        network: "remote",
    },
};

function loadEnv(file) {
    const values = {};
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) {
            continue;
        }
        const cut = line.indexOf("=");
        let value = line.slice(cut + 1).trim();
        if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === "\"" || value[0] === "'")) {
            value = value.slice(1, -1);
        }
        values[line.slice(0, cut).trim()] = value;
    }
    return values;
}

function ensureFile(profile) {
    const chosen = PROFILES[profile];
    if (!fs.existsSync(chosen.file)) {
        console.error("manca " + path.relative(root, chosen.file));
        process.exit(1);
    }
    return chosen.file;
}

function run(command, args, options) {
    const result = spawnSync(command, args, {stdio: "inherit", ...options});
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireValue(env, key) {
    if (!env[key]) {
        console.error(key + " assente nel file di ambiente");
        process.exit(1);
    }
}

function compose(profile, args) {
    const files = ["-f", "docker-compose.yaml"];
    if (profile === "local") {
        files.push("-f", "docker-compose.mls15.yaml");
    }
    run("docker", ["compose", "--env-file", ".env", ...files, ...args], {
        cwd: dockerDir,
        env: {...process.env, ENV_FILE: PROFILES[profile].composeEnv},
    });
}

function startServices(profile) {
    compose(profile, ["up", "-d", ...PROFILES[profile].services]);
}

function startApp(profile) {
    compose(profile, ["up", "-d", "--force-recreate", "--no-deps", "certengine"]);
}

function addressesAreEmpty(envFile) {
    const text = fs.readFileSync(envFile, "utf8");
    for (const [key] of ADDRESS_KEYS) {
        if (!new RegExp("^" + key + "=", "m").test(text)) {
            console.error("manca " + key + " in " + envFile);
            process.exit(1);
        }
    }
    return ADDRESS_KEYS.some(([key]) => new RegExp("^" + key + '=""', "m").test(text));
}

function writeAddresses(envFile, output) {
    const parsed = JSON.parse(output.slice(output.lastIndexOf("{"), output.lastIndexOf("}") + 1));
    let text = fs.readFileSync(envFile, "utf8");
    for (const [key, field] of ADDRESS_KEYS) {
        const replaced = text.replace(
            new RegExp("^" + key + '="[^"]*"', "m"),
            key + '="' + parsed[field] + '"'
        );
        if (replaced === text) {
            console.error("chiave non aggiornata: " + key);
            process.exit(1);
        }
        text = replaced;
    }
    fs.writeFileSync(envFile, text);
    console.log(parsed.erc1155, parsed.erc721, parsed.sbt);
}

function deploy(profile, env, envFile) {
    requireValue(env, "SENDER_ADDR");
    requireValue(env, "MLS15_RPC_URL");
    requireValue(env, "CHAIN_ID");
    requireValue(env, "MAX_SERIALIZE_BATCH");
    const childEnv = {
        ...process.env,
        MAX_SERIALIZE_BATCH: env.MAX_SERIALIZE_BATCH,
        SENDER_ADDR: env.SENDER_ADDR,
        MLS15_RPC_URL: env.MLS15_RPC_URL,
        CHAIN_ID: env.CHAIN_ID,
    };
    if (profile === "remote") {
        requireValue(env, "SENDER_PRIVKEY");
        childEnv.SENDER_PRIVKEY = env.SENDER_PRIVKEY;
    }
    const result = spawnSync(
        "npx hardhat run scripts/deploy-mls1.js --network " + PROFILES[profile].network,
        {cwd: root, env: childEnv, shell: true, encoding: "utf8"}
    );
    const output = (result.stdout || "") + (result.stderr || "");
    if (result.status !== 0) {
        process.stdout.write(output);
        process.exit(result.status || 1);
    }
    writeAddresses(envFile, output);
}

async function waitForChain(env) {
    const expected = "0x" + Number(env.CHAIN_ID).toString(16);
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            const response = await axios.post(env.MLS15_RPC_URL, {
                jsonrpc: "2.0",
                method: "eth_chainId",
                params: [],
                id: 1,
            });
            if (String(response.data.result).toLowerCase() === expected) {
                return;
            }
        } catch (error) {
        }
        await sleep(2000);
    }
    console.error("chain ID " + env.CHAIN_ID + " non risponde su " + env.MLS15_RPC_URL);
    process.exit(1);
}

async function waitForApp(env) {
    const port = env.CERT_ENGINE_PORT || "5001";
    const apiUrl = env.MLS15_API_URL || ("http://127.0.0.1:" + port);
    const needle = "Running on port " + port;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const logs = spawnSync("docker", ["logs", "certengine", "--tail", "80"], {encoding: "utf8"});
        const text = (logs.stdout || "") + (logs.stderr || "");
        if (text.includes(needle)) {
            try {
                const ping = await axios.get(apiUrl.replace(/\/$/, "") + "/api/ping?message=PING");
                if (JSON.stringify(ping.data).includes("PONG")) {
                    return;
                }
            } catch (error) {
            }
        }
        await sleep(3000);
    }
    spawnSync("docker", ["logs", "certengine", "--tail", "40"], {stdio: "inherit"});
    process.exit(1);
}

async function main() {
    const profile = (process.argv[2] || "").trim().toLowerCase();
    if (!PROFILES[profile]) {
        console.error("Uso: node scripts/start-engine.js local|remote");
        process.exit(1);
    }

    const envFile = ensureFile(profile);
    const inspect = spawnSync("docker", ["network", "inspect", "certengine_network"], {stdio: "ignore"});
    if (inspect.status !== 0) {
        run("docker", ["network", "create", "certengine_network"]);
    }

    startServices(profile);
    const env = loadEnv(envFile);
    if (profile === "local") {
        await waitForChain(env);
    }
    if (addressesAreEmpty(envFile)) {
        deploy(profile, env, envFile);
    }
    startApp(profile);
    await waitForApp(env);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
