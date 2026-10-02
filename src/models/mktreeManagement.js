const {connectToDbMongo} = require("../connectors/mongoDBConnector");
const {MerkleTreeRecursiveV4} = require("../utils/recursiveMerkleTree_v4");
const appLogger = require("../services/loggers/applogger");

class MktreeManagement {

    async #getConnection() {
        return await connectToDbMongo();
    }

    getMerkleTree(dataList, toBeHashedLeaves, hashAlgo){
        return new MerkleTreeRecursiveV4(dataList, toBeHashedLeaves, hashAlgo);
    }

    /**
     * The function saves the newly created merkle tree containing documents to be certified inside the database.
     * The document created will have the following structure:
     * {
     *     _id: "xxxxx"
     *     leavesIndexes: [1, 3, 5, ],
     *     tree: MerkleTreeRecursive tree
     * }
     *
     * @param tree The MerkleTreeRecursive object containing the already built tree
     * @returns The document id, if creation was successful, else undefined
     */
    async saveTree(tree){
        let connection;
        let treeID = undefined;
        let doc = {
            leavesIndexes : tree.leavesIndexes,
            tree : tree.tree
        };

        try{
            connection = await this.#getConnection();
            let collection = await connection.collection("Trees");
            const temp = await collection.insertOne(doc);
            treeID = temp.insertedId;

        } catch (error) {
            appLogger.error({error:error},`Error while trying to save the merkle tree`);
            throw error;
        }
        return treeID;
    }

    /**
     * Function that retrieves the document containing a saved merkle tree
     * @param id document id
     * @returns the document
     * {
     *     _id: "xxxx",
     *     leavesIndexes: [1, 3, 5],
     *     tree: recursive tree
     * }
     */
    async getTree(id){
        /**
         * Query R_CMS_7
         */
        let connection;
        let queryResult;
        try{
            connection = await this.#getConnection();
            let collection = await connection.collection("Trees");

            queryResult = await collection.findOne({ "_id":id});

        } catch (error) {
            appLogger.error({context:{treeID: id}, error:error},`Error while trying to get the merkle tree`);
            throw error;
        }
        return queryResult;
    }



    async deleteTree(treeID){
        let connection;
        try{
            connection = await this.#getConnection();

            let collection = await connection.collection("Trees");
            await collection.deleteOne({ _id: treeID});

        } catch (error) {
            appLogger.error({context:{treeID: treeID}, error:error}, `Error while trying to delete a tree`);
        }
    }

    getAllProofs(tree, hashAlgo){
        let merkleTools = new MerkleTreeRecursiveV4([], undefined, hashAlgo);
        merkleTools.loadTree(tree);
        let proofs = [];

        try {
            for (let leaf of tree.leavesIndexes) {
                proofs.push(merkleTools.getMerkleProof([leaf]));
            }
        }catch(error){
            appLogger.error({error:error},`Error while trying to get all the proofs from the merkle tree`);
            throw error;
        }

        return proofs
    }


}

module.exports = {
    MktreeManagement
}