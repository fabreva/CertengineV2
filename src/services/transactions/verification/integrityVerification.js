const {MktreeManagement} = require("../../../models/mktreeManagement");


function computeRootHash(plainData, merkleProof, hashAlgo){
    const mktreeManagement = new MktreeManagement();
    let merkleTools = mktreeManagement.getMerkleTree([], false, hashAlgo)
    return merkleTools.computeHashRoot(plainData, merkleProof);
}

function verifyMerkle(plainData, onchainRoot, bcInfo){
    const computedHashRoot = computeRootHash(plainData, bcInfo.merkleproof, bcInfo.hashAlgo);
    return "0x"+computedHashRoot === onchainRoot;
}

module.exports = {
    verifyMerkle
}