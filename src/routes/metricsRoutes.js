const {checkExact, query, validationResult} = require("express-validator");
const {handlerErrorRequest} = require("../responseHandlers/handlerErrorRequest");
const appLogger = require("../services/loggers/applogger");
const {handlerSuccessRequest} = require("../responseHandlers/handlerSuccessRequest");
const express = require("express");
const router = express.Router()

router.get('/ping',
    checkExact([
        query(["message"]).exists().custom(msg => {
            if(msg!=="PING"){
             throw new Error()
            }
            return true
        })
    ]),
    async (req, res, next) => {
        try{
            const result = validationResult(req);
            if (!result.isEmpty()) {
                return res.status(400).json(handlerErrorRequest({message:result.errors}))
            }
            return res.status(200).json(handlerSuccessRequest("PONG"))
        }catch(error){
            appLogger.error({error:error}, `Error while getGasPrice`);
            next(error);
        }
    });

module.exports = router;