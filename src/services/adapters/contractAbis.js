const fs = require("fs");
const path = require("path");

function loadGeneratedAbi(contractName) {
    const filePath = path.join(__dirname, "..", "..", "contracts", "abi", `${contractName}.json`);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) {
        throw new Error(`Generated ABI for ${contractName} is not a JSON array`);
    }
    return parsed;
}

module.exports = {
    certEngine1155: () => loadGeneratedAbi("CertEngine1155"),
    certEngine721: () => loadGeneratedAbi("CertEngine721"),
    certEngineSBT721: () => loadGeneratedAbi("CertEngineSBT721"),
};
