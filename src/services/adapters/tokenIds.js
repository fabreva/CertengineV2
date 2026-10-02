const {Web3} = require("web3");

let web3;

function encoder() {
    if (!web3) {
        web3 = new Web3();
    }
    return web3;
}

function normalizeFamilyId(root) {
    if (typeof root !== "string") {
        throw new TypeError("familyId must be a 32-byte hex string");
    }
    const body = root.startsWith("0x") || root.startsWith("0X") ? root.slice(2) : root;
    if (!/^[0-9a-fA-F]{64}$/.test(body)) {
        throw new TypeError("familyId must be exactly 32 bytes");
    }
    return "0x" + body;
}

function familyTokenId(root) {
    return BigInt(normalizeFamilyId(root)).toString(10);
}

function serializedTokenId(root, progressive) {
    const familyId = normalizeFamilyId(root);
    if (typeof progressive !== "string" || !/^[1-9]\d*$/.test(progressive)) {
        throw new TypeError("progressive must be a positive integer string");
    }
    const encoded = encoder().eth.abi.encodeParameters(
        ["bytes32", "uint256"],
        [familyId, progressive]
    );
    return BigInt(encoder().utils.keccak256(encoded)).toString(10);
}

module.exports = {
    normalizeFamilyId,
    familyTokenId,
    serializedTokenId,
};
