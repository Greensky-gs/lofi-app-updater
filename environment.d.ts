declare global {
    namespace NodeJS {
        interface ProcessEnv {
            port: string;
            dbUrl: string;
            webhookUrl: string;
            bucketUrl: string;
            apiPort: string;
        }
    }
}

export {}