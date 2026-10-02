const dotenv = require('dotenv');
const { resolve } = require("path");
const { Vault } = require("./services/vault/infisicalVault");
const appLogger = require("./services/loggers/applogger");

const dotenvResult = dotenv.config({ path: resolve(__dirname, '.env') });
if (dotenvResult.error) {
    appLogger.warn('No .env file found, relying on environment variables injected at runtime');
}

class Configurator {
    constructor() {
        this.config = {
            node_environment: process.env.NODE_ENV,
            log_level: process.env.LOG_LEVEL || 'info',
            useVault: process.env.USE_VAULT === 'true',

            server: {
                port: process.env.CERT_ENGINE_PORT,
                main_server_url: process.env.MAIN_SERVER_URL,
            },
            projectName: process.env.PROJECT_NAME,
            databaseMongo: {},
            redisconf: {
                host: process.env.REDIS_HOST,
                port: process.env.REDIS_PORT,
            },
            blockchain: {
                gas: Number(process.env.GAS),
                contractGasCap: process.env.CONTRACT_GAS_CAP,
                blockchainURL: process.env.BLOCKCHAIN_URL,
                blockchainName: process.env.BLOCKCHAIN_NAME,
                chainId: process.env.CHAIN_ID,
                contracts: {
                    erc721: process.env.ERC721_ADDR,
                    erc721Sbt: process.env.ERC721_SBT_ADDR,
                    erc1155: process.env.ERC1155_ADDR
                }
            }
        };
    }

    async #loadSecrets() {
        let secrets;

        if (this.config.useVault) {
            const v2 = new Vault(
                process.env.VAULT_CLIENT_ID,
                process.env.VAULT_CLIENT_SECRET,
                process.env.VAULT_PROJECT_ID,
                process.env.VAULT_INSTANCE_LOCATION,
                process.env.NODE_ENV
            );
            secrets = await v2.getSecrets();
        } else {
            secrets = {
                REDIS_PASSWORD: process.env.REDIS_PASSWORD,
                MONGO_DATABASE_CONNECTION_STRING: process.env.MONGO_DATABASE_CONNECTION_STRING,
                ETHERSCAN_KEY: process.env.ETHERSCAN_KEY,
                OWLRACLE_KEY: process.env.OWLRACLE_KEY,
                SENDER_ADDR: process.env.SENDER_ADDR,
                SENDER_PRIVKEY: process.env.SENDER_PRIVKEY,
                RECEIVER_ADDR: process.env.RECEIVER_ADDR,
                SERVICE_API_KEY: process.env.SERVICE_API_KEY,
            };
        }

        this.config.redisconf.password = secrets.REDIS_PASSWORD;
        this.config.databaseMongo.connection_string = secrets.MONGO_DATABASE_CONNECTION_STRING;
        this.config.etherscanKey = secrets.ETHERSCAN_KEY;
        this.config.owlracleKey = secrets.OWLRACLE_KEY;
        this.config.blockchain.ethSender = {
            address: secrets.SENDER_ADDR,
            privateKey: secrets.SENDER_PRIVKEY
        };
        this.config.blockchain.ethReceiver = {
            address: secrets.RECEIVER_ADDR,
        };
        this.config.serviceApiKey = secrets.SERVICE_API_KEY;
    }

    #getNestedConfig(obj, key) {
        return key.split('.').reduce((acc, part) => acc?.[part], obj);
    }

    async getConfig(key) {
        let value = this.#getNestedConfig(this.config, key);

        if (value === undefined) {
            await this.#loadSecrets();
        }

        return this.#getNestedConfig(this.config, key);
    }
}

const configurator = new Configurator();

module.exports = {
    configurator
};