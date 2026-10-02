const express = require("express");
const { query, validationResult, checkExact} = require('express-validator');
const {handlerErrorRequest} = require("../responseHandlers/handlerErrorRequest");
const appLogger = require("../services/loggers/applogger");
const {StatsController} = require("../controllers/statsController");

const router = express.Router();

router.get('/getTransactions',
    checkExact([
        query(['page', 'elemsPerPage']).optional().isInt(),
        query(['owner']).optional().isString(),
    ]),
    async (req, res, next) => {
        try{
            const result = validationResult(req);
            if (!result.isEmpty()) {
                return res.status(400).json(handlerErrorRequest({message:result.errors}))
            }
            const statsController = new StatsController();
            await statsController.getTransactions(req, res);
        }catch(error){
            appLogger.error({error:error}, `Error while getting all transactions info`);
            next(error);
        }

    }
)

router.get('/getCertificationStats',
    checkExact([
        query(['owner']).optional().isString(),
    ]),
    async (req, res, next) => {
        try{
            const result = validationResult(req);
            if (!result.isEmpty()) {
                return res.status(400).json(handlerErrorRequest({message:result.errors}))
            }
            const statsController = new StatsController();
            await statsController.getCertificationStats(req, res);
        }catch(error){
            appLogger.error({error:error}, `Error while getting certification stats`);
            next(error);
        }
    }
)

router.get('/getExpenses',
    checkExact([
        query(['owner']).optional().isString(),
    ]),
    async (req, res, next) => {
        try{
            const result = validationResult(req);
            if (!result.isEmpty()) {
                return res.status(400).json(handlerErrorRequest({message:result.errors}))
            }
            const statsController = new StatsController();
            await statsController.getTotalSpent(req, res);
        }catch(error){
            appLogger.error({error:error}, `Error while getting total expenses`);
            next(error);
        }
    }
)


router.get('/getUsageStats',
    checkExact([]),
    async (req, res, next) => {
        try{
            const result = validationResult(req);
            if (!result.isEmpty()) {
                return res.status(400).json(handlerErrorRequest({message:result.errors}))
            }
            const statsController = new StatsController();
            await statsController.getDashboardStats(req, res);
        }catch(error){
            appLogger.error({error:error}, `Error while getting total expenses`);
            next(error);
        }
    }
)



module.exports = router;