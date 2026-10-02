const {connectToDbMongo} = require("../connectors/mongoDBConnector");
const appLogger = require("../services/loggers/applogger");

class StatsManagement {

    async #getConnection() {
        return await connectToDbMongo();
    }

    async addTransactionToHistory(transaction, owner, senderAddress) {
        let connection;
        try{
            connection = await this.#getConnection();
            let collection = await connection.collection("History");
            await collection.insertOne({
                type: "CERTIFICATION",
                blockchain: {
                    name: transaction.blockchainName,
                    url: transaction.blockchainURL
                },
                transactionHash: transaction.transactionHash,
                timestamp: transaction.transactionTimestamp,
                priceEUR: transaction.priceEUR,
                address: senderAddress,
                owner: owner,
            });

        } catch (error) {
            appLogger.error({error:error},`Error while updating transactions history`);
            throw error;
        }
    }


    async getTransactionsPaginated(owner, currPage, elemsPerPage, filterObject = {}) {
        let connection;
        let queryResult = null;

        const filters = [filterObject];

        if (owner) {
            filters.push({ owner: owner });
        }

        const combinedFilterObject = filters.length > 1
            ? { $and: filters } : filterObject;

        try {
            connection = await this.#getConnection();
            const collection = connection.collection("History");

            const queryResultDocs = await collection
                .aggregate([
                    { $match: combinedFilterObject },
                    { $sort: { timestamp: -1 } },
                    { $skip: (currPage - 1) * elemsPerPage },
                    { $limit: elemsPerPage }
                ])
                .toArray();

            const count = await collection.countDocuments(combinedFilterObject);

            queryResult = {
                docs: queryResultDocs,
                count: count
            };

        } catch (error) {
            appLogger.error({ error: error }, `Error while getting transactions history paginated`);
            throw error;
        }

        return queryResult;
    }


    /**
     * [
     *   {
     *     "_id": { "year": 2026, "month": 3 },
     *     "totalCertifications": 42,
     *     "totalSpentEUR": 1.92
     *   }
     * ]
     * @param owner
     * @returns {Promise<Document[]>}
     */
    async getCertificationStats(owner=null) {
        let connection;

        try{
            connection = await this.#getConnection();
            const collection = connection.collection("History");
            const match = { type: "CERTIFICATION" };
            if (owner) {
                match.owner = owner;
            }
            const result = await collection.aggregate([
                { $match: match },
                {$addFields: {date: { $toDate: "$timestamp" }}},
                {$group: {
                    _id: {year: { $year: "$date" }, month: { $month: "$date" }},
                    totalCertifications: { $sum: 1 },
                    totalSpentEUR: { $sum: "$priceEUR" }
                }},
                { $sort: { "_id.year": -1, "_id.month": -1 } }
            ]).toArray();
            return result;
        } catch (error) {
            appLogger.error({error:error}, "Error getting certification stats");
            throw error;
        }
    }

    /**
     *
     * @param owner
     * @returns {Promise<Document[]>}
     * [
     *   {
     *     "_id": {
     *       "year": 2026,
     *       "month": 3
     *     },
     *     "totalTransactions": 120,
     *     "totalSpentEUR": 4.51
     *   },
     *   {
     *     "_id": {
     *       "year": 2026,
     *       "month": 2
     *     },
     *     "totalTransactions": 98,
     *     "totalSpentEUR": 3.88
     *   }
     * ]
     */
    async getTotalSpent(owner=null) {
        let connection;

        try{
            connection = await this.#getConnection();
            const collection = connection.collection("History");
            const match = {};
            if (owner) {
                match.owner = owner;
            }

            const result = await collection.aggregate([
                { $match: match },
                {$addFields: {date: { $toDate: "$timestamp" }}},
                {$group: {
                        _id: {year: { $year: "$date" }, month: { $month: "$date" }},
                        totalTransactions: { $sum: 1 },
                        totalSpentEUR: { $sum: "$priceEUR" }
                }},
                { $sort: { "_id.year": -1, "_id.month": -1 } }
            ]).toArray();
            return result;
        } catch (error) {
            appLogger.error({error:error}, "Error getting total spent stats");
            throw error;
        }
    }


    /**
     *
     * @returns {Promise<Document>}
     * {
     *   "totalStats": [
     *     {
     *       "totalTransactions": 1240,
     *       "totalSpentEUR": 54.32,
     *       "avgTransactionCost": 0.043
     *     }
     *   ],
     *
     *   "transactionsByType": [
     *     {
     *       "_id": "CERTIFICATION",
     *       "total": 700,
     *       "spent": 22.21
     *     }
     *   ],
     *
     *   "monthlyStats": [
     *     {
     *       "_id": { "year": 2026, "month": 3 },
     *       "transactions": 120,
     *       "spent": 4.32
     *     }
     *   ],
     *
     *   "blockchainUsage": [
     *     {
     *       "_id": "Ethereum-Sepolia",
     *       "transactions": 1240,
     *       "spent": 54.32
     *     }
     *   ],
     *
     *
     *   "mostActiveOwners": [
     *     {
     *       "_id": "Owner1",
     *       "transactions": 400,
     *       "spent": 18.9
     *     }
     *   ]
     * }
     */
    async getDashboardStats() {
        let connection;
        try {
            connection = await this.#getConnection();
            const collection = connection.collection("History");

            const result = await collection.aggregate([
                {$addFields: {date: { $toDate: "$timestamp" }}},
                {
                    $facet: {
                        totalStats: [
                            {$group: {
                                _id: null,
                                totalTransactions: { $sum: 1 },
                                totalSpentEUR: { $sum: "$priceEUR" },
                                avgTransactionCost: { $avg: "$priceEUR" }
                            }}
                        ],

                        transactionsByType: [
                            {$group: {
                                _id: "$type",
                                total: { $sum: 1 },
                                spent: { $sum: "$priceEUR" }
                            }}
                        ],

                        monthlyStats: [
                            {$group: {
                                _id: {year: { $year: "$date" },month: { $month: "$date" }},
                                transactions: { $sum: 1 },
                                spent: { $sum: "$priceEUR" }
                            }},
                            { $sort: { "_id.year": -1, "_id.month": -1 } }
                        ],

                        blockchainUsage: [
                            {$group: {
                                _id: "$blockchain.name",
                                transactions: { $sum: 1 },
                                spent: { $sum: "$priceEUR" }
                            }},
                            { $sort: { transactions: -1 } }
                        ],


                        mostActiveOwners: [
                            {$group: {
                                _id: "$owner",
                                transactions: { $sum: 1 },
                                spent: { $sum: "$priceEUR" }
                            }},
                            { $sort: { transactions: -1 } },
                            { $limit: 10 }
                        ]
                    }
                }
            ]).toArray();

            return result[0];

        } catch (error) {
            appLogger.error({error:error}, "Error while computing dashboard stats");
            throw error;
        }
    }


}
module.exports = {StatsManagement};