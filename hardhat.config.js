/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.27",
        settings: {
            evmVersion: "cancun",
        },
    },
    paths: {
        sources: "./src/contracts",
    },
    networks: {
        mls15: {
            url: process.env.MLS15_RPC_URL || "http://127.0.0.1:8545",
            chainId: 31337,
        },
        remote: {
            url: process.env.MLS15_RPC_URL || "",
            chainId: Number(process.env.CHAIN_ID) || 1,
            accounts: process.env.SENDER_PRIVKEY ? [process.env.SENDER_PRIVKEY] : [],
        },
    },
};
