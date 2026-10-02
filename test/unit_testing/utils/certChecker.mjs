import chai from "chai";
const expect = chai.expect;

export function checkTicket(ticket) {
    expect(typeof ticket, 'ticket should be a string').to.equal('string');
}

export function checkCertInfos(certInfos) {
    expect(typeof certInfos, 'certInfos should be an object').to.equal('object');
    expect(typeof certInfos.blockchainName, 'blockchainName should be a string').to.equal('string');
    expect(typeof certInfos.blockchainURL, 'blockchainURL should be a string').to.equal('string');
    expect(certInfos.transactionHash, 'transactionHash should exist').to.not.be.undefined;
    expect(certInfos.transactionHash.startsWith('0x'), 'transactionHash should be 0x-prefixed').to.be.true;
    expect(certInfos.transactionTimestamp, 'transactionTimestamp should exist').to.not.be.undefined;
    expect(typeof certInfos.userID, 'userID should be string or undefined').is.oneOf(['string', 'undefined']);
}

export function checkProofs(certProofs, hashAlgo) {
    expect(typeof certProofs, 'proofs payload should be an object').to.equal('object');
    expect(Array.isArray(certProofs.proofs), 'proofs should be an array').to.equal(true);
    for (const elem of certProofs.proofs) {
        expect(typeof elem.id, 'proof.id should be a string').to.equal('string');
        expect(Array.isArray(elem.proof), 'proof.proof should be an array').to.equal(true);
    }
    expect(certProofs.hashAlgorithm, `hashAlgorithm should be ${hashAlgo}`).to.equal(hashAlgo);
    checkCertInfos(certProofs);
}
