const { InfisicalSDK } = require("@infisical/sdk");

class Vault {
    constructor(CLIENT_ID, CLIENT_SECRET, PROJECT_ID, LOCATION, ENV) {
        this.CLIENT_ID = CLIENT_ID;
        this.CLIENT_SECRET = CLIENT_SECRET;
        this.PROJECT_ID = PROJECT_ID;
        this.ENV = ENV;
        this.LOCATION = LOCATION;
        this.client = undefined

    }
    async setup(){
        if (this.client) {
            return;
        }
        const options = this.LOCATION === 'EU' ? {siteUrl: "https://eu.infisical.com"} : undefined;
        const infisicalSdk = new InfisicalSDK(options);

        await infisicalSdk.auth().universalAuth.login({
            clientId: this.CLIENT_ID,
            clientSecret: this.CLIENT_SECRET
        });

        this.client = infisicalSdk;
    }

    async getSecrets(){
        await this.setup()
        const infisicalSecrets = await this.client.secrets().listSecrets({
            environment: this.ENV,
            projectId: this.PROJECT_ID
        })

        let secrets = {}
        for (let secret of infisicalSecrets.secrets) {
            secrets[secret.secretKey] = secret.secretValue
        }
        return secrets
    }
}

module.exports = {
    Vault
}