function validateGasFee(value){
    const num = Number(value);
        if (Number.isNaN(num) || num < 0) {
            throw new Error('Invalid baseFee');
        }
        return true;
}

const ALLOWED_HASH_ALGORITHMS = ['sha256', 'sha384', 'sha512', 'sha224', 'sha3-256', 'sha3-512'];

function validateHashAlgorithm(value){
    if (!ALLOWED_HASH_ALGORITHMS.includes(value)) {
        throw new Error(`Unsupported hashAlgorithm. Allowed: ${ALLOWED_HASH_ALGORITHMS.join(', ')}`);
    }
    return true;
}


module.exports = {
    validateGasFee,
    validateHashAlgorithm
}