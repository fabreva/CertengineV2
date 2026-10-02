const {transactOnBC} = require("../transactions/certification/certifier");

class RawAdapter {
    async anchor(context) {
        const {merkleRoot, gasPrice, sender} = context;
        return await transactOnBC(merkleRoot, gasPrice, sender);
    }
}

module.exports = RawAdapter;
