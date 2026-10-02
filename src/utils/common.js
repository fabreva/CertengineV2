const {createHash} = require("crypto");


function hash(string, algo = 'sha256') {
    return createHash(algo).update(string).digest('hex');
}

function hashingMethod(elem, algo){
    if (typeof elem === "string"){
        return hash(elem, algo)
    }else if (typeof elem === "object" || Array.isArray(elem)){
        return hash(JSON.stringify(elem), algo);
    }
}

function getPlainDataToBeHashed(document){
    return document.certData;
}


function dateFormatting(date){
    return date.toISOString()
}



module.exports = {hashingMethod, getPlainDataToBeHashed, dateFormatting};

