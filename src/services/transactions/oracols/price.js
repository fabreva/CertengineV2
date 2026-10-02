const axios = require("axios");


async function getEthEurFromService() {
    const { data } = await axios.get("https://api.binance.com/api/v3/ticker/price",
        {params: {symbol: "ETHEUR"}}
    );
    const eur = parseFloat(data.price);
    return {eur, status: !isNaN(eur)};
}

module.exports = {getEthEurFromService}