const {StatsManagement} = require("../models/statsManagement");
const {handlerSuccessRequest} = require("../responseHandlers/handlerSuccessRequest");
const {handlerErrorRequest} = require("../responseHandlers/handlerErrorRequest");
const appLogger = require("../services/loggers/applogger");

class StatsController {
    constructor() {
        this.statsManager = new StatsManagement();

    }

    async getTransactions(req, res){
        const owner = req.query.owner ? req.query.owner : null;
        const currPage = Number.isInteger(parseInt(req.query.page))
        && parseInt(req.query.page) !== 0
            ? Math.abs(parseInt(req.query.page)) : 1;
        const elemsPerPage = Math.abs(parseInt(req.query.elemsPerPage)) || 5;

        try{
            const result = await this.statsManager.getTransactionsPaginated(owner, currPage, elemsPerPage);
            if(result){
                return res.status(200).json(handlerSuccessRequest(result));
            }else{
                return res.status(404).json(handlerErrorRequest({message:"Not found"}));
            }
        }catch (error){
            appLogger.error({error:error},`Error while getting transactions history`);
            return res.status(500).json(handlerErrorRequest({message:"Internal Server Error"}));
        }
    }

    async getCertificationStats(req, res){
        const owner = req.query.owner ? req.query.owner : null;

        try{
            const result = await this.statsManager.getCertificationStats(owner);
            if(result){
                return res.status(200).json(handlerSuccessRequest(result));
            }else{
                return res.status(404).json(handlerErrorRequest({message:"Not found"}));
            }
        }catch (error){
            appLogger.error({error:error},`Error while getting certification stats`);
            return res.status(500).json(handlerErrorRequest({message:"Internal Server Error"}));
        }
    }

    async getTotalSpent(req, res){
        const owner = req.query.owner ? req.query.owner : null;

        try{
            const result = await this.statsManager.getTotalSpent(owner);
            if(result){
                return res.status(200).json(handlerSuccessRequest(result));
            }else{
                return res.status(404).json(handlerErrorRequest({message:"Not found"}));
            }
        }catch (error){
            appLogger.error({error:error},`Error while getting stats on total spent`);
            return res.status(500).json(handlerErrorRequest({message:"Internal Server Error"}));
        }
    }

    async getDashboardStats(req, res){
        try{
            const result = await this.statsManager.getDashboardStats();
            if(result){
                return res.status(200).json(handlerSuccessRequest(result));
            }else{
                return res.status(404).json(handlerErrorRequest({message:"Not found"}));
            }
        }catch (error){
            appLogger.error({error:error},`Error while getting full stats`);
            return res.status(500).json(handlerErrorRequest({message:"Internal Server Error"}));
        }
    }

}

module.exports = {
    StatsController
}