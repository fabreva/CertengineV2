const {MktreeManagement} = require("../models/mktreeManagement");
const {CertQueueManagement} = require("../models/certQueueManagement");

const appLogger = require("../services/loggers/applogger");

const {handlerSuccessRequest} = require("../responseHandlers/handlerSuccessRequest");
const {handlerErrorRequest} = require("../responseHandlers/handlerErrorRequest");


class DownloadController {
    constructor() {
        this.treeManager = new MktreeManagement();
        this.queueManager = new CertQueueManagement();
    }
    async #getAllProofs(queueDoc){
        const tree = await this.treeManager.getTree(queueDoc.treeID);
        return this.treeManager.getAllProofs(tree, queueDoc.hashAlgo);
    }

    async downloadCertificationProof(req, res){
        const owner = req.query.owner;
        const ticket = req.query.ticket;

        try {
            const queueDoc = await this.queueManager.getQueue(owner, ticket);
            if(!queueDoc){
                return res.status(404).json(handlerErrorRequest({message:"Ticket invalid or expired"}));
            }

            if(!queueDoc.blockchainData?.transactionHash || !queueDoc.treeID){
                return res.status(409).json(handlerErrorRequest({message:"Ticket not certified yet"}));
            }

            const docsIDs = queueDoc.queue.map(item => item.id);
            const hashAlgo = queueDoc.hashAlgo;
            const proofs = await this.#getAllProofs(queueDoc);
            const fullProofs = proofs.map(((item,index) => {
                return {id: docsIDs[index], proof: item}
            }));
            const blockchainData = queueDoc.blockchainData;

            const result = {
                proofs:fullProofs,
                hashAlgorithm:hashAlgo,
                blockchainName: blockchainData.blockchainName,
                blockchainURL: blockchainData.blockchainURL,
                transactionHash: blockchainData.transactionHash,
                transactionTimestamp: blockchainData.transactionTimestamp
            }
            if (blockchainData.anchorMode === 'erc1155' || blockchainData.anchorMode === 'erc721' || blockchainData.anchorMode === 'sbt') {
                for (const key of ['anchorMode', 'contractAddress', 'familyId', 'owner', 'receiver', 'tokenId', 'quantity']) {
                    if (blockchainData[key] !== undefined && blockchainData[key] !== null) {
                        result[key] = blockchainData[key];
                    }
                }
            }
            await this.queueManager.setReadyForDeletion(ticket, owner);
            return res.status(200).json(handlerSuccessRequest(result));

        }catch (error){
            appLogger.error({context:{owner:owner, ticket:ticket},error:error}, 'Error while downloading proof');
            return res.status(500).json(handlerErrorRequest({message:"Internal Server Error"}));
        }

    }

    async deleteCertifiedData(req, res){
        const owner = req.query.owner;
        const ticket = req.query.ticket;

        try{
            const queueDoc = await this.queueManager.getQueue(owner, ticket);
            if(!queueDoc){
                return res.status(404).json(handlerErrorRequest({message:"Ticket invalid or expired"}));
            }
            if(!queueDoc.readyForDeletion){
                return res.status(409).json(handlerErrorRequest({message:"Proof must be downloaded before the certified data can be deleted"}));
            }
            await this.queueManager.deleteQueue(ticket, owner);
            await this.treeManager.deleteTree(queueDoc.treeID)
            return res.status(200).json(handlerSuccessRequest());
        }catch(error){
            appLogger.error({context:{owner:owner, ticket:ticket}, error:error},'Error while deleting certifiedData');
            return res.status(500).json(handlerErrorRequest({message:"Internal Server Error"}));
        }
    }

}

module.exports = {
    DownloadController
};