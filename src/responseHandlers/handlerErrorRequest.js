

function handlerErrorRequest(error){
    return {
        success: false,
        error: error.message
    }
}
module.exports = {handlerErrorRequest};