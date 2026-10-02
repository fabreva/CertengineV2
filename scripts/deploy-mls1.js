const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const {Web3} = require("web3");

const CONTRACTS = ["CertEngine1155", "CertEngine721", "CertEngineSBT721"];

async function exportAbis() {
    const outDir = path.join(__dirname, "..", "src", "contracts", "abi");
    fs.mkdirSync(outDir, {recursive: true});
    for (const name of CONTRACTS) {
        const artifact = await hre.artifacts.readArtifact(name);
        fs.writeFileSync(
            path.join(outDir, `${name}.json`),
            JSON.stringify(artifact.abi, null, 2) + "\n"
        );
    }
}

async function deployOne(web3, from, name, args) {
    const artifact = await hre.artifacts.readArtifact(name);
    const contract = new web3.eth.Contract(artifact.abi);
    const deployed = await contract.deploy({data: artifact.bytecode, arguments: args}).send({from});
    return deployed.options.address;
}

async function deploy() {
    const sender = process.env.SENDER_ADDR;
    if (!sender || !/^0x[0-9a-fA-F]{40}$/.test(sender)) {
        throw new Error("SENDER_ADDR must be the service wallet address");
    }
    const maxBatch = process.env.MAX_SERIALIZE_BATCH;
    if (!maxBatch || !/^[1-9]\d*$/.test(maxBatch)) {
        throw new Error("MAX_SERIALIZE_BATCH must be a positive integer");
    }

    const web3 = new Web3(hre.network.provider);
    const deployed = {
        CertEngine1155: await deployOne(web3, sender, "CertEngine1155", [sender, maxBatch]),
        CertEngine721: await deployOne(web3, sender, "CertEngine721", [sender]),
        CertEngineSBT721: await deployOne(web3, sender, "CertEngineSBT721", [sender]),
    };
    for (const [name, address] of Object.entries(deployed)) {
        const artifact = await hre.artifacts.readArtifact(name);
        const contract = new web3.eth.Contract(artifact.abi, address);
        const owner = await contract.methods.owner().call();
        if (owner.toLowerCase() !== sender.toLowerCase()) {
            throw new Error(`${name} owner ${owner} is not SENDER_ADDR`);
        }
    }
    const erc1155 = deployed.CertEngine1155;
    const erc721 = deployed.CertEngine721;
    const sbt = deployed.CertEngineSBT721;

    console.log(JSON.stringify({
        erc1155,
        erc721,
        sbt,
        owner: sender,
        maxSerializeBatch: maxBatch,
    }, null, 2));
}

async function main() {
    await exportAbis();
    if (process.env.MLS1_ABI_ONLY === "1") {
        return;
    }
    await deploy();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
