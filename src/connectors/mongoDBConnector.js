const mongoose = require('mongoose');
const {configurator} = require("../config");

const appLogger = require("../services/loggers/applogger");

async function connectToDbMongo() {
    if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2 ){
        try {
            mongoose.set('strictQuery', true);
            const conn = await configurator.getConfig('databaseMongo.connection_string')
            await mongoose.connect(conn, {retryWrites:true, retryReads:true});
            appLogger.info(undefined,"MONGODB - Connected");
        } catch (error) {
            appLogger.error({error:error}, "MONGODB - Error while establishing connection");
            throw error;
        }
    }
    return mongoose.connection;
}

async function disconnectFromDbMongo() {
    if (mongoose.connection.readyState !== 0 && mongoose.connection.readyState !== 3){
        appLogger.warn(undefined,'MONGODB - Disconnected');
        try{
            await mongoose.connection.close();
        }catch(error){
            appLogger.error({error:error}, 'MONGODB - Error while disconnecting');
        }
    }
}

module.exports = {
    connectToDbMongo,
    disconnectFromDbMongo
};