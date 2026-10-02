const {connectToRedis} = require("../../connectors/redisConnector");
const {default: Redlock} = require("redlock");
const appLogger = require("../loggers/applogger");
const {getEthEurFromService} = require("../transactions/oracols/price");


class RedisClient {
    constructor() {
        this.redlock = null
        this.lockedKeys = [
            "nextNonce",
            "concurrentTransactions",
            "suggestedTransactionPrice"
        ];
    }

    async #connect(){
        return await connectToRedis()
    }

    /**
     * @param client {Client|RedisClient}
     */
    async #initRedlock(client){
        this.redlock = new Redlock([client], {
            driftFactor: 0.01,
            retryCount: 10,
            retryDelay: 200,
            retryJitter: 200,}
        );
    }

    /**
     *
     * @param key {string}
     * @return {Promise<Lock>}
     */
    async lockKey(key){
        return this.redlock.acquire([`lock:${key}`], 5000);
    }

    /**
     * @param lock {Lock}
     */
    async unlockKey(lock){
        try {
            await lock.release();
        } catch (error) {
            appLogger.error({context:{lock: lock.resources}, error:error}, "REDIS - Error while releasing lock");
        }
    }

    /**
     * @param key {string}
     * @param value {string|number}
     */
    async setValue(key, value){
        const client = await this.#connect()
        if(this.lockedKeys.some(lockedKey => key.startsWith(lockedKey))){
            try{
                if(!this.redlock){
                    await this.#initRedlock(client)
                }
                const lock = await this.lockKey(key)
                try {
                    await client.set(key, value);
                } finally {
                    await this.unlockKey(lock);
                }
            } catch (error) {
                appLogger.error({context:{key: key}, error:error},`REDIS - Error while updating data with locking`);
                throw error;
            }
        }else{
            await client.set(key, value);
        }
    }

    /**
     * @param key {string}
     * @return
     */
    async getValue(key){
        const client = await this.#connect()
        if(this.lockedKeys.some(lockedKey => key.startsWith(lockedKey))){
            try{
                if(!this.redlock){
                    await this.#initRedlock(client)
                }
                const lock = await this.lockKey(key)
                try {
                    return await client.get(key)
                } finally {
                    await this.unlockKey(lock);
                }
            } catch (error) {
                appLogger.error({context:{key: key}, error:error},`REDIS - Error while reading with locking`);
                throw error;
            }
        }else{
            return await client.get(key)
        }
    }

    /**
     * @param key {string}
     */
    async blindIncrement(key){
        const client = await this.#connect();
        if(this.lockedKeys.some(lockedKey => key.startsWith(lockedKey))){
            try{
                if(!this.redlock){ await this.#initRedlock(client); }
                const lock = await this.lockKey(key);
                try {
                    const v = Number(await client.get(key));
                    await client.set(key, v + 1);
                    appLogger.debug(undefined, "REDIS - concurrent transactions: " + (v + 1));
                } finally {
                    await this.unlockKey(lock);
                }
                return true;
            } catch (error) {
                appLogger.error({context:{key}, error}, `REDIS - Error while blindly incrementing with locking`);
                return false;
            }
        } else {
            try {
                const v = Number(await client.get(key));
                await client.set(key, v + 1);
                return true;
            } catch (error) {
                appLogger.error({context:{key}, error}, `REDIS - Error while blindly incrementing`);
                return false;
            }
        }
    }


    /**
     * @param key {string}
     */
    async blindDecrement(key){
        const client = await this.#connect();
        if(this.lockedKeys.some(lockedKey => key.startsWith(lockedKey))){
            try{
                if(!this.redlock){ await this.#initRedlock(client); }
                const lock = await this.lockKey(key);
                try {
                    const v = Number(await client.get(key));
                    await client.set(key, Math.max(0, v - 1));
                    appLogger.debug(undefined, "REDIS - concurrent transactions: " + Math.max(0, v - 1));
                } finally {
                    await this.unlockKey(lock);
                }
                return true;
            } catch (error) {
                appLogger.error({context:{key}, error}, `REDIS - Error while blindly decrementing with locking`);
                return false;
            }
        } else {
            try {
                const v = Number(await client.get(key));
                await client.set(key, Math.max(0, v - 1));
                return true;
            } catch (error) {
                appLogger.error({context:{key}, error}, `REDIS - Error while blindly decrementing`);
                return false;
            }
        }
    }


    async getPriceAndTransactions(){
        let price;
        let transactions;
        const client = await this.#connect()
        try{
            if(!this.redlock){
                await this.#initRedlock(client)
            }
            const lock =  await this.redlock.acquire([`lock:concurrentTransactions`, `lock:suggestedTransactionPrice`], 5000);
            try {
                price = JSON.parse(await client.get(`suggestedTransactionPrice`));
                transactions = Number(await client.get(`concurrentTransactions`));
            }finally {
                await this.unlockKey(lock);
            }
        }catch (error) {
            appLogger.error({error:error},`REDIS - Error while updating concurrentTransactions and suggestedTransactionPrice`);
        }
        return {
            price:price,
            transactions:transactions
        }
    }

    async incrementAndGetNonce(){
        const client = await this.#connect()
        const key = `nextNonce`;
        if(!this.redlock){
            await this.#initRedlock(client)
        }
        const lock = await this.lockKey(key)
        try {
            const current = Number(await client.get(key));
            await client.set(key, current + 1);
            return current;
        } finally {
            await this.unlockKey(lock);
        }
    }

    async saveOnRedisETHtoEUR(){
        const client = await this.#connect()
        let {eur, status} = await getEthEurFromService()
        await client.set('price_service_STATUS', status.toString())
        if(status){
            await client.set('from_ETH_to_EUR', eur)
        }
    }

    async getEURfromRedis(){
        const client = await this.#connect()
        let eur, status;
        eur = Number(await client.get('from_ETH_to_EUR'))
        status = await client.get('price_service_STATUS')
        status = status === 'true';
        return {eur: eur, status:status}
    }
}
const redisClient = new RedisClient()

module.exports = redisClient;