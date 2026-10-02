const RawAdapter = require('./RawAdapter');
const SbtAdapter = require('./SbtAdapter');
const Erc721Adapter = require('./Erc721Adapter');
const Erc1155Adapter = require('./Erc1155Adapter');

class AdapterFactory {
    /**
     * @param {string} anchorMode - 'raw', 'sbt', 'erc721', 'erc1155'
     */
    static getAdapter(anchorMode) {
        switch (anchorMode) {
            case 'raw':
                return new RawAdapter();
            case 'erc721':
                return new Erc721Adapter();
            case 'sbt':
                return new SbtAdapter();
            case 'erc1155':
                return new Erc1155Adapter();
            default:
                throw new Error(`Unknown anchorMode: ${anchorMode}`);
        }
    }
}

module.exports = AdapterFactory;
