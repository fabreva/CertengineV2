
function handlerSuccessRequest(result){
    if (result) {
        return {
            success: true,
            data: {
                message: "Operation completed successfully",
                result: result
            }
        };
        }
    else{
        return {
            success: true,
            data: {
                message: "Operation completed successfully",
            }
        };
    }
}


module.exports = { handlerSuccessRequest
};